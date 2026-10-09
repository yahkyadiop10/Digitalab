import { describe, expect, it } from 'vitest';
import {
  coutAlimentParOeuf, employesDuMois, enAttenteDeValidation, enAttente, enRetard, exporterCsv, fluxParMode, lignesFinance, moisDecale, parCategorie, parLot, prochainNumeroFacture,
  reglement, resume, soldesParTiers, suiviSalaires, totalLignes, type Employe, type OperationFinanciere, type Paiement,
} from './finances';
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
    expect(exporterCsv(l, () => 'Lot A')).toBe('Date;Type;Catégorie;Montant (FCFA);Lot;Client ou fournisseur;Payé;N°;Reste à régler (FCFA)\n2026-10-03;Recette;Œufs;5000;Lot A;"Dupont; ""Fils""";oui;;0');
  });
});

const paiement = (operationId: string, montant: number, date = '2026-10-10', mode: Paiement['mode'] = 'especes'): Paiement => ({ id: `p${++n}`, ...base, operationId, montant, date, mode });

describe('factures détaillées', () => {
  it('additionne les lignes et déduit la remise, sans jamais descendre sous zéro', () => {
    const lignes = [{ libelle: 'Plateaux d’œufs', quantite: 30, prixUnitaire: 2500 }, { libelle: 'Poulets', quantite: 2.5, prixUnitaire: 3333 }];
    expect(totalLignes(lignes)).toBe(75000 + 8333);
    expect(totalLignes(lignes, 3333)).toBe(80000);
    expect(totalLignes(lignes, 1_000_000)).toBe(0);
    expect(totalLignes([])).toBe(0);
  });

  it('numérote les ventes de l’année à la suite, sans compter les autres années ni les dépenses', () => {
    const vente = (numero: string, sens: OperationFinanciere['sens'] = 'recette') => op(sens, 'oeufs', 1000, '2026-01-01', { numero });
    expect(prochainNumeroFacture([], 2026)).toBe('F-2026-0001');
    expect(prochainNumeroFacture([vente('F-2026-0001'), vente('F-2026-0007'), vente('F-2025-0099'), vente('F-2026-0050', 'depense'), vente('abc')], 2026)).toBe('F-2026-0008');
  });
});

describe('règlements partiels', () => {
  const facture = op('recette', 'poussins', 100000, '2026-10-05', { paye: false, tiers: 'M. Diop', tiersId: 't1', echeance: '2026-10-20' });
  it('un acompte laisse un reste ; le solde ferme la facture', () => {
    expect(reglement(facture, [])).toEqual({ regle: 0, reste: 100000 });
    expect(reglement(facture, [paiement(facture.id, 40000)])).toEqual({ regle: 40000, reste: 60000 });
    expect(reglement(facture, [paiement(facture.id, 40000), paiement(facture.id, 60000)])).toEqual({ regle: 100000, reste: 0 });
  });
  it('ignore les paiements annulés et ceux d’autres opérations', () => {
    const annule = { ...paiement(facture.id, 70000), supprimeLe: 5 };
    expect(reglement(facture, [annule, paiement('autre', 10000)]).reste).toBe(100000);
  });
  it('ne dépasse jamais zéro en cas de trop-perçu', () => {
    expect(reglement(facture, [paiement(facture.id, 120000)])).toEqual({ regle: 120000, reste: 0 });
  });
  it('reconnaît l’ancien indicateur « payé » quand il n’y a aucun règlement détaillé', () => {
    expect(reglement(op('depense', 'soins', 8000, '2026-10-02'), []).reste).toBe(0);
  });
  it('les en-attente et les retards se calculent sur le reste', () => {
    const l = lignesFinance([facture], [], [paiement(facture.id, 40000)]);
    expect(l[0]).toMatchObject({ reste: 60000, paye: false });
    expect(enAttente(l).totalAEncaisser).toBe(60000);
    expect(enRetard(l[0]!, '2026-10-21')).toBe(true);
    expect(enRetard(l[0]!, '2026-10-20')).toBe(false);
    const soldee = lignesFinance([facture], [], [paiement(facture.id, 100000)]);
    expect(enRetard(soldee[0]!, '2026-12-01')).toBe(false);
    expect(enAttente(soldee).aEncaisser).toHaveLength(0);
  });
  it('totalise ce que doit chaque client et ce que vous devez à chaque fournisseur', () => {
    const achat = op('depense', 'materiel', 30000, '2026-10-01', { paye: false, tiersId: 'f1' });
    const l = lignesFinance([facture, achat], [], [paiement(facture.id, 40000)]);
    const s = soldesParTiers(l);
    expect(s.get('t1')).toEqual({ aEncaisser: 60000, aPayer: 0 });
    expect(s.get('f1')).toEqual({ aEncaisser: 0, aPayer: 30000 });
  });
  it('répartit l’argent réellement encaissé ou payé par moyen de paiement', () => {
    const achat = op('depense', 'materiel', 30000, '2026-10-01', { paye: false });
    const flux = fluxParMode([facture, achat], [paiement(facture.id, 40000, '2026-10-10', 'wave'), paiement(achat.id, 5000, '2026-10-11', 'especes'), paiement(facture.id, 1000, '2026-09-30', 'wave')], '2026-10');
    expect(flux).toEqual([{ mode: 'especes', encaisse: 0, paye: 5000 }, { mode: 'wave', encaisse: 40000, paye: 0 }]);
  });
});

describe('salaires', () => {
  const emp = (id: string, salaire: number, extra: Partial<Employe> = {}): Employe => ({ id, ...base, nom: id, salaire, ...extra });
  const paie = (employeId: string, montant: number, nature: OperationFinanciere['nature'], periode = '2026-10') =>
    op('depense', 'main_oeuvre', montant, '2026-10-28', { employeId, periode, nature });
  const employes = [emp('awa', 60000), emp('moussa', 45000), emp('ancien', 30000, { fin: '2026-09' }), emp('futur', 30000, { debut: '2026-11' }), { ...emp('supprime', 1), supprimeLe: 1 }];

  it('ne retient que les employés présents ce mois-là', () => {
    expect(employesDuMois(employes, '2026-10').map((e) => e.id)).toEqual(['awa', 'moussa']);
    expect(employesDuMois(employes, '2026-09').map((e) => e.id)).toEqual(['awa', 'moussa', 'ancien']);
  });
  it('compte les avances dans ce qui est versé et laisse les primes à part', () => {
    const s = suiviSalaires(employes, [paie('awa', 20000, 'avance'), paie('awa', 40000, 'salaire'), paie('awa', 10000, 'prime'), paie('moussa', 15000, 'avance'), paie('moussa', 45000, 'salaire', '2026-09')], '2026-10');
    expect(s.find((x) => x.employe.id === 'awa')).toMatchObject({ du: 60000, verse: 60000, primes: 10000, reste: 0, statut: 'paye' });
    expect(s.find((x) => x.employe.id === 'moussa')).toMatchObject({ verse: 15000, reste: 30000, statut: 'partiel' });
  });
  it('signale « à payer » quand rien n’a été versé', () => {
    expect(suiviSalaires(employes, [], '2026-10').every((x) => x.statut === 'a_payer' && x.reste === x.du)).toBe(true);
  });
  it('ne tient pas compte des salaires annulés', () => {
    const annule = { ...paie('awa', 60000, 'salaire'), supprimeLe: 3 };
    expect(suiviSalaires(employes, [annule], '2026-10')[0]!.statut).toBe('a_payer');
  });
});

describe('validation des dépenses et des paiements', () => {
  const depense = op('depense', 'materiel', 30000, '2026-10-01', { paye: false, statut: 'a_valider' });
  const validee = op('depense', 'soins', 8000, '2026-10-02', { statut: 'validee' });

  it('une dépense à valider ne compte dans aucun chiffre ni dans les sommes dues', () => {
    const l = lignesFinance([depense, validee], []);
    expect(l).toHaveLength(1);
    expect(resume(l, '2026-10').depenses).toBe(8000);
    expect(enAttente(l).totalAPayer).toBe(0);
  });
  it('un paiement à valider ne réduit pas le reste à payer', () => {
    const facture = op('depense', 'materiel', 10000, '2026-10-01', { paye: false });
    const attente = { ...paiement(facture.id, 10000), statut: 'a_valider' as const };
    expect(reglement(facture, [attente]).reste).toBe(10000);
    expect(reglement(facture, [{ ...attente, statut: 'validee' }]).reste).toBe(0);
  });
  it('liste ce qui attend une validation, sans les éléments annulés', () => {
    const facture = op('depense', 'materiel', 10000, '2026-10-01', { paye: false });
    const p = { ...paiement(facture.id, 4000), statut: 'a_valider' as const };
    const annulee = { ...op('depense', 'autre', 5, '2026-10-01', { statut: 'a_valider' }), supprimeLe: 9 };
    const r = enAttenteDeValidation([depense, validee, facture, annulee], [p, { ...paiement(facture.id, 1), statut: 'a_valider' as const, supprimeLe: 1 }]);
    expect(r.operations.map((o) => o.id)).toEqual([depense.id]);
    expect(r.paiements).toHaveLength(1);
  });
  it('un salaire à valider ne compte pas comme versé', () => {
    const emp: Employe = { id: 'e', ...base, nom: 'E', salaire: 1000 };
    const s = op('depense', 'main_oeuvre', 1000, '2026-10-28', { employeId: 'e', periode: '2026-10', nature: 'salaire', statut: 'a_valider' });
    expect(suiviSalaires([emp], [s], '2026-10')[0]!.statut).toBe('a_payer');
  });
});
