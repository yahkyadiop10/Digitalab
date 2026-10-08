import type { Jour } from './dates';

/** Champs communs : prêts pour une synchronisation ultérieure. */
export interface Enregistrement {
  id: string;
  /** Horodatage (ms) de la dernière modification. */
  misAJour: number;
  /** Suppression logique : un enregistrement n'est jamais effacé. */
  supprimeLe?: number | null;
}

export type TypeLogement = 'batiment' | 'cage' | 'voliere' | 'parc' | 'quarantaine';

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
  /** Mise en incubation dont ce lot est issu. */
  incubationId?: string;
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

/** Repères d'incubation d'une espèce. Valeurs de départ : la notice de la couveuse et un technicien font foi. */
export interface ProfilIncubation {
  /** Jours entre la mise en place et l'éclosion. */
  duree: number;
  /** Jours de mirage (contrôle des œufs à la lumière). */
  mirages: number[];
  /** Jour où l'on arrête de tourner les œufs et où l'on passe à l'éclosion. */
  jourTransfert: number;
  temperature: number;
  /** Humidité relative en %, avant le transfert (fourchette) et après. */
  humidite: { avant: [number, number]; apres: number };
}

export interface EspeceConfig {
  code: string;
  nom: string;
  /** Surface minimale par animal, en m². Valeur de départ, modifiable. */
  m2ParAnimal: number;
  /** Les œufs sont suivis pour cette espèce. */
  pondeuse: boolean;
  incubation?: ProfilIncubation;
}

export type TypeCouveuse = 'automatique' | 'manuelle';

export interface Couveuse extends Enregistrement {
  nom: string;
  type: TypeCouveuse;
  /** Nombre d'œufs que l'appareil accepte, par espèce (code espèce → œufs). */
  capacites: Record<string, number>;
  /** L'éclosion se fait dans un appareil séparé (sinon dans la même machine). */
  eclosoirSepare: boolean;
}

/** Contrôle à la lumière : œufs clairs (non fécondés) et œufs morts retirés. */
export interface Mirage extends Enregistrement {
  incubationId: string;
  /** Jour d'incubation prévu (ex. 7 ou 14). */
  etape: number;
  jour: Jour;
  clairs: number;
  morts: number;
}

export interface EclosionResultat {
  jour: Jour;
  nes: number;
  mortsCoquille: number;
  lotId: string | null;
}

/** Une mise en incubation : des œufs placés ensemble dans une couveuse le même jour. */
export interface Incubation extends Enregistrement {
  couveuseId: string;
  especeCode: string;
  nom: string;
  miseEnPlace: Jour;
  nbOeufs: number;
  /** Provenance libre (mère, groupe, achat). */
  origine?: string;
  /** Étapes faites sans saisie chiffrée : « transfert », « tour:AAAA-MM-JJ ». */
  faits: string[];
  eclosion?: EclosionResultat;
}

export type EtatArrivee = 'bon' | 'moyen' | 'mauvais';

/** Zone de quarantaine : des animaux nouvellement arrivés, tenus à l'écart avant d'entrer dans l'élevage. */
export interface Quarantaine extends Enregistrement {
  nom: string;
  /** Lot créé à l'arrivée : l'effectif, les décès, la santé et l'alimentation passent par lui. */
  lotId: string;
  especeCode: string;
  race?: string;
  /** Nombre d'animaux à l'arrivée. */
  nombre: number;
  /** Âge approximatif à l'arrivée, en jours. */
  ageJours?: number;
  /** Vendeur ou provenance. */
  origine?: string;
  arrivee: Jour;
  dureeJours: number;
  logementId?: string | null;
  /** Alimentation prévue ou utilisée à l'arrivée. */
  alimentation?: string;
  etatArrivee?: EtatArrivee;
  noteArrivee?: string;
  /** Contrôles faits : « examen », « deparasitage », « vaccins », « pesee ». */
  etapes: string[];
  /** Renseigné quand la quarantaine est terminée. */
  sortie?: { jour: Jour; decision: 'integre' | 'ecarte'; logementId?: string | null; note?: string };
}

export type EtatNote = 'bien' | 'moyen' | 'inquietant';

/** Une ligne du journal d'observation d'une quarantaine. */
export interface NoteQuarantaine extends Enregistrement {
  quarantaineId: string;
  date: Jour;
  etat: EtatNote;
  /** Codes des comportements observés (voir COMPORTEMENTS). */
  comportements: string[];
  alimentation?: string;
  poidsMoyenG?: number;
  /** Nombre d'animaux qui semblent malades. */
  malades?: number;
  note?: string;
}

export type TypeSante = 'observation' | 'vaccin' | 'traitement' | 'quarantaine';
export type ResultatTraitement = 'gueri' | 'ameliore' | 'sans_effet';

/** Événement de santé d'un lot : jamais supprimé (suppression logique), pour garder l'historique complet. */
export interface EvenementSante extends Enregistrement {
  lotId: string;
  type: TypeSante;
  date: Jour;
  /** Observation : codes des symptômes notés. */
  symptomes?: string[];
  /** Observation : 1 léger, 2 inquiétant, 3 grave. */
  gravite?: 1 | 2 | 3;
  /** Observation : maladie que l'on soupçonne (code), choisie par l'éleveur ou le vétérinaire. */
  maladie?: string;
  /** Vaccin : nom du vaccin ; traitement : nom du produit. */
  nom?: string;
  dose?: string;
  voie?: string;
  /** Vaccin : numéro de lot du flacon, pour la traçabilité. */
  numeroLotProduit?: string;
  /** Vaccin fait selon un protocole : identifiant de la ligne de protocole. */
  protocoleId?: string;
  /** Traitement ou quarantaine : durée en jours, à partir de `date`. */
  dureeJours?: number;
  /** Traitement : jours à attendre après la fin avant de consommer ou vendre œufs et viande. */
  delaiAttenteJours?: number;
  resultat?: ResultatTraitement;
  note?: string;
}

/** Une ligne de calendrier de vaccination, modifiable par l'éleveur. */
export interface ProtocoleVaccin {
  id: string;
  nom: string;
  especeCode: string;
  /** Âge (jours) de la première dose. */
  ageJours: number;
  /** Si renseigné, rappel tous les N jours après la dernière dose. */
  repeterTousLesJours?: number | null;
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
export type CodeAlerte = 'densite' | 'mortalite' | 'chute_ponte' | 'stock_aliment' | 'incubation' | 'vaccin' | 'delai_attente' | 'foyer' | 'sante_grave' | 'quarantaine';

export interface Alerte {
  /** Identifiant stable, utilisé pour « pris en charge » et « reporter ». */
  cle: string;
  code: CodeAlerte;
  niveau: Niveau;
  lotId?: string;
  logementId?: string;
  incubationId?: string;
  /** Quarantaine d'arrivants concernée. */
  quarantaineId?: string;
  /** Pour une alerte d'incubation : « mirage », « retournement », « transfert » ou « eclosion » ; pour la quarantaine : « fin » ou « inquiet ». */
  etape?: string;
  /** Pour une alerte de vaccin : nom du vaccin. */
  libelle?: string;
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
  couveuses: Couveuse[];
  incubations: Incubation[];
  mirages: Mirage[];
  evenementsSante: EvenementSante[];
  quarantaines: Quarantaine[];
  notesQuarantaine: NoteQuarantaine[];
}

/** Informations de l'élevage imprimées sur les factures, reçus et récapitulatifs ; partagées entre tous les appareils (une seule fiche, `id: 'elevage'`). */
export interface ProfilElevage extends Enregistrement {
  nom?: string;
  adresse?: string;
  telephone?: string;
  ninea?: string;
  /** Logo en image (data:image/…;base64,…), réduit pour rester léger. */
  logo?: string;
}
