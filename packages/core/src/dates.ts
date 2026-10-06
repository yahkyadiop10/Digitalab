/** Dates « jour » au format AAAA-MM-JJ, en heure locale de l'appareil. */
export type Jour = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function jourLocal(d: Date): Jour {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function enMs(j: Jour): number {
  const [y, m, d] = j.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Nombre de jours de `a` à `b` (positif si `b` est après `a`). */
export function ecartJours(a: Jour, b: Jour): number {
  return Math.round((enMs(b) - enMs(a)) / 86_400_000);
}

export function ajouterJours(j: Jour, n: number): Jour {
  const d = new Date(enMs(j) + n * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
