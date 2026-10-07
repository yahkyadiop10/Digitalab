import { describe, expect, it } from 'vitest';
import { evaluerAlertes, type EntreeAlertes } from './alertes';
import { ajouterJours } from './dates';
import { construireFiche, decoderFiche, encoderFiche } from './fiche';
import { ESPECES_PAR_DEFAUT, SEUILS_PAR_DEFAUT } from './parametres';
import { MALADIES, PROTOCOLES_PAR_DEFAUT, SYMPTOMES, bilanRemedes, delaisEnCours, finEvenement, pistesDiagnostic, quarantainesEnCours, vaccinsAFaire } from './sante';
import type { DonneesElevage, EvenementSante, Lot, Mouvement, ProtocoleVaccin } from './types';

const base = { misAJour: 0 };
const AUJ = '2026-10-07';
let n = 0;
const ev = (lotId: string, type: EvenementSante['type'], date: string, partiel: Partial<EvenementSante> = {}): EvenementSante => ({ id: `e${++n}`, ...base, lotId, type, date, ...partiel });
const lot = (id: string, partiel: Partial<Lot> = {}): Lot => ({ id, ...base, nom: id, especeCode: 'poule', ...partiel });
const arrivee = (lotId: string, q: number): Mouvement => ({ id: `m${++n}`, ...base, lotId, type: 'arrivee', quantite: q, date: '2026-01-01' });

describe('base de connaissances', () => {
  it('ne référence que des symptômes connus', () => {
    const codes = new Set(SYMPTOMES.map((s) => s.code));
    for (const m of MALADIES) for (const c of Object.keys(m.symptomes)) expect(codes.has(c), `${m.code} : ${c}`).toBe(true);
  });
  it('a des codes uniques', () => {
    expect(new Set(MALADIES.map((m) => m.code)).size).toBe(MALADIES.length);
    expect(new Set(SYMPTOMES.map((s) => s.code)).size).toBe(SYMPTOMES.length);
  });
});

describe('pistes de diagnostic', () => {
  it('place la coccidiose en tête devant une diarrhée sanglante avec abattement', () => {
    const r = pistesDiagnostic(['diarrhee_sanglante', 'apathie', 'plumes_ebouriffees']);
    expect(r[0]?.maladie.code).toBe('coccidiose');
    expect(r[0]?.retrouves).toEqual(expect.arrayContaining(['diarrhee_sanglante', 'apathie']));
  });
  it('signale une maladie à déclaration obligatoire devant des morts brutales avec crête violacée', () => {
    const r = pistesDiagnostic(['mort_brutale', 'crete_bleutee']);
    expect(r[0]?.maladie.code).toBe('influenza');
    expect(r[0]?.maladie.declaration).toBe('obligatoire');
  });
  it('exige deux symptômes concordants, sauf quand un seul est choisi', () => {
    expect(pistesDiagnostic(['paralysie']).map((p) => p.maladie.code)).toEqual(expect.arrayContaining(['marek', 'newcastle']));
    expect(pistesDiagnostic(['paralysie', 'apathie']).every((p) => p.retrouves.length >= 2)).toBe(true);
    expect(pistesDiagnostic([])).toEqual([]);
  });
  it('écarte les maladies d’une autre espèce', () => {
    const codes = (e: string) => pistesDiagnostic(['mort_brutale', 'diarrhee', 'apathie'], e).map((p) => p.maladie.code);
    expect(codes('caille')).toContain('enterite_ulcereuse');
    expect(codes('poule')).not.toContain('enterite_ulcereuse');
  });
});

describe('traitements et délais d’attente', () => {
  it('calcule la fin et le délai d’attente', () => {
    const t = ev('a', 'traitement', '2026-10-05', { nom: 'X', dureeJours: 5, delaiAttenteJours: 7 });
    expect(finEvenement(t)).toBe('2026-10-09');
    expect(delaisEnCours([t], '2026-10-07')).toMatchObject([{ jusqua: '2026-10-16', enCours: true }]);
    expect(delaisEnCours([t], '2026-10-16')).toMatchObject([{ jusqua: '2026-10-16', enCours: false }]);
    expect(delaisEnCours([t], '2026-10-17')).toEqual([]);
  });
  it('ignore un traitement sans délai, futur ou supprimé', () => {
    expect(delaisEnCours([ev('a', 'traitement', '2026-10-05', { dureeJours: 3 })], AUJ)).toEqual([]);
    expect(delaisEnCours([ev('a', 'traitement', '2026-10-10', { dureeJours: 3, delaiAttenteJours: 5 })], AUJ)).toEqual([]);
    expect(delaisEnCours([{ ...ev('a', 'traitement', '2026-10-05', { delaiAttenteJours: 5 }), supprimeLe: 1 }], AUJ)).toEqual([]);
  });
  it('liste les quarantaines en cours', () => {
    const q = ev('a', 'quarantaine', '2026-10-05', { dureeJours: 7 });
    expect(quarantainesEnCours([q], AUJ)).toMatchObject([{ jusqua: '2026-10-11' }]);
    expect(quarantainesEnCours([q], '2026-10-12')).toEqual([]);
  });
  it('résume les remèdes essayés', () => {
    const b = bilanRemedes([
      ev('a', 'traitement', AUJ, { nom: 'Tisane', resultat: 'gueri' }),
      ev('b', 'traitement', AUJ, { nom: 'tisane ', resultat: 'sans_effet' }),
      ev('c', 'traitement', AUJ, { nom: 'Tisane' }),
      ev('c', 'traitement', AUJ, { nom: 'Autre', resultat: 'ameliore' }),
      ev('c', 'vaccin', AUJ, { nom: 'Newcastle' }),
    ]);
    expect(b).toEqual([
      { nom: 'Tisane', essais: 3, gueri: 1, ameliore: 0, sansEffet: 1, sansResultat: 1 },
      { nom: 'Autre', essais: 1, gueri: 0, ameliore: 1, sansEffet: 0, sansResultat: 0 },
    ]);
  });
});

describe('calendrier de vaccination', () => {
  const protocoles: ProtocoleVaccin[] = [
    { id: 'nc1', nom: 'Newcastle (1re dose)', especeCode: 'poule', ageJours: 7, repeterTousLesJours: null },
    { id: 'nc2', nom: 'Newcastle (rappel)', especeCode: 'poule', ageJours: 21, repeterTousLesJours: 90 },
  ];
  const mv = [arrivee('a', 20)];
  const du = (lots: Lot[], evs: EvenementSante[], jour: string) => vaccinsAFaire(lots, mv, evs, protocoles, jour).map((v) => [v.protocole.id, v.statut, v.date]);

  it('prévient trois jours avant la première dose, le jour même, puis en retard', () => {
    const l = [lot('a', { naissance: '2026-10-01' })]; // 1re dose le 8 octobre
    expect(du(l, [], '2026-10-04')).toEqual([]);
    expect(du(l, [], '2026-10-05')).toEqual([['nc1', 'bientot', '2026-10-08']]);
    expect(du(l, [], '2026-10-08')).toEqual([['nc1', 'aujourdhui', '2026-10-08']]);
    expect(du(l, [], '2026-10-10')).toEqual([['nc1', 'retard', '2026-10-08']]);
  });
  it('s’arrête une fois la dose faite, et programme le rappel si le protocole en prévoit un', () => {
    const l = [lot('a', { naissance: '2026-10-01' })];
    const fait = [ev('a', 'vaccin', '2026-10-08', { protocoleId: 'nc1' })];
    expect(du(l, fait, '2026-10-10')).toEqual([]);
    const rappel = [ev('a', 'vaccin', '2026-10-22', { protocoleId: 'nc2' })];
    expect(du(l, [...fait, ...rappel], '2027-01-18')).toEqual([['nc2', 'bientot', '2027-01-20']]);
  });
  it('demande de renseigner l’historique d’un lot ancien plutôt que de crier au retard', () => {
    const l = [lot('a', { naissance: '2025-01-01' })];
    expect(du(l, [], AUJ).map((x) => x[1])).toEqual(['a_renseigner', 'a_renseigner']);
  });
  it('ignore les lots sans naissance, archivés, vides ou d’une autre espèce', () => {
    expect(du([lot('a')], [], AUJ)).toEqual([]);
    expect(du([lot('a', { naissance: '2026-10-01', archive: true })], [], '2026-10-08')).toEqual([]);
    expect(du([lot('z', { naissance: '2026-10-01' })], [], '2026-10-08')).toEqual([]);
    expect(du([lot('a', { naissance: '2026-10-01', especeCode: 'caille' })], [], '2026-10-08')).toEqual([]);
  });
  it('fournit un exemple de protocole pour la poule seulement', () => {
    expect(new Set(PROTOCOLES_PAR_DEFAUT.map((p) => p.especeCode))).toEqual(new Set(['poule']));
  });
});

describe('alertes de santé', () => {
  const entree = (partiel: Partial<EntreeAlertes> = {}): EntreeAlertes => ({
    maintenant: new Date(`${AUJ}T10:00:00`), especes: ESPECES_PAR_DEFAUT, seuils: SEUILS_PAR_DEFAUT, protocoles: [],
    lots: [lot('a', { logementId: 'g' }), lot('b', { logementId: 'g' }), lot('c', { logementId: 'h' })],
    logements: [{ id: 'g', ...base, nom: 'G', type: 'batiment', surfaceM2: 100 }, { id: 'h', ...base, nom: 'H', type: 'batiment', surfaceM2: 100 }],
    mouvements: [arrivee('a', 10), arrivee('b', 10), arrivee('c', 10)],
    pontes: [], distributions: [], entreesStock: [], couveuses: [], incubations: [], mirages: [], evenementsSante: [], ...partiel,
  });
  const sante = (partiel?: Partial<EntreeAlertes>) => evaluerAlertes(entree(partiel)).filter((a) => ['vaccin', 'delai_attente', 'foyer', 'sante_grave'].includes(a.code));

  it('signale un vaccin en retard (orange, puis rouge au-delà d’une semaine)', () => {
    const protocoles: ProtocoleVaccin[] = [{ id: 'p', nom: 'Gumboro', especeCode: 'poule', ageJours: 14, repeterTousLesJours: null }];
    const lots = [lot('a', { naissance: ajouterJours(AUJ, -16) })];
    expect(sante({ protocoles, lots })).toMatchObject([{ code: 'vaccin', niveau: 'orange', libelle: 'Gumboro', params: { retard: 2 } }]);
    expect(sante({ protocoles, lots: [lot('a', { naissance: ajouterJours(AUJ, -25) })] })).toMatchObject([{ niveau: 'rouge' }]);
  });
  it('rappelle le délai d’attente d’un traitement', () => {
    const t = ev('a', 'traitement', '2026-10-05', { nom: 'Produit', dureeJours: 3, delaiAttenteJours: 4 });
    expect(sante({ evenementsSante: [t] })).toMatchObject([{ code: 'delai_attente', niveau: 'jaune', lotId: 'a', libelle: 'Produit', params: { jours: 5, enCours: 1 } }]);
  });
  it('signale des symptômes graves récents, et pas les anciens ni les légers', () => {
    const grave = ev('a', 'observation', AUJ, { gravite: 3, symptomes: ['torticolis'] });
    expect(sante({ evenementsSante: [grave] })).toMatchObject([{ code: 'sante_grave', niveau: 'rouge' }]);
    expect(sante({ evenementsSante: [ev('a', 'observation', AUJ, { gravite: 2 })] })).toMatchObject([{ niveau: 'orange' }]);
    expect(sante({ evenementsSante: [ev('a', 'observation', AUJ, { gravite: 1 })] })).toEqual([]);
    expect(sante({ evenementsSante: [ev('a', 'observation', '2026-10-01', { gravite: 3 })] })).toEqual([]);
  });
  it('détecte un possible foyer quand deux lots d’un même local sont touchés', () => {
    const e = (id: string) => ev(id, 'observation', AUJ, { gravite: 2 });
    expect(sante({ evenementsSante: [e('a'), e('b')] }).map((a) => a.code).sort()).toEqual(['foyer', 'sante_grave', 'sante_grave']);
    expect(sante({ evenementsSante: [e('a'), e('c')] }).some((a) => a.code === 'foyer')).toBe(false);
  });
});

describe('fiche de suivi', () => {
  const donnees: DonneesElevage = {
    lots: [lot('a', { nom: 'Soie – lot A', race: 'Soie', naissance: '2026-09-07', incubationId: 'i' })],
    logements: [], mouvements: [arrivee('a', 12), { id: 'd', ...base, lotId: 'a', type: 'deces', quantite: -2, date: '2026-10-01' }],
    pontes: [{ id: 'p', ...base, lotId: 'a', date: '2026-10-05', nombre: 6, casses: 0 }, { id: 'p0', ...base, lotId: 'a', date: '2026-08-01', nombre: 99, casses: 0 }],
    distributions: [], entreesStock: [], couveuses: [],
    incubations: [{ id: 'i', ...base, couveuseId: 'c', especeCode: 'poule', nom: 'Série 1', miseEnPlace: '2026-08-17', nbOeufs: 20, origine: 'Mes Soie', faits: [] }],
    mirages: [],
    evenementsSante: [ev('a', 'vaccin', '2026-09-14', { nom: 'Newcastle' }), ev('a', 'traitement', '2026-10-02', { nom: 'Produit', dureeJours: 3, delaiAttenteJours: 5, note: 'confidentiel' }), { ...ev('a', 'vaccin', '2026-09-20', { nom: 'Supprimé' }), supprimeLe: 1 }],
  };
  const lotA = donnees.lots[0]!;

  it('ne montre que les rubriques choisies', () => {
    const f = construireFiche(lotA, donnees, ESPECES_PAR_DEFAUT, ['identite'], AUJ);
    expect(f.identite).toMatchObject({ espece: 'Poule', race: 'Soie', effectif: 10, ageJours: 30 });
    expect(f.sante).toBeUndefined();
    expect(f.mortalite).toBeUndefined();
    expect(f.origine).toBeUndefined();
  });
  it('résume santé, mortalité et production sans les notes privées ni les lignes supprimées', () => {
    const f = construireFiche(lotA, donnees, ESPECES_PAR_DEFAUT, ['sante', 'mortalite', 'production', 'origine'], AUJ);
    expect(f.sante?.map((l) => l.texte)).toEqual(['Traitement : Produit, délai d’attente 5 j après le 2026-10-04', 'Vaccin : Newcastle']);
    expect(JSON.stringify(f)).not.toContain('confidentiel');
    expect(f.mortalite).toEqual({ deces: 2, tauxPct: 16.7 });
    expect(f.production).toEqual({ oeufs30j: 6 });
    expect(f.origine).toEqual({ naissance: '2026-09-07', incubation: 'Série 1 (Mes Soie)' });
    expect(f.mention).toBe('declaratif');
  });
  it('se code dans un lien et se relit à l’identique, accents compris', () => {
    const f = construireFiche(lotA, donnees, ESPECES_PAR_DEFAUT, ['identite', 'sante'], AUJ);
    const jeton = encoderFiche(f);
    expect(jeton).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decoderFiche(jeton)).toEqual(f);
  });
  it('refuse un lien qui n’est pas une fiche', () => {
    expect(decoderFiche('n’importe quoi')).toBeNull();
    expect(decoderFiche(encoderFiche({ version: 1 } as never))).toBeNull();
  });
});
