import { randomUUID } from 'node:crypto';
import { normaliserTelephone } from '@digitalab/core';
import type { FastifyInstance } from 'fastify';
import { creerApp } from './app.js';
import type { Config } from './config.js';
import { creerPool, migrer, type Pool } from './db.js';
import { hacherMotDePasse } from './securite.js';

export const URL_BASE_TEST = process.env['TEST_DATABASE_URL'];

export const configTest: Config = {
  port: 0, hote: '127.0.0.1', databaseUrl: URL_BASE_TEST ?? '', secret: 'secret-de-test-0123456789', sessionJours: 90,
  // Coût réduit : les essais font des dizaines de connexions.
  coutMotDePasse: { N: 1024, r: 8, p: 1 }, cleInstallation: null, origines: true,
};

export const MOT_DE_PASSE_TEST = 'Poule-Pondeuse-7';

interface Compte {
  identifiant: string;
  motDePasse: string;
  /** Faux tant que la personne utilise encore le mot de passe provisoire donné par l'administrateur. */
  definitif: boolean;
}

export interface Banc {
  app: FastifyInstance;
  pool: Pool;
  horloge: { maintenant: Date };
  /** Comptes créés par les assistants ci-dessous, par étiquette (téléphone). */
  comptes: Map<string, Compte>;
  fermer: () => Promise<void>;
}

/** Crée un banc d'essai isolé : un schéma PostgreSQL neuf, une application et une horloge réglable. */
export async function creerBanc(config: Partial<Config> = {}): Promise<Banc> {
  const schema = `essai_${randomUUID().replace(/-/g, '')}`;
  const admin = creerPool(URL_BASE_TEST!);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = creerPool(URL_BASE_TEST!, { searchPath: schema });
  await migrer(pool);
  const horloge = { maintenant: new Date('2026-10-08T10:00:00Z') };
  const app = await creerApp({ pool, config: { ...configTest, ...config }, maintenant: () => horloge.maintenant, limiteAuthParMinute: 1000 });
  return {
    app, pool, horloge, comptes: new Map(),
    async fermer() {
      await app.close();
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}

export interface Session {
  jeton: string;
  /** Étiquette donnée à l'assistant (un numéro de téléphone, par habitude). */
  telephone: string;
  identifiant: string;
  organisationId: string;
  entetes: { authorization: string };
}

const chiffres = (s: string) => s.replace(/\D/g, '');

async function connexion(banc: Banc, identifiant: string, motDePasse: string) {
  const r = await banc.app.inject({ method: 'POST', url: '/v1/auth/connexion', payload: { identifiant, motDePasse } });
  if (r.statusCode !== 200) throw new Error(`connexion : ${r.statusCode} ${r.body}`);
  return r.json();
}

/** Crée directement en base un propriétaire avec son élevage (le seul administrateur « officiel » s'installe une fois, via /v1/installation). */
export async function creerProprietaire(banc: Banc, identifiant: string, motDePasse = MOT_DE_PASSE_TEST, nomElevage = 'Mon élevage'): Promise<void> {
  const empreinte = await hacherMotDePasse(motDePasse, configTest.coutMotDePasse);
  const u = (await banc.pool.query<{ id: string }>('INSERT INTO utilisateurs (identifiant, nom, mot_de_passe_hash) VALUES ($1, $1, $2) RETURNING id', [identifiant, empreinte])).rows[0]!;
  const o = (await banc.pool.query<{ id: string }>('INSERT INTO organisations (nom) VALUES ($1) RETURNING id', [nomElevage])).rows[0]!;
  await banc.pool.query(`INSERT INTO membres (organisation_id, utilisateur_id, role) VALUES ($1, $2, 'proprietaire')`, [o.id, u.id]);
}

/**
 * Connecte une personne désignée par une étiquette (un numéro de téléphone) : une personne ajoutée avec `inviter` choisit son mot de passe
 * au premier passage ; une étiquette inconnue crée un nouveau propriétaire avec son propre élevage.
 */
export async function seConnecter(banc: Banc, etiquette: string): Promise<Session> {
  const cle = normaliserTelephone(etiquette) ?? etiquette;
  let compte = banc.comptes.get(cle);
  if (!compte) {
    compte = { identifiant: `proprio${chiffres(cle)}`, motDePasse: MOT_DE_PASSE_TEST, definitif: true };
    await creerProprietaire(banc, compte.identifiant, compte.motDePasse);
    banc.comptes.set(cle, compte);
  }
  let r = await connexion(banc, compte.identifiant, compte.motDePasse);
  if (r.doitChanger) {
    const change = await banc.app.inject({
      method: 'POST', url: '/v1/moi/mot-de-passe', headers: { authorization: `Bearer ${r.jeton}` }, payload: { ancien: compte.motDePasse, nouveau: MOT_DE_PASSE_TEST },
    });
    if (change.statusCode !== 200) throw new Error(`changement : ${change.statusCode} ${change.body}`);
    compte.motDePasse = MOT_DE_PASSE_TEST;
    compte.definitif = true;
    r = { ...r, doitChanger: false };
  }
  return { jeton: r.jeton, telephone: cle, identifiant: compte.identifiant, organisationId: r.organisations[0].id, entetes: { authorization: `Bearer ${r.jeton}` } };
}

/**
 * Ajoute (ou modifie, si la personne existe déjà) une personne de l'élevage. `telephone` sert d'étiquette et de contact ;
 * `nom` peut contenir « Prénom Nom ».
 */
export async function inviter(banc: Banc, patron: Session, corps: Record<string, unknown> & { telephone: string }) {
  const cle = normaliserTelephone(corps.telephone) ?? corps.telephone;
  const { telephone, nom, ...reste } = corps;
  const existant = banc.comptes.get(cle);
  if (existant) {
    return banc.app.inject({
      method: 'PATCH', url: `/v1/organisations/${patron.organisationId}/membres/${encodeURIComponent(existant.identifiant)}`, headers: patron.entetes,
      payload: { ...reste, ...(typeof nom === 'string' ? { nom } : {}) },
    });
  }
  const [prenom, ...suite] = (typeof nom === 'string' && nom.trim() ? nom.trim() : 'Personne').split(/\s+/);
  const reponse = await banc.app.inject({
    method: 'POST', url: `/v1/organisations/${patron.organisationId}/membres`, headers: patron.entetes,
    payload: { prenom, nom: suite.join(' ') || `Essai${chiffres(cle)}`, telephone, ...reste },
  });
  if (reponse.statusCode === 200) {
    const r = reponse.json();
    banc.comptes.set(cle, { identifiant: r.identifiant, motDePasse: r.motDePasseProvisoire, definitif: false });
  }
  return reponse;
}
