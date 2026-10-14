import { MOT_DE_PASSE_PROVISOIRE_JOURS, normaliserIdentifiant, problemeIdentifiant } from '@digitalab/core';
import { transaction, type Pool } from './db.js';
import { genererMotDePasseProvisoire, hacherMotDePasse, type CoutMotDePasse } from './securite.js';

const JOUR_MS = 86_400_000;

/** Vrai tant qu'aucun propriétaire n'a de mot de passe : le serveur crée alors lui-même le compte administrateur au démarrage. */
export async function sansAdministrateur(executeur: Pick<Pool, 'query'>): Promise<boolean> {
  const r = await executeur.query(`SELECT 1 FROM membres m JOIN utilisateurs u ON u.id = m.utilisateur_id WHERE m.role = 'proprietaire' AND u.mot_de_passe_hash IS NOT NULL LIMIT 1`);
  return !r.rowCount;
}

export interface AccesProvisoire {
  identifiant: string;
  motDePasseProvisoire: string;
  expireLe: Date;
}

/**
 * Crée un élevage et son propriétaire, avec un mot de passe provisoire à remettre au propriétaire : il devra en choisir un autre dès
 * sa première connexion. Sert au premier démarrage du serveur, et à la personne qui installe pour créer l'élevage d'un nouveau client.
 */
export async function creerElevage(
  pool: Pool, cout: CoutMotDePasse,
  d: { identifiant?: string; nom?: string; nomElevage?: string; maintenant?: Date } = {},
): Promise<AccesProvisoire & { organisationId: string }> {
  const identifiant = normaliserIdentifiant(d.identifiant ?? 'admin');
  const probleme = problemeIdentifiant(identifiant);
  if (probleme) throw new Error(probleme);
  const motDePasseProvisoire = genererMotDePasseProvisoire();
  const empreinte = await hacherMotDePasse(motDePasseProvisoire, cout);
  const maintenant = d.maintenant ?? new Date();
  const expireLe = new Date(maintenant.getTime() + MOT_DE_PASSE_PROVISOIRE_JOURS * JOUR_MS);
  return transaction(pool, async (c) => {
    const pris = await c.query('SELECT 1 FROM utilisateurs WHERE identifiant = $1', [identifiant]);
    if (pris.rowCount) throw new Error(`L’identifiant « ${identifiant} » existe déjà.`);
    const u = (await c.query<{ id: string }>(
      'INSERT INTO utilisateurs (identifiant, nom, mot_de_passe_hash, doit_changer, mot_de_passe_expire) VALUES ($1, $2, $3, true, $4) RETURNING id',
      [identifiant, d.nom?.trim() || null, empreinte, expireLe],
    )).rows[0]!;
    const o = (await c.query<{ id: string }>('INSERT INTO organisations (nom) VALUES ($1) RETURNING id', [d.nomElevage?.trim() || 'Mon élevage'])).rows[0]!;
    await c.query(`INSERT INTO membres (organisation_id, utilisateur_id, role) VALUES ($1, $2, 'proprietaire')`, [o.id, u.id]);
    await c.query(
      `INSERT INTO journal (organisation_id, fait_le, utilisateur_id, identifiant, nom, action, table_nom, enregistrement_id, description)
       VALUES ($1, $2, $3, $4, $5, 'utilisateur', 'utilisateurs', $4, 'compte administrateur créé à l’installation')`,
      [o.id, maintenant.getTime(), u.id, identifiant, d.nom?.trim() || null],
    );
    return { identifiant, motDePasseProvisoire, expireLe, organisationId: o.id };
  });
}

/**
 * Donne un nouveau mot de passe provisoire à n'importe quel compte, propriétaire compris, depuis l'ordinateur du serveur :
 * c'est le recours quand le propriétaire a oublié le sien. Ses appareils sont déconnectés et un éventuel blocage est levé.
 */
export async function reinitialiserDepuisLeServeur(pool: Pool, cout: CoutMotDePasse, brut: string, maintenant = new Date()): Promise<AccesProvisoire> {
  const identifiant = normaliserIdentifiant(brut);
  const motDePasseProvisoire = genererMotDePasseProvisoire();
  const empreinte = await hacherMotDePasse(motDePasseProvisoire, cout);
  const expireLe = new Date(maintenant.getTime() + MOT_DE_PASSE_PROVISOIRE_JOURS * JOUR_MS);
  return transaction(pool, async (c) => {
    const u = (await c.query<{ id: string; nom: string | null }>(
      'UPDATE utilisateurs SET mot_de_passe_hash = $2, doit_changer = true, mot_de_passe_expire = $3 WHERE identifiant = $1 RETURNING id, nom',
      [identifiant, empreinte, expireLe],
    )).rows[0];
    if (!u) throw new Error(`Aucun compte n’a l’identifiant « ${identifiant} ».`);
    await c.query('DELETE FROM sessions WHERE utilisateur_id = $1', [u.id]);
    await c.query('DELETE FROM echecs_connexion WHERE cle = $1', [identifiant]);
    const orgs = await c.query<{ organisation_id: string; fonction: string | null }>('SELECT organisation_id, fonction FROM membres WHERE utilisateur_id = $1', [u.id]);
    for (const o of orgs.rows) {
      await c.query(
        `INSERT INTO journal (organisation_id, fait_le, utilisateur_id, identifiant, nom, fonction, action, table_nom, enregistrement_id, description)
         VALUES ($1, $2, $3, $4, $5, $6, 'utilisateur', 'utilisateurs', $4, 'mot de passe réinitialisé depuis l’ordinateur du serveur')`,
        [o.organisation_id, maintenant.getTime(), u.id, identifiant, u.nom, o.fonction],
      );
    }
    return { identifiant, motDePasseProvisoire, expireLe };
  });
}
