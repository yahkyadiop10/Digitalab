import type { TableSynchronisee } from './sync';

export type ActionJournal = 'creation' | 'modification' | 'annulation' | 'restauration' | 'validation' | 'utilisateur';

/** Une ligne du journal d'activité : qui a fait quoi, et quand. */
export interface EntreeJournal {
  id: number;
  /** Instant (ms) où la personne a fait l'action sur son téléphone. */
  faitLe: number;
  /** Instant (ISO) où le serveur l'a reçue ; il peut être bien plus tard si elle travaillait sans réseau. */
  recuLe: string;
  telephone: string;
  nom: string | null;
  fonction: string | null;
  action: ActionJournal;
  table: string;
  enregistrementId: string;
  description: string;
}

const NOMS_TABLES: Record<TableSynchronisee, string> = {
  logements: 'un bâtiment ou une cage',
  lots: 'un lot',
  mouvements: 'un mouvement d’animaux',
  pontes: 'une ponte',
  distributions: 'une distribution d’aliment',
  entreesStock: 'un mouvement de stock',
  couveuses: 'une couveuse',
  incubations: 'une incubation',
  mirages: 'un mirage',
  evenementsSante: 'une saisie de santé',
  operations: 'une opération financière',
  quarantaines: 'une quarantaine',
  notesQuarantaine: 'une note de quarantaine',
  paiements: 'un règlement',
  tiers: 'une fiche du carnet',
  employes: 'une fiche d’employé',
  profil: 'les informations de l’élevage',
  comptes: 'un compte de trésorerie',
  transferts: 'un transfert entre comptes',
  pointages: 'un comptage de caisse ou de compte',
};

export const LIBELLES_TABLES_JOURNAL: Record<string, string> = {
  ...Object.fromEntries(Object.entries(NOMS_TABLES).map(([k, v]) => [k, v.replace(/^(un|une|les) /, '')])),
  utilisateurs: 'utilisateurs',
};

const VERBES: Record<Exclude<ActionJournal, 'utilisateur'>, string> = {
  creation: 'a ajouté',
  modification: 'a modifié',
  annulation: 'a annulé',
  restauration: 'a rétabli',
  validation: 'a validé',
};

const TYPES_MOUVEMENT: Record<string, string> = { naissance: 'naissance', arrivee: 'arrivée', vente: 'vente', deces: 'décès', reforme: 'réforme', correction: 'correction' };
const TYPES_SANTE: Record<string, string> = { observation: 'problème de santé', vaccin: 'vaccin', traitement: 'traitement', quarantaine: 'mise à l’écart' };

const fcfa = (n: unknown) => `${new Intl.NumberFormat('fr-FR').format(Number(n) || 0).replace(/[\u00a0\u202f]/g, '\u00a0')}\u00a0FCFA`;
const texte = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Résumé court d'une fiche, pour le journal. Ne montre que l'essentiel, jamais le contenu entier. */
export function decrireEnregistrement(table: string, e: Record<string, unknown>): string {
  const morceaux: (string | false | undefined)[] = [];
  switch (table) {
    case 'pontes':
      morceaux.push(`${e['nombre']} œufs`, Number(e['casses']) > 0 && `${e['casses']} cassés`);
      break;
    case 'distributions':
      morceaux.push(`${String(e['quantiteKg']).replace('.', ',')} kg`);
      break;
    case 'mouvements':
      morceaux.push(TYPES_MOUVEMENT[String(e['type'])] ?? String(e['type'] ?? ''), `${Math.abs(Number(e['quantite']) || 0)} animaux`);
      break;
    case 'entreesStock':
      morceaux.push(`${String(e['quantiteKg']).replace('.', ',')} kg`, Number(e['prixTotal']) > 0 && fcfa(e['prixTotal']));
      break;
    case 'lots': case 'logements': case 'couveuses': case 'quarantaines': case 'tiers': case 'employes':
      morceaux.push(texte(e['nom']));
      break;
    case 'incubations':
      morceaux.push(texte(e['nom']), `${e['nbOeufs']} œufs`);
      break;
    case 'mirages':
      morceaux.push(`jour ${e['etape']}`, `${e['clairs']} clairs, ${e['morts']} morts`);
      break;
    case 'evenementsSante':
      morceaux.push(TYPES_SANTE[String(e['type'])] ?? String(e['type'] ?? ''), texte(e['nom']));
      break;
    case 'operations':
      morceaux.push(e['sens'] === 'recette' ? 'recette' : 'dépense', fcfa(e['montant']), texte(e['tiers']), texte(e['numero']));
      break;
    case 'paiements':
      morceaux.push(fcfa(e['montant']), texte(e['mode']));
      break;
    case 'comptes':
      morceaux.push(texte(e['nom']));
      break;
    case 'transferts':
      morceaux.push(fcfa(e['montant']), Number(e['frais']) > 0 && `frais ${fcfa(e['frais'])}`);
      break;
    case 'pointages':
      morceaux.push(`réel ${fcfa(e['soldeReel'])}`, Number(e['ecart']) !== 0 ? `écart ${Number(e['ecart']) > 0 ? '+' : '−'}${fcfa(Math.abs(Number(e['ecart'])))}` : 'aucun écart');
      break;
    case 'notesQuarantaine':
      morceaux.push(texte(e['etat']));
      break;
    default:
      break;
  }
  return morceaux.filter((m): m is string => typeof m === 'string' && m.length > 0).join(' · ');
}

/** Ce que représente une modification, d'après la fiche avant et après. */
export function determinerAction(avant: Record<string, unknown> | undefined, apres: Record<string, unknown>): Exclude<ActionJournal, 'utilisateur'> {
  if (!avant) return 'creation';
  const supprimeAvant = !!avant['supprimeLe'];
  const supprimeApres = !!apres['supprimeLe'];
  if (!supprimeAvant && supprimeApres) return 'annulation';
  if (supprimeAvant && !supprimeApres) return 'restauration';
  if (avant['statut'] === 'a_valider' && apres['statut'] !== 'a_valider') return 'validation';
  return 'modification';
}

/** Phrase du journal : « a ajouté une ponte : 9 œufs ». */
export function phraseJournal(e: Pick<EntreeJournal, 'action' | 'table' | 'description'>): string {
  if (e.action === 'utilisateur') return e.description;
  const objet = NOMS_TABLES[e.table as TableSynchronisee] ?? 'une fiche';
  return `${VERBES[e.action]} ${objet}${e.description ? ` : ${e.description}` : ''}`;
}
