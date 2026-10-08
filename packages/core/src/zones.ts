import type { DonneesElevage } from './types';

/**
 * Ne garde que ce qui concerne les bâtiments et cages confiés à une personne (« responsable bâtiment A »).
 * Sans zone, tout est gardé. Les couveuses, le stock d'aliment et la couvée restent communs à toute la ferme.
 */
export function filtrerParZones(donnees: DonneesElevage, zones: readonly string[]): DonneesElevage {
  if (zones.length === 0) return donnees;
  const ok = new Set(zones);
  const logements = donnees.logements.filter((l) => ok.has(l.id));
  const lots = donnees.lots.filter((l) => !!l.logementId && ok.has(l.logementId));
  const lotsOk = new Set(lots.map((l) => l.id));
  const quarantaines = donnees.quarantaines.filter((q) => lotsOk.has(q.lotId) || (!!q.logementId && ok.has(q.logementId)));
  const quarantainesOk = new Set(quarantaines.map((q) => q.id));
  return {
    ...donnees,
    logements,
    lots,
    mouvements: donnees.mouvements.filter((m) => lotsOk.has(m.lotId)),
    pontes: donnees.pontes.filter((p) => lotsOk.has(p.lotId)),
    distributions: donnees.distributions.filter((d) => lotsOk.has(d.lotId)),
    evenementsSante: donnees.evenementsSante.filter((e) => lotsOk.has(e.lotId)),
    quarantaines,
    notesQuarantaine: donnees.notesQuarantaine.filter((n) => quarantainesOk.has(n.quarantaineId)),
  };
}
