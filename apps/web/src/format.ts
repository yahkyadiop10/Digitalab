/** Montant en FCFA, sans signe. Les espaces sont insécables : un montant ne se coupe jamais en deux lignes. */
export const formatMontant = (n: number): string => `${new Intl.NumberFormat('fr-FR').format(Math.abs(n)).replace(/[   ]/g, ' ')} FCFA`;

export const signe = (n: number): string => (n < 0 ? '−' : n > 0 ? '+' : '');

/** « 2026-10-07 » devient « 07/10 ». */
export const dateCourte = (j: string): string => j.slice(5).split('-').reverse().join('/');

export const virgule = (x: number): string => String(x).replace('.', ',');
