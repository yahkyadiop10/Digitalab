import type { Jour } from './dates';
import type { Enregistrement, EntreeStock } from './types';
import type { ModePaiement, OperationFinanciere, Paiement } from './finances';

export type TypeCompte = 'caisse' | 'mobile_money' | 'banque' | 'autre';

export const LIBELLES_TYPES_COMPTE: Record<TypeCompte, string> = {
  caisse: 'Caisse (espèces)',
  mobile_money: 'Mobile money',
  banque: 'Banque',
  autre: 'Autre',
};

/** Un endroit où se trouve l'argent : la caisse, un compte Wave ou Orange Money, la banque… */
export interface CompteTresorerie extends Enregistrement {
  nom: string;
  type: TypeCompte;
  /** Solde connu au début du jour `dateInitiale`, en FCFA. Rien d'antérieur n'est compté. */
  soldeInitial: number;
  dateInitiale: Jour;
  /** Les règlements faits par ces moyens de paiement arrivent (ou partent) de ce compte. */
  modes: ModePaiement[];
}

/** Argent déplacé d'un compte à un autre (retrait Wave vers la caisse, dépôt en banque…). */
export interface Transfert extends Enregistrement {
  date: Jour;
  deId: string;
  versId: string;
  montant: number;
  /** Frais retenus sur le compte d'origine (retrait, commission) ; ils comptent comme une dépense. */
  frais?: number;
  note?: string;
}

/** Comptage réel d'un compte, comparé à ce que les saisies annoncent. */
export interface Pointage extends Enregistrement {
  compteId: string;
  date: Jour;
  /** Ce que la personne a compté ou lu sur le compte. */
  soldeReel: number;
  /** Ce que l'application annonçait à ce moment-là. */
  soldeTheorique: number;
  /** Réel moins théorique : négatif = il manque de l'argent. */
  ecart: number;
  /** Écart expliqué et corrigé : il entre alors dans le solde du compte. */
  regularise: boolean;
  note?: string;
}

export const COMPTES_PAR_DEFAUT: { nom: string; type: TypeCompte; modes: ModePaiement[] }[] = [
  { nom: 'Caisse', type: 'caisse', modes: ['especes'] },
  { nom: 'Wave', type: 'mobile_money', modes: ['wave'] },
  { nom: 'Orange Money', type: 'mobile_money', modes: ['orange_money'] },
  { nom: 'Banque', type: 'banque', modes: ['virement', 'cheque'] },
];

const vivants = <T extends { supprimeLe?: number | null }>(xs: T[]) => xs.filter((x) => !x.supprimeLe);

/** Compte qui reçoit ou paie par ce moyen de paiement, s'il y en a un. */
export function compteDuMode(comptes: CompteTresorerie[], mode: string | undefined): CompteTresorerie | undefined {
  return mode ? vivants(comptes).find((c) => c.modes.includes(mode as ModePaiement)) : undefined;
}

export type NatureMouvement = 'recette' | 'depense' | 'achat_stock' | 'transfert_entrant' | 'transfert_sortant' | 'frais' | 'ajustement';

export interface MouvementCompte {
  cle: string;
  date: Jour;
  nature: NatureMouvement;
  /** Signé : positif = l'argent entre, négatif = il sort. */
  montant: number;
  libelle: string;
  /** Pour retrouver la fiche d'origine (opération, transfert, pointage). */
  reference?: { type: 'operation' | 'transfert' | 'pointage' | 'stock'; id: string };
}

export interface EntreeTresorerie {
  comptes: CompteTresorerie[];
  operations: OperationFinanciere[];
  paiements: Paiement[];
  entreesStock?: EntreeStock[];
  transferts: Transfert[];
  pointages: Pointage[];
}

/** Tous les mouvements d'un compte depuis son jour de départ, du plus ancien au plus récent. */
export function mouvementsCompte(compte: CompteTresorerie, d: EntreeTresorerie, nomCompte: (id: string) => string = (id) => id): MouvementCompte[] {
  const out: MouvementCompte[] = [];
  const ops = new Map(vivants(d.operations).filter((o) => o.statut !== 'a_valider').map((o) => [o.id, o]));
  const mes = (date: Jour) => date >= compte.dateInitiale;

  for (const p of vivants(d.paiements)) {
    const o = ops.get(p.operationId);
    if (!o || p.statut === 'a_valider' || !mes(p.date) || compteDuMode(d.comptes, p.mode)?.id !== compte.id) continue;
    out.push({
      cle: `p:${p.id}`, date: p.date, nature: o.sens, montant: o.sens === 'recette' ? p.montant : -p.montant,
      libelle: `${o.sens === 'recette' ? 'Encaissement' : 'Paiement'}${o.tiers ? ` · ${o.tiers}` : ''}${o.numero ? ` · ${o.numero}` : ''}`, reference: { type: 'operation', id: o.id },
    });
  }
  for (const e of vivants(d.entreesStock ?? [])) {
    const mode = (e as EntreeStock & { mode?: string }).mode;
    if (!mode || !(e.prixTotal && e.prixTotal > 0) || e.quantiteKg <= 0 || !mes(e.date) || compteDuMode(d.comptes, mode)?.id !== compte.id) continue;
    out.push({ cle: `s:${e.id}`, date: e.date, nature: 'achat_stock', montant: -e.prixTotal, libelle: `Achat d’aliment · ${e.quantiteKg} kg`, reference: { type: 'stock', id: e.id } });
  }
  for (const t of vivants(d.transferts)) {
    if (!mes(t.date)) continue;
    if (t.deId === compte.id) {
      out.push({ cle: `t:${t.id}:s`, date: t.date, nature: 'transfert_sortant', montant: -t.montant, libelle: `Transfert vers ${nomCompte(t.versId)}`, reference: { type: 'transfert', id: t.id } });
      if (t.frais && t.frais > 0) out.push({ cle: `t:${t.id}:f`, date: t.date, nature: 'frais', montant: -t.frais, libelle: `Frais du transfert vers ${nomCompte(t.versId)}`, reference: { type: 'transfert', id: t.id } });
    }
    if (t.versId === compte.id) out.push({ cle: `t:${t.id}:e`, date: t.date, nature: 'transfert_entrant', montant: t.montant, libelle: `Transfert depuis ${nomCompte(t.deId)}`, reference: { type: 'transfert', id: t.id } });
  }
  for (const p of vivants(d.pointages)) {
    if (p.compteId !== compte.id || !p.regularise || p.ecart === 0 || !mes(p.date)) continue;
    out.push({ cle: `a:${p.id}`, date: p.date, nature: 'ajustement', montant: p.ecart, libelle: `Ajustement après comptage${p.note ? ` · ${p.note}` : ''}`, reference: { type: 'pointage', id: p.id } });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.cle.localeCompare(b.cle));
}

export interface SoldeCompte {
  compte: CompteTresorerie;
  entrees: number;
  sorties: number;
  solde: number;
}

const RANG_TYPE: Record<TypeCompte, number> = { caisse: 0, mobile_money: 1, banque: 2, autre: 3 };

/** Ordre d'affichage stable, identique sur tous les appareils : la caisse d'abord, puis le mobile money, puis la banque. */
export const trierComptes = <T extends CompteTresorerie>(comptes: T[]): T[] =>
  [...comptes].sort((a, b) => RANG_TYPE[a.type] - RANG_TYPE[b.type] || a.nom.localeCompare(b.nom, 'fr') || a.id.localeCompare(b.id));

/** Solde de chaque compte : solde de départ plus tout ce qui est entré, moins tout ce qui est sorti. */
export function soldesComptes(d: EntreeTresorerie, nomCompte?: (id: string) => string): SoldeCompte[] {
  return trierComptes(vivants(d.comptes)).map((compte) => {
    const m = mouvementsCompte(compte, d, nomCompte);
    const entrees = m.filter((x) => x.montant > 0).reduce((a, x) => a + x.montant, 0);
    const sorties = m.filter((x) => x.montant < 0).reduce((a, x) => a - x.montant, 0);
    return { compte, entrees, sorties, solde: compte.soldeInitial + entrees - sorties };
  });
}

export const liquiditeTotale = (soldes: SoldeCompte[]): number => soldes.reduce((a, s) => a + s.solde, 0);

/** Écarts constatés au comptage et pas encore expliqués : à surveiller. */
export const ecartsAExpliquer = (pointages: Pointage[]): Pointage[] => vivants(pointages).filter((p) => p.ecart !== 0 && !p.regularise).sort((a, b) => b.date.localeCompare(a.date));

/** Total des frais de transfert d'une période (« AAAA-MM » ou vide pour tout), comptés comme dépense. */
export function fraisTransferts(transferts: Transfert[], periode = ''): number {
  return vivants(transferts).filter((t) => !periode || t.date.startsWith(periode)).reduce((a, t) => a + (t.frais ?? 0), 0);
}

/** Règlements (reçus ou payés) par un moyen de paiement qu'aucun compte ne reçoit : l'argent n'est suivi nulle part. */
export function reglementsSansCompte(d: EntreeTresorerie): { nombre: number; montant: number } {
  const ops = new Map(vivants(d.operations).filter((o) => o.statut !== 'a_valider').map((o) => [o.id, o]));
  let nombre = 0;
  let montant = 0;
  for (const p of vivants(d.paiements)) {
    if (!ops.has(p.operationId) || p.statut === 'a_valider' || compteDuMode(d.comptes, p.mode)) continue;
    nombre += 1;
    montant += p.montant;
  }
  return { nombre, montant };
}
