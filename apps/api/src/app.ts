import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import {
  PROFILS_ASSIGNABLES, TABLES_SYNCHRONISEES, aDroit, aUnDroit, droitsDuProfil, droitsEffectifs, fonctionsDuModule, nettoyerDroits, normaliserTelephone, peutAnnuler, peutEcrireTable,
  peutLireTable, peutValiderDepense, tablesEcrivables,
  type ChangementSync, type DemandeSync, type DroitsMembre, type ReponseSync, type RoleMembre, type TableSynchronisee,
} from '@digitalab/core';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import { transaction, type Pool } from './db.js';
import type { Notifieur } from './notifieur.js';
import { egaux, empreinteCode, empreinteJeton, genererCode, genererJeton } from './securite.js';

export interface Dependances {
  pool: Pool;
  config: Config;
  notifieur: Notifieur;
  /** Horloge, remplaçable dans les tests. */
  maintenant?: () => Date;
  /** Nombre de demandes de connexion par minute et par adresse (15 par défaut ; relevé dans les tests). */
  limiteAuthParMinute?: number;
}

interface Utilisateur {
  id: string;
  telephone: string;
  nom: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    utilisateur?: Utilisateur;
  }
}

class ErreurHttp extends Error {
  constructor(readonly statut: number, message: string) {
    super(message);
  }
}

const VALIDITE_INVITATION_JOURS = 7;
const MAX_ESSAIS_INVITATION = 5;
const LIMITE_REPONSE_SYNC = 1000;
const TAILLE_MAX_ENREGISTREMENT = 50_000;
const MAX_ESSAIS_CODE = 5;

export async function creerApp(dep: Dependances): Promise<FastifyInstance> {
  const { pool, config, notifieur } = dep;
  const maintenant = dep.maintenant ?? (() => new Date());
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024, trustProxy: true });

  await app.register(cors, { origin: config.origines, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['content-type', 'authorization'] });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
    if (err instanceof ErreurHttp) return reply.status(err.statut).send({ erreur: err.message });
    if (err.validation) return reply.status(400).send({ erreur: 'Demande invalide.' });
    if (err.statusCode === 429) return reply.status(429).send({ erreur: 'Trop de demandes. Réessayez dans un instant.' });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ erreur: 'Demande invalide.' });
    console.error('[digitalab] erreur serveur', err);
    return reply.status(500).send({ erreur: 'Erreur du serveur. Réessayez plus tard.' });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ erreur: 'Adresse inconnue.' }));

  /* ---------- Authentification ---------- */

  async function authentifier(req: FastifyRequest): Promise<Utilisateur> {
    const entete = req.headers.authorization ?? '';
    const jeton = entete.startsWith('Bearer ') ? entete.slice(7).trim() : '';
    if (!jeton) throw new ErreurHttp(401, 'Connexion requise.');
    const r = await pool.query<Utilisateur>(
      `SELECT u.id, u.telephone, u.nom FROM sessions s JOIN utilisateurs u ON u.id = s.utilisateur_id WHERE s.jeton_hash = $1 AND s.expire_le > $2`,
      [empreinteJeton(jeton), maintenant()],
    );
    const u = r.rows[0];
    if (!u) throw new ErreurHttp(401, 'Session expirée. Reconnectez-vous.');
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

  const limiteAuth = { config: { rateLimit: { max: dep.limiteAuthParMinute ?? 15, timeWindow: '1 minute' } } };

  app.post('/v1/auth/code', {
    ...limiteAuth,
    schema: { body: { type: 'object', required: ['telephone'], properties: { telephone: { type: 'string', maxLength: 30 } }, additionalProperties: false } },
  }, async (req) => {
    const telephone = normaliserTelephone((req.body as { telephone: string }).telephone);
    if (!telephone) throw new ErreurHttp(400, 'Numéro de téléphone invalide. Exemple : 77 123 45 67.');
    const now = maintenant();
    const recent = await pool.query('SELECT 1 FROM codes_connexion WHERE telephone = $1 AND cree_le > $2', [telephone, new Date(now.getTime() - 60_000)]);
    if (recent.rowCount) throw new ErreurHttp(429, 'Un code vient d’être envoyé. Patientez une minute avant d’en demander un autre.');
    const code = genererCode();
    await pool.query(
      `INSERT INTO codes_connexion (telephone, code_hash, expire_le, essais, cree_le) VALUES ($1, $2, $3, 0, $4)
       ON CONFLICT (telephone) DO UPDATE SET code_hash = EXCLUDED.code_hash, expire_le = EXCLUDED.expire_le, essais = 0, cree_le = EXCLUDED.cree_le`,
      [telephone, empreinteCode(config.secret, telephone, code), new Date(now.getTime() + config.codeValiditeMinutes * 60_000), now],
    );
    await notifieur.envoyerCode(telephone, code);
    return { ok: true, telephone, ...(config.codeDemo ? { codeDemo: code } : {}) };
  });

  app.post('/v1/auth/connexion', {
    ...limiteAuth,
    schema: {
      body: {
        type: 'object', required: ['telephone', 'code'], additionalProperties: false,
        properties: { telephone: { type: 'string', maxLength: 30 }, code: { type: 'string', minLength: 6, maxLength: 6 }, appareil: { type: 'string', maxLength: 80 } },
      },
    },
  }, async (req) => {
    const b = req.body as { telephone: string; code: string; appareil?: string };
    const telephone = normaliserTelephone(b.telephone);
    if (!telephone) throw new ErreurHttp(400, 'Numéro de téléphone invalide.');
    const now = maintenant();
    const ligne = (await pool.query<{ code_hash: string; expire_le: Date; essais: number }>('SELECT code_hash, expire_le, essais FROM codes_connexion WHERE telephone = $1', [telephone])).rows[0];
    const codeSms = ligne && ligne.expire_le > now;
    if (codeSms && ligne.essais >= MAX_ESSAIS_CODE) throw new ErreurHttp(429, 'Trop d’essais. Demandez un nouveau code.');
    const smsBon = codeSms && egaux(ligne.code_hash, empreinteCode(config.secret, telephone, b.code));

    // Sinon, le code a pu être donné par l'administrateur de l'élevage (invitation) : il sert une seule fois.
    let invitation: { organisation_id: string } | undefined;
    if (!smsBon) {
      const invitations = (await pool.query<{ organisation_id: string; invitation_hash: string; invitation_essais: number }>(
        'SELECT organisation_id, invitation_hash, invitation_essais FROM membres WHERE telephone = $1 AND invitation_hash IS NOT NULL AND invitation_expire > $2',
        [telephone, now],
      )).rows;
      if (invitations.some((i) => i.invitation_essais >= MAX_ESSAIS_INVITATION)) throw new ErreurHttp(429, 'Trop d’essais. Demandez un nouveau code à l’administrateur.');
      invitation = invitations.find((i) => egaux(i.invitation_hash, empreinteCode(config.secret, `${telephone}|${i.organisation_id}`, b.code)));
      if (!invitation) {
        if (codeSms) await pool.query('UPDATE codes_connexion SET essais = essais + 1 WHERE telephone = $1', [telephone]);
        if (invitations.length) await pool.query('UPDATE membres SET invitation_essais = invitation_essais + 1 WHERE telephone = $1 AND invitation_hash IS NOT NULL', [telephone]);
        throw new ErreurHttp(400, 'Code invalide ou expiré. Demandez un nouveau code.');
      }
    }
    const jeton = genererJeton();
    const utilisateur = await transaction(pool, async (c) => {
      if (smsBon) await c.query('DELETE FROM codes_connexion WHERE telephone = $1', [telephone]);
      if (invitation) await c.query('UPDATE membres SET invitation_hash = NULL, invitation_expire = NULL, invitation_essais = 0 WHERE organisation_id = $1 AND telephone = $2', [invitation.organisation_id, telephone]);
      const u = (await c.query<Utilisateur>(
        `INSERT INTO utilisateurs (telephone) VALUES ($1) ON CONFLICT (telephone) DO UPDATE SET telephone = EXCLUDED.telephone RETURNING id, telephone, nom`,
        [telephone],
      )).rows[0]!;
      await c.query('UPDATE membres SET utilisateur_id = $1 WHERE telephone = $2 AND utilisateur_id IS NULL', [u.id, telephone]);
      const deja = await c.query('SELECT 1 FROM membres WHERE utilisateur_id = $1', [u.id]);
      if (!deja.rowCount) {
        const o = (await c.query<{ id: string }>('INSERT INTO organisations (nom) VALUES ($1) RETURNING id', ['Mon élevage'])).rows[0]!;
        await c.query(`INSERT INTO membres (organisation_id, telephone, utilisateur_id, role) VALUES ($1, $2, $3, 'proprietaire')`, [o.id, telephone, u.id]);
      }
      await c.query('INSERT INTO sessions (jeton_hash, utilisateur_id, appareil, expire_le) VALUES ($1, $2, $3, $4)', [
        empreinteJeton(jeton), u.id, b.appareil ?? null, new Date(now.getTime() + config.sessionJours * 86_400_000),
      ]);
      return u;
    });
    return { jeton, utilisateur, organisations: await organisationsDe(utilisateur.id) };
  });

  app.post('/v1/auth/deconnexion', async (req) => {
    await authentifier(req);
    const jeton = (req.headers.authorization ?? '').slice(7).trim();
    await pool.query('DELETE FROM sessions WHERE jeton_hash = $1', [empreinteJeton(jeton)]);
    return { ok: true };
  });

  app.get('/v1/moi', async (req) => {
    const u = await authentifier(req);
    return { utilisateur: u, organisations: await organisationsDe(u.id) };
  });

  app.patch('/v1/moi', { schema: { body: { type: 'object', required: ['nom'], properties: { nom: { type: 'string', maxLength: 80 } }, additionalProperties: false } } }, async (req) => {
    const u = await authentifier(req);
    const nom = (req.body as { nom: string }).nom.trim();
    await pool.query('UPDATE utilisateurs SET nom = $1 WHERE id = $2', [nom || null, u.id]);
    return { ok: true };
  });

  /* ---------- Organisations et membres ---------- */

  const paramsOrg = { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } as const;

  app.patch('/v1/organisations/:id', {
    schema: { ...paramsOrg, body: { type: 'object', required: ['nom'], properties: { nom: { type: 'string', minLength: 1, maxLength: 80 } }, additionalProperties: false } },
  }, async (req) => {
    const u = await authentifier(req);
    const { id } = req.params as { id: string };
    await exigerDroit(id, u.id, 'admin.elevage', 'Vous n’avez pas le droit de modifier les informations de l’élevage.');
    await pool.query('UPDATE organisations SET nom = $1 WHERE id = $2', [(req.body as { nom: string }).nom.trim(), id]);
    return { ok: true };
  });

  interface MembreListe {
    telephone: string;
    role: RoleMembre;
    nom: string | null;
    fonction: string | null;
    droits: string[];
    zones: string[];
    actif: boolean;
    invitationEnCours: boolean;
  }

  app.get('/v1/organisations/:id/membres', { schema: paramsOrg }, async (req) => {
    const u = await authentifier(req);
    const { id } = req.params as { id: string };
    await exigerDroit(id, u.id, 'admin.utilisateurs', 'Seuls les administrateurs voient la liste des utilisateurs.');
    const r = await pool.query<LigneMembre & { telephone: string; nom_affiche: string | null; nom: string | null; actif: boolean; invitation: boolean }>(
      `SELECT m.telephone, m.role, m.fonction, m.droits, m.zones, COALESCE(us.nom, m.nom_affiche) AS nom, (m.utilisateur_id IS NOT NULL) AS actif,
              (m.invitation_hash IS NOT NULL AND m.invitation_expire > now()) AS invitation
       FROM membres m LEFT JOIN utilisateurs us ON us.id = m.utilisateur_id
       WHERE m.organisation_id = $1 ORDER BY (m.role = 'proprietaire') DESC, m.cree_le`,
      [id],
    );
    const membres: MembreListe[] = r.rows.map((x) => ({
      telephone: x.telephone, role: x.role, nom: x.nom, fonction: x.fonction, droits: droitsEffectifs(x.role, x.droits), zones: x.zones ?? [], actif: x.actif, invitationEnCours: x.invitation,
    }));
    return { membres };
  });

  /** Crée ou modifie une personne : profil de départ, droits cochés un par un, zones. Renvoie un code de connexion tant qu'elle ne s'est pas connectée. */
  app.post('/v1/organisations/:id/membres', {
    schema: {
      ...paramsOrg,
      body: {
        type: 'object', required: ['telephone'], additionalProperties: false,
        properties: {
          telephone: { type: 'string', maxLength: 30 },
          role: { type: 'string', enum: PROFILS_ASSIGNABLES },
          nom: { type: 'string', maxLength: 80 },
          fonction: { type: 'string', maxLength: 80 },
          droits: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 60 } },
          zones: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 100 } },
          nouveauCode: { type: 'boolean' },
        },
      },
    },
  }, async (req) => {
    const u = await authentifier(req);
    const { id } = req.params as { id: string };
    await exigerDroit(id, u.id, 'admin.utilisateurs', 'Vous n’avez pas le droit de gérer les utilisateurs.');
    const b = req.body as { telephone: string; role?: RoleMembre; nom?: string; fonction?: string; droits?: string[]; zones?: string[]; nouveauCode?: boolean };
    const telephone = normaliserTelephone(b.telephone);
    if (!telephone) throw new ErreurHttp(400, 'Numéro de téléphone invalide. Exemple : 77 123 45 67.');
    const existant = (await pool.query<LigneMembre & { utilisateur_id: string | null }>(
      'SELECT role, fonction, droits, zones, utilisateur_id FROM membres WHERE organisation_id = $1 AND telephone = $2', [id, telephone],
    )).rows[0];
    if (existant?.role === 'proprietaire') throw new ErreurHttp(400, 'Les droits du propriétaire ne se modifient pas.');
    if (!existant && !b.role && !b.droits) throw new ErreurHttp(400, 'Choisissez un profil ou cochez des droits.');
    const role: RoleMembre = b.role ?? (b.droits ? 'personnalise' : existant!.role);
    const droits = nettoyerDroits(b.droits ?? (b.role ? droitsDuProfil(b.role) : droitsEffectifs(existant!.role, existant!.droits)));
    // Seul le propriétaire peut confier la gestion des utilisateurs : sinon un gérant pourrait s'accorder tous les droits.
    const moi = await membreDans(id, u.id);
    if (droits.includes('admin.utilisateurs') && moi.role !== 'proprietaire') throw new ErreurHttp(403, 'Seul le propriétaire peut donner le droit de gérer les utilisateurs.');
    const zones = [...new Set((b.zones ?? existant?.zones ?? []).filter(Boolean))];
    const nouveauCode = b.nouveauCode === true || !existant;
    const code = nouveauCode ? genererCode() : null;
    await pool.query(
      `INSERT INTO membres (organisation_id, telephone, utilisateur_id, role, invite_par, nom_affiche, fonction, droits, zones, invitation_hash, invitation_expire, invitation_essais)
       VALUES ($1, $2, (SELECT id FROM utilisateurs WHERE telephone = $2), $3, $4, $5, $6, $7, $8, $9, $10, 0)
       ON CONFLICT (organisation_id, telephone) DO UPDATE SET
         role = EXCLUDED.role, droits = EXCLUDED.droits, zones = EXCLUDED.zones,
         nom_affiche = COALESCE(EXCLUDED.nom_affiche, membres.nom_affiche), fonction = COALESCE(EXCLUDED.fonction, membres.fonction),
         invitation_hash = COALESCE(EXCLUDED.invitation_hash, membres.invitation_hash), invitation_expire = COALESCE(EXCLUDED.invitation_expire, membres.invitation_expire),
         invitation_essais = CASE WHEN EXCLUDED.invitation_hash IS NULL THEN membres.invitation_essais ELSE 0 END`,
      [
        id, telephone, role, u.id, b.nom?.trim() || null, b.fonction?.trim() || null, droits, zones,
        code ? empreinteCode(config.secret, `${telephone}|${id}`, code) : null,
        code ? new Date(maintenant().getTime() + VALIDITE_INVITATION_JOURS * 86_400_000) : null,
      ],
    );
    return { ok: true, telephone, role, ...(code ? { codeInvitation: code } : {}) };
  });

  app.delete('/v1/organisations/:id/membres/:telephone', {
    schema: { params: { type: 'object', required: ['id', 'telephone'], properties: { id: { type: 'string', format: 'uuid' }, telephone: { type: 'string', maxLength: 30 } } } },
  }, async (req) => {
    const u = await authentifier(req);
    const { id, telephone: brut } = req.params as { id: string; telephone: string };
    await exigerDroit(id, u.id, 'admin.utilisateurs', 'Vous n’avez pas le droit de retirer des personnes.');
    const telephone = normaliserTelephone(decodeURIComponent(brut));
    if (!telephone) throw new ErreurHttp(400, 'Numéro de téléphone invalide.');
    const cible = (await pool.query<{ role: RoleMembre; utilisateur_id: string | null }>('SELECT role, utilisateur_id FROM membres WHERE organisation_id = $1 AND telephone = $2', [id, telephone])).rows[0];
    if (!cible) throw new ErreurHttp(404, 'Cette personne ne fait pas partie de l’élevage.');
    if (cible.role === 'proprietaire') throw new ErreurHttp(400, 'Le propriétaire ne peut pas être retiré.');
    await pool.query('DELETE FROM membres WHERE organisation_id = $1 AND telephone = $2', [id, telephone]);
    return { ok: true };
  });

  /** Déconnecte tous les appareils d'une personne (téléphone perdu, employé parti). Elle devra se reconnecter avec un nouveau code. */
  app.post('/v1/organisations/:id/membres/:telephone/deconnexion', {
    schema: { params: { type: 'object', required: ['id', 'telephone'], properties: { id: { type: 'string', format: 'uuid' }, telephone: { type: 'string', maxLength: 30 } } } },
  }, async (req) => {
    const u = await authentifier(req);
    const { id, telephone: brut } = req.params as { id: string; telephone: string };
    await exigerDroit(id, u.id, 'admin.utilisateurs', 'Vous n’avez pas le droit de déconnecter des personnes.');
    const telephone = normaliserTelephone(decodeURIComponent(brut));
    if (!telephone) throw new ErreurHttp(400, 'Numéro de téléphone invalide.');
    const cible = (await pool.query<{ role: RoleMembre; utilisateur_id: string | null }>('SELECT role, utilisateur_id FROM membres WHERE organisation_id = $1 AND telephone = $2', [id, telephone])).rows[0];
    if (!cible) throw new ErreurHttp(404, 'Cette personne ne fait pas partie de l’élevage.');
    if (cible.role === 'proprietaire' && cible.utilisateur_id === u.id) throw new ErreurHttp(400, 'Vous ne pouvez pas vous déconnecter vous-même ici.');
    const r = cible.utilisateur_id ? await pool.query('DELETE FROM sessions WHERE utilisateur_id = $1', [cible.utilisateur_id]) : { rowCount: 0 };
    return { ok: true, appareils: r.rowCount ?? 0 };
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

  /** Conditions SQL (déjà vérifiées, jamais issues de la saisie) pour ne renvoyer que ce que les droits permettent de lire. */
  function conditionsLecture(droits: string[]): { tables: TableSynchronisee[]; operation: (alias: string) => string } {
    const voitDepenses = aUnDroit(droits, ['finances.voir_depenses', 'finances.valider_depense', 'finances.valider_achat', 'finances.valider_paiement', 'finances.payer', 'finances.annuler_depense']);
    const voitRecettes = aUnDroit(droits, ['finances.voir_recettes', 'finances.saisir_facture', 'finances.encaisser', 'finances.annuler_vente']);
    const voitSalaires = aUnDroit(droits, fonctionsDuModule('salaires'));
    const operation = (a: string) =>
      `(CASE WHEN ${a}.donnees->>'employeId' IS NOT NULL THEN ${voitSalaires} ` +
      `WHEN ${a}.donnees->>'sens' = 'depense' THEN ${voitDepenses} WHEN ${a}.donnees->>'sens' = 'recette' THEN ${voitRecettes} ELSE false END)`;
    return { tables: TABLES_SYNCHRONISEES.filter((t) => peutLireTable(droits, t)), operation };
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
    const lecture = conditionsLecture(moi.droits);

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
        if (r.rowCount === 0) {
          // Version égale : déjà connue. Version plus ancienne que celle du serveur : écartée.
          const actuelle = (await c.query<{ mis_a_jour: string }>('SELECT mis_a_jour FROM enregistrements WHERE organisation_id = $1 AND table_nom = $2 AND id = $3', [id, ch.table, e.id])).rows[0];
          if (actuelle && Number(actuelle.mis_a_jour) > e.misAJour) ecartes += 1;
        }
      }

      /** Cette personne a-t-elle le droit de faire cette modification ? */
      async function autorise(ch: ChangementSync, existant: Record<string, unknown> | undefined): Promise<boolean> {
        const e = ch.enregistrement;
        if (!peutEcrireTable(moi.droits, ch.table)) return false;
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
           AND (e.table_nom <> 'operations' OR ${lecture.operation('e')})
           AND (e.table_nom <> 'paiements' OR EXISTS (
             SELECT 1 FROM enregistrements o WHERE o.organisation_id = e.organisation_id AND o.table_nom = 'operations' AND o.id = e.donnees->>'operationId' AND ${lecture.operation('o')}))
         ORDER BY e.seq LIMIT $4`,
        [id, demande.depuisSeq, lecture.tables, LIMITE_REPONSE_SYNC + 1],
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
