import Dexie, { type Table } from 'dexie';
import type { CompteTresorerie, Pointage, Transfert, Employe, Paiement, ProfilElevage, Tiers, RoleMembre, OperationFinanciere, Couveuse, Distribution, EntreeStock, EvenementSante, Incubation, Logement, Lot, Mirage, Mouvement, NoteQuarantaine, Ponte, Quarantaine } from '@digitalab/core';

export interface Reglage {
  cle: string;
  valeur: unknown;
}

/** État d'une alerte choisi par l'utilisateur. */
export interface EtatAlerte {
  cle: string;
  statut: 'prise_en_charge' | 'reportee';
  /** Pour « reportée » : instant (ms) jusqu'auquel l'alerte reste masquée. */
  jusqua?: number;
}

/** Lien de cet appareil avec le serveur (compte, élevage choisi, avancement de la synchronisation). Jamais sauvegardé ni synchronisé. */
export interface Connexion {
  cle: 'serveur';
  url: string;
  jeton: string;
  identifiant: string;
  organisationId: string;
  organisationNom: string;
  role: RoleMembre;
  /** Fonction dans la ferme (« Responsable bâtiment A »), droits accordés et bâtiments réservés, tels que le serveur les a donnés à la dernière synchronisation. */
  fonction?: string;
  droits: string[];
  zones: string[];
  /** Dernier numéro de séquence reçu du serveur. */
  derniereSeq: number;
  /** Début de la dernière synchronisation réussie : seules les modifications plus récentes sont envoyées. */
  dernierEnvoi: number;
  derniereSync?: number;
  /** Dernier refus du serveur (session expirée, accès retiré…) ; effacé à la prochaine réussite. */
  erreur?: string;
}

/** Réglages propres à l'appareil et à la sécurité (code de verrouillage, compte requis…). Jamais sauvegardés ni synchronisés. */
export interface LigneAppareil {
  cle: string;
  valeur: unknown;
}

export class BaseElevage extends Dexie {
  logements!: Table<Logement, string>;
  lots!: Table<Lot, string>;
  mouvements!: Table<Mouvement, string>;
  pontes!: Table<Ponte, string>;
  distributions!: Table<Distribution, string>;
  entreesStock!: Table<EntreeStock, string>;
  couveuses!: Table<Couveuse, string>;
  incubations!: Table<Incubation, string>;
  mirages!: Table<Mirage, string>;
  evenementsSante!: Table<EvenementSante, string>;
  operations!: Table<OperationFinanciere, string>;
  quarantaines!: Table<Quarantaine, string>;
  notesQuarantaine!: Table<NoteQuarantaine, string>;
  paiements!: Table<Paiement, string>;
  tiers!: Table<Tiers, string>;
  employes!: Table<Employe, string>;
  profil!: Table<ProfilElevage, string>;
  comptes!: Table<CompteTresorerie, string>;
  transferts!: Table<Transfert, string>;
  pointages!: Table<Pointage, string>;
  reglages!: Table<Reglage, string>;
  connexion!: Table<Connexion, string>;
  appareil!: Table<LigneAppareil, string>;
  etatsAlertes!: Table<EtatAlerte, string>;

  constructor(nom = 'digitalab') {
    super(nom);
    this.version(1).stores({
      logements: 'id',
      lots: 'id, logementId',
      mouvements: 'id, lotId, date',
      pontes: 'id, lotId, date',
      distributions: 'id, lotId, date',
      entreesStock: 'id, date',
      reglages: 'cle',
      etatsAlertes: 'cle',
    });
    this.version(2).stores({
      couveuses: 'id',
      incubations: 'id, couveuseId',
      mirages: 'id, incubationId',
    });
    this.version(3).stores({
      evenementsSante: 'id, lotId, type, date',
    });
    this.version(4).stores({
      operations: 'id, date, sens',
    });
    this.version(5).stores({
      quarantaines: 'id, lotId',
      notesQuarantaine: 'id, quarantaineId, date',
    });
    this.version(6).stores({
      connexion: 'cle',
    });
    this.version(7).stores({
      paiements: 'id, operationId, date',
      tiers: 'id',
      employes: 'id',
    });
    this.version(8).stores({
      profil: 'id',
    });
    this.version(9).stores({
      comptes: 'id',
      transferts: 'id, date',
      pointages: 'id, compteId, date',
    });
    this.version(10).stores({
      appareil: 'cle',
    });
  }
}

export const db = new BaseElevage();

export const TABLES_DONNEES = ['logements', 'lots', 'mouvements', 'pontes', 'distributions', 'entreesStock', 'couveuses', 'incubations', 'mirages', 'evenementsSante', 'operations', 'quarantaines', 'notesQuarantaine', 'paiements', 'tiers', 'employes', 'profil', 'comptes', 'transferts', 'pointages', 'reglages', 'etatsAlertes'] as const;
