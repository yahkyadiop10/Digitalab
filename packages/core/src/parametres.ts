import type { EspeceConfig, Seuils } from './types';

/**
 * Valeurs de départ, tirées de sources généralistes.
 * Elles doivent être validées par un vétérinaire ou un éleveur expérimenté, race par race.
 */
export const ESPECES_PAR_DEFAUT: Record<string, EspeceConfig> = {
  poule: { code: 'poule', nom: 'Poule', m2ParAnimal: 0.25, pondeuse: true, incubationJours: 21 },
  caille: { code: 'caille', nom: 'Caille', m2ParAnimal: 0.015, pondeuse: true, incubationJours: 18 },
  autre: { code: 'autre', nom: 'Autre volaille', m2ParAnimal: 0.25, pondeuse: false },
};

export const SEUILS_PAR_DEFAUT: Seuils = {
  densite: { jaune: 0.8, orange: 0.9, rouge: 1 },
  mortalite1j: { orange: 1, rouge: 2 },
  mortalite7j: { orange: 3, rouge: 5 },
  minDeces: 2,
  ponte: { orange: 0.85, rouge: 0.6 },
  heureBilanPonte: 17,
  autonomieAliment: { jaune: 7, orange: 3 },
};
