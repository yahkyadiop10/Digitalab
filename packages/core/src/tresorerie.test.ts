import { describe, expect, it } from 'vitest';
import type { EntreeTresorerie } from './tresorerie';
import { COMPTES_PAR_DEFAUT, compteDuMode, ecartsAExpliquer, fraisTransferts, liquiditeTotale, mouvementsCompte, reglementsSansCompte, soldesComptes } from './tresorerie';
import { lignesFinance, type OperationFinanciere, type Paiement } from './finances';

const base = { misAJour: 0 };
let n = 0;
const compte = (nom: string, modes: string[], soldeInitial = 0, dateInitiale = '2026-10-01') => ({ id: nom, ...base, nom, type: 'caisse' as const, soldeInitial, dateInitiale, modes: modes as never });
const op = (sens: 'recette' | 'depense', montant: number, extra: Partial<OperationFinanciere> = {}): OperationFinanciere => ({ id: `o${++n}`, ...base, date: '2026-10-05', sens, categorie: 'oeufs', montant, paye: false, ...extra });
const pay = (o: OperationFinanciere, montant: number, mode: string, date = '2026-10-05', extra: Partial<Paiement> = {}): Paiement => ({ id: `p${++n}`, ...base, operationId: o.id, montant, mode: mode as never, date, ...extra });

const caisse = compte('Caisse', ['especes'], 20000);
const wave = compte('Wave', ['wave'], 50000);
const vide = (): EntreeTresorerie => ({ comptes: [caisse, wave], operations: [], paiements: [], transferts: [], pointages: [] });
const solde = (d: EntreeTresorerie, nom: string) => soldesComptes(d).find((s) => s.compte.nom === nom)!.solde;

describe('soldes des comptes', () => {
  it('part du solde de départ puis ajoute les encaissements et retire les paiements, compte par compte', () => {
    const vente = op('recette', 30000);
    const achat = op('depense', 12000);
    const d = { ...vide(), operations: [vente, achat], paiements: [pay(vente, 10000, 'especes'), pay(vente, 20000, 'wave'), pay(achat, 12000, 'especes')] };
    expect(solde(d, 'Caisse')).toBe(20000 + 10000 - 12000);
    expect(solde(d, 'Wave')).toBe(50000 + 20000);
    expect(liquiditeTotale(soldesComptes(d))).toBe(88000);
  });

  it('ignore ce qui est antérieur au solde de départ, annulé ou pas encore validé', () => {
    const v = op('recette', 5000);
    const annulee = { ...op('recette', 9000), supprimeLe: 1 };
    const aValider = op('depense', 700, { statut: 'a_valider' });
    const d = {
      ...vide(), operations: [v, annulee, aValider],
      paiements: [pay(v, 5000, 'especes', '2026-09-30'), pay(annulee, 9000, 'especes'), pay(aValider, 700, 'especes'), pay(v, 1, 'especes', '2026-10-06', { supprimeLe: 3 }), pay(v, 2, 'especes', '2026-10-06', { statut: 'a_valider' })],
    };
    expect(solde(d, 'Caisse')).toBe(20000);
  });

  it('un transfert retire du compte d’origine, ajoute au compte d’arrivée, et ses frais sortent de l’origine', () => {
    const d = { ...vide(), transferts: [{ id: 't', ...base, date: '2026-10-06', deId: 'Wave', versId: 'Caisse', montant: 30000, frais: 300 }] };
    expect(solde(d, 'Wave')).toBe(50000 - 30000 - 300);
    expect(solde(d, 'Caisse')).toBe(20000 + 30000);
    expect(liquiditeTotale(soldesComptes(d))).toBe(70000 - 300);
    expect(fraisTransferts(d.transferts)).toBe(300);
    expect(fraisTransferts(d.transferts, '2026-09')).toBe(0);
  });

  it('un comptage corrige le solde seulement une fois régularisé', () => {
    const point = (regularise: boolean) => ({ id: 'pt', ...base, compteId: 'Caisse', date: '2026-10-07', soldeReel: 19500, soldeTheorique: 20000, ecart: -500, regularise });
    expect(solde({ ...vide(), pointages: [point(false)] }, 'Caisse')).toBe(20000);
    expect(solde({ ...vide(), pointages: [point(true)] }, 'Caisse')).toBe(19500);
    expect(ecartsAExpliquer([point(false), point(true), { ...point(false), supprimeLe: 2 }])).toHaveLength(1);
    expect(ecartsAExpliquer([{ ...point(false), ecart: 0 }])).toHaveLength(0);
  });

  it('les achats d’aliment payés par un moyen donné sortent du compte correspondant', () => {
    const d = { ...vide(), entreesStock: [{ id: 's', ...base, date: '2026-10-03', quantiteKg: 50, prixTotal: 20000, mode: 'especes' }, { id: 's2', ...base, date: '2026-10-03', quantiteKg: 50, prixTotal: 9000 }] };
    expect(solde(d, 'Caisse')).toBe(0);
  });

  it('range les mouvements par date, avec leur libellé', () => {
    const vente = op('recette', 4000, { tiers: 'Awa', numero: 'F-2026-0001' });
    const d = { ...vide(), operations: [vente], paiements: [pay(vente, 4000, 'especes', '2026-10-09')], transferts: [{ id: 't', ...base, date: '2026-10-08', deId: 'Caisse', versId: 'Wave', montant: 1000 }] };
    const m = mouvementsCompte(caisse, d, (id) => id);
    expect(m.map((x) => x.nature)).toEqual(['transfert_sortant', 'recette']);
    expect(m[1]!.libelle).toBe('Encaissement · Awa · F-2026-0001');
  });
});

describe('ordre des comptes', () => {
  it('est le même partout : caisse, mobile money par nom, banque', () => {
    const mk = (nom: string, type: 'caisse' | 'mobile_money' | 'banque' | 'autre', id: string) => ({ ...compte(nom, []), id, type });
    const d = { ...vide(), comptes: [mk('Banque', 'banque', 'z'), mk('Wave', 'mobile_money', 'y'), mk('Caisse', 'caisse', 'x'), mk('Orange Money', 'mobile_money', 'w')] };
    expect(soldesComptes(d).map((s) => s.compte.nom)).toEqual(['Caisse', 'Orange Money', 'Wave', 'Banque']);
  });
});

describe('moyens de paiement sans compte', () => {
  it('signale l’argent qu’aucun compte ne suit', () => {
    const v = op('recette', 3000);
    const d = { ...vide(), operations: [v], paiements: [pay(v, 3000, 'cheque'), pay(v, 100, 'wave')] };
    expect(reglementsSansCompte(d)).toEqual({ nombre: 1, montant: 3000 });
    expect(compteDuMode(d.comptes, 'cheque')).toBeUndefined();
    expect(compteDuMode(d.comptes, 'wave')?.nom).toBe('Wave');
  });
  it('les comptes habituels couvrent espèces, Wave, Orange Money, virement et chèque', () => {
    const modes = new Set(COMPTES_PAR_DEFAUT.flatMap((c) => c.modes));
    expect([...modes].sort()).toEqual(['cheque', 'especes', 'orange_money', 'virement', 'wave']);
  });
});

describe('frais de transfert dans les finances', () => {
  it('comptent comme une dépense payée, sans ligne pour un transfert gratuit', () => {
    const l = lignesFinance([], [], [], [{ id: 'a', date: '2026-10-06', frais: 300 }, { id: 'b', date: '2026-10-06' }, { id: 'c', date: '2026-10-06', frais: 100, supprimeLe: 1 }]);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ sens: 'depense', categorie: 'frais_comptes', montant: 300, paye: true, automatique: true });
  });
});
