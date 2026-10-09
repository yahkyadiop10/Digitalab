import type { Pool } from './db.js';

/** Vrai tant qu'aucun propriétaire n'a de mot de passe : l'écran « Créer l'administrateur » est alors le seul accessible. */
export async function sansAdministrateur(executeur: Pick<Pool, 'query'>): Promise<boolean> {
  const r = await executeur.query(`SELECT 1 FROM membres m JOIN utilisateurs u ON u.id = m.utilisateur_id WHERE m.role = 'proprietaire' AND u.mot_de_passe_hash IS NOT NULL LIMIT 1`);
  return !r.rowCount;
}
