import Dexie, { type Table } from 'dexie';
import type { OperationFinanciere, Couveuse, Distribution, EntreeStock, EvenementSante, Incubation, Logement, Lot, Mirage, Mouvement, NoteQuarantaine, Ponte, Quarantaine } from '@digitalab/core';

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
  reglages!: Table<Reglage, string>;
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
  }
}

export const db = new BaseElevage();

export const TABLES_DONNEES = ['logements', 'lots', 'mouvements', 'pontes', 'distributions', 'entreesStock', 'couveuses', 'incubations', 'mirages', 'evenementsSante', 'operations', 'quarantaines', 'notesQuarantaine', 'reglages', 'etatsAlertes'] as const;
