/** Tables de l'élevage synchronisées entre appareils (les réglages restent propres à chaque appareil). */
export const TABLES_SYNCHRONISEES = [
  'logements',
  'lots',
  'mouvements',
  'pontes',
  'distributions',
  'entreesStock',
  'couveuses',
  'incubations',
  'mirages',
  'evenementsSante',
  'operations',
  'quarantaines',
  'notesQuarantaine',
  'paiements',
  'tiers',
  'employes',
  'profil',
  'comptes',
  'transferts',
  'pointages',
] as const;

export type TableSynchronisee = (typeof TABLES_SYNCHRONISEES)[number];

/** Un enregistrement échangé : il porte son identifiant et son horodatage de modification. */
export interface EnregistrementSync {
  id: string;
  misAJour: number;
  supprimeLe?: number | null;
  [champ: string]: unknown;
}

export interface ChangementSync {
  table: TableSynchronisee;
  enregistrement: EnregistrementSync;
}

export interface DemandeSync {
  /** Dernier numéro de séquence reçu du serveur (0 la première fois). */
  depuisSeq: number;
  /** Modifications faites sur cet appareil depuis la dernière synchronisation. */
  changements: ChangementSync[];
}

export interface ReponseSync {
  /** Numéro de séquence à renvoyer à la prochaine demande. */
  seq: number;
  /** Modifications des autres appareils (et les vôtres, déjà connues). */
  changements: ChangementSync[];
  /** Vrai s'il reste des modifications à récupérer : redemandez tout de suite. */
  reste: boolean;
  /** Nombre de vos modifications écartées car une version plus récente existait déjà sur le serveur. */
  ecartes: number;
  /** Nombre de vos modifications refusées faute d'autorisation. */
  refuses: number;
  /** Vos droits actuels, pour que l'appareil s'adapte quand l'administrateur les change. */
  moi: DroitsMembre;
}

export type { RoleMembre } from './permissions';

/** Ce que le serveur dit de la personne connectée : son profil, ses droits et ses zones. */
export interface DroitsMembre {
  role: import('./permissions').RoleMembre;
  fonction?: string;
  droits: string[];
  /** Bâtiments et cages réservés à cette personne ; vide = toute la ferme. */
  zones: string[];
}

/** Garde un numéro de téléphone sous forme internationale (+221…), ou `null` s'il est invalide. */
export function normaliserTelephone(brut: string): string | null {
  let s = brut.trim().replace(/[\s.\-()]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!s.startsWith('+')) {
    if (/^7\d{8}$/.test(s)) s = `+221${s}`; // numéro sénégalais à 9 chiffres
    else if (/^221\d{9}$/.test(s)) s = `+${s}`;
    else return null;
  }
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}
