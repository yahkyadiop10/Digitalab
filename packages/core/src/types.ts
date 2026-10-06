import type { Jour } from './dates';

/** Champs communs : prêts pour une synchronisation ultérieure. */
export interface Enregistrement {
  id: string;
  /** Horodatage (ms) de la dernière modification. */
  misAJour: number;
  /** Suppression logique : un enregistrement n'est jamais effacé. */
  supprimeLe?: number | null;
}

export type TypeLogement = 'batiment' | 'cage' | 'voliere' | 'parc';

export interface Logement extends Enregistrement {
  nom: string;
  type: TypeLogement;
  surfaceM2?: number | null;
}

export interface Lot extends Enregistrement {
  nom: string;
  especeCode: string;
  race?: string;
  naissance?: Jour;
  logementId?: string | null;
  archive?: boolean;
}

export type TypeMouvement = 'naissance' | 'arrivee' | 'vente' | 'deces' | 'reforme' | 'correction';

/**
 * Journal de mouvements : source de vérité des effectifs.
 * `quantite` est signée (entrées > 0, sorties < 0).
 */
export interface Mouvement extends Enregistrement {
  lotId: string;
  date: Jour;
  type: TypeMouvement;
  quantite: number;
  cause?: string;
  note?: string;
}

export interface Ponte extends Enregistrement {
  lotId: string;
  date: Jour;
  nombre: number;
  casses: number;
}

export interface Distribution extends Enregistrement {
  lotId: string;
  date: Jour;
  quantiteKg: number;
}

/** Entrée de stock d'aliment (achat, stock initial ou correction de comptage si négatif). */
export interface EntreeStock extends Enregistrement {
  date: Jour;
  quantiteKg: number;
  prixTotal?: number | null;
}

export interface EspeceConfig {
  code: string;
  nom: string;
  /** Surface minimale par animal, en m². Valeur de départ, modifiable. */
  m2ParAnimal: number;
  /** Les œufs sont suivis pour cette espèce. */
  pondeuse: boolean;
  /** Durée d'incubation (jours), pour la phase 2. */
  incubationJours?: number;
}

export interface Seuils {
  densite: { jaune: number; orange: number; rouge: number };
  /** Taux de mortalité en %, sur 1 jour et sur 7 jours. */
  mortalite1j: { orange: number; rouge: number };
  mortalite7j: { orange: number; rouge: number };
  /** Nombre minimal de morts pour passer en orange ou rouge (évite l'alarme sur un petit lot). */
  minDeces: number;
  /** Rapport ponte du jour / moyenne récente en dessous duquel on alerte. */
  ponte: { orange: number; rouge: number };
  /** Heure locale à partir de laquelle la ponte du jour est considérée comme complète. */
  heureBilanPonte: number;
  /** Jours d'autonomie d'aliment en dessous desquels on alerte. */
  autonomieAliment: { jaune: number; orange: number };
}

export type Niveau = 'jaune' | 'orange' | 'rouge';
export type CodeAlerte = 'densite' | 'mortalite' | 'chute_ponte' | 'stock_aliment';

export interface Alerte {
  /** Identifiant stable, utilisé pour « pris en charge » et « reporter ». */
  cle: string;
  code: CodeAlerte;
  niveau: Niveau;
  lotId?: string;
  logementId?: string;
  /** Valeurs chiffrées ; la mise en phrase se fait côté interface (traduisible). */
  params: Record<string, number>;
}

export interface DonneesElevage {
  lots: Lot[];
  logements: Logement[];
  mouvements: Mouvement[];
  pontes: Ponte[];
  distributions: Distribution[];
  entreesStock: EntreeStock[];
}
