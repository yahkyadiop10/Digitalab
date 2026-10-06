import Dexie, { type Table } from 'dexie';
import type { Distribution, EntreeStock, Logement, Lot, Mouvement, Ponte } from '@digitalab/core';

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
  }
}

export const db = new BaseElevage();

export const TABLES_DONNEES = ['logements', 'lots', 'mouvements', 'pontes', 'distributions', 'entreesStock', 'reglages', 'etatsAlertes'] as const;
