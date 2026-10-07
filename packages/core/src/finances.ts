import type { Jour } from './dates';
import type { EntreeStock, Enregistrement, Ponte } from './types';

export type SensOperation = 'depense' | 'recette';

export const CATEGORIES_DEPENSE = ['aliment', 'soins', 'energie', 'achat_animaux', 'materiel', 'main_oeuvre', 'autre'] as const;
export const CATEGORIES_RECETTE = ['oeufs', 'oeufs_a_couver', 'poussins', 'reproducteurs', 'animaux', 'autre'] as const;

export const LIBELLES_CATEGORIES: Record<string, string> = {
  aliment: 'Aliment',
  soins: 'Soins et vaccins',
  energie: 'Énergie et eau',
  achat_animaux: 'Achat d’animaux',
  materiel: 'Matériel',
  main_oeuvre: 'Main-d’œuvre',
  oeufs: 'Œufs',
  oeufs_a_couver: 'Œufs à couver',
  poussins: 'Poussins',
  reproducteurs: 'Reproducteurs',
  animaux: 'Animaux (viande)',
  autre: 'Autre',
};

/** Une dépense ou une recette, en FCFA (montant entier, sans centimes). */
export interface OperationFinanciere extends Enregistrement {
  date: Jour;
  sens: SensOperation;
  categorie: string;
  montant: number;
  lotId?: string | null;
  /** Client ou fournisseur. */
  tiers?: string;
  /** Faux tant que l'argent n'est pas encaissé (recette) ou payé (dépense). */
  paye: boolean;
  payeLe?: Jour;
  note?: string;
}

/** Ligne unifiée : une opération saisie, ou un achat d'aliment du stock compté automatiquement comme dépense. */
export interface LigneFinance {
  cle: string;
  date: Jour;
  sens: SensOperation;
  categorie: string;
  montant: number;
  lotId?: string | null;
  tiers?: string;
  paye: boolean;
  /** Vient du stock d'aliment : à corriger là-bas, pas ici. */
  automatique: boolean;
}

const vivants = <T extends { supprimeLe?: number | null }>(xs: T[]) => xs.filter((x) => !x.supprimeLe);

/** Réunit les opérations saisies et les achats d'aliment avec un prix (dépense « aliment » déjà payée). */
export function lignesFinance(operations: OperationFinanciere[], entreesStock: EntreeStock[]): LigneFinance[] {
  const saisies = vivants(operations).map((o): LigneFinance => ({
    cle: o.id, date: o.date, sens: o.sens, categorie: o.categorie, montant: o.montant, lotId: o.lotId ?? null, paye: o.paye, automatique: false,
    ...(o.tiers ? { tiers: o.tiers } : {}),
  }));
  const achats = vivants(entreesStock)
    .filter((e) => e.quantiteKg > 0 && (e.prixTotal ?? 0) > 0)
    .map((e): LigneFinance => ({ cle: `stock:${e.id}`, date: e.date, sens: 'depense', categorie: 'aliment', montant: e.prixTotal ?? 0, paye: true, automatique: true }));
  return [...saisies, ...achats].sort((a, b) => b.date.localeCompare(a.date) || b.cle.localeCompare(a.cle));
}

export interface ResumeFinance {
  recettes: number;
  depenses: number;
  /** Recettes moins dépenses. */
  resultat: number;
}

/** `periode` : « AAAA-MM » pour un mois, ou vide pour tout. */
export function resume(lignes: LigneFinance[], periode = ''): ResumeFinance {
  let recettes = 0;
  let depenses = 0;
  for (const l of lignes) {
    if (periode && !l.date.startsWith(periode)) continue;
    if (l.sens === 'recette') recettes += l.montant;
    else depenses += l.montant;
  }
  return { recettes, depenses, resultat: recettes - depenses };
}

export interface TotalCategorie {
  categorie: string;
  montant: number;
}

export function parCategorie(lignes: LigneFinance[], sens: SensOperation, periode = ''): TotalCategorie[] {
  const par = new Map<string, number>();
  for (const l of lignes) {
    if (l.sens !== sens || (periode && !l.date.startsWith(periode))) continue;
    par.set(l.categorie, (par.get(l.categorie) ?? 0) + l.montant);
  }
  return [...par.entries()].map(([categorie, montant]) => ({ categorie, montant })).sort((a, b) => b.montant - a.montant);
}

/** Ce qu'on vous doit (recettes non encaissées) et ce que vous devez (dépenses non payées). */
export function enAttente(lignes: LigneFinance[]): { aEncaisser: LigneFinance[]; aPayer: LigneFinance[]; totalAEncaisser: number; totalAPayer: number } {
  const ouvertes = lignes.filter((l) => !l.paye);
  const aEncaisser = ouvertes.filter((l) => l.sens === 'recette').sort((a, b) => a.date.localeCompare(b.date));
  const aPayer = ouvertes.filter((l) => l.sens === 'depense').sort((a, b) => a.date.localeCompare(b.date));
  return { aEncaisser, aPayer, totalAEncaisser: aEncaisser.reduce((a, l) => a + l.montant, 0), totalAPayer: aPayer.reduce((a, l) => a + l.montant, 0) };
}

/** Résultat par lot : recettes et dépenses rattachées à un lot. */
export function parLot(lignes: LigneFinance[]): { lotId: string; recettes: number; depenses: number; resultat: number }[] {
  const par = new Map<string, { recettes: number; depenses: number }>();
  for (const l of lignes) {
    if (!l.lotId) continue;
    const c = par.get(l.lotId) ?? { recettes: 0, depenses: 0 };
    if (l.sens === 'recette') c.recettes += l.montant;
    else c.depenses += l.montant;
    par.set(l.lotId, c);
  }
  return [...par.entries()].map(([lotId, c]) => ({ lotId, ...c, resultat: c.recettes - c.depenses })).sort((a, b) => b.resultat - a.resultat);
}

/** Coût d'aliment par œuf sur la période ; `null` sans dépense d'aliment ni œufs. Estimation : l'aliment acheté n'est pas forcément consommé le même mois. */
export function coutAlimentParOeuf(lignes: LigneFinance[], pontes: Ponte[], periode: string): number | null {
  const aliment = lignes.filter((l) => l.sens === 'depense' && l.categorie === 'aliment' && l.date.startsWith(periode)).reduce((a, l) => a + l.montant, 0);
  const oeufs = vivants(pontes).filter((p) => p.date.startsWith(periode)).reduce((a, p) => a + p.nombre, 0);
  return aliment > 0 && oeufs > 0 ? Math.round(aliment / oeufs) : null;
}

/** Mois précédent ou suivant d'un « AAAA-MM ». */
export function moisDecale(periode: string, delta: number): string {
  const [a = 1970, m = 1] = periode.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Texte CSV (séparateur point-virgule, lisible par Excel en français) pour le comptable. */
export function exporterCsv(lignes: LigneFinance[], nomLot: (id?: string | null) => string): string {
  const echapper = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const entete = ['Date', 'Type', 'Catégorie', 'Montant (FCFA)', 'Lot', 'Client ou fournisseur', 'Payé'];
  const corps = [...lignes].sort((a, b) => a.date.localeCompare(b.date)).map((l) =>
    [l.date, l.sens === 'recette' ? 'Recette' : 'Dépense', LIBELLES_CATEGORIES[l.categorie] ?? l.categorie, String(l.montant), l.lotId ? nomLot(l.lotId) : '', l.tiers ?? '', l.paye ? 'oui' : 'non'].map(echapper).join(';'),
  );
  return [entete.join(';'), ...corps].join('\n');
}
