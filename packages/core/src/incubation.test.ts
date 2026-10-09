import { describe, expect, it } from 'vitest';
import { evaluerAlertes, type EntreeAlertes } from './alertes';
import { ajouterJours } from './dates';
import { etapesIncubation, occupation, placesLibres, placesPourNouvelleMise, prochaineLiberation, statsIncubation, suivreEtapes, tachesIncubation } from './incubation';
import { ESPECES_PAR_DEFAUT, SEUILS_PAR_DEFAUT } from './parametres';
import type { Couveuse, Incubation, Mirage } from './types';

const base = { misAJour: 0 };
const POULE = ESPECES_PAR_DEFAUT['poule']!.incubation!;
const CAILLE = ESPECES_PAR_DEFAUT['caille']!.incubation!;

const couveuse = (partiel: Partial<Couveuse> = {}): Couveuse => ({ id: 'c', ...base, nom: 'Couveuse', type: 'automatique', capacites: { poule: 150 }, eclosoirSepare: false, ...partiel });
const inc = (id: string, miseEnPlace: string, nbOeufs: number, partiel: Partial<Incubation> = {}): Incubation => ({ id, ...base, couveuseId: 'c', especeCode: 'poule', nom: id, miseEnPlace, nbOeufs, faits: [], ...partiel });
const mirage = (incubationId: string, etape: number, jour: string, clairs: number, morts = 0): Mirage => ({ id: `${incubationId}-${etape}`, ...base, incubationId, etape, jour, clairs, morts });

describe('étapes', () => {
  it('calcule le calendrier d’une poule : mirages J7 et J14, arrêt du retournement J18, éclosion J21', () => {
    const e = etapesIncubation(inc('a', '2026-10-01', 100), POULE, false);
    expect(e.map((x) => [x.cle, x.date])).toEqual([
      ['mirage:7', '2026-10-08'],
      ['mirage:14', '2026-10-15'],
      ['retournement', '2026-10-19'],
      ['eclosion', '2026-10-22'],
    ]);
  });

  it('ajoute le transfert vers l’éclosoir, le même jour que l’arrêt du retournement, quand l’éclosoir est séparé', () => {
    const e = etapesIncubation(inc('a', '2026-10-01', 100), POULE, true);
    expect(e.map((x) => x.cle)).toEqual(['mirage:7', 'mirage:14', 'retournement', 'transfert', 'eclosion']);
    expect(e.find((x) => x.cle === 'transfert')?.date).toBe('2026-10-19');
  });

  it('adapte le calendrier à la caille : arrêt du retournement J14, éclosion J18', () => {
    const e = etapesIncubation(inc('a', '2026-10-01', 60, { especeCode: 'caille' }), CAILLE, false);
    expect(e.at(-2)).toMatchObject({ cle: 'retournement', date: '2026-10-15' });
    expect(e.at(-1)).toMatchObject({ cle: 'eclosion', date: '2026-10-19' });
  });

  it('suit l’état de chaque étape, avec un avertissement la veille (deux jours avant l’éclosion)', () => {
    const i = inc('a', '2026-10-01', 100, { faits: ['retournement'] });
    const m = [mirage('a', 7, '2026-10-08', 10)];
    const statuts = (jour: string, sep = false) => Object.fromEntries(suivreEtapes(i, POULE, m, jour, sep).map((e) => [e.cle, e.statut]));
    expect(statuts('2026-10-15')).toMatchObject({ 'mirage:7': 'fait', 'mirage:14': 'aujourdhui', retournement: 'fait', eclosion: 'a_venir' });
    expect(statuts('2026-10-14')).toMatchObject({ 'mirage:14': 'bientot' });
    expect(statuts('2026-10-13')).toMatchObject({ 'mirage:14': 'a_venir' });
    expect(statuts('2026-10-20')).toMatchObject({ eclosion: 'bientot' });
    expect(statuts('2026-10-19', true)).toMatchObject({ transfert: 'aujourdhui' });
    expect(suivreEtapes(i, POULE, m, '2026-10-17', false).find((e) => e.cle === 'mirage:14')).toMatchObject({ statut: 'retard', retard: 2 });
    expect(suivreEtapes(i, POULE, m, '2026-10-21', false).find((e) => e.cle === 'eclosion')).toMatchObject({ statut: 'bientot', dans: 1 });
  });

  it('reconnaît l’ancien « transfert » comme arrêt du retournement fait', () => {
    const i = inc('a', '2026-10-01', 100, { faits: ['transfert'] });
    expect(suivreEtapes(i, POULE, [], '2026-10-19', false).find((e) => e.cle === 'retournement')?.statut).toBe('fait');
  });
});

describe('tâches du jour', () => {
  const especes = ESPECES_PAR_DEFAUT;
  it('ajoute le retournement pour une couveuse manuelle, tant que l’œuf n’est pas transféré', () => {
    const c = couveuse({ type: 'manuelle' });
    const i = inc('a', '2026-10-01', 50);
    const faits = [mirage('a', 7, '2026-10-08', 0), mirage('a', 14, '2026-10-15', 0)];
    const genres = (jour: string, incs = [i]) => tachesIncubation(incs, [c], faits, especes, jour).map((t) => t.genre);
    expect(genres('2026-10-01')).toEqual([]); // jour de mise en place
    expect(genres('2026-10-03')).toEqual(['tourner']);
    expect(genres('2026-10-03', [inc('a', '2026-10-01', 50, { faits: ['tour:2026-10-03'] })])).toEqual([]);
    expect(genres('2026-10-19')).toEqual(['etape']); // jour du transfert : plus de retournement
  });

  it('ne demande pas de retournement pour une couveuse automatique', () => {
    expect(tachesIncubation([inc('a', '2026-10-01', 50)], [couveuse()], [], especes, '2026-10-03')).toEqual([]);
  });

  it('ignore une mise en incubation déjà éclose', () => {
    const i = inc('a', '2026-10-01', 50, { eclosion: { jour: '2026-10-22', nes: 40, mortsCoquille: 2, lotId: null } });
    expect(tachesIncubation([i], [couveuse()], [], especes, '2026-10-22')).toEqual([]);
  });
});

describe('occupation et capacité', () => {
  const especes = ESPECES_PAR_DEFAUT;
  it('compte les œufs présents, après retrait des œufs clairs', () => {
    const c = couveuse();
    const incs = [inc('a', '2026-10-01', 100)];
    expect(placesLibres(c, incs, [], especes, 'poule', '2026-10-05')).toBe(50);
    expect(placesLibres(c, incs, [mirage('a', 7, '2026-10-08', 20, 5)], especes, 'poule', '2026-10-09')).toBe(75);
    expect(placesLibres(c, incs, [], especes, 'poule', '2026-09-30')).toBe(150);
  });

  it('libère la place au transfert si l’éclosoir est séparé, à l’éclosion sinon', () => {
    const incs = [inc('a', '2026-10-01', 100)];
    expect(placesLibres(couveuse({ eclosoirSepare: true }), incs, [], especes, 'poule', '2026-10-19')).toBe(150);
    expect(placesLibres(couveuse({ eclosoirSepare: true }), incs, [], especes, 'poule', '2026-10-18')).toBe(50);
    expect(placesLibres(couveuse(), incs, [], especes, 'poule', '2026-10-19')).toBe(50);
    expect(placesLibres(couveuse(), incs, [], especes, 'poule', '2026-10-23')).toBe(150);
  });

  it('partage l’appareil entre espèces selon leurs capacités', () => {
    const c = couveuse({ capacites: { poule: 150, caille: 300 } });
    const incs = [inc('a', '2026-10-01', 75), inc('b', '2026-10-01', 60, { especeCode: 'caille' })]; // 50 % + 20 %
    expect(occupation(c, incs, [], especes, '2026-10-02').fraction).toBeCloseTo(0.7);
    expect(placesLibres(c, incs, [], especes, 'poule', '2026-10-02')).toBe(45);
    expect(placesLibres(c, incs, [], especes, 'caille', '2026-10-02')).toBe(90);
  });

  it('renvoie null quand la capacité n’est pas renseignée', () => {
    expect(placesLibres(couveuse({ capacites: {} }), [], [], especes, 'poule', '2026-10-01')).toBeNull();
  });

  it('tient compte d’une mise en incubation ultérieure pendant la période', () => {
    const c = couveuse();
    const incs = [inc('a', '2026-10-05', 100)];
    // Une mise en place le 1er octobre croise celle du 5 : au pic il ne reste que 50 places.
    expect(placesPourNouvelleMise(c, incs, [], especes, 'poule', '2026-10-01')).toBe(50);
    expect(placesPourNouvelleMise(c, incs, [], especes, 'poule', '2026-11-01')).toBe(150);
  });

  it('donne la prochaine libération', () => {
    const incs = [inc('a', '2026-10-01', 100), inc('b', '2026-10-10', 10)];
    expect(prochaineLiberation(couveuse(), incs, especes, '2026-10-05')).toBe('2026-10-23');
    expect(prochaineLiberation(couveuse({ eclosoirSepare: true }), incs, especes, '2026-10-05')).toBe('2026-10-19');
  });
});

describe('résultats', () => {
  it('calcule fertilité et taux d’éclosion', () => {
    const i = inc('a', '2026-10-01', 100, { eclosion: { jour: '2026-10-22', nes: 63, mortsCoquille: 7, lotId: 'l' } });
    const s = statsIncubation(i, [mirage('a', 7, '2026-10-08', 20), mirage('a', 14, '2026-10-15', 2, 8)]);
    expect(s).toMatchObject({ mis: 100, clairs: 22, mortsOvo: 8, fecondes: 78, nes: 63, tauxFertilite: 78, tauxEclosionFecondes: 80.8, tauxEclosionMis: 63 });
  });

  it('ne conclut pas sur la fertilité sans mirage', () => {
    const s = statsIncubation(inc('a', '2026-10-01', 100), []);
    expect(s.tauxFertilite).toBeNull();
    expect(s.nes).toBeNull();
  });
});

describe('alertes d’incubation', () => {
  const entree = (jour: string, partiel: Partial<EntreeAlertes> = {}): EntreeAlertes => ({
    maintenant: new Date(`${jour}T10:00:00`), especes: ESPECES_PAR_DEFAUT, seuils: SEUILS_PAR_DEFAUT,
    lots: [], logements: [], mouvements: [], pontes: [], distributions: [], entreesStock: [],
    couveuses: [couveuse()], incubations: [inc('a', '2026-10-01', 100)], mirages: [], evenementsSante: [], quarantaines: [], notesQuarantaine: [], protocoles: [], ...partiel,
  });
  const incub = (jour: string, partiel?: Partial<EntreeAlertes>) => evaluerAlertes(entree(jour, partiel)).filter((a) => a.code === 'incubation');
  const miragesFaits = [mirage('a', 7, '2026-10-08', 5), mirage('a', 14, '2026-10-15', 1)];

  it('est silencieuse les jours sans étape', () => {
    expect(incub('2026-10-03')).toEqual([]);
  });
  it('prévient la veille du mirage du 7e jour (jaune), le jour même (orange), puis en retard (orange)', () => {
    expect(incub('2026-10-07')).toMatchObject([{ niveau: 'jaune', etape: 'mirage', params: { jourJ: 7, dans: 1 } }]);
    expect(incub('2026-10-08')).toMatchObject([{ niveau: 'orange', etape: 'mirage', params: { jourJ: 7 } }]);
    expect(incub('2026-10-10')).toMatchObject([{ niveau: 'orange', etape: 'mirage', params: { retard: 2 } }]);
  });
  it('s’éteint quand l’étape est faite', () => {
    expect(incub('2026-10-08', { mirages: [mirage('a', 7, '2026-10-08', 5)] })).toEqual([]);
  });
  it('signale l’arrêt du retournement automatique, en rouge s’il est en retard', () => {
    const e = { mirages: miragesFaits };
    expect(incub('2026-10-18', e)).toMatchObject([{ niveau: 'jaune', etape: 'retournement', params: { auto: 1, dans: 1 } }]);
    expect(incub('2026-10-19', e)).toMatchObject([{ niveau: 'orange', etape: 'retournement' }]);
    expect(incub('2026-10-20', e).map((a) => [a.etape, a.niveau])).toEqual([['retournement', 'rouge'], ['eclosion', 'jaune']]);
  });
  it('signale le transfert vers l’éclosoir séparé, en plus de l’arrêt du retournement', () => {
    const e = { mirages: miragesFaits, couveuses: [couveuse({ eclosoirSepare: true })] };
    expect(incub('2026-10-19', e).map((a) => [a.etape, a.niveau, a.params['separe']])).toEqual([['retournement', 'orange', 1], ['transfert', 'orange', 1]]);
  });
  it('avertit deux jours avant l’éclosion, puis le jour même, puis en retard', () => {
    const e = { mirages: miragesFaits, incubations: [inc('a', '2026-10-01', 100, { faits: ['retournement'] })] };
    expect(incub('2026-10-20', e)).toMatchObject([{ niveau: 'jaune', etape: 'eclosion', params: { dans: 2 } }]);
    expect(incub('2026-10-22', e)).toMatchObject([{ niveau: 'orange', etape: 'eclosion' }]);
    expect(incub('2026-10-24', e)).toMatchObject([{ niveau: 'orange', etape: 'eclosion', params: { retard: 2 } }]);
  });
  it('ne signale plus rien après l’éclosion', () => {
    const e = { mirages: miragesFaits, incubations: [inc('a', '2026-10-01', 100, { eclosion: { jour: '2026-10-22', nes: 80, mortsCoquille: 5, lotId: null } })] };
    expect(incub('2026-10-23', e)).toEqual([]);
  });
  it('ajouterJours reste cohérent avec les dates de test', () => {
    expect(ajouterJours('2026-10-01', 21)).toBe('2026-10-22');
  });
});
