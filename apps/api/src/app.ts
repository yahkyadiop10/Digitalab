import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import {
  BLOCAGE_CONNEXION_MINUTES, ESSAIS_CONNEXION_MAX, LIBELLES_PROFILS, MOT_DE_PASSE_PROVISOIRE_JOURS, PROFILS_ASSIGNABLES, TABLES_SYNCHRONISEES,
  aDroit, decrireEnregistrement, determinerAction, aUnDroit, droitsDuProfil, droitsEffectifs, fonctionsDuModule, identifiantDepuisNom, identifiantLibre, nettoyerDroits,
  normaliserIdentifiant, normaliserTelephone, peutAnnuler, peutEcrireTable, peutLireTable, peutValiderDepense, problemeIdentifiant, problemeMotDePasse, tablesEcrivables,
  type ActionJournal, type ChangementSync, type DemandeSync, type DroitsMembre, type EntreeJournal, type ReponseSync, type RoleMembre, type TableSynchronisee,
} from '@digitalab/core';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import { transaction, type Pool } from './db.js';
import { sansAdministrateur } from './installation.js';
import {
  egaux, empreinteCodeSecours, empreinteJeton, genererCodeSecours, genererJeton, genererMotDePasseProvisoire, hacherMotDePasse, normaliserCle, normaliserCodeSecours, verifierMotDePasse,
} from './securite.js';

export interface Dependances {
  pool: Pool;
  config: Config;
  /** Horloge, remplaçable dans les tests. */
  maintenant?: () => Date;
  /** Nombre de demandes de connexion par minute et par adresse (15 par défaut ; relevé dans les tests). */
  limiteAuthParMinute?: number;
}

interface Utilisateur {
  id: string;
  identifiant: string;
  nom: string | null;
  telephone: string | null;
  /** Mot de passe provisoire : la personne doit d'abord en choisir un autre. */
  doitChanger: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    utilisateur?: Utilisateur;
  }
}

class ErreurHttp extends Error {
  constructor(readonly statut: number, message: string, readonly code?: string) {
    super(message);
  }
}

const LIMITE_REPONSE_SYNC = 1000;
const TAILLE_MAX_ENREGISTREMENT = 50_000;
const NOMBRE_CODES_SECOURS = 8;
const MESSAGE_IDENTIFIANTS = 'Identifiant ou mot de passe incorrect.';
const JOUR_MS = 86_400_000;

export async function creerApp(dep: Dependances): Promise<FastifyInstance> {
  const { pool, config } = dep;
  const maintenant = dep.maintenant ?? (() => new Date());
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024, trustProxy: true });

  await app.register(cors, { origin: config.origines, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['content-type', 'authorization'] });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
    if (err instanceof ErreurHttp) return reply.status(err.statut).send({ erreur: err.message, ...(err.code ? { code: err.code } : {}) });
    if (err.validation) return reply.status(400).send({ erreur: 'Demande invalide.' });
    if (err.statusCode === 429) return reply.status(429).send({ erreur: 'Trop de demandes. Réessayez dans un instant.' });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ erreur: 'Demande invalide.' });
    console.error('[digitalab] erreur serveur', err);
    return reply.status(500).send({ erreur: 'Erreur du serveur. Réessayez plus tard.' });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ erreur: 'Adresse inconnue.' }));

  /* ---------- Authentification ---------- */

  /** Identifie la personne par son jeton. Tant qu'elle n'a pas remplacé son mot de passe provisoire, seules les routes `permissif` lui sont ouvertes. */
  async function authentifier(req: FastifyRequest, options: { permissif?: boolean } = {}): Promise<Utilisateur> {
    const entete = req.headers.authorization ?? '';
    const jeton = entete.startsWith('Bearer ') ? entete.slice(7).trim() : '';
    if (!jeton) throw new ErreurHttp(401, 'Connexion requise.');
    const r = await pool.query<Utilisateur>(
      `SELECT u.id, u.identifiant, u.nom, u.telephone, u.doit_changer AS "doitChanger"
       FROM sessions s JOIN utilisateurs u ON u.id = s.utilisateur_id WHERE s.jeton_hash = $1 AND s.expire_le > $2`,
      [empreinteJeton(jeton), maintenant()],
    );
    const u = r.rows[0];
    if (!u) throw new ErreurHttp(401, 'Session expirée. Reconnectez-vous.');
    if (u.doitChanger && !options.permissif) throw new ErreurHttp(403, 'Choisissez d’abord votre propre mot de passe.', 'changement_requis');
    req.utilisateur = u;
    return u;
  }

  interface LigneMembre {
    role: RoleMembre;
    fonction: string | null;
    droits: string[] | null;
    zones: string[];
  }

  const versDroits = (m: LigneMembre): DroitsMembre => ({
    role: m.role,
    ...(m.fonction ? { fonction: m.fonction } : {}),
    droits: droitsEffectifs(m.role, m.droits),
    zones: m.zones ?? [],
  });

  async function organisationsDe(utilisateurId: string): Promise<({ id: string; nom: string } & DroitsMembre)[]> {
    const r = await pool.query<{ id: string; nom: string } & LigneMembre>(
      `SELECT o.id, o.nom, m.role, m.fonction, m.droits, m.zones FROM membres m JOIN organisations o ON o.id = m.organisation_id WHERE m.utilisateur_id = $1 ORDER BY o.cree_le`,
      [utilisateurId],
    );
    return r.rows.map((x) => ({ id: x.id, nom: x.nom, ...versDroits(x) }));
  }

  /** Vérifie que l'utilisateur appartient à l'organisation et renvoie son profil et ses droits. */
  async function membreDans(organisationId: string, utilisateurId: string): Promise<DroitsMembre> {
    const r = await pool.query<LigneMembre>('SELECT role, fonction, droits, zones FROM membres WHERE organisation_id = $1 AND utilisateur_id = $2', [organisationId, utilisateurId]);
    const m = r.rows[0];
    if (!m) throw new ErreurHttp(404, 'Élevage introuvable.');
    return versDroits(m);
  }

  async function exigerDroit(organisationId: string, utilisateurId: string, code: string, message: string): Promise<DroitsMembre> {
    const m = await membreDans(organisationId, utilisateurId);
    if (!aDroit(m.droits, code)) throw new ErreurHttp(403, message);
    return m;
  }

  interface Acteur {
    id: string;
    identifiant: string;
    nom: string | null;
    fonction: string | null;
  }

  async function acteurDe(organisationId: string, u: Utilisateur): Promise<Acteur> {
    const r = await pool.query<{ fonction: string | null }>('SELECT fonction FROM membres WHERE organisation_id = $1 AND utilisateur_id = $2', [organisationId, u.id]);
    return { id: u.id, identifiant: u.identifiant, nom: u.nom, fonction: r.rows[0]?.fonction ?? null };
  }

  type Executeur = { query: (texte: string, valeurs: unknown[]) => Promise<unknown> };

  /** Écrit une ligne du journal (dans la transaction en cours quand on en passe une). */
  async function journaliser(
    executeur: Executeur,
    organisationId: string, acteur: Acteur, action: ActionJournal, table: string, enregistrementId: string, description: string, faitLe: number,
  ): Promise<void> {
    await executeur.query(
      `INSERT INTO journal (organisation_id, fait_le, utilisateur_id, identifiant, nom, fonction, action, table_nom, enregistrement_id, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [organisationId, faitLe, acteur.id, acteur.identifiant, acteur.nom, acteur.fonction, action, table, enregistrementId, description.slice(0, 300)],
    );
  }

  /** Une action qui touche le compte lui-même (mot de passe…) est notée dans le journal de chaque élevage de la personne. */
  async function journaliserCompte(executeur: Executeur & Pick<Pool, 'query'>, u: Utilisateur, description: string): Promise<void> {
    const orgs = await executeur.query<{ organisation_id: string; fonction: string | null }>('SELECT organisation_id, fonction FROM membres WHERE utilisateur_id = $1', [u.id]);
    for (const o of orgs.rows) {
      await journaliser(executeur, o.organisation_id, { id: u.id, identifiant: u.identifiant, nom: u.nom, fonction: o.fonction }, 'utilisateur', 'utilisateurs', u.identifiant, description, maintenant().getTime());
    }
  }

  const limiteAuth = { config: { rateLimit: { max: dep.limiteAuthParMinute ?? 15, timeWindow: '1 minute' } } };

  /* Blocage après trop d'échecs : suivi par identifiant, qu'il existe ou non, pour ne rien révéler. */

  async function verifierBlocage(cle: string): Promise<void> {
    const r = await pool.query<{ verrouille_jusqua: Date | null }>('SELECT verrouille_jusqua FROM echecs_connexion WHERE cle = $1', [cle]);
    const jusqua = r.rows[0]?.verrouille_jusqua;
    if (jusqua && jusqua > maintenant()) {
      const minutes = Math.max(1, Math.ceil((jusqua.getTime() - maintenant().getTime()) / 60_000));
      throw new ErreurHttp(429, `Trop d’essais. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`);
    }
  }

  async function noterEchec(cle: string): Promise<void> {
    const now = maintenant();
    const r = await pool.query<{ essais: number }>(
      `INSERT INTO echecs_connexion (cle, essais, dernier_le) VALUES ($1, 1, $2)
       ON CONFLICT (cle) DO UPDATE SET
         essais = CASE WHEN echecs_connexion.verrouille_jusqua IS NOT NULL AND echecs_connexion.verrouille_jusqua <= $2 THEN 1 ELSE echecs_connexion.essais + 1 END,
         dernier_le = $2
       RETURNING essais`,
      [cle, now],
    );
    if ((r.rows[0]?.essais ?? 0) >= ESSAIS_CONNEXION_MAX) {
      await pool.query('UPDATE echecs_connexion SET essais = 0, verrouille_jusqua = $2 WHERE cle = $1', [cle, new Date(now.getTime() + BLOCAGE_CONNEXION_MINUTES * 60_000)]);
    }
    await pool.query('DELETE FROM echecs_connexion WHERE dernier_le < $1 AND (verrouille_jusqua IS NULL OR verrouille_jusqua < $1)', [new Date(now.getTime() - JOUR_MS)]);
  }

  const oublierEchecs = (cle: string) => pool.query('DELETE FROM echecs_connexion WHERE cle = $1', [cle]);

  /** Empreinte factice : vérifier un identifiant inconnu prend autant de temps qu'un identifiant connu. */
  let empreinteFactice: Promise<string> | undefined;
  const fausseEmpreinte = () => (empreinteFactice ??= hacherMotDePasse('mot de passe inexistant', config.coutMotDePasse));

  /** Un mot de passe provisoire se recopie : on tolère les majuscules et espaces que le clavier du téléphone ajoute. */
  async function motDePasseJuste(saisi: string, empreinte: string, provisoire: boolean): Promise<boolean> {
    if (await verifierMotDePasse(saisi, empreinte)) return true;
    const retouche = saisi.trim().toLowerCase();
    return provisoire && retouche !== saisi && (await verifierMotDePasse(retouche, empreinte));
  }

  async function ouvrirSession(executeur: Executeur, utilisateurId: string, appareil: string | undefined): Promise<string> {
    const jeton = genererJeton();
    await executeur.query('INSERT INTO sessions (jeton_hash, utilisateur_id, appareil, expire_le) VALUES ($1, $2, $3, $4)', [
      empreinteJeton(jeton), utilisateurId, appareil ?? null, new Date(maintenant().getTime() + config.sessionJours * JOUR_MS),
    ]);
    return jeton;
  }

  const versUtilisateurPublic = (u: Pick<Utilisateur, 'id' | 'identifiant' | 'nom' | 'telephone'>) => ({ id: u.id, identifiant: u.identifiant, nom: u.nom, telephone: u.telephone });

  /** Génère les codes de secours (remplace les précédents) et renvoie leur texte, qui ne sera plus jamais affichable. */
  async function creerCodesSecours(executeur: Executeur, utilisateurId: string): Promise<string[]> {
    await executeur.query('DELETE FROM codes_secours WHERE utilisateur_id = $1', [utilisateurId]);
    const codes = Array.from({ length: NOMBRE_CODES_SECOURS }, () => genererCodeSecours());
    for (const code of codes) {
      await executeur.query('INSERT INTO codes_secours (utilisateur_id, code_hash) VALUES ($1, $2)', [utilisateurId, empreinteCodeSecours(config.secret, code)]);
    }
    return codes;
  }

  /* ----- Premier lancement : création de l'administrateur ----- */

  app.get('/v1/installation', async () => ({ aInitialiser: await sansAdministrateur(pool), cleRequise: !!config.cleInstallation }));

  app.post('/v1/installation', {
    ...limiteAuth,
    schema: {
      body: {
        type: 'object', required: ['identifiant', 'motDePasse'], additionalProperties: false,
        properties: {
          cle: { type: 'string', maxLength: 60 }, identifiant: { type: 'string', maxLength: 60 }, motDePasse: { type: 'string', maxLength: 200 },
          nom: { type: 'string', maxLength: 80 }, nomElevage: { type: 'string', maxLength: 80 }, appareil: { type: 'string', maxLength: 80 },
        },
      },
    },
  }, async (req) => {
    const b = req.body as { cle?: string; identifiant: string; motDePasse: string; nom?: string; nomElevage?: string; appareil?: string };
    if (!(await sansAdministrateur(pool))) throw new ErreurHttp(409, 'L’application est déjà installée. Connectez-vous avec votre identifiant.');
    if (config.cleInstallation) {
      await verifierBlocage('__installation');
      if (!egaux(normaliserCle(b.cle ?? ''), normaliserCle(config.cleInstallation))) {
        await noterEchec('__installation');
        throw new ErreurHttp(403, 'Clé d’installation incorrecte. Elle s’affiche dans la fenêtre du serveur.');
      }
    }
    const identifiant = normaliserIdentifiant(b.identifiant);
    const problemeId = problemeIdentifiant(identifiant);
    if (problemeId) throw new ErreurHttp(400, problemeId);
    const problemeMdp = problemeMotDePasse(b.motDePasse, identifiant);
    if (problemeMdp) throw new ErreurHttp(400, problemeMdp);
    const empreinte = await hacherMotDePasse(b.motDePasse, config.coutMotDePasse);
    const nom = b.nom?.trim() || null;

    const r = await transaction(pool, async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended('installation', 0))`);
      if (!(await sansAdministrateur(c))) throw new ErreurHttp(409, 'L’application est déjà installée. Connectez-vous avec votre identifiant.');
      const pris = await c.query('SELECT 1 FROM utilisateurs WHERE identifiant = $1', [identifiant]);
      if (pris.rowCount) throw new ErreurHttp(409, 'Cet identifiant existe déjà. Choisissez-en un autre.');
      const u = (await c.query<{ id: string }>(
        `INSERT INTO utilisateurs (identifiant, nom, mot_de_passe_hash, derniere_connexion) VALUES ($1, $2, $3, $4) RETURNING id`,
        [identifiant, nom, empreinte, maintenant()],
      )).rows[0]!;
      const o = (await c.query<{ id: string }>('INSERT INTO organisations (nom) VALUES ($1) RETURNING id', [b.nomElevage?.trim() || 'Mon élevage'])).rows[0]!;
      await c.query(`INSERT INTO membres (organisation_id, utilisateur_id, role) VALUES ($1, $2, 'proprietaire')`, [o.id, u.id]);
      const codesSecours = await creerCodesSecours(c, u.id);
      const jeton = await ouvrirSession(c, u.id, b.appareil);
      await journaliser(c, o.id, { id: u.id, identifiant, nom, fonction: null }, 'utilisateur', 'utilisateurs', identifiant, 'a créé le compte administrateur de l’élevage', maintenant().getTime());
      return { jeton, utilisateur: { id: u.id, identifiant, nom, telephone: null }, codesSecours };
    });
    await oublierEchecs('__installation');
    return { ...r, doitChanger: false, organisations: await organisationsDe(r.utilisateur.id) };
  });

  /* ----- Connexion ----- */

  app.post('/v1/auth/connexion', {
    ...limiteAuth,
    schema: {
      body: {
        type: 'object', required: ['identifiant', 'motDePasse'], additionalProperties: false,
        properties: { identifiant: { type: 'string', maxLength: 60 }, motDePasse: { type: 'string', maxLength: 200 }, appareil: { type: 'string', maxLength: 80 } },
      },
    },
  }, async (req) => {
    const b = req.body as { identifiant: string; motDePasse: string; appareil?: string };
    const identifiant = normaliserIdentifiant(b.identifiant);
    await verifierBlocage(identifiant);
    const ligne = (await pool.query<{ id: string; nom: string | null; telephone: string | null; mot_de_passe_hash: string | null; doit_changer: boolean; mot_de_passe_expire: Date | null }>(
      'SELECT id, nom, telephone, mot_de_passe_hash, doit_changer, mot_de_passe_expire FROM utilisateurs WHERE identifiant = $1', [identifiant],
    )).rows[0];
    const empreinte = ligne?.mot_de_passe_hash ?? (await fausseEmpreinte());
    const bon = await motDePasseJuste(b.motDePasse, empreinte, ligne?.doit_changer === true);
    if (!ligne || !ligne.mot_de_passe_hash || !bon) {
      await noterEchec(identifiant);
      throw new ErreurHttp(401, MESSAGE_IDENTIFIANTS);
    }
    if (ligne.doit_changer && ligne.mot_de_passe_expire && ligne.mot_de_passe_expire <= maintenant()) {
      throw new ErreurHttp(403, 'Ce mot de passe provisoire a expiré. Demandez-en un nouveau à votre administrateur.', 'provisoire_expire');
    }
    await oublierEchecs(identifiant);
    const jeton = await ouvrirSession(pool, ligne.id, b.appareil);
    await pool.query('UPDATE utilisateurs SET derniere_connexion = $2 WHERE id = $1', [ligne.id, maintenant()]);
    return {
      jeton, utilisateur: versUtilisateurPublic({ id: ligne.id, identifiant, nom: ligne.nom, telephone: ligne.telephone }),
      doitChanger: ligne.doit_changer, organisations: await organisationsDe(ligne.id),
    };
  });

  /** Mot de passe perdu par le propriétaire : un code de secours, noté sur papier à l'installation, permet d'en choisir un nouveau. */
  app.post('/v1/auth/secours', {
    ...limiteAuth,
    schema: {
      body: {
        type: 'object', required: ['identifiant', 'code', 'nouveauMotDePasse'], additionalProperties: false,
        properties: { identifiant: { type: 'string', maxLength: 60 }, code: { type: 'string', maxLength: 40 }, nouveauMotDePasse: { type: 'string', maxLength: 200 } },
      },
    },
  }, async (req) => {
    const b = req.body as { identifiant: string; code: string; nouveauMotDePasse: string };
    const identifiant = normaliserIdentifiant(b.identifiant);
    await verifierBlocage(identifiant);
    const probleme = problemeMotDePasse(b.nouveauMotDePasse, identifiant);
    if (probleme) throw new ErreurHttp(400, probleme);
    const u = (await pool.query<{ id: string; nom: string | null; telephone: string | null }>('SELECT id, nom, telephone FROM utilisateurs WHERE identifiant = $1', [identifiant])).rows[0];
    const code = u ? (await pool.query<{ id: string }>(
      'SELECT id FROM codes_secours WHERE utilisateur_id = $1 AND utilise_le IS NULL AND code_hash = $2', [u.id, empreinteCodeSecours(config.secret, b.code)],
    )).rows[0] : undefined;
    if (!u || !code || normaliserCodeSecours(b.code).length < 8) {
      await noterEchec(identifiant);
      throw new ErreurHttp(401, 'Identifiant ou code de secours incorrect.');
    }
    const empreinte = await hacherMotDePasse(b.nouveauMotDePasse, config.coutMotDePasse);
    const restants = await transaction(pool, async (c) => {
      const pris = await c.query('UPDATE codes_secours SET utilise_le = $2 WHERE id = $1 AND utilise_le IS NULL', [code.id, maintenant()]);
      if (!pris.rowCount) throw new ErreurHttp(401, 'Identifiant ou code de secours incorrect.');
      await c.query('UPDATE utilisateurs SET mot_de_passe_hash = $2, doit_changer = false, mot_de_passe_expire = NULL WHERE id = $1', [u.id, empreinte]);
      await c.query('DELETE FROM sessions WHERE utilisateur_id = $1', [u.id]);
      await journaliserCompte(c, { id: u.id, identifiant, nom: u.nom, telephone: u.telephone, doitChanger: false }, 'a utilisé un code de secours pour choisir un nouveau mot de passe');
      return Number((await c.query<{ n: string }>('SELECT count(*) AS n FROM codes_secours WHERE utilisateur_id = $1 AND utilise_le IS NULL', [u.id])).rows[0]!.n);
    });
    await oublierEchecs(identifiant);
    return { ok: true, codesRestants: restants };
  });

  app.post('/v1/auth/deconnexion', async (req) => {
    await authentifier(req, { permissif: true });
    const jeton = (req.headers.authorization ?? '').slice(7).trim();
    await pool.query('DELETE FROM sessions WHERE jeton_hash = $1', [empreinteJeton(jeton)]);
    return { ok: true };
  });

  app.get('/v1/moi', async (req) => {
    const u = await authentifier(req, { permissif: true });
    const secours = (await pool.query<{ n: string }>('SELECT count(*) AS n FROM codes_secours WHERE utilisateur_id = $1 AND utilise_le IS NULL', [u.id])).rows[0]!;
    return { utilisateur: { ...versUtilisateurPublic(u), doitChanger: u.doitChanger }, organisations: await organisationsDe(u.id), codesSecoursRestants: Number(secours.n) };
  });

  app.patch('/v1/moi', {
    schema: { body: { type: 'object', additionalProperties: false, properties: { nom: { type: 'string', maxLength: 80 }, telephone: { type: 'string', maxLength: 30 } } } },
  }, async (req) => {
    const u = await authentifier(req);
    const b = req.body as { nom?: string; telephone?: string };
    if (b.nom !== undefined) await pool.query('UPDATE utilisateurs SET nom = $1 WHERE id = $2', [b.nom.trim() || null, u.id]);
    if (b.telephone !== undefined) {
      const tel = b.telephone.trim() ? normaliserTelephone(b.telephone) : null;
      if (b.telephone.trim() && !tel) throw new ErreurHttp(400, 'Numéro de téléphone invalide. Exemple : 77 123 45 67.');
      await pool.query('UPDATE utilisateurs SET telephone = $1 WHERE id = $2', [tel, u.id]);
    }
    return { ok: true };
  });

  /** Changer son mot de passe : indispensable après un mot de passe provisoire, possible à tout moment ensuite. Les autres appareils sont déconnectés. */
  app.post('/v1/moi/mot-de-passe', {
    ...limiteAuth,
    schema: { body: { type: 'object', required: ['ancien', 'nouveau'], additionalProperties: false, properties: { ancien: { type: 'string', maxLength: 200 }, nouveau: { type: 'string', maxLength: 200 } } } },
  }, async (req) => {
    const u = await authentifier(req, { permissif: true });
    const b = req.body as { ancien: string; nouveau: string };
    await verifierBlocage(u.identifiant);
    const ligne = (await pool.query<{ mot_de_passe_hash: string }>('SELECT mot_de_passe_hash FROM utilisateurs WHERE id = $1', [u.id])).rows[0];
    if (!ligne || !(await motDePasseJuste(b.ancien, ligne.mot_de_passe_hash, u.doitChanger))) {
      await noterEchec(u.identifiant);
      throw new ErreurHttp(400, 'Le mot de passe actuel est incorrect.');
    }
    const probleme = problemeMotDePasse(b.nouveau, u.identifiant);
    if (probleme) throw new ErreurHttp(400, probleme);
    if (b.nouveau === b.ancien) throw new ErreurHttp(400, 'Choisissez un mot de passe différent de l’actuel.');
    const empreinte = await hacherMotDePasse(b.nouveau, config.coutMotDePasse);
    const jeton = (req.headers.authorization ?? '').slice(7).trim();
    await transaction(pool, async (c) => {
      await c.query('UPDATE utilisateurs SET mot_de_passe_hash = $2, doit_changer = false, mot_de_passe_expire = NULL WHERE id = $1', [u.id, empreinte]);
      await c.query('DELETE FROM sessions WHERE utilisateur_id = $1 AND jeton_hash <> $2', [u.id, empreinteJeton(jeton)]);
      await journaliserCompte(c, u, u.doitChanger ? 'a choisi son mot de passe personnel' : 'a changé son mot de passe');
    });
    await oublierEchecs(u.identifiant);
    return { ok: true };
  });

  /** Nouveaux codes de secours du propriétaire (les anciens cessent de fonctionner). Demande le mot de passe. */
  app.post('/v1/moi/codes-secours', {
    ...limiteAuth,
    schema: { body: { type: 'object', required: ['motDePasse'], additionalProperties: false, properties: { motDePasse: { type: 'string', maxLength: 200 } } } },
  }, async (req) => {
    const u = await authentifier(req);
    await verifierBlocage(u.identifiant);
    const proprietaire = await pool.query(`SELECT 1 FROM membres WHERE utilisateur_id = $1 AND role = 'proprietaire'`, [u.id]);
    if (!proprietaire.rowCount) throw new ErreurHttp(403, 'Seul le propriétaire a des codes de secours.');
    const ligne = (await pool.query<{ mot_de_passe_hash: string }>('SELECT mot_de_passe_hash FROM utilisateurs WHERE id = $1', [u.id])).rows[0];
    if (!ligne || !(await verifierMotDePasse((req.body as { motDePasse: string }).motDePasse, ligne.mot_de_passe_hash))) {
      await noterEchec(u.identifiant);
      throw new ErreurHttp(400, 'Mot de passe incorrect.');
    }
    const codesSecours = await transaction(pool, async (c) => {
      const codes = await creerCodesSecours(c, u.id);
      await journaliserCompte(c, u, 'a généré de nouveaux codes de secours');
      return codes;
    });
    await oublierEchecs(u.identifiant);
    return { codesSecours };
  });

  /* ---------- Organisations et membres ---------- */

  const paramsOrg = { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } as const;
  const paramsMembre = { params: { type: 'object', required: ['id', 'identifiant'], properties: { id: { type: 'string', format: 'uuid' }, identifiant: { type: 'string', maxLength: 60 } } } } as const;

  app.patch('/v1/organisations/:id', {
    schema: { ...paramsOrg, body: { type: 'object', required: ['nom'], properties: { nom: { type: 'string', minLength: 1, maxLength: 80 } }, additionalProperties: false } },
  }, async (req) => {
    const u = await authentifier(req);
    const { id } = req.params as { id: string };
    await exigerDroit(id, u.id, 'admin.elevage', 'Vous n’avez pas le droit de modifier les informations de l’élevage.');
    await pool.query('UPDATE organisations SET nom = $1 WHERE id = $2', [(req.body as { nom: string }).nom.trim(), id]);
    return { ok: true };
  });

  type EtatCompte = 'actif' | 'provisoire' | 'expire';

  interface MembreListe {
    identifiant: string;
    nom: string | null;
    telephone: string | null;
    role: RoleMembre;
    fonction: string | null;
    droits: string[];
    zones: string[];
    /** `provisoire` : mot de passe donné, pas encore remplacé ; `expire` : il n'est plus valable, il faut en redonner un. */
    etat: EtatCompte;
    derniereConnexion: string | null;
  }

  app.get('/v1/organisations/:id/membres', { schema: paramsOrg }, async (req) => {
    const u = await authentifier(req);
    const { id } = req.params as { id: string };
    await exigerDroit(id, u.id, 'admin.utilisateurs', 'Seuls les administrateurs voient la liste des utilisateurs.');
    const r = await pool.query<LigneMembre & { identifiant: string; nom: string | null; telephone: string | null; doit_changer: boolean; mot_de_passe_expire: Date | null; derniere_connexion: Date | null }>(
      `SELECT us.identifiant, us.nom, us.telephone, m.role, m.fonction, m.droits, m.zones, us.doit_changer, us.mot_de_passe_expire, us.derniere_connexion
       FROM membres m JOIN utilisateurs us ON us.id = m.utilisateur_id
       WHERE m.organisation_id = $1 ORDER BY (m.role = 'proprietaire') DESC, m.cree_le`,
      [id],
    );
    const now = maintenant();
    const membres: MembreListe[] = r.rows.map((x) => ({
      identifiant: x.identifiant, nom: x.nom, telephone: x.telephone, role: x.role, fonction: x.fonction, droits: droitsEffectifs(x.role, x.droits), zones: x.zones ?? [],
      etat: x.doit_changer ? (x.mot_de_passe_expire && x.mot_de_passe_expire <= now ? 'expire' : 'provisoire') : 'actif',
      derniereConnexion: x.derniere_connexion?.toISOString() ?? null,
    }));
    return { membres };
  });

  /** Droits et zones demandés pour une fiche, avec les garde-fous : seul le propriétaire confie la gestion des utilisateurs. */
  async function resoudreDroits(
    organisationId: string, acteur: Utilisateur,
    b: { role?: RoleMembre; droits?: string[]; zones?: string[] },
    existant?: { role: RoleMembre; droits: string[] | null; zones: string[] },
  ): Promise<{ role: RoleMembre; droits: string[]; zones: string[] }> {
    if (!existant && !b.role && !b.droits) throw new ErreurHttp(400, 'Choisissez un profil ou cochez des droits.');
    const role: RoleMembre = b.role ?? (b.droits ? 'personnalise' : existant!.role);
    const droits = nettoyerDroits(b.droits ?? (b.role ? droitsDuProfil(b.role) : droitsEffectifs(existant!.role, existant!.droits)));
    const moi = await membreDans(organisationId, acteur.id);
    // Sinon un gérant pourrait s'accorder tous les droits.
    if (droits.includes('admin.utilisateurs') && moi.role !== 'proprietaire') throw new ErreurHttp(403, 'Seul le propriétaire peut donner le droit de gérer les utilisateurs.');
    return { role, droits, zones: [...new Set((b.zones ?? existant?.zones ?? []).filter(Boolean))] };
  }

  const descriptionDroits = (role: RoleMembre, droits: string[], zones: string[]) =>
    `profil ${LIBELLES_PROFILS[role].toLowerCase()}, ${droits.length} fonction${droits.length > 1 ? 's' : ''}${zones.length ? `, ${zones.length} bâtiment${zones.length > 1 ? 's' : ''}` : ''}`;

  const schemaDroits = {
    role: { type: 'string', enum: PROFILS_ASSIGNABLES },
    fonction: { type: 'string', maxLength: 80 },
    telephone: { type: 'string', maxLength: 30 },
    droits: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 60 } },
    zones: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 100 } },
  } as const;

  const telephoneFacultatif = (brut: string | undefined): string | null => {
    if (!brut?.trim()) return null;
    const tel = normaliserTelephone(brut);
    if (!tel) throw new ErreurHttp(400, 'Numéro de téléphone invalide. Exemple : 77 123 45 67.');
    return tel;
  };

  /**
   * Ajoute une personne : le serveur crée son identifiant (nom.prénom) et un mot de passe provisoire propre à elle, montré une seule fois à l'administrateur.
   * La personne devra en choisir un autre dès sa première connexion, avant l'expiration du provisoire.
   */
  app.post('/v1/organisations/:id/membres', {
    schema: {
      ...paramsOrg,
      body: {
        type: 'object', required: ['prenom', 'nom'], additionalProperties: false,
        properties: { prenom: { type: 'string', minLength: 1, maxLength: 60 }, nom: { type: 'string', minLength: 1, maxLength: 60 }, ...schemaDroits },
      },
    },
  }, async (req) => {
    const u = await authentifier(req);
    const { id } = req.params as { id: string };
    await exigerDroit(id, u.id, 'admin.utilisateurs', 'Vous n’avez pas le droit de gérer les utilisateurs.');
    const b = req.body as { prenom: string; nom: string; telephone?: string; fonction?: string; role?: RoleMembre; droits?: string[]; zones?: string[] };
    const prenom = b.prenom.trim();
    const nom = b.nom.trim();
    const base = identifiantDepuisNom(prenom, nom);
    if (problemeIdentifiant(base)) throw new ErreurHttp(400, 'Le nom et le prénom doivent contenir des lettres.');
    const telephone = telephoneFacultatif(b.telephone);
    const { role, droits, zones } = await resoudreDroits(id, u, b);
    const motDePasseProvisoire = genererMotDePasseProvisoire();
    const empreinte = await hacherMotDePasse(motDePasseProvisoire, config.coutMotDePasse);
    const expire = new Date(maintenant().getTime() + MOT_DE_PASSE_PROVISOIRE_JOURS * JOUR_MS);
    const nomAffiche = `${prenom} ${nom}`;
    const acteur = await acteurDe(id, u);

    const identifiant = await transaction(pool, async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended('identifiants', 0))`);
      const proches = new Set((await c.query<{ identifiant: string }>(`SELECT identifiant FROM utilisateurs WHERE identifiant LIKE $1 || '%'`, [base])).rows.map((x) => x.identifiant));
      const libre = identifiantLibre(base, (x) => proches.has(x));
      const nouveau = (await c.query<{ id: string }>(
        `INSERT INTO utilisateurs (identifiant, nom, telephone, mot_de_passe_hash, doit_changer, mot_de_passe_expire) VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
        [libre, nomAffiche, telephone, empreinte, expire],
      )).rows[0]!;
      await c.query(
        `INSERT INTO membres (organisation_id, utilisateur_id, role, invite_par, fonction, droits, zones) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, nouveau.id, role, u.id, b.fonction?.trim() || null, droits, zones],
      );
      await journaliser(
        c, id, acteur, 'utilisateur', 'utilisateurs', libre,
        `a ajouté ${nomAffiche}${b.fonction?.trim() ? ` (${b.fonction.trim()})` : ''} · identifiant ${libre}, ${descriptionDroits(role, droits, zones)}`, maintenant().getTime(),
      );
      return libre;
    });
    return { ok: true, identifiant, nom: nomAffiche, role, motDePasseProvisoire, expireLe: expire.toISOString() };
  });

  /** Cherche une personne de l'élevage par son identifiant. */
  async function cibleDe(organisationId: string, brut: string) {
    const identifiant = normaliserIdentifiant(brut);
    const cible = (await pool.query<LigneMembre & { utilisateur_id: string; identifiant: string; nom: string | null }>(
      `SELECT m.utilisateur_id, us.identifiant, us.nom, m.role, m.fonction, m.droits, m.zones FROM membres m JOIN utilisateurs us ON us.id = m.utilisateur_id
       WHERE m.organisation_id = $1 AND us.identifiant = $2`,
      [organisationId, identifiant],
    )).rows[0];
    if (!cible) throw new ErreurHttp(404, 'Cette personne ne fait pas partie de l’élevage.');
    return cible;
  }

  /** Modifie une personne : nom, téléphone, fonction, profil, droits cochés, zones. */
  app.patch('/v1/organisations/:id/membres/:identifiant', {
    schema: {
      ...paramsMembre,
      body: { type: 'object', additionalProperties: false, properties: { nom: { type: 'string', minLength: 1, maxLength: 80 }, ...schemaDroits } },
    },
  }, async (req) => {
    const u = await authentifier(req);
    const { id, identifiant } = req.params as { id: string; identifiant: string };
    await exigerDroit(id, u.id, 'admin.utilisateurs', 'Vous n’avez pas le droit de gérer les utilisateurs.');
    const cible = await cibleDe(id, identifiant);
    if (cible.role === 'proprietaire') throw new ErreurHttp(400, 'Les droits du propriétaire ne se modifient pas.');
    if (cible.utilisateur_id === u.id) throw new ErreurHttp(400, 'Vous ne pouvez pas modifier vos propres droits.');
    const b = req.body as { nom?: string; telephone?: string; fonction?: string; role?: RoleMembre; droits?: string[]; zones?: string[] };
    const { role, droits, zones } = await resoudreDroits(id, u, b, cible);
    const telephone = b.telephone === undefined ? undefined : telephoneFacultatif(b.telephone);
    const fonction = b.fonction === undefined ? cible.fonction : b.fonction.trim() || null;
    await transaction(pool, async (c) => {
      await c.query('UPDATE membres SET role = $3, droits = $4, zones = $5, fonction = $6 WHERE organisation_id = $1 AND utilisateur_id = $2', [id, cible.utilisateur_id, role, droits, zones, fonction]);
      if (b.nom !== undefined) await c.query('UPDATE utilisateurs SET nom = $2 WHERE id = $1', [cible.utilisateur_id, b.nom.trim()]);
      if (telephone !== undefined) await c.query('UPDATE utilisateurs SET telephone = $2 WHERE id = $1', [cible.utilisateur_id, telephone]);
    });
    await journaliser(
      pool, id, await acteurDe(id, u), 'utilisateur', 'utilisateurs', cible.identifiant,
      `a modifié les droits de ${b.nom?.trim() || cible.nom || cible.identifiant}${fonction ? ` (${fonction})` : ''} · ${descriptionDroits(role, droits, zones)}`, maintenant().getTime(),
    );
    return { ok: true, identifiant: cible.identifiant, role };
  });

  /** Nouveau mot de passe provisoire (oubli, mot de passe perdu ou expiré). Les appareils de la personne sont déconnectés. L'administrateur ne voit jamais le vrai mot de passe. */
  app.post('/v1/organisations/:id/membres/:identifiant/mot-de-passe', { ...limiteAuth, schema: { ...paramsMembre } }, async (req) => {
    const u = await authentifier(req);
    const { id, identifiant } = req.params as { id: string; identifiant: string };
    const moi = await exigerDroit(id, u.id, 'admin.utilisateurs', 'Vous n’avez pas le droit de réinitialiser des mots de passe.');
    const cible = await cibleDe(id, identifiant);
    if (cible.utilisateur_id === u.id) throw new ErreurHttp(400, 'Pour changer votre propre mot de passe, utilisez « Compte ».');
    if (cible.role === 'proprietaire') throw new ErreurHttp(403, 'Le mot de passe du propriétaire ne se réinitialise pas ici : il utilise ses codes de secours.');
    if (moi.role !== 'proprietaire' && aDroit(droitsEffectifs(cible.role, cible.droits), 'admin.utilisateurs')) {
      throw new ErreurHttp(403, 'Seul le propriétaire peut réinitialiser le mot de passe d’une personne qui gère les utilisateurs.');
    }
    const motDePasseProvisoire = genererMotDePasseProvisoire();
    const empreinte = await hacherMotDePasse(motDePasseProvisoire, config.coutMotDePasse);
    const expire = new Date(maintenant().getTime() + MOT_DE_PASSE_PROVISOIRE_JOURS * JOUR_MS);
    await transaction(pool, async (c) => {
      await c.query('UPDATE utilisateurs SET mot_de_passe_hash = $2, doit_changer = true, mot_de_passe_expire = $3 WHERE id = $1', [cible.utilisateur_id, empreinte, expire]);
      await c.query('DELETE FROM sessions WHERE utilisateur_id = $1', [cible.utilisateur_id]);
      await c.query('DELETE FROM echecs_connexion WHERE cle = $1', [cible.identifiant]);
    });
    await journaliser(pool, id, await acteurDe(id, u), 'utilisateur', 'utilisateurs', cible.identifiant, `a réinitialisé le mot de passe de ${cible.nom ?? cible.identifiant}`, maintenant().getTime());
    return { ok: true, identifiant: cible.identifiant, nom: cible.nom, motDePasseProvisoire, expireLe: expire.toISOString() };
  });

  app.delete('/v1/organisations/:id/membres/:identifiant', { schema: paramsMembre }, async (req) => {
    const u = await authentifier(req);
    const { id, identifiant } = req.params as { id: string; identifiant: string };
    await exigerDroit(id, u.id, 'admin.utilisateurs', 'Vous n’avez pas le droit de retirer des personnes.');
    const cible = await cibleDe(id, identifiant);
    if (cible.role === 'proprietaire') throw new ErreurHttp(400, 'Le propriétaire ne peut pas être retiré.');
    if (cible.utilisateur_id === u.id) throw new ErreurHttp(400, 'Vous ne pouvez pas vous retirer vous-même.');
    await transaction(pool, async (c) => {
      await c.query('DELETE FROM membres WHERE organisation_id = $1 AND utilisateur_id = $2', [id, cible.utilisateur_id]);
      // Une personne qui n'appartient plus à aucun élevage n'a plus de raison d'avoir un compte : son identifiant redevient libre.
      await c.query('DELETE FROM utilisateurs u WHERE u.id = $1 AND NOT EXISTS (SELECT 1 FROM membres m WHERE m.utilisateur_id = u.id)', [cible.utilisateur_id]);
    });
    await journaliser(pool, id, await acteurDe(id, u), 'utilisateur', 'utilisateurs', cible.identifiant, `a retiré ${cible.nom ?? cible.identifiant} de l’élevage`, maintenant().getTime());
    return { ok: true };
  });

  /** Déconnecte tous les appareils d'une personne (téléphone perdu, employé parti). Elle devra se reconnecter avec son mot de passe. */
  app.post('/v1/organisations/:id/membres/:identifiant/deconnexion', { schema: paramsMembre }, async (req) => {
    const u = await authentifier(req);
    const { id, identifiant } = req.params as { id: string; identifiant: string };
    await exigerDroit(id, u.id, 'admin.utilisateurs', 'Vous n’avez pas le droit de déconnecter des personnes.');
    const cible = await cibleDe(id, identifiant);
    if (cible.utilisateur_id === u.id) throw new ErreurHttp(400, 'Vous ne pouvez pas vous déconnecter vous-même ici.');
    const r = await pool.query('DELETE FROM sessions WHERE utilisateur_id = $1', [cible.utilisateur_id]);
    await journaliser(pool, id, await acteurDe(id, u), 'utilisateur', 'utilisateurs', cible.identifiant, `a déconnecté les appareils de ${cible.nom ?? cible.identifiant}`, maintenant().getTime());
    return { ok: true, appareils: r.rowCount ?? 0 };
  });

/* ---------- Journal d'activité ---------- */

  app.get('/v1/organisations/:id/journal', {
    schema: {
      ...paramsOrg,
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { avant: { type: 'integer', minimum: 1 }, limite: { type: 'integer', minimum: 1, maximum: 200 }, identifiant: { type: 'string', maxLength: 60 }, table: { type: 'string', maxLength: 40 } },
      },
    },
  }, async (req) => {
    const u = await authentifier(req);
    const { id } = req.params as { id: string };
    await exigerDroit(id, u.id, 'admin.journal', 'Vous n’avez pas le droit de consulter le journal d’activité.');
    const q = req.query as { avant?: number; limite?: number; identifiant?: string; table?: string };
    const limite = q.limite ?? 50;
    const qui = q.identifiant ? normaliserIdentifiant(q.identifiant) : null;
    const r = await pool.query<{ id: string; fait_le: string; recu_le: Date; identifiant: string; nom: string | null; fonction: string | null; action: ActionJournal; table_nom: string; enregistrement_id: string; description: string }>(
      `SELECT id, fait_le, recu_le, identifiant, nom, fonction, action, table_nom, enregistrement_id, description FROM journal
       WHERE organisation_id = $1 AND ($2::bigint IS NULL OR id < $2) AND ($3::text IS NULL OR identifiant = $3) AND ($4::text IS NULL OR table_nom = $4)
       ORDER BY id DESC LIMIT $5`,
      [id, q.avant ?? null, qui, q.table ?? null, limite + 1],
    );
    const lignes = r.rows.slice(0, limite);
    const entrees: EntreeJournal[] = lignes.map((x) => ({
      id: Number(x.id), faitLe: Number(x.fait_le), recuLe: x.recu_le.toISOString(), identifiant: x.identifiant, nom: x.nom, fonction: x.fonction, action: x.action, table: x.table_nom, enregistrementId: x.enregistrement_id, description: x.description,
    }));
    return { entrees, reste: r.rows.length > limite };
  });

  /* ---------- Synchronisation ---------- */

  const changementSchema = {
    type: 'object', required: ['table', 'enregistrement'], additionalProperties: false,
    properties: {
      table: { type: 'string', enum: [...TABLES_SYNCHRONISEES] },
      enregistrement: {
        type: 'object', required: ['id', 'misAJour'],
        properties: { id: { type: 'string', minLength: 1, maxLength: 100 }, misAJour: { type: 'integer', minimum: 1 }, supprimeLe: { type: ['integer', 'null'] } },
      },
    },
  } as const;

  /**
   * Conditions SQL (déjà vérifiées, jamais issues de la saisie) pour ne renvoyer que ce que les droits et les bâtiments réservés permettent de lire.
   * Quand des zones sont données, le paramètre `$5` est la liste des bâtiments et cages autorisés.
   */
  function conditionsLecture(droits: string[], zones: string[]): { tables: TableSynchronisee[]; operation: (alias: string) => string; zone: string } {
    // Voir les soldes des comptes suppose de voir les règlements qui les composent.
    const voitTresorerie = aUnDroit(droits, fonctionsDuModule('tresorerie'));
    const voitDepenses = voitTresorerie || aUnDroit(droits, ['finances.voir_depenses', 'finances.valider_depense', 'finances.valider_achat', 'finances.valider_paiement', 'finances.payer', 'finances.annuler_depense']);
    const voitRecettes = voitTresorerie || aUnDroit(droits, ['finances.voir_recettes', 'finances.saisir_facture', 'finances.encaisser', 'finances.annuler_vente']);
    const voitSalaires = voitTresorerie || aUnDroit(droits, fonctionsDuModule('salaires'));
    const lotEnZone = (organisation: string, idLot: string) =>
      `EXISTS (SELECT 1 FROM enregistrements zl WHERE zl.organisation_id = ${organisation} AND zl.table_nom = 'lots' AND zl.id = ${idLot} AND zl.donnees->>'logementId' = ANY($5::text[]))`;
    const operation = (a: string) =>
      `(CASE WHEN ${a}.donnees->>'employeId' IS NOT NULL THEN ${voitSalaires} ` +
      `WHEN ${a}.donnees->>'sens' = 'depense' THEN ${voitDepenses} WHEN ${a}.donnees->>'sens' = 'recette' THEN ${voitRecettes} ELSE false END)` +
      (zones.length ? ` AND (${a}.donnees->>'lotId' IS NULL OR ${lotEnZone(`${a}.organisation_id`, `${a}.donnees->>'lotId'`)})` : '');
    const zone = zones.length === 0 ? 'true' : `(CASE e.table_nom
      WHEN 'logements' THEN e.id = ANY($5::text[])
      WHEN 'lots' THEN e.donnees->>'logementId' = ANY($5::text[])
      WHEN 'mouvements' THEN ${lotEnZone('e.organisation_id', "e.donnees->>'lotId'")}
      WHEN 'pontes' THEN ${lotEnZone('e.organisation_id', "e.donnees->>'lotId'")}
      WHEN 'distributions' THEN ${lotEnZone('e.organisation_id', "e.donnees->>'lotId'")}
      WHEN 'evenementsSante' THEN ${lotEnZone('e.organisation_id', "e.donnees->>'lotId'")}
      WHEN 'quarantaines' THEN (e.donnees->>'logementId' = ANY($5::text[]) OR ${lotEnZone('e.organisation_id', "e.donnees->>'lotId'")})
      WHEN 'notesQuarantaine' THEN EXISTS (SELECT 1 FROM enregistrements zq WHERE zq.organisation_id = e.organisation_id AND zq.table_nom = 'quarantaines' AND zq.id = e.donnees->>'quarantaineId'
        AND (zq.donnees->>'logementId' = ANY($5::text[]) OR ${lotEnZone('zq.organisation_id', "zq.donnees->>'lotId'")}))
      ELSE true END)`;
    return { tables: TABLES_SYNCHRONISEES.filter((t) => peutLireTable(droits, t)), operation, zone };
  }

  app.post('/v1/organisations/:id/sync', {
    bodyLimit: 4 * 1024 * 1024,
    schema: {
      ...paramsOrg,
      body: {
        type: 'object', required: ['depuisSeq', 'changements'], additionalProperties: false,
        properties: { depuisSeq: { type: 'integer', minimum: 0 }, changements: { type: 'array', maxItems: 500, items: changementSchema } },
      },
    },
  }, async (req): Promise<ReponseSync> => {
    const u = await authentifier(req);
    const { id } = req.params as { id: string };
    const moi = await membreDans(id, u.id);
    const demande = req.body as DemandeSync;
    if (demande.changements.length > 0 && tablesEcrivables(moi.droits).length === 0) {
      throw new ErreurHttp(403, 'Vos droits permettent seulement de consulter les données de cet élevage.');
    }
    for (const ch of demande.changements) {
      if (JSON.stringify(ch.enregistrement).length > TAILLE_MAX_ENREGISTREMENT) throw new ErreurHttp(400, 'Un enregistrement est trop volumineux.');
    }
    const lecture = conditionsLecture(moi.droits, moi.zones);
    const acteur = await acteurDe(id, u);

    return transaction(pool, async (c) => {
      // Une seule synchronisation à la fois par élevage : l'ordre des numéros de séquence reste celui de validation.
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id]);
      let ecartes = 0;
      let refuses = 0;
      const donneeDe = async (table: string, idEnr: string) =>
        (await c.query<{ donnees: Record<string, unknown> }>('SELECT donnees FROM enregistrements WHERE organisation_id = $1 AND table_nom = $2 AND id = $3', [id, table, idEnr])).rows[0]?.donnees;

      for (const ch of demande.changements as ChangementSync[]) {
        const e = ch.enregistrement;
        const existant = await donneeDe(ch.table, e.id);
        if (!(await autorise(ch, existant))) {
          refuses += 1;
          continue;
        }
        const r = await c.query(
          `INSERT INTO enregistrements (organisation_id, table_nom, id, donnees, mis_a_jour, supprime_le)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (organisation_id, table_nom, id) DO UPDATE
             SET donnees = EXCLUDED.donnees, mis_a_jour = EXCLUDED.mis_a_jour, supprime_le = EXCLUDED.supprime_le, seq = nextval('enregistrements_seq')
             WHERE enregistrements.mis_a_jour < EXCLUDED.mis_a_jour
           RETURNING seq`,
          [id, ch.table, e.id, JSON.stringify(e), e.misAJour, e.supprimeLe ?? null],
        );
        if (r.rowCount) {
          await journaliser(c, id, acteur, determinerAction(existant, e), ch.table, e.id, decrireEnregistrement(ch.table, e), e.misAJour);
        } else {
          // Version égale : déjà connue. Version plus ancienne que celle du serveur : écartée.
          const actuelle = (await c.query<{ mis_a_jour: string }>('SELECT mis_a_jour FROM enregistrements WHERE organisation_id = $1 AND table_nom = $2 AND id = $3', [id, ch.table, e.id])).rows[0];
          if (actuelle && Number(actuelle.mis_a_jour) > e.misAJour) ecartes += 1;
        }
      }

      /** Une personne limitée à des bâtiments ne peut écrire que dans ces bâtiments (ou sur leurs lots). */
      async function dansLesZones(ch: ChangementSync, existant: Record<string, unknown> | undefined): Promise<boolean> {
        const e = ch.enregistrement;
        const zones = new Set(moi.zones);
        const logementOk = (v: unknown) => typeof v === 'string' && zones.has(v);
        const lotOk = async (idLot: unknown) => typeof idLot === 'string' && logementOk((await donneeDe('lots', idLot))?.['logementId']);
        switch (ch.table) {
          case 'logements': return zones.has(e.id);
          case 'lots': return logementOk(e['logementId']) && (!existant || logementOk(existant['logementId']));
          case 'mouvements': case 'pontes': case 'distributions': case 'evenementsSante': return lotOk(e['lotId']);
          case 'quarantaines': return logementOk(e['logementId']) || lotOk(e['lotId']);
          case 'notesQuarantaine': {
            const q = typeof e['quarantaineId'] === 'string' ? await donneeDe('quarantaines', e['quarantaineId']) : undefined;
            return !!q && (logementOk(q['logementId']) || (await lotOk(q['lotId'])));
          }
          case 'operations': return e['lotId'] == null || lotOk(e['lotId']);
          case 'paiements': {
            const op = typeof e['operationId'] === 'string' ? await donneeDe('operations', e['operationId']) : undefined;
            return !!op && (op['lotId'] == null || (await lotOk(op['lotId'])));
          }
          default: return true;
        }
      }

      /** Cette personne a-t-elle le droit de faire cette modification ? */
      async function autorise(ch: ChangementSync, existant: Record<string, unknown> | undefined): Promise<boolean> {
        const e = ch.enregistrement;
        if (!peutEcrireTable(moi.droits, ch.table)) return false;
        if (moi.zones.length > 0 && !(await dansLesZones(ch, existant))) return false;
        if (e.supprimeLe) {
          let sens = e['sens'];
          if (ch.table === 'paiements' && typeof e['operationId'] === 'string') sens = (await donneeDe('operations', e['operationId']))?.['sens'];
          if (!peutAnnuler(moi.droits, ch.table, { sens })) return false;
        }
        // Validation : seul un responsable peut passer une dépense ou un paiement à « validé ».
        if (ch.table === 'operations' && e['sens'] === 'depense') {
          const devientValide = e['statut'] !== 'a_valider' && (existant ? existant['statut'] === 'a_valider' : true);
          const salaire = typeof e['employeId'] === 'string';
          const droitSalaire = salaire && aDroit(moi.droits, 'salaires.payer');
          if (devientValide && !droitSalaire && !peutValiderDepense(moi.droits, String(e['categorie'] ?? ''))) return false;
        }
        if (ch.table === 'paiements') {
          const op = typeof e['operationId'] === 'string' ? await donneeDe('operations', e['operationId']) : undefined;
          const devientValide = e['statut'] !== 'a_valider' && (existant ? existant['statut'] === 'a_valider' : true);
          if (op?.['sens'] === 'depense' && devientValide && !aUnDroit(moi.droits, ['finances.valider_paiement', 'salaires.payer'])) return false;
          if (op?.['sens'] === 'recette' && !aUnDroit(moi.droits, ['finances.encaisser', 'finances.saisir_facture', 'finances.valider_paiement'])) return false;
        }
        return true;
      }

      const lignes = (await c.query<{ table_nom: ChangementSync['table']; donnees: ChangementSync['enregistrement']; seq: string }>(
        `SELECT e.table_nom, e.donnees, e.seq FROM enregistrements e
         WHERE e.organisation_id = $1 AND e.seq > $2 AND e.table_nom = ANY($3::text[])
           AND ${lecture.zone} AND $5::text[] IS NOT NULL
           AND (e.table_nom <> 'operations' OR ${lecture.operation('e')})
           AND (e.table_nom <> 'paiements' OR EXISTS (
             SELECT 1 FROM enregistrements o WHERE o.organisation_id = e.organisation_id AND o.table_nom = 'operations' AND o.id = e.donnees->>'operationId' AND ${lecture.operation('o')}))
         ORDER BY e.seq LIMIT $4`,
        [id, demande.depuisSeq, lecture.tables, LIMITE_REPONSE_SYNC + 1, moi.zones],
      )).rows;
      const reste = lignes.length > LIMITE_REPONSE_SYNC;
      const gardees = reste ? lignes.slice(0, LIMITE_REPONSE_SYNC) : lignes;
      const dernier = gardees.at(-1);
      return {
        seq: dernier ? Number(dernier.seq) : demande.depuisSeq,
        changements: gardees.map((l) => ({ table: l.table_nom, enregistrement: l.donnees })),
        reste,
        ecartes,
        refuses,
        moi,
      };
    });
  });

  app.get('/v1/sante', async () => ({ ok: true }));

  return app;
}
