import { describe, expect, it } from 'vitest';
import { evaluerAlertes, type EntreeAlertes } from './alertes';
import { ESPECES_PAR_DEFAUT, SEUILS_PAR_DEFAUT } from './parametres';
import { bilanQuarantaine, derniereNote, finQuarantaine, naissanceEstimee, quarantainesActives, suivreQuarantaine } from './quarantaine';
import { tableauDeBord } from './tableau';
import type { DonneesElevage, Lot, Mouvement, NoteQuarantaine, Quarantaine } from './types';
import type { OperationFinanciere } from './finances';

const base = { misAJour: 0 };
const AUJ = '2026-10-07';
let n = 0;
const q = (partiel: Partial<Quarantaine> = {}): Quarantaine => ({ id: 'q', ...base, nom: 'Arrivage', lotId: 'a', especeCode: 'poule', nombre: 10, arrivee: '2026-10-01', dureeJours: 21, etapes: [], ...partiel });
const note = (partiel: Partial<NoteQuarantaine> = {}): NoteQuarantaine => ({ id: `n${++n}`, ...base, quarantaineId: 'q', date: AUJ, etat: 'bien', comportements: [], ...partiel });
const mv = (lotId: string, type: Mouvement['type'], quantite: number, date = '2026-10-01'): Mouvement => ({ id: `m${++n}`, ...base, lotId, type, quantite, date });
const lot = (id: string, partiel: Partial<Lot> = {}): Lot => ({ id, ...base, nom: id, especeCode: 'poule', ...partiel });

describe('suivi de quarantaine', () => {
  it('compte les jours et trouve la date de fin', () => {
    expect(finQuarantaine(q())).toBe('2026-10-22');
    expect(suivreQuarantaine(q(), AUJ)).toMatchObject({ jourJ: 6, joursRestants: 15, fin: '2026-10-22', statut: 'en_cours' });
  });
  it('passe en « fin proche » la veille, puis « à décider » le jour de la fin et après', () => {
    expect(suivreQuarantaine(q(), '2026-10-21').statut).toBe('fin_proche');
    expect(suivreQuarantaine(q(), '2026-10-22').statut).toBe('a_decider');
    expect(suivreQuarantaine(q(), '2026-10-25')).toMatchObject({ statut: 'a_decider', joursRestants: -3 });
  });
  it('est terminée quand une sortie est notée', () => {
    expect(suivreQuarantaine(q({ sortie: { jour: '2026-10-20', decision: 'integre' } }), AUJ).statut).toBe('terminee');
    expect(quarantainesActives([q(), q({ id: 'r', sortie: { jour: AUJ, decision: 'ecarte' } }), { ...q({ id: 's' }), supprimeLe: 1 }]).map((x) => x.id)).toEqual(['q']);
  });
  it('estime la naissance d’après l’âge à l’arrivée', () => {
    expect(naissanceEstimee('2026-10-01', 56)).toBe('2026-08-06');
    expect(naissanceEstimee('2026-10-01', -5)).toBe('2026-10-01');
  });
  it('retient la note la plus récente', () => {
    const notes = [note({ date: '2026-10-05', note: 'ancienne' }), note({ date: '2026-10-07', note: 'récente' }), note({ quarantaineId: 'autre', date: '2026-10-08' })];
    expect(derniereNote(notes, 'q')?.note).toBe('récente');
    expect(derniereNote([], 'q')).toBeUndefined();
  });
  it('fait le bilan : présents, morts, évolution du poids', () => {
    const b = bilanQuarantaine(q(), [note({ date: '2026-10-02', poidsMoyenG: 800 }), note({ date: '2026-10-06', poidsMoyenG: 880 }), note({ date: '2026-10-04' })], [mv('a', 'arrivee', 10), mv('a', 'deces', -2, '2026-10-03')]);
    expect(b).toEqual({ arrives: 10, presents: 8, morts: 2, notes: 3, poidsDebutG: 800, poidsFinG: 880 });
  });
});

describe('alertes de quarantaine', () => {
  const entree = (jour: string, partiel: Partial<EntreeAlertes> = {}): EntreeAlertes => ({
    maintenant: new Date(`${jour}T10:00:00`), especes: ESPECES_PAR_DEFAUT, seuils: SEUILS_PAR_DEFAUT, protocoles: [],
    lots: [lot('a')], logements: [], mouvements: [mv('a', 'arrivee', 10)], pontes: [], distributions: [], entreesStock: [],
    couveuses: [], incubations: [], mirages: [], evenementsSante: [], quarantaines: [q()], notesQuarantaine: [], ...partiel,
  });
  const quarantaine = (jour: string, partiel?: Partial<EntreeAlertes>) => evaluerAlertes(entree(jour, partiel)).filter((a) => a.code === 'quarantaine');

  it('est silencieuse pendant la quarantaine', () => {
    expect(quarantaine(AUJ)).toEqual([]);
  });
  it('prévient la veille de la fin (jaune), puis demande de décider (orange)', () => {
    expect(quarantaine('2026-10-21')).toMatchObject([{ niveau: 'jaune', etape: 'fin', quarantaineId: 'q' }]);
    expect(quarantaine('2026-10-24')).toMatchObject([{ niveau: 'orange', etape: 'fin', params: { retard: 2 } }]);
  });
  it('s’éteint une fois la quarantaine terminée', () => {
    expect(quarantaine('2026-10-24', { quarantaines: [q({ sortie: { jour: '2026-10-23', decision: 'integre' } })] })).toEqual([]);
  });
  it('signale une note inquiétante récente, pas une ancienne ni une rassurante', () => {
    const inquiete = note({ etat: 'inquietant', malades: 3, date: AUJ });
    expect(quarantaine(AUJ, { notesQuarantaine: [inquiete] })).toMatchObject([{ niveau: 'orange', etape: 'inquiet', params: { malades: 3 } }]);
    expect(quarantaine(AUJ, { notesQuarantaine: [note({ etat: 'inquietant', date: '2026-10-03' })] })).toEqual([]);
    expect(quarantaine(AUJ, { notesQuarantaine: [note({ etat: 'inquietant', date: '2026-10-06' }), note({ etat: 'bien', date: AUJ })] })).toEqual([]);
  });
});

describe('tableau de bord', () => {
  const donnees: DonneesElevage = {
    lots: [
      lot('a', { nom: 'Soie', race: 'Soie', naissance: '2026-09-20', logementId: 'g' }),
      lot('b', { nom: 'Brahma', race: 'Brahma', naissance: '2025-01-01', logementId: 'g' }),
      lot('c', { nom: 'Cailles', especeCode: 'caille', logementId: 'h', naissance: '2026-08-01' }),
      lot('d', { nom: 'Arrivage', naissance: undefined, logementId: 'i' }),
      lot('e', { nom: 'Vide' }),
      lot('f', { nom: 'Sans local', especeCode: 'autre' }),
    ],
    logements: [
      { id: 'g', ...base, nom: 'Poulailler', type: 'batiment', surfaceM2: 10 },
      { id: 'h', ...base, nom: 'Cages', type: 'cage', surfaceM2: 1 },
      { id: 'i', ...base, nom: 'Zone de quarantaine', type: 'quarantaine', surfaceM2: null },
    ],
    mouvements: [mv('a', 'arrivee', 10), mv('b', 'arrivee', 10), mv('c', 'arrivee', 40), mv('d', 'arrivee', 5), mv('f', 'arrivee', 2), mv('e', 'arrivee', 3), mv('e', 'vente', -3)],
    pontes: [
      { id: 'p1', ...base, lotId: 'b', date: AUJ, nombre: 8, casses: 0 },
      { id: 'p2', ...base, lotId: 'c', date: '2026-10-05', nombre: 30, casses: 0 },
      { id: 'p3', ...base, lotId: 'c', date: '2026-09-01', nombre: 99, casses: 0 },
    ],
    distributions: [], entreesStock: [], couveuses: [],
    incubations: [{ id: 'i1', ...base, couveuseId: 'x', especeCode: 'poule', nom: 'Série 1', miseEnPlace: '2026-09-30', nbOeufs: 50, faits: [] }],
    mirages: [{ id: 'mi', ...base, incubationId: 'i1', etape: 7, jour: '2026-10-07', clairs: 5, morts: 0 }],
    evenementsSante: [{ id: 'ev', ...base, lotId: 'a', type: 'traitement', date: '2026-10-06', nom: 'X', dureeJours: 3, delaiAttenteJours: 2 }],
    quarantaines: [q({ lotId: 'd', nombre: 5 })], notesQuarantaine: [],
  };
  const operations: OperationFinanciere[] = [
    { id: 'o1', ...base, date: '2026-10-03', sens: 'recette', categorie: 'oeufs', montant: 30000, paye: true },
    { id: 'o2', ...base, date: '2026-09-10', sens: 'depense', categorie: 'materiel', montant: 12000, paye: false },
  ];
  const t = tableauDeBord({ donnees, operations, especes: ESPECES_PAR_DEFAUT, protocoles: [], maintenant: new Date(`${AUJ}T10:00:00`) });

  it('récapitule le cheptel par espèce, race et âge, sans les lots vides', () => {
    expect(t.cheptel.total).toBe(67);
    expect(t.cheptel.lotsActifs).toBe(5);
    expect(t.cheptel.parEspece.map((e) => [e.code, e.effectif])).toEqual([['caille', 40], ['poule', 25], ['autre', 2]]);
    expect(t.cheptel.parRace.find((r) => r.race === 'Brahma')?.effectif).toBe(10);
    expect(t.cheptel.parAge).toEqual({ poussins: 10, jeunes: 40, adultes: 10, inconnu: 7 });
    expect(t.cheptel.enQuarantaine).toBe(5);
  });
  it('décrit chaque local avec son effectif et sa densité, et compte les animaux sans local', () => {
    const poulailler = t.locaux.find((l) => l.logementId === 'g');
    expect(poulailler).toMatchObject({ effectif: 20, densitePct: 50 }); // 20 × 0,25 m² / 10 m²
    expect(poulailler?.lots.map((l) => l.nom)).toEqual(['Soie', 'Brahma']);
    expect(t.locaux.find((l) => l.logementId === 'h')?.densitePct).toBe(60); // 40 × 0,015 / 1
    expect(t.locaux.find((l) => l.logementId === 'i')).toMatchObject({ type: 'quarantaine', densitePct: null, effectif: 5 });
    expect(t.sansLocal).toEqual({ effectif: 2, lots: 1 });
  });
  it('calcule la production des 7 derniers jours et le taux de ponte', () => {
    expect(t.production.oeufsAujourdhui).toBe(8);
    expect(t.production.oeufs7j).toHaveLength(7);
    expect(t.production.oeufs7j.reduce((a, x) => a + x.n, 0)).toBe(38);
    expect(t.production.tauxPonte7jPct).toBe(Math.round((38 / (65 * 7)) * 100)); // 65 pondeuses : tout sauf « autre »
  });
  it('résume l’incubation et la prochaine éclosion', () => {
    expect(t.incubation).toEqual({ misesEnCours: 1, oeufsEnCours: 45, prochaineEclosion: { date: '2026-10-21', nom: 'Série 1' } });
  });
  it('résume les finances et la santé', () => {
    expect(t.finances).toEqual({ recettesTotal: 30000, depensesTotal: 12000, resultatTotal: 18000, recettesMois: 30000, depensesMois: 0, resultatMois: 30000, aEncaisser: 0, aPayer: 12000, enRetard: 0, salairesAPayer: 0 });
    expect(t.sante).toEqual({ vaccinsAFaire: 0, traitementsEnCours: 1, delaisAttente: 1 });
  });
});
