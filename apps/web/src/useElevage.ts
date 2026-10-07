import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  effectifs,
  evaluerAlertes,
  rangNiveau,
  type Alerte,
  type DonneesElevage,
  type Niveau,
} from '@digitalab/core';
import { db, type EtatAlerte } from './db';
import { fusionnerReglages, type Reglages } from './reglages';
import type { Noms } from './i18n/fr';

export type { Reglages };
const vivants = <T extends { supprimeLe?: number | null }>(xs: T[] | undefined): T[] => (xs ?? []).filter((x) => !x.supprimeLe);

export interface AlerteEtat {
  alerte: Alerte;
  priseEnCharge: boolean;
}

export interface Elevage {
  donnees: DonneesElevage;
  reglages: Reglages;
  effectifParLot: Map<string, number>;
  alertes: AlerteEtat[];
  /** Niveau le plus grave parmi les alertes non encore prises en charge. */
  niveauGlobal: Niveau | 'vert';
  noms: Noms;
  maintenant: Date;
}

/** Applique les choix « pris en charge » et « reporter » aux alertes calculées. */
export function appliquerEtats(alertes: Alerte[], etats: EtatAlerte[], maintenant: number): AlerteEtat[] {
  const parCle = new Map(etats.map((e) => [e.cle, e]));
  const out: AlerteEtat[] = [];
  for (const a of alertes) {
    const e = parCle.get(a.cle);
    if (e?.statut === 'reportee' && (e.jusqua ?? 0) > maintenant) continue;
    out.push({ alerte: a, priseEnCharge: e?.statut === 'prise_en_charge' });
  }
  return out;
}

export function niveauGlobal(alertes: AlerteEtat[]): Niveau | 'vert' {
  let max: Niveau | 'vert' = 'vert';
  for (const { alerte, priseEnCharge } of alertes) {
    if (priseEnCharge) continue;
    if (max === 'vert' || rangNiveau(alerte.niveau) > rangNiveau(max)) max = alerte.niveau;
  }
  return max;
}

/** Toutes les données de l'élevage, tenues à jour en direct. `null` pendant le chargement. */
export function useElevage(): Elevage | null {
  const [maintenant, setMaintenant] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setMaintenant(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const lots = useLiveQuery(() => db.lots.toArray(), []);
  const logements = useLiveQuery(() => db.logements.toArray(), []);
  const mouvements = useLiveQuery(() => db.mouvements.toArray(), []);
  const pontes = useLiveQuery(() => db.pontes.toArray(), []);
  const distributions = useLiveQuery(() => db.distributions.toArray(), []);
  const entreesStock = useLiveQuery(() => db.entreesStock.toArray(), []);
  const couveuses = useLiveQuery(() => db.couveuses.toArray(), []);
  const incubations = useLiveQuery(() => db.incubations.toArray(), []);
  const mirages = useLiveQuery(() => db.mirages.toArray(), []);
  const reglagesBruts = useLiveQuery(() => db.reglages.toArray(), []);
  const etats = useLiveQuery(() => db.etatsAlertes.toArray(), []);

  return useMemo(() => {
    if (!lots || !logements || !mouvements || !pontes || !distributions || !entreesStock || !couveuses || !incubations || !mirages || !reglagesBruts || !etats) return null;
    const donnees: DonneesElevage = {
      lots: vivants(lots),
      logements: vivants(logements),
      mouvements: vivants(mouvements),
      pontes: vivants(pontes),
      distributions: vivants(distributions),
      entreesStock: vivants(entreesStock),
      couveuses: vivants(couveuses),
      incubations: vivants(incubations),
      mirages: vivants(mirages),
    };
    const reglages = fusionnerReglages(Object.fromEntries(reglagesBruts.map((r) => [r.cle, r.valeur])));
    const alertes = appliquerEtats(evaluerAlertes({ ...donnees, maintenant, especes: reglages.especes, seuils: reglages.seuils }), etats, maintenant.getTime());
    const noms: Noms = {
      lot: (id) => donnees.lots.find((l) => l.id === id)?.nom ?? 'Lot',
      logement: (id) => donnees.logements.find((l) => l.id === id)?.nom ?? 'Local',
      incubation: (id) => donnees.incubations.find((i) => i.id === id)?.nom ?? 'Incubation',
    };
    return { donnees, reglages, effectifParLot: effectifs(donnees.mouvements), alertes, niveauGlobal: niveauGlobal(alertes), noms, maintenant };
  }, [lots, logements, mouvements, pontes, distributions, entreesStock, couveuses, incubations, mirages, reglagesBruts, etats, maintenant]);
}
