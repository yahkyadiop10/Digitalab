/** Montant en FCFA, sans signe. Les espaces sont insécables : un montant ne se coupe jamais en deux lignes. */
export const formatMontant = (n: number): string => `${new Intl.NumberFormat('fr-FR').format(Math.abs(n)).replace(/[   ]/g, ' ')} FCFA`;

export const signe = (n: number): string => (n < 0 ? '−' : n > 0 ? '+' : '');

/** « 2026-10-07 » devient « 07/10 ». */
export const dateCourte = (j: string): string => j.slice(5).split('-').reverse().join('/');

export const virgule = (x: number): string => String(x).replace('.', ',');

const sansEspaces = (s: string) => s.replace(/[\s  ]/g, '');
const DECIMAL = /^-?(\d+([.,]\d*)?|[.,]\d+)$/;

/**
 * Lit un nombre tapé à la main (kilos, surfaces…) : « 2,5 », « 2.5 », « 1 250 », « 1.250.000 ». Renvoie NaN si ce n'en est pas un
 * (« 12 kg », « abc ») plutôt que d'en garder un morceau.
 */
export function versNombre(s: string): number {
  let t = sansEspaces(s);
  if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(t)) t = t.replace(/\./g, '');
  return DECIMAL.test(t) ? Number(t.replace(',', '.')) : Number.NaN;
}

/**
 * Lit un montant en FCFA ou un nombre d'animaux, d'œufs… : le point ou la virgule suivis de trois chiffres séparent les milliers
 * (« 25.000 » et « 25,000 » valent 25 000), comme on l'écrit couramment.
 */
export function versEntier(s: string): number {
  const t = sansEspaces(s);
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ''));
  return versNombre(t);
}
