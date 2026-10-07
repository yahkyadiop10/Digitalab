import Dexie, { type Table } from 'dexie';
import type { Couveuse, Distribution, EntreeStock, Incubation, Logement, Lot, Mirage, Mouvement, Ponte } from '@digitalab/core';

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
  }
}

export const db = new BaseElevage();

export const TABLES_DONNEES = ['logements', 'lots', 'mouvements', 'pontes', 'distributions', 'entreesStock', 'couveuses', 'incubations', 'mirages', 'reglages', 'etatsAlertes'] as const;
