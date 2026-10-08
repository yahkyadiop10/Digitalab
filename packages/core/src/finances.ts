import type { Jour } from './dates';
import type { EntreeStock, Enregistrement, Ponte } from './types';

export type SensOperation = 'depense' | 'recette';

export const CATEGORIES_DEPENSE = ['aliment', 'soins', 'energie', 'achat_animaux', 'materiel', 'main_oeuvre', 'transport', 'impots', 'autre'] as const;
export const CATEGORIES_RECETTE = ['oeufs', 'oeufs_a_couver', 'poussins', 'reproducteurs', 'animaux', 'autre'] as const;

export const LIBELLES_CATEGORIES: Record<string, string> = {
  aliment: 'Aliment',
  soins: 'Soins et vaccins',
  energie: 'Énergie et eau',
  achat_animaux: 'Achat d’animaux',
  materiel: 'Matériel',
  main_oeuvre: 'Main-d’œuvre et salaires',
  transport: 'Transport',
  impots: 'Impôts, taxes et frais',
  oeufs: 'Œufs',
  oeufs_a_couver: 'Œufs à couver',
  poussins: 'Poussins',
  reproducteurs: 'Reproducteurs',
  animaux: 'Animaux (viande)',
  autre: 'Autre',
};

export const MODES_PAIEMENT = ['especes', 'wave', 'orange_money', 'virement', 'cheque', 'autre'] as const;
export type ModePaiement = (typeof MODES_PAIEMENT)[number];
export const LIBELLES_MODES: Record<ModePaiement, string> = {
  especes: 'Espèces',
  wave: 'Wave',
  orange_money: 'Orange Money',
  virement: 'Virement bancaire',
  cheque: 'Chèque',
  autre: 'Autre',
};

/** Une ligne d'une facture : « 30 plateaux d'œufs × 2 500 ». */
export interface LigneDocument {
  libelle: string;
  quantite: number;
  prixUnitaire: number;
}

export type NatureSalaire = 'salaire' | 'avance' | 'prime';

/** Une dépense ou une recette, en FCFA (montant entier, sans centimes). */
export interface OperationFinanciere extends Enregistrement {
  date: Jour;
  sens: SensOperation;
  categorie: string;
  /** Total à payer ou à encaisser (lignes moins remise, quand il y a des lignes). */
  montant: number;
  lotId?: string | null;
  /** Client ou fournisseur (nom). */
  tiers?: string;
  tiersId?: string;
  /**
   * Ancien système : vrai si tout est réglé, sans détail. Les nouvelles opérations ne s'en servent plus :
   * leurs règlements sont des enregistrements `Paiement`.
   */
  paye: boolean;
  payeLe?: Jour;
  note?: string;
  /** Numéro de facture (vente : F-2026-0001) ou référence du fournisseur. */
  numero?: string;
  lignes?: LigneDocument[];
  /** Remise globale en FCFA, déjà déduite du montant. */
  remise?: number;
  /** Date limite de règlement. */
  echeance?: Jour;
  /** Paie : employé concerné, mois (AAAA-MM) et nature du versement. */
  employeId?: string;
  periode?: string;
  nature?: NatureSalaire;
  /** `a_valider` : saisi par quelqu'un qui n'a pas le droit de valider ; rien ne compte tant qu'un responsable ne l'a pas validé. Absent = validé. */
  statut?: 'a_valider' | 'validee';
}

/** Un règlement (acompte, solde…). Une opération peut en avoir plusieurs ; ils ne se modifient pas, on les annule. */
export interface Paiement extends Enregistrement {
  operationId: string;
  date: Jour;
  montant: number;
  mode: ModePaiement;
  statut?: 'a_valider' | 'validee';
}

/** Carnet des clients et fournisseurs. */
export interface Tiers extends Enregistrement {
  nom: string;
  telephone?: string;
  note?: string;
}

export interface Employe extends Enregistrement {
  nom: string;
  poste?: string;
  /** Salaire mensuel convenu, en FCFA. */
  salaire: number;
  telephone?: string;
  /** Premier mois payé (AAAA-MM) et dernier mois (départ), facultatifs. */
  debut?: string;
  fin?: string;
}

export const CATEGORIES_PAIE: Record<NatureSalaire, string> = { salaire: 'Salaire', avance: 'Avance sur salaire', prime: 'Prime' };

/** Ligne unifiée : une opération saisie, ou un achat d'aliment du stock compté automatiquement comme dépense. */
export interface LigneFinance {
  cle: string;
  date: Jour;
  sens: SensOperation;
  categorie: string;
  montant: number;
  lotId?: string | null;
  tiers?: string;
  /** Tout est réglé. */
  paye: boolean;
  /** Reste à régler (0 si tout est réglé). */
  reste: number;
  echeance?: Jour;
  numero?: string;
  tiersId?: string;
  employeId?: string;
  /** Vient du stock d'aliment : à corriger là-bas, pas ici. */
  automatique: boolean;
}

const vivants = <T extends { supprimeLe?: number | null }>(xs: T[]) => xs.filter((x) => !x.supprimeLe);

/** Les opérations et règlements « à valider » ne comptent dans aucun chiffre tant qu'ils ne sont pas validés. */
const comptes = <T extends { supprimeLe?: number | null; statut?: string }>(xs: T[]) => xs.filter((x) => !x.supprimeLe && x.statut !== 'a_valider');

/** Ce qui attend la validation d'un responsable. */
export function enAttenteDeValidation(operations: OperationFinanciere[], paiements: Paiement[]): { operations: OperationFinanciere[]; paiements: Paiement[] } {
  const ops = vivants(operations);
  const vivantes = new Set(ops.map((o) => o.id));
  return {
    operations: ops.filter((o) => o.statut === 'a_valider').sort((a, b) => a.date.localeCompare(b.date)),
    paiements: vivants(paiements).filter((p) => p.statut === 'a_valider' && vivantes.has(p.operationId)).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** Total d'une facture : somme des lignes moins la remise (jamais négatif). */
export function totalLignes(lignes: LigneDocument[], remise = 0): number {
  const somme = lignes.reduce((a, l) => a + Math.round(l.quantite * l.prixUnitaire), 0);
  return Math.max(0, somme - Math.max(0, remise));
}

export interface Reglement {
  regle: number;
  reste: number;
}

/**
 * Ce qui est déjà réglé sur une opération. S'il existe des paiements, ils font foi ;
 * sinon on retombe sur l'ancien indicateur « payé » (données saisies avant les règlements détaillés).
 */
export function reglement(op: OperationFinanciere, paiements: Paiement[]): Reglement {
  const siens = comptes(paiements).filter((p) => p.operationId === op.id);
  const regle = siens.length > 0 ? siens.reduce((a, p) => a + p.montant, 0) : op.paye ? op.montant : 0;
  return { regle, reste: Math.max(0, op.montant - regle) };
}

/** Réunit les opérations saisies et les achats d'aliment avec un prix (dépense « aliment » déjà payée). */
export function lignesFinance(operations: OperationFinanciere[], entreesStock: EntreeStock[], paiements: Paiement[] = []): LigneFinance[] {
  const parOperation = new Map<string, Paiement[]>();
  for (const p of comptes(paiements)) parOperation.set(p.operationId, [...(parOperation.get(p.operationId) ?? []), p]);
  const saisies = comptes(operations).map((o): LigneFinance => {
    const { reste } = reglement(o, parOperation.get(o.id) ?? []);
    return {
      cle: o.id, date: o.date, sens: o.sens, categorie: o.categorie, montant: o.montant, lotId: o.lotId ?? null, paye: reste === 0, reste, automatique: false,
      ...(o.tiers ? { tiers: o.tiers } : {}),
      ...(o.tiersId ? { tiersId: o.tiersId } : {}),
      ...(o.echeance ? { echeance: o.echeance } : {}),
      ...(o.numero ? { numero: o.numero } : {}),
      ...(o.employeId ? { employeId: o.employeId } : {}),
    };
  });
  const achats = vivants(entreesStock)
    .filter((e) => e.quantiteKg > 0 && (e.prixTotal ?? 0) > 0)
    .map((e): LigneFinance => ({ cle: `stock:${e.id}`, date: e.date, sens: 'depense', categorie: 'aliment', montant: e.prixTotal ?? 0, paye: true, reste: 0, automatique: true }));
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
  const ouvertes = lignes.filter((l) => l.reste > 0);
  const aEncaisser = ouvertes.filter((l) => l.sens === 'recette').sort((a, b) => a.date.localeCompare(b.date));
  const aPayer = ouvertes.filter((l) => l.sens === 'depense').sort((a, b) => a.date.localeCompare(b.date));
  return { aEncaisser, aPayer, totalAEncaisser: aEncaisser.reduce((a, l) => a + l.reste, 0), totalAPayer: aPayer.reduce((a, l) => a + l.reste, 0) };
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

/** Règlement en retard : il reste de l'argent à régler et la date limite est dépassée. */
export const enRetard = (l: LigneFinance, aujourdhui: Jour): boolean => l.reste > 0 && !!l.echeance && l.echeance < aujourdhui;

/** Ce que doit chaque client (à encaisser) et ce que vous devez à chaque fournisseur (à payer), par fiche du carnet. */
export function soldesParTiers(lignes: LigneFinance[]): Map<string, { aEncaisser: number; aPayer: number }> {
  const par = new Map<string, { aEncaisser: number; aPayer: number }>();
  for (const l of lignes) {
    if (!l.tiersId || l.reste <= 0) continue;
    const c = par.get(l.tiersId) ?? { aEncaisser: 0, aPayer: 0 };
    if (l.sens === 'recette') c.aEncaisser += l.reste;
    else c.aPayer += l.reste;
    par.set(l.tiersId, c);
  }
  return par;
}

/** Argent réellement encaissé ou payé sur la période, par moyen de paiement (d'après les règlements enregistrés). */
export function fluxParMode(operations: OperationFinanciere[], paiements: Paiement[], periode = ''): { mode: ModePaiement; encaisse: number; paye: number }[] {
  const sens = new Map(comptes(operations).map((o) => [o.id, o.sens]));
  const par = new Map<ModePaiement, { encaisse: number; paye: number }>();
  for (const p of comptes(paiements)) {
    const s = sens.get(p.operationId);
    if (!s || (periode && !p.date.startsWith(periode))) continue;
    const c = par.get(p.mode) ?? { encaisse: 0, paye: 0 };
    if (s === 'recette') c.encaisse += p.montant;
    else c.paye += p.montant;
    par.set(p.mode, c);
  }
  return MODES_PAIEMENT.filter((m) => par.has(m)).map((mode) => ({ mode, ...par.get(mode)! }));
}

/** Prochain numéro de facture de vente de l'année : F-2026-0001, F-2026-0002… */
export function prochainNumeroFacture(operations: OperationFinanciere[], annee: number): string {
  const prefixe = `F-${annee}-`;
  let max = 0;
  for (const o of operations) {
    if (o.sens !== 'recette' || !o.numero?.startsWith(prefixe)) continue;
    const n = Number(o.numero.slice(prefixe.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefixe}${String(max + 1).padStart(4, '0')}`;
}

export type StatutSalaire = 'paye' | 'partiel' | 'a_payer';

export interface SuiviSalaire {
  employe: Employe;
  /** Salaire convenu pour le mois. */
  du: number;
  /** Salaire et avances déjà versés pour ce mois. */
  verse: number;
  primes: number;
  /** Ce qu'il reste à verser (0 si le mois est soldé). */
  reste: number;
  statut: StatutSalaire;
}

/** Employés concernés par un mois (AAAA-MM) : ni pas encore arrivés, ni déjà partis. */
export const employesDuMois = (employes: Employe[], periode: string): Employe[] =>
  vivants(employes).filter((e) => (!e.debut || e.debut <= periode) && (!e.fin || e.fin >= periode));

/** Pour chaque employé du mois : ce qui est dû, ce qui est versé (salaire + avances), ce qui reste. */
export function suiviSalaires(employes: Employe[], operations: OperationFinanciere[], periode: string): SuiviSalaire[] {
  const paie = comptes(operations).filter((o) => o.sens === 'depense' && o.employeId && o.periode === periode);
  return employesDuMois(employes, periode).map((employe) => {
    const siennes = paie.filter((o) => o.employeId === employe.id);
    const verse = siennes.filter((o) => o.nature !== 'prime').reduce((a, o) => a + o.montant, 0);
    const primes = siennes.filter((o) => o.nature === 'prime').reduce((a, o) => a + o.montant, 0);
    const reste = Math.max(0, employe.salaire - verse);
    return { employe, du: employe.salaire, verse, primes, reste, statut: reste === 0 ? 'paye' : verse > 0 ? 'partiel' : 'a_payer' };
  });
}

/** Texte CSV (séparateur point-virgule, lisible par Excel en français) pour le comptable. */
export function exporterCsv(lignes: LigneFinance[], nomLot: (id?: string | null) => string): string {
  const echapper = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const entete = ['Date', 'Type', 'Catégorie', 'Montant (FCFA)', 'Lot', 'Client ou fournisseur', 'Payé', 'N°', 'Reste à régler (FCFA)'];
  const corps = [...lignes].sort((a, b) => a.date.localeCompare(b.date)).map((l) =>
    [l.date, l.sens === 'recette' ? 'Recette' : 'Dépense', LIBELLES_CATEGORIES[l.categorie] ?? l.categorie, String(l.montant), l.lotId ? nomLot(l.lotId) : '', l.tiers ?? '', l.reste === 0 ? 'oui' : 'non', l.numero ?? '', String(l.reste)].map(echapper).join(';'),
  );
  return [entete.join(';'), ...corps].join('\n');
}
