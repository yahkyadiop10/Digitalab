import { ajouterJours, ecartJours, type Jour } from './dates';
import type { Couveuse, EspeceConfig, Incubation, Mirage, ProfilIncubation } from './types';

const vivants = <T extends { supprimeLe?: number | null }>(xs: T[]) => xs.filter((x) => !x.supprimeLe);

export type TypeEtape = 'mirage' | 'transfert' | 'eclosion';

export interface Etape {
  /** Identifiant stable : « mirage:7 », « transfert », « eclosion ». */
  cle: string;
  type: TypeEtape;
  /** Jour d'incubation (J7, J14…). */
  jourJ: number;
  date: Jour;
}

export type StatutEtape = 'fait' | 'aujourdhui' | 'retard' | 'a_venir';

export interface EtapeSuivie extends Etape {
  statut: StatutEtape;
  /** Jours de retard (statut « retard »). */
  retard: number;
}

export type Tache =
  | { genre: 'etape'; incubation: Incubation; etape: EtapeSuivie }
  | { genre: 'tourner'; incubation: Incubation; jourJ: number };

export const profilDe = (especes: Record<string, EspeceConfig>, code: string): ProfilIncubation | undefined => especes[code]?.incubation;

/** Étapes d'une mise en incubation, dans l'ordre du temps. */
export function etapesIncubation(inc: Incubation, profil: ProfilIncubation): Etape[] {
  const e: Etape[] = profil.mirages
    .filter((j) => j < profil.duree)
    .map((j) => ({ cle: `mirage:${j}`, type: 'mirage' as const, jourJ: j, date: ajouterJours(inc.miseEnPlace, j) }));
  e.push({ cle: 'transfert', type: 'transfert', jourJ: profil.jourTransfert, date: ajouterJours(inc.miseEnPlace, profil.jourTransfert) });
  e.push({ cle: 'eclosion', type: 'eclosion', jourJ: profil.duree, date: ajouterJours(inc.miseEnPlace, profil.duree) });
  return e.sort((a, b) => a.jourJ - b.jourJ || a.type.localeCompare(b.type));
}

function estFait(inc: Incubation, mirages: Mirage[], etape: Etape): boolean {
  if (etape.type === 'eclosion') return !!inc.eclosion;
  if (etape.type === 'transfert') return inc.faits.includes('transfert');
  return vivants(mirages).some((m) => m.incubationId === inc.id && m.etape === etape.jourJ);
}

export function suivreEtapes(inc: Incubation, profil: ProfilIncubation, mirages: Mirage[], aujourdhui: Jour): EtapeSuivie[] {
  return etapesIncubation(inc, profil).map((e) => {
    if (estFait(inc, mirages, e)) return { ...e, statut: 'fait', retard: 0 };
    const ecart = ecartJours(e.date, aujourdhui);
    if (ecart === 0) return { ...e, statut: 'aujourdhui', retard: 0 };
    if (ecart > 0) return { ...e, statut: 'retard', retard: ecart };
    return { ...e, statut: 'a_venir', retard: 0 };
  });
}

/** Mises en incubation encore en cours (pas encore d'éclosion enregistrée). */
export const incubationsEnCours = (incubations: Incubation[]): Incubation[] => vivants(incubations).filter((i) => !i.eclosion);

/** Tâches du jour : étapes à faire ou en retard, et retournement des œufs pour les couveuses manuelles. */
export function tachesIncubation(
  incubations: Incubation[],
  couveuses: Couveuse[],
  mirages: Mirage[],
  especes: Record<string, EspeceConfig>,
  aujourdhui: Jour,
): Tache[] {
  const taches: Tache[] = [];
  for (const inc of incubationsEnCours(incubations)) {
    const profil = profilDe(especes, inc.especeCode);
    if (!profil) continue;
    for (const etape of suivreEtapes(inc, profil, mirages, aujourdhui)) {
      if (etape.statut === 'aujourdhui' || etape.statut === 'retard') taches.push({ genre: 'etape', incubation: inc, etape });
    }
    const couveuse = vivants(couveuses).find((c) => c.id === inc.couveuseId);
    const jourJ = ecartJours(inc.miseEnPlace, aujourdhui);
    if (couveuse?.type === 'manuelle' && jourJ >= 1 && jourJ < profil.jourTransfert && !inc.faits.includes(`tour:${aujourdhui}`)) {
      taches.push({ genre: 'tourner', incubation: inc, jourJ });
    }
  }
  return taches;
}

/* ---------- Occupation de la couveuse ---------- */

/** Jours pendant lesquels les œufs occupent l'appareil : de la mise en place (incluse) à la sortie (exclue). */
function jourSortie(inc: Incubation, couveuse: Couveuse, profil: ProfilIncubation): Jour {
  return ajouterJours(inc.miseEnPlace, couveuse.eclosoirSepare ? profil.jourTransfert : profil.duree + 1);
}

/** Nombre d'œufs d'une mise en incubation encore dans l'appareil à une date donnée (après retrait des œufs clairs et morts). */
export function oeufsRestants(inc: Incubation, mirages: Mirage[], jour: Jour): number {
  const retires = vivants(mirages)
    .filter((m) => m.incubationId === inc.id && m.jour <= jour)
    .reduce((a, m) => a + m.clairs + m.morts, 0);
  return Math.max(0, inc.nbOeufs - retires);
}

export interface Occupation {
  /** Part de l'appareil occupée (0 à 1 ou plus), sur les espèces dont la capacité est connue. */
  fraction: number;
  parEspece: Record<string, number>;
}

export function occupation(
  couveuse: Couveuse,
  incubations: Incubation[],
  mirages: Mirage[],
  especes: Record<string, EspeceConfig>,
  jour: Jour,
  ignorerId?: string,
): Occupation {
  const parEspece: Record<string, number> = {};
  let fraction = 0;
  for (const inc of incubationsEnCours(incubations)) {
    if (inc.couveuseId !== couveuse.id || inc.id === ignorerId) continue;
    const profil = profilDe(especes, inc.especeCode);
    if (!profil || jour < inc.miseEnPlace || jour >= jourSortie(inc, couveuse, profil)) continue;
    const n = oeufsRestants(inc, mirages, jour);
    parEspece[inc.especeCode] = (parEspece[inc.especeCode] ?? 0) + n;
    const cap = couveuse.capacites[inc.especeCode];
    if (cap && cap > 0) fraction += n / cap;
  }
  return { fraction, parEspece };
}

/** Œufs de cette espèce que l'on peut encore ajouter à une date donnée ; `null` si la capacité n'est pas renseignée. */
export function placesLibres(
  couveuse: Couveuse,
  incubations: Incubation[],
  mirages: Mirage[],
  especes: Record<string, EspeceConfig>,
  especeCode: string,
  jour: Jour,
): number | null {
  const cap = couveuse.capacites[especeCode];
  if (!cap || cap <= 0) return null;
  const { fraction } = occupation(couveuse, incubations, mirages, especes, jour);
  return Math.max(0, Math.floor((1 - fraction) * cap + 1e-9));
}

/**
 * Vérifie qu'une nouvelle mise en incubation tient dans l'appareil pendant toute sa présence.
 * Renvoie le nombre maximal d'œufs acceptables (ou `null` si la capacité est inconnue).
 */
export function placesPourNouvelleMise(
  couveuse: Couveuse,
  incubations: Incubation[],
  mirages: Mirage[],
  especes: Record<string, EspeceConfig>,
  especeCode: string,
  miseEnPlace: Jour,
): number | null {
  const profil = profilDe(especes, especeCode);
  const cap = couveuse.capacites[especeCode];
  if (!profil || !cap || cap <= 0) return null;
  const sortie = ajouterJours(miseEnPlace, couveuse.eclosoirSepare ? profil.jourTransfert : profil.duree + 1);
  // Le pic d'occupation survient à la mise en place ou à l'arrivée d'une autre mise en place pendant la période.
  const jours = new Set<Jour>([miseEnPlace]);
  for (const inc of incubationsEnCours(incubations)) {
    if (inc.couveuseId === couveuse.id && inc.miseEnPlace > miseEnPlace && inc.miseEnPlace < sortie) jours.add(inc.miseEnPlace);
  }
  let min = Infinity;
  for (const j of jours) min = Math.min(min, placesLibres(couveuse, incubations, mirages, especes, especeCode, j) ?? Infinity);
  return Number.isFinite(min) ? min : null;
}

/** Prochaine date à laquelle des œufs quittent l'appareil. */
export function prochaineLiberation(couveuse: Couveuse, incubations: Incubation[], especes: Record<string, EspeceConfig>, aujourdhui: Jour): Jour | null {
  let min: Jour | null = null;
  for (const inc of incubationsEnCours(incubations)) {
    if (inc.couveuseId !== couveuse.id) continue;
    const profil = profilDe(especes, inc.especeCode);
    if (!profil) continue;
    const s = jourSortie(inc, couveuse, profil);
    if (s > aujourdhui && (min === null || s < min)) min = s;
  }
  return min;
}

/* ---------- Résultats ---------- */

export interface StatsIncubation {
  mis: number;
  clairs: number;
  mortsOvo: number;
  /** Œufs fécondés = mis − clairs (connu seulement si un mirage a été noté). */
  fecondes: number | null;
  nes: number | null;
  tauxFertilite: number | null;
  tauxEclosionFecondes: number | null;
  tauxEclosionMis: number | null;
}

const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function statsIncubation(inc: Incubation, mirages: Mirage[]): StatsIncubation {
  const ms = vivants(mirages).filter((m) => m.incubationId === inc.id);
  const clairs = ms.reduce((a, m) => a + m.clairs, 0);
  const mortsOvo = ms.reduce((a, m) => a + m.morts, 0);
  const fecondes = ms.length > 0 ? inc.nbOeufs - clairs : null;
  const nes = inc.eclosion ? inc.eclosion.nes : null;
  return {
    mis: inc.nbOeufs,
    clairs,
    mortsOvo,
    fecondes,
    nes,
    tauxFertilite: fecondes === null ? null : pct(fecondes, inc.nbOeufs),
    tauxEclosionFecondes: nes === null || fecondes === null ? null : pct(nes, fecondes),
    tauxEclosionMis: nes === null ? null : pct(nes, inc.nbOeufs),
  };
}
