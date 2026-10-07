import { describe, expect, it } from 'vitest';
import { ajouterJours, ecartJours, jourLocal } from './dates';
import { effectifs } from './effectif';
import { consommationMoyenneKg, evaluerAlertes, stockAlimentKg, type EntreeAlertes } from './alertes';
import { ESPECES_PAR_DEFAUT, SEUILS_PAR_DEFAUT } from './parametres';
import type { Distribution, EntreeStock, Mouvement, Ponte } from './types';

const MAINTENANT = new Date(2026, 9, 6, 18, 0, 0); // 6 oct. 2026, 18 h (heure locale)
const AUJ = jourLocal(MAINTENANT);
let n = 0;
const id = () => `id${++n}`;
const base = { misAJour: 0 };

const mv = (lotId: string, type: Mouvement['type'], quantite: number, date = AUJ): Mouvement => ({ id: id(), ...base, lotId, type, quantite, date });
const ponte = (lotId: string, date: string, nombre: number): Ponte => ({ id: id(), ...base, lotId, date, nombre, casses: 0 });
const dist = (lotId: string, date: string, quantiteKg: number): Distribution => ({ id: id(), ...base, lotId, date, quantiteKg });
const stock = (date: string, quantiteKg: number): EntreeStock => ({ id: id(), ...base, date, quantiteKg });

function elevage(partiel: Partial<EntreeAlertes> = {}): EntreeAlertes {
  return {
    maintenant: MAINTENANT,
    especes: ESPECES_PAR_DEFAUT,
    seuils: SEUILS_PAR_DEFAUT,
    lots: [{ id: 'p', ...base, nom: 'Poules', especeCode: 'poule', logementId: 'g' }],
    logements: [{ id: 'g', ...base, nom: 'Poulailler', type: 'batiment', surfaceM2: 10 }],
    mouvements: [mv('p', 'arrivee', 20, ajouterJours(AUJ, -30))],
    pontes: [],
    distributions: [],
    entreesStock: [],
    couveuses: [],
    incubations: [],
    mirages: [],
    evenementsSante: [],
    protocoles: [],
    ...partiel,
  };
}

describe('dates', () => {
  it('ajoute et compte des jours sans dérive de fuseau', () => {
    expect(ajouterJours('2026-10-31', 1)).toBe('2026-11-01');
    expect(ajouterJours('2026-03-01', -1)).toBe('2026-02-28');
    expect(ecartJours('2026-10-01', '2026-10-06')).toBe(5);
  });
});

describe('effectifs', () => {
  it('déduit l’effectif du journal et ignore les mouvements supprimés', () => {
    const m = [mv('p', 'arrivee', 20), mv('p', 'deces', -3), { ...mv('p', 'deces', -5), supprimeLe: 1 }];
    expect(effectifs(m).get('p')).toBe(17);
  });
});

describe('densité', () => {
  // 20 poules × 0,25 m² = 5 m² nécessaires
  it('ne signale rien sous 80 %', () => {
    expect(evaluerAlertes(elevage()).filter((a) => a.code === 'densite')).toHaveLength(0);
  });
  it('jaune de 80 %, orange de 90 %, rouge de 100 %', () => {
    const niveau = (surface: number) => evaluerAlertes(elevage({ logements: [{ id: 'g', ...base, nom: 'P', type: 'batiment', surfaceM2: surface }] })).find((a) => a.code === 'densite')?.niveau;
    expect(niveau(6.25)).toBe('jaune'); // 80 %
    expect(niveau(5.55)).toBe('orange'); // 90 %
    expect(niveau(5)).toBe('rouge'); // 100 %
    expect(niveau(4)).toBe('rouge');
  });
  it('ignore un logement sans surface', () => {
    const e = elevage({ logements: [{ id: 'g', ...base, nom: 'P', type: 'batiment', surfaceM2: null }] });
    expect(evaluerAlertes(e)).toHaveLength(0);
  });
});

describe('mortalité', () => {
  it('ne déclenche pas de rouge pour un seul décès dans un petit lot', () => {
    const e = elevage({ mouvements: [mv('p', 'arrivee', 8, ajouterJours(AUJ, -30)), mv('p', 'deces', -1)] });
    const a = evaluerAlertes(e).find((x) => x.code === 'mortalite');
    expect(a?.niveau).toBe('jaune');
  });
  it('passe en rouge dès 2 décès et 2 % dans la journée', () => {
    const e = elevage({ mouvements: [mv('p', 'arrivee', 60, ajouterJours(AUJ, -30)), mv('p', 'deces', -3)] });
    const a = evaluerAlertes(e).find((x) => x.code === 'mortalite');
    expect(a?.niveau).toBe('rouge');
    expect(a?.params).toMatchObject({ deces: 3, jours: 1, taux: 5 });
  });
  it('compte la fenêtre de 7 jours', () => {
    const e = elevage({
      mouvements: [mv('p', 'arrivee', 100, ajouterJours(AUJ, -30)), mv('p', 'deces', -2, ajouterJours(AUJ, -5)), mv('p', 'deces', -2, ajouterJours(AUJ, -3))],
    });
    const a = evaluerAlertes(e).find((x) => x.code === 'mortalite');
    expect(a?.niveau).toBe('orange'); // 4 / 100 = 4 %
    expect(a?.params.jours).toBe(7);
  });
  it('ne signale rien sans décès', () => {
    expect(evaluerAlertes(elevage()).some((x) => x.code === 'mortalite')).toBe(false);
  });
});

describe('chute de ponte', () => {
  const historique = [ponte('p', ajouterJours(AUJ, -3), 10), ponte('p', ajouterJours(AUJ, -2), 10), ponte('p', ajouterJours(AUJ, -1), 10)];
  it('alerte orange sous 85 % de la moyenne, une fois la collecte terminée', () => {
    const a = evaluerAlertes(elevage({ pontes: [...historique, ponte('p', AUJ, 8)] })).find((x) => x.code === 'chute_ponte');
    expect(a?.niveau).toBe('orange');
    expect(a?.params).toMatchObject({ valeur: 8, moyenne: 10, pct: 80 });
  });
  it('alerte rouge sous 60 %', () => {
    const a = evaluerAlertes(elevage({ pontes: [...historique, ponte('p', AUJ, 5)] })).find((x) => x.code === 'chute_ponte');
    expect(a?.niveau).toBe('rouge');
  });
  it('attend l’heure de bilan avant de juger la ponte du jour', () => {
    const matin = new Date(2026, 9, 6, 9, 0, 0);
    const e = elevage({ maintenant: matin, pontes: [...historique, ponte('p', AUJ, 2)] });
    expect(evaluerAlertes(e).some((x) => x.code === 'chute_ponte')).toBe(false);
  });
  it('additionne plusieurs collectes dans la journée', () => {
    const e = elevage({ pontes: [...historique, ponte('p', AUJ, 4), ponte('p', AUJ, 6)] });
    expect(evaluerAlertes(e).some((x) => x.code === 'chute_ponte')).toBe(false);
  });
  it('ne conclut pas avec trop peu de données ou trop peu d’œufs', () => {
    expect(evaluerAlertes(elevage({ pontes: [ponte('p', ajouterJours(AUJ, -1), 10), ponte('p', AUJ, 1)] })).some((x) => x.code === 'chute_ponte')).toBe(false);
    const peu = [ponte('p', ajouterJours(AUJ, -3), 2), ponte('p', ajouterJours(AUJ, -2), 2), ponte('p', AUJ, 0)];
    expect(evaluerAlertes(elevage({ pontes: peu })).some((x) => x.code === 'chute_ponte')).toBe(false);
  });
  it('ignore les espèces non pondeuses', () => {
    const e = elevage({ lots: [{ id: 'p', ...base, nom: 'X', especeCode: 'autre', logementId: 'g' }], pontes: [...historique, ponte('p', AUJ, 1)] });
    expect(evaluerAlertes(e).some((x) => x.code === 'chute_ponte')).toBe(false);
  });
});

describe('stock d’aliment', () => {
  const conso = [1, 2, 3].map((i) => dist('p', ajouterJours(AUJ, -i), 2));
  it('est silencieux tant que le stock n’est pas suivi', () => {
    expect(evaluerAlertes(elevage({ distributions: conso })).some((x) => x.code === 'stock_aliment')).toBe(false);
  });
  it('calcule le stock et la consommation', () => {
    const e = { entreesStock: [stock(ajouterJours(AUJ, -10), 50)], distributions: conso };
    expect(stockAlimentKg(e)).toBe(44);
    expect(consommationMoyenneKg(e, AUJ)).toBe(2);
  });
  it('jaune sous 7 jours, orange sous 3 jours, rouge à zéro', () => {
    const niveau = (kg: number) => evaluerAlertes(elevage({ distributions: conso, entreesStock: [stock(ajouterJours(AUJ, -10), kg)] })).find((x) => x.code === 'stock_aliment')?.niveau;
    expect(niveau(20)).toBeUndefined(); // 14 / 2 = 7 j
    expect(niveau(19)).toBe('jaune'); // 13 / 2 = 6,5 j
    expect(niveau(11)).toBe('orange'); // 5 / 2 = 2,5 j
    expect(niveau(6)).toBe('rouge'); // stock nul
  });
});

describe('tri', () => {
  it('place les alertes les plus graves en premier', () => {
    const e = elevage({
      mouvements: [mv('p', 'arrivee', 60, ajouterJours(AUJ, -30)), mv('p', 'deces', -3)],
      logements: [{ id: 'g', ...base, nom: 'P', type: 'batiment', surfaceM2: 20 }],
    });
    const niveaux = evaluerAlertes(e).map((a) => a.niveau);
    expect(niveaux[0]).toBe('rouge');
  });
});
