import { ajouterJours, ecartJours, type Jour } from './dates';
import { effectifs } from './effectif';
import type { Mouvement, NoteQuarantaine, Quarantaine } from './types';

/** Durée de départ proposée, modifiable : un vétérinaire ou un technicien peut conseiller plus ou moins. */
export const DUREE_QUARANTAINE_DEFAUT = 21;

/** Comportements et signes que l'on peut cocher dans une note du journal. */
export const COMPORTEMENTS: { code: string; libelle: string; inquietant: boolean }[] = [
  { code: 'mange_bien', libelle: 'Mange et boit normalement', inquietant: false },
  { code: 'actif', libelle: 'Actif, alerte', inquietant: false },
  { code: 'fientes_normales', libelle: 'Fientes normales', inquietant: false },
  { code: 'sociable', libelle: 'S’entend bien entre eux', inquietant: false },
  { code: 'mange_peu', libelle: 'Mange peu', inquietant: true },
  { code: 'abattu', libelle: 'Abattu, à l’écart', inquietant: true },
  { code: 'toux', libelle: 'Tousse ou éternue', inquietant: true },
  { code: 'diarrhee', libelle: 'Diarrhée', inquietant: true },
  { code: 'yeux_nez', libelle: 'Yeux ou nez qui coulent', inquietant: true },
  { code: 'boiterie', libelle: 'Boite', inquietant: true },
  { code: 'plumes', libelle: 'Plumes ébouriffées ou abîmées', inquietant: true },
  { code: 'parasites', libelle: 'Poux ou acariens visibles', inquietant: true },
  { code: 'agressif', libelle: 'Agressif, se bat', inquietant: true },
];

/** Contrôles que l'on coche au fil de la quarantaine. */
export const ETAPES_QUARANTAINE: { code: string; libelle: string }[] = [
  { code: 'examen', libelle: 'Examen à l’arrivée (yeux, nez, pattes, plumes)' },
  { code: 'pesee', libelle: 'Pesée de contrôle' },
  { code: 'deparasitage', libelle: 'Déparasitage' },
  { code: 'vaccins', libelle: 'Vaccins à jour' },
];

const vivantes = <T extends { supprimeLe?: number | null }>(xs: T[]) => xs.filter((x) => !x.supprimeLe);

/** Quarantaines en cours : ni supprimées ni terminées. */
export const quarantainesActives = (qs: Quarantaine[]): Quarantaine[] => vivantes(qs).filter((q) => !q.sortie);

/** Date à laquelle la durée prévue est écoulée (jour d'arrivée + durée). */
export const finQuarantaine = (q: Quarantaine): Jour => ajouterJours(q.arrivee, Math.max(1, q.dureeJours));

export type StatutQuarantaine = 'en_cours' | 'fin_proche' | 'a_decider' | 'terminee';

export interface SuiviQuarantaine {
  /** Jours écoulés depuis l'arrivée. */
  jourJ: number;
  /** Jours avant la fin prévue (négatif si elle est dépassée). */
  joursRestants: number;
  fin: Jour;
  /** `fin_proche` : la veille ; `a_decider` : le jour de la fin et après, tant qu'aucune décision n'est notée. */
  statut: StatutQuarantaine;
}

export function suivreQuarantaine(q: Quarantaine, aujourdhui: Jour): SuiviQuarantaine {
  const fin = finQuarantaine(q);
  const joursRestants = ecartJours(aujourdhui, fin);
  const statut: StatutQuarantaine = q.sortie ? 'terminee' : joursRestants <= 0 ? 'a_decider' : joursRestants === 1 ? 'fin_proche' : 'en_cours';
  return { jourJ: ecartJours(q.arrivee, aujourdhui), joursRestants, fin, statut };
}

/** Naissance estimée d'après l'âge approximatif à l'arrivée. */
export const naissanceEstimee = (arrivee: Jour, ageJours: number): Jour => ajouterJours(arrivee, -Math.max(0, ageJours));

/** Note la plus récente d'une quarantaine. */
export function derniereNote(notes: NoteQuarantaine[], quarantaineId: string): NoteQuarantaine | undefined {
  return vivantes(notes)
    .filter((n) => n.quarantaineId === quarantaineId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.misAJour - a.misAJour)[0];
}

export interface BilanQuarantaine {
  arrives: number;
  presents: number;
  morts: number;
  notes: number;
  /** Premier et dernier poids moyen relevés (g), ou `null` si aucun. */
  poidsDebutG: number | null;
  poidsFinG: number | null;
}

/** Où en est le lot : combien sont arrivés, combien restent, combien sont morts, et comment évolue le poids. */
export function bilanQuarantaine(q: Quarantaine, notes: NoteQuarantaine[], mouvements: Mouvement[]): BilanQuarantaine {
  const dumouvement = vivantes(mouvements);
  const presents = effectifs(dumouvement).get(q.lotId) ?? 0;
  const morts = dumouvement.filter((m) => m.lotId === q.lotId && m.type === 'deces').reduce((a, m) => a - m.quantite, 0);
  const sesNotes = vivantes(notes).filter((n) => n.quarantaineId === q.id);
  const poids = sesNotes.filter((n) => typeof n.poidsMoyenG === 'number').sort((a, b) => a.date.localeCompare(b.date));
  return {
    arrives: q.nombre,
    presents,
    morts,
    notes: sesNotes.length,
    poidsDebutG: poids[0]?.poidsMoyenG ?? null,
    poidsFinG: poids.at(-1)?.poidsMoyenG ?? null,
  };
}
