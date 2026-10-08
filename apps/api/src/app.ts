import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ROLES, TABLES_SYNCHRONISEES, normaliserTelephone, type ChangementSync, type DemandeSync, type ReponseSync, type RoleMembre } from '@digitalab/core';
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

const ROLES_INVITABLES: RoleMembre[] = ['soigneur', 'veterinaire', 'lecteur'];
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

  async function organisationsDe(utilisateurId: string): Promise<{ id: string; nom: string; role: RoleMembre }[]> {
    const r = await pool.query<{ id: string; nom: string; role: RoleMembre }>(
      `SELECT o.id, o.nom, m.role FROM membres m JOIN organisations o ON o.id = m.organisation_id WHERE m.utilisateur_id = $1 ORDER BY o.cree_le`,
      [utilisateurId],
    );
    return r.rows;
  }

  /** Vérifie que l'utilisateur appartient à l'organisation et renvoie son rôle. */
  async function roleDans(organisationId: string, utilisateurId: string): Promise<RoleMembre> {
    const r = await pool.query<{ role: RoleMembre }>('SELECT role FROM membres WHERE organisation_id = $1 AND utilisateur_id = $2', [organisationId, utilisateurId]);
    const role = r.rows[0]?.role;
    if (!role) throw new ErreurHttp(404, 'Élevage introuvable.');
    return role;
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
    if (!ligne || ligne.expire_le <= now) throw new ErreurHttp(400, 'Code invalide ou expiré. Demandez un nouveau code.');
    if (ligne.essais >= MAX_ESSAIS_CODE) throw new ErreurHttp(429, 'Trop d’essais. Demandez un nouveau code.');
    if (!egaux(ligne.code_hash, empreinteCode(config.secret, telephone, b.code))) {
      await pool.query('UPDATE codes_connexion SET essais = essais + 1 WHERE telephone = $1', [telephone]);
      throw new ErreurHttp(400, 'Code invalide ou expiré. Demandez un nouveau code.');
    }
    const jeton = genererJeton();
    const utilisateur = await transaction(pool, async (c) => {
      await c.query('DELETE FROM codes_connexion WHERE telephone = $1', [telephone]);
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
    if ((await roleDans(id, u.id)) !== 'proprietaire') throw new ErreurHttp(403, 'Seul le propriétaire peut renommer l’élevage.');
    await pool.query('UPDATE organisations SET nom = $1 WHERE id = $2', [(req.body as { nom: string }).nom.trim(), id]);
    return { ok: true };
  });

  app.get('/v1/organisations/:id/membres', { schema: paramsOrg }, async (req) => {
    const u = await authentifier(req);
    const { id } = req.params as { id: string };
    await roleDans(id, u.id);
    const r = await pool.query<{ telephone: string; role: RoleMembre; actif: boolean; nom: string | null }>(
      `SELECT m.telephone, m.role, (m.utilisateur_id IS NOT NULL) AS actif, us.nom FROM membres m LEFT JOIN utilisateurs us ON us.id = m.utilisateur_id
       WHERE m.organisation_id = $1 ORDER BY (m.role = 'proprietaire') DESC, m.cree_le`,
      [id],
    );
    return { membres: r.rows };
  });

  app.post('/v1/organisations/:id/membres', {
    schema: {
      ...paramsOrg,
      body: { type: 'object', required: ['telephone', 'role'], additionalProperties: false, properties: { telephone: { type: 'string', maxLength: 30 }, role: { type: 'string', enum: ROLES_INVITABLES } } },
    },
  }, async (req) => {
    const u = await authentifier(req);
    const { id } = req.params as { id: string };
    if ((await roleDans(id, u.id)) !== 'proprietaire') throw new ErreurHttp(403, 'Seul le propriétaire peut inviter des personnes.');
    const b = req.body as { telephone: string; role: RoleMembre };
    const telephone = normaliserTelephone(b.telephone);
    if (!telephone) throw new ErreurHttp(400, 'Numéro de téléphone invalide. Exemple : 77 123 45 67.');
    const existant = (await pool.query<{ role: RoleMembre }>('SELECT role FROM membres WHERE organisation_id = $1 AND telephone = $2', [id, telephone])).rows[0];
    if (existant?.role === 'proprietaire') throw new ErreurHttp(400, 'Cette personne est déjà propriétaire de l’élevage.');
    await pool.query(
      `INSERT INTO membres (organisation_id, telephone, utilisateur_id, role, invite_par)
       VALUES ($1, $2, (SELECT id FROM utilisateurs WHERE telephone = $2), $3, $4)
       ON CONFLICT (organisation_id, telephone) DO UPDATE SET role = EXCLUDED.role`,
      [id, telephone, b.role, u.id],
    );
    return { ok: true, telephone, role: b.role };
  });

  app.delete('/v1/organisations/:id/membres/:telephone', {
    schema: { params: { type: 'object', required: ['id', 'telephone'], properties: { id: { type: 'string', format: 'uuid' }, telephone: { type: 'string', maxLength: 30 } } } },
  }, async (req) => {
    const u = await authentifier(req);
    const { id, telephone: brut } = req.params as { id: string; telephone: string };
    if ((await roleDans(id, u.id)) !== 'proprietaire') throw new ErreurHttp(403, 'Seul le propriétaire peut retirer des personnes.');
    const telephone = normaliserTelephone(decodeURIComponent(brut));
    if (!telephone) throw new ErreurHttp(400, 'Numéro de téléphone invalide.');
    const cible = (await pool.query<{ role: RoleMembre; utilisateur_id: string | null }>('SELECT role, utilisateur_id FROM membres WHERE organisation_id = $1 AND telephone = $2', [id, telephone])).rows[0];
    if (!cible) throw new ErreurHttp(404, 'Cette personne ne fait pas partie de l’élevage.');
    if (cible.role === 'proprietaire') throw new ErreurHttp(400, 'Le propriétaire ne peut pas être retiré.');
    await pool.query('DELETE FROM membres WHERE organisation_id = $1 AND telephone = $2', [id, telephone]);
    return { ok: true };
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
    const role = await roleDans(id, u.id);
    const demande = req.body as DemandeSync;
    if (demande.changements.length > 0 && !ROLES[role].ecriture) {
      throw new ErreurHttp(403, 'Votre rôle permet seulement de consulter les données de cet élevage.');
    }
    for (const ch of demande.changements) {
      if (JSON.stringify(ch.enregistrement).length > TAILLE_MAX_ENREGISTREMENT) throw new ErreurHttp(400, 'Un enregistrement est trop volumineux.');
    }

    return transaction(pool, async (c) => {
      // Une seule synchronisation à la fois par élevage : l'ordre des numéros de séquence reste celui de validation.
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id]);
      let ecartes = 0;
      for (const ch of demande.changements as ChangementSync[]) {
        const e = ch.enregistrement;
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
      const lignes = (await c.query<{ table_nom: ChangementSync['table']; donnees: ChangementSync['enregistrement']; seq: string }>(
        'SELECT table_nom, donnees, seq FROM enregistrements WHERE organisation_id = $1 AND seq > $2 ORDER BY seq LIMIT $3',
        [id, demande.depuisSeq, LIMITE_REPONSE_SYNC + 1],
      )).rows;
      const reste = lignes.length > LIMITE_REPONSE_SYNC;
      const gardees = reste ? lignes.slice(0, LIMITE_REPONSE_SYNC) : lignes;
      const dernier = gardees.at(-1);
      return {
        seq: dernier ? Number(dernier.seq) : demande.depuisSeq,
        changements: gardees.map((l) => ({ table: l.table_nom, enregistrement: l.donnees })),
        reste,
        ecartes,
      };
    });
  });

  app.get('/v1/sante', async () => ({ ok: true }));

  return app;
}
