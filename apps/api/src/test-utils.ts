import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { creerApp } from './app.js';
import type { Config } from './config.js';
import { creerPool, migrer, type Pool } from './db.js';
import type { Notifieur } from './notifieur.js';

export const URL_BASE_TEST = process.env['TEST_DATABASE_URL'];

export const configTest: Config = {
  port: 0, hote: '127.0.0.1', databaseUrl: URL_BASE_TEST ?? '', secret: 'secret-de-test-0123456789', sessionJours: 90, codeValiditeMinutes: 10, codeDemo: false, origines: true,
};

export interface Banc {
  app: FastifyInstance;
  pool: Pool;
  /** Derniers codes « envoyés » par téléphone. */
  codes: Map<string, string>;
  horloge: { maintenant: Date };
  fermer: () => Promise<void>;
}

/** Crée un banc d'essai isolé : un schéma PostgreSQL neuf, une application, un faux envoi de codes et une horloge réglable. */
export async function creerBanc(): Promise<Banc> {
  const schema = `essai_${randomUUID().replace(/-/g, '')}`;
  const admin = creerPool(URL_BASE_TEST!);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = creerPool(URL_BASE_TEST!, { searchPath: schema });
  await migrer(pool);
  const codes = new Map<string, string>();
  const notifieur: Notifieur = { async envoyerCode(tel, code) { codes.set(tel, code); } };
  const horloge = { maintenant: new Date('2026-10-08T10:00:00Z') };
  const app = await creerApp({ pool, config: configTest, notifieur, maintenant: () => horloge.maintenant, limiteAuthParMinute: 1000 });
  return {
    app, pool, codes, horloge,
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
  telephone: string;
  organisationId: string;
  entetes: { authorization: string };
}

/** Demande un code puis se connecte ; renvoie la session et le premier élevage de la personne. */
export async function seConnecter(banc: Banc, telephone: string): Promise<Session> {
  const demande = await banc.app.inject({ method: 'POST', url: '/v1/auth/code', payload: { telephone } });
  if (demande.statusCode !== 200) throw new Error(`demande de code : ${demande.statusCode} ${demande.body}`);
  const tel = demande.json().telephone as string;
  const reponse = await banc.app.inject({ method: 'POST', url: '/v1/auth/connexion', payload: { telephone, code: banc.codes.get(tel)! } });
  if (reponse.statusCode !== 200) throw new Error(`connexion : ${reponse.statusCode} ${reponse.body}`);
  const r = reponse.json();
  // Le délai d'une minute entre deux codes est contourné en avançant l'horloge.
  banc.horloge.maintenant = new Date(banc.horloge.maintenant.getTime() + 61_000);
  return { jeton: r.jeton, telephone: tel, organisationId: r.organisations[0].id, entetes: { authorization: `Bearer ${r.jeton}` } };
}
