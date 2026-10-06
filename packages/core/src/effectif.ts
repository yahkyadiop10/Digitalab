import type { Mouvement } from './types';

const actifs = (mouvements: Mouvement[]) => mouvements.filter((m) => !m.supprimeLe);

/** Effectif de chaque lot, déduit du journal de mouvements. */
export function effectifs(mouvements: Mouvement[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of actifs(mouvements)) out.set(m.lotId, (out.get(m.lotId) ?? 0) + m.quantite);
  return out;
}

/** Nombre de morts d'un lot entre deux jours inclus. */
export function decesEntre(mouvements: Mouvement[], lotId: string, debut: string, fin: string): number {
  let total = 0;
  for (const m of actifs(mouvements)) {
    if (m.lotId === lotId && m.type === 'deces' && m.date >= debut && m.date <= fin) total += -m.quantite;
  }
  return total;
}
