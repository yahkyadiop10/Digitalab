import { describe, expect, it } from 'vitest';
import { coutAlimentParOeuf, enAttente, exporterCsv, lignesFinance, moisDecale, parCategorie, parLot, resume, type OperationFinanciere } from './finances';
import type { EntreeStock, Ponte } from './types';

const base = { misAJour: 0 };
let n = 0;
const op = (sens: OperationFinanciere['sens'], categorie: string, montant: number, date: string, partiel: Partial<OperationFinanciere> = {}): OperationFinanciere => ({ id: `o${++n}`, ...base, sens, categorie, montant, date, paye: true, ...partiel });
const achat = (date: string, quantiteKg: number, prixTotal: number | null): EntreeStock => ({ id: `s${++n}`, ...base, date, quantiteKg, prixTotal });
const ponte = (date: string, nombre: number): Ponte => ({ id: `p${++n}`, ...base, lotId: 'a', date, nombre, casses: 0 });

const ops = [
  op('recette', 'oeufs', 30000, '2026-10-03'),
  op('recette', 'poussins', 45000, '2026-10-05', { paye: false, tiers: 'M. Diop', lotId: 'a' }),
  op('depense', 'soins', 8000, '2026-10-02', { lotId: 'a' }),
  op('depense', 'materiel', 12000, '2026-09-28', { paye: false, tiers: 'Quincaillerie' }),
  { ...op('depense', 'autre', 99999, '2026-10-04'), supprimeLe: 1 },
];
const stock = [achat('2026-10-01', 50, 20000), achat('2026-10-01', 50, null), achat('2026-10-06', -5, 1000)];

describe('lignes de finance', () => {
  it('ajoute les achats d’aliment avec un prix comme dépenses payées, et ignore les autres et les supprimés', () => {
    const l = lignesFinance(ops, stock);
    expect(l).toHaveLength(5);
    expect(l.find((x) => x.automatique)).toMatchObject({ sens: 'depense', categorie: 'aliment', montant: 20000, paye: true });
    expect(l.some((x) => x.montant === 99999)).toBe(false);
    expect(l.map((x) => x.date)).toEqual([...l.map((x) => x.date)].sort().reverse());
  });
});

describe('résumé', () => {
  const l = lignesFinance(ops, stock);
  it('calcule recettes, dépenses et résultat sur un mois', () => {
    expect(resume(l, '2026-10')).toEqual({ recettes: 75000, depenses: 28000, resultat: 47000 });
    expect(resume(l, '2026-09')).toEqual({ recettes: 0, depenses: 12000, resultat: -12000 });
    expect(resume(l)).toEqual({ recettes: 75000, depenses: 40000, resultat: 35000 });
  });
  it('classe par catégorie, la plus grosse d’abord', () => {
    expect(parCategorie(l, 'depense', '2026-10')).toEqual([{ categorie: 'aliment', montant: 20000 }, { categorie: 'soins', montant: 8000 }]);
    expect(parCategorie(l, 'recette')[0]).toEqual({ categorie: 'poussins', montant: 45000 });
  });
  it('liste ce qu’on vous doit et ce que vous devez', () => {
    const e = enAttente(l);
    expect(e.totalAEncaisser).toBe(45000);
    expect(e.totalAPayer).toBe(12000);
    expect(e.aEncaisser[0]?.tiers).toBe('M. Diop');
  });
  it('résume par lot', () => {
    expect(parLot(l)).toEqual([{ lotId: 'a', recettes: 45000, depenses: 8000, resultat: 37000 }]);
  });
});

describe('coût d’aliment par œuf', () => {
  it('divise l’aliment acheté du mois par les œufs du mois', () => {
    const l = lignesFinance(ops, stock);
    expect(coutAlimentParOeuf(l, [ponte('2026-10-02', 100), ponte('2026-10-03', 100)], '2026-10')).toBe(100);
  });
  it('ne conclut pas sans aliment acheté ni œufs', () => {
    expect(coutAlimentParOeuf(lignesFinance(ops, stock), [], '2026-10')).toBeNull();
    expect(coutAlimentParOeuf(lignesFinance(ops, stock), [ponte('2026-09-02', 10)], '2026-09')).toBeNull();
  });
});

describe('mois et export', () => {
  it('décale les mois en passant les années', () => {
    expect(moisDecale('2026-01', -1)).toBe('2025-12');
    expect(moisDecale('2026-12', 1)).toBe('2027-01');
    expect(moisDecale('2026-10', 0)).toBe('2026-10');
  });
  it('exporte un CSV lisible par Excel, avec les guillemets protégés', () => {
    const l = lignesFinance([op('recette', 'oeufs', 5000, '2026-10-03', { tiers: 'Dupont; "Fils"', lotId: 'a' })], []);
    expect(exporterCsv(l, () => 'Lot A')).toBe('Date;Type;Catégorie;Montant (FCFA);Lot;Client ou fournisseur;Payé\n2026-10-03;Recette;Œufs;5000;Lot A;"Dupont; ""Fils""";oui');
  });
});
