import type { TableSynchronisee } from './sync';

/**
 * Ce qu'une fiche déjà enregistrée peut encore changer, table par table. Le reste est figé dès la création : on annule et on refait
 * plutôt que de réécrire. C'est ce qui empêche, par exemple, de transformer une recette en dépense validée, de rattacher un règlement
 * à une autre facture ou de ramener à zéro une arrivée d'animaux sans le droit d'annuler.
 * Les tables absentes de cette liste (locaux, lots, couveuses, incubations, quarantaines, carnet, employés, comptes…) se modifient librement :
 * leurs droits d'écriture suffisent.
 */
export const CHAMPS_MODIFIABLES: Partial<Record<TableSynchronisee, readonly string[]>> = {
  mouvements: [],
  pontes: [],
  distributions: [],
  entreesStock: [],
  mirages: [],
  transferts: [],
  evenementsSante: ['resultat'],
  operations: ['statut', 'tiers'],
  paiements: ['statut'],
  pointages: ['regularise', 'note'],
};

/** Champs qui ne comptent jamais comme une modification de contenu. */
const TOUJOURS_LIBRES = new Set(['id', 'misAJour', 'supprimeLe']);

const egal = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Champs figés que la nouvelle version modifie par rapport à la fiche enregistrée (vide si rien d'interdit). */
export function champsFigesModifies(table: TableSynchronisee, existant: Record<string, unknown>, nouveau: Record<string, unknown>): string[] {
  const libres = CHAMPS_MODIFIABLES[table];
  if (!libres) return [];
  const cles = new Set([...Object.keys(existant), ...Object.keys(nouveau)]);
  return [...cles].filter((c) => !TOUJOURS_LIBRES.has(c) && !libres.includes(c) && !egal(existant[c], nouveau[c]));
}

const CHAMPS_TEXTE = [
  'nom', 'note', 'tiers', 'race', 'libelle', 'numero', 'categorie', 'sens', 'mode', 'type', 'date', 'jour', 'echeance', 'especeCode', 'periode', 'poste',
  'telephone', 'cause', 'lotId', 'logementId', 'operationId', 'employeId', 'incubationId', 'quarantaineId', 'tiersId', 'compteId', 'deId', 'versId',
] as const;
const CHAMPS_NOMBRE = ['casses', 'clairs', 'morts', 'dureeJours', 'frais', 'montant', 'nombre', 'prixTotal', 'quantite', 'quantiteKg', 'remise', 'salaire', 'soldeInitial', 'soldeReel', 'surfaceM2'] as const;
const POSITIFS = new Set(['montant', 'prixTotal', 'frais', 'salaire', 'nombre', 'casses', 'clairs', 'morts']);
const LONGUEUR_TEXTE_MAX = 500;
const JOUR = /^\d{4}-\d{2}-\d{2}$/;

/**
 * La fiche a-t-elle la forme attendue ? Une fiche malformée (un nom qui n'est pas du texte, un nombre qui n'en est pas un…) pourrait
 * empêcher l'application de s'afficher sur tous les téléphones de l'élevage : le serveur la refuse. Renvoie le problème, ou `null`.
 */
export function problemeForme(table: TableSynchronisee, e: Record<string, unknown>): string | null {
  for (const c of CHAMPS_TEXTE) {
    const v = e[c];
    if (v == null) continue;
    if (typeof v !== 'string') return `${c} doit être du texte`;
    if (v.length > LONGUEUR_TEXTE_MAX) return `${c} est trop long`;
    if ((c === 'date' || c === 'jour' || c === 'echeance') && !JOUR.test(v)) return `${c} n’est pas une date`;
  }
  for (const c of CHAMPS_NOMBRE) {
    const v = e[c];
    if (v == null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${c} doit être un nombre`;
    if (POSITIFS.has(c) && v < 0) return `${c} ne peut pas être négatif`;
  }
  if (e['lignes'] != null) {
    if (!Array.isArray(e['lignes'])) return 'lignes doit être une liste';
    for (const l of e['lignes'] as unknown[]) {
      const ligne = l as Record<string, unknown> | null;
      if (!ligne || typeof ligne !== 'object' || typeof ligne['libelle'] !== 'string' || typeof ligne['quantite'] !== 'number' || typeof ligne['prixUnitaire'] !== 'number') return 'ligne de facture mal formée';
    }
  }
  if (table === 'profil' && e['logo'] != null && !(typeof e['logo'] === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(e['logo']))) return 'le logo doit être une image';
  return null;
}
