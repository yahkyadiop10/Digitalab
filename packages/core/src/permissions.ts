import type { TableSynchronisee } from './sync';

/** Une fonction que l'administrateur peut accorder ou retirer. */
export interface Fonction {
  code: string;
  libelle: string;
}

export interface ModulePermissions {
  code: string;
  libelle: string;
  fonctions: Fonction[];
}

const f = (code: string, libelle: string): Fonction => ({ code, libelle });

/** Toutes les fonctions de l'application, rangées par module (l'ordre est celui de l'écran « Gestion des utilisateurs »). */
export const MODULES: ModulePermissions[] = [
  {
    code: 'saisie', libelle: 'Saisie',
    fonctions: [
      f('saisie.ponte', 'Noter la ponte'),
      f('saisie.aliment', 'Noter l’aliment distribué'),
      f('saisie.deces', 'Noter un décès'),
      f('saisie.vente', 'Noter une vente ou une réforme d’animaux'),
      f('saisie.stock', 'Gérer le stock d’aliment (achats, inventaire)'),
      f('saisie.annuler', 'Annuler une saisie'),
    ],
  },
  {
    code: 'cheptel', libelle: 'Gestion du cheptel',
    fonctions: [
      f('cheptel.voir', 'Voir le cheptel et les bâtiments'),
      f('cheptel.lots', 'Créer et modifier des lots'),
      f('cheptel.deplacer', 'Changer un lot de bâtiment'),
      f('cheptel.archiver', 'Archiver un lot'),
      f('cheptel.locaux', 'Gérer les bâtiments et les cages'),
      f('cheptel.fiche', 'Partager la fiche de suivi avec un acheteur'),
    ],
  },
  {
    code: 'couveuse', libelle: 'Couveuse',
    fonctions: [
      f('couveuse.voir', 'Voir les incubations'),
      f('couveuse.mise', 'Mettre des œufs en incubation'),
      f('couveuse.mirage', 'Noter un mirage et cocher les étapes'),
      f('couveuse.eclosion', 'Enregistrer une éclosion'),
      f('couveuse.appareils', 'Gérer les couveuses (ajouter, modifier, retirer)'),
      f('couveuse.annuler', 'Annuler une incubation ou un mirage'),
    ],
  },
  {
    code: 'sante', libelle: 'Santé',
    fonctions: [
      f('sante.voir', 'Voir la santé, les traitements et les vaccins'),
      f('sante.probleme', 'Signaler un problème ou des symptômes'),
      f('sante.vaccin', 'Noter un vaccin'),
      f('sante.traitement', 'Noter un traitement'),
      f('sante.isolement', 'Mettre un lot en quarantaine sanitaire'),
      f('sante.protocoles', 'Modifier le calendrier des vaccins'),
      f('sante.annuler', 'Annuler une saisie de santé'),
    ],
  },
  {
    code: 'quarantaine', libelle: 'Quarantaine',
    fonctions: [
      f('quarantaine.voir', 'Voir la zone de quarantaine'),
      f('quarantaine.arrivee', 'Enregistrer une nouvelle arrivée'),
      f('quarantaine.notes', 'Écrire dans le journal d’observation'),
      f('quarantaine.controles', 'Cocher les contrôles (examen, déparasitage…)'),
      f('quarantaine.decision', 'Prolonger ou terminer la quarantaine'),
      f('quarantaine.annuler', 'Annuler une note de quarantaine'),
    ],
  },
  {
    code: 'finances', libelle: 'Finances',
    fonctions: [
      f('finances.voir_depenses', 'Afficher les dépenses'),
      f('finances.voir_recettes', 'Afficher les recettes et les résultats'),
      f('finances.saisir_depense', 'Saisir les dépenses'),
      f('finances.saisir_facture', 'Saisir les factures de vente'),
      f('finances.encaisser', 'Encaisser les ventes (caisse)'),
      f('finances.payer', 'Payer les fournisseurs'),
      f('finances.valider_depense', 'Valider les dépenses'),
      f('finances.valider_achat', 'Valider les achats (aliment, animaux, matériel)'),
      f('finances.valider_paiement', 'Valider les paiements'),
      f('finances.annuler_depense', 'Annuler une dépense déjà saisie'),
      f('finances.annuler_vente', 'Annuler une vente ou un encaissement'),
      f('finances.carnet', 'Gérer les clients et fournisseurs'),
      f('finances.exporter', 'Exporter les comptes (CSV)'),
    ],
  },
  {
    code: 'salaires', libelle: 'Salaires',
    fonctions: [
      f('salaires.voir', 'Voir les salaires et les employés'),
      f('salaires.payer', 'Payer salaires, avances et primes'),
      f('salaires.gerer', 'Ajouter et modifier les fiches des employés'),
    ],
  },
  {
    code: 'admin', libelle: 'Administration',
    fonctions: [
      f('admin.elevage', 'Modifier les informations de l’élevage et le logo'),
      f('admin.seuils', 'Régler les seuils d’alerte et les places par animal'),
      f('admin.utilisateurs', 'Gérer les utilisateurs et leurs droits'),
    ],
  },
];

export const TOUTES_LES_FONCTIONS: string[] = MODULES.flatMap((m) => m.fonctions.map((x) => x.code));
const CODES = new Set(TOUTES_LES_FONCTIONS);

/** Garde seulement les codes connus, sans doublons (un code inconnu ne donne aucun droit). */
export const nettoyerDroits = (droits: readonly string[]): string[] => [...new Set(droits.filter((c) => CODES.has(c)))];

export const fonctionsDuModule = (module: string): string[] => MODULES.find((m) => m.code === module)?.fonctions.map((x) => x.code) ?? [];

/** Le module est coché entièrement, en partie, ou pas du tout. */
export function etatModule(droits: readonly string[], module: string): 'tout' | 'partiel' | 'aucun' {
  const codes = fonctionsDuModule(module);
  const n = codes.filter((c) => droits.includes(c)).length;
  return n === 0 ? 'aucun' : n === codes.length ? 'tout' : 'partiel';
}

/** Coche ou décoche toutes les fonctions d'un module d'un coup. */
export function basculerModule(droits: readonly string[], module: string, actif: boolean): string[] {
  const codes = new Set(fonctionsDuModule(module));
  const reste = droits.filter((c) => !codes.has(c));
  return actif ? [...reste, ...codes] : reste;
}

/* ---------- Profils de départ ---------- */

export type RoleMembre = 'proprietaire' | 'gerant' | 'soigneur' | 'caissier' | 'veterinaire' | 'lecteur' | 'personnalise';

/** Droits proposés pour chaque profil ; l'administrateur peut ensuite cocher et décocher ce qu'il veut. */
export const DROITS_DES_PROFILS: Record<Exclude<RoleMembre, 'personnalise'>, string[]> = {
  proprietaire: TOUTES_LES_FONCTIONS,
  gerant: TOUTES_LES_FONCTIONS.filter((c) => c !== 'admin.utilisateurs'),
  soigneur: [
    'saisie.ponte', 'saisie.aliment', 'saisie.deces',
    'cheptel.voir', 'couveuse.voir', 'couveuse.mirage', 'couveuse.eclosion',
    'sante.voir', 'sante.probleme', 'sante.vaccin', 'sante.traitement',
    'quarantaine.voir', 'quarantaine.notes', 'quarantaine.controles',
  ],
  caissier: ['cheptel.voir', 'finances.voir_recettes', 'finances.saisir_facture', 'finances.encaisser', 'finances.carnet'],
  veterinaire: [
    'cheptel.voir', 'couveuse.voir',
    'sante.voir', 'sante.probleme', 'sante.vaccin', 'sante.traitement', 'sante.isolement', 'sante.protocoles',
    'quarantaine.voir', 'quarantaine.notes', 'quarantaine.controles',
  ],
  lecteur: ['cheptel.voir', 'couveuse.voir', 'sante.voir', 'quarantaine.voir'],
};

export const LIBELLES_PROFILS: Record<RoleMembre, string> = {
  proprietaire: 'Propriétaire',
  gerant: 'Gérant',
  soigneur: 'Soigneur',
  caissier: 'Caissier',
  veterinaire: 'Vétérinaire',
  lecteur: 'Lecteur',
  personnalise: 'Personnalisé',
};

export const DESCRIPTIONS_PROFILS: Record<RoleMembre, string> = {
  proprietaire: 'Tous les droits, dont la gestion des utilisateurs.',
  gerant: 'Tout, sauf la gestion des utilisateurs.',
  soigneur: 'Saisit ponte, aliment et décès, suit les couvées et la santé. Aucun accès aux finances.',
  caissier: 'Fait les factures, encaisse les ventes et tient le carnet des clients.',
  veterinaire: 'Consulte le cheptel et écrit dans la santé et la quarantaine.',
  lecteur: 'Consulte seulement.',
  personnalise: 'Droits choisis un par un.',
};

export const PROFILS_ASSIGNABLES: Exclude<RoleMembre, 'proprietaire'>[] = ['gerant', 'soigneur', 'caissier', 'veterinaire', 'lecteur', 'personnalise'];

/** Droits d'un profil ; `personnalise` n'a rien de prédéfini. */
export const droitsDuProfil = (role: RoleMembre): string[] => (role === 'personnalise' ? [] : [...DROITS_DES_PROFILS[role]]);

/** Libellé de rôle : l'ancien champ `role` donne les droits tant qu'aucun droit n'a été choisi un par un. */
export function droitsEffectifs(role: RoleMembre, droits: readonly string[] | null | undefined): string[] {
  if (role === 'proprietaire') return [...TOUTES_LES_FONCTIONS];
  return droits ? nettoyerDroits(droits) : droitsDuProfil(role);
}

export const aDroit = (droits: readonly string[], code: string): boolean => droits.includes(code);
export const aUnDroit = (droits: readonly string[], codes: readonly string[]): boolean => codes.some((c) => droits.includes(c));

/* ---------- Ce que chaque droit permet de lire et d'écrire (appliqué par le serveur) ---------- */

const module = fonctionsDuModule;

interface Regle {
  /** `base` : toute personne ayant au moins un droit. Sinon : au moins un de ces droits. */
  lecture: 'base' | string[];
  ecriture: string[];
  /** Droits qui permettent d'annuler (suppression logique) une fiche de cette table. */
  annulation: string[];
}

export const REGLES_TABLES: Record<TableSynchronisee, Regle> = {
  logements: { lecture: 'base', ecriture: ['cheptel.locaux', 'quarantaine.arrivee'], annulation: ['cheptel.locaux'] },
  lots: {
    lecture: 'base',
    ecriture: ['cheptel.lots', 'cheptel.deplacer', 'cheptel.archiver', 'couveuse.eclosion', 'quarantaine.arrivee', 'quarantaine.decision'],
    annulation: ['cheptel.lots', 'saisie.annuler', 'couveuse.annuler', 'couveuse.eclosion', 'quarantaine.decision'],
  },
  mouvements: {
    lecture: 'base',
    ecriture: ['saisie.deces', 'saisie.vente', 'saisie.annuler', 'cheptel.lots', 'couveuse.eclosion', 'quarantaine.arrivee', 'quarantaine.decision', 'sante.isolement'],
    annulation: ['saisie.annuler', 'cheptel.lots', 'couveuse.annuler', 'couveuse.eclosion', 'quarantaine.annuler', 'quarantaine.decision'],
  },
  pontes: { lecture: [...module('saisie'), 'cheptel.voir'], ecriture: ['saisie.ponte'], annulation: ['saisie.annuler'] },
  distributions: { lecture: [...module('saisie'), 'cheptel.voir'], ecriture: ['saisie.aliment'], annulation: ['saisie.annuler'] },
  entreesStock: { lecture: [...module('saisie'), 'cheptel.voir'], ecriture: ['saisie.stock', 'quarantaine.arrivee'], annulation: ['saisie.annuler', 'saisie.stock'] },
  couveuses: { lecture: module('couveuse'), ecriture: ['couveuse.appareils'], annulation: ['couveuse.appareils'] },
  incubations: { lecture: module('couveuse'), ecriture: ['couveuse.mise', 'couveuse.mirage', 'couveuse.eclosion'], annulation: ['couveuse.annuler'] },
  mirages: { lecture: module('couveuse'), ecriture: ['couveuse.mirage'], annulation: ['couveuse.annuler'] },
  evenementsSante: { lecture: module('sante'), ecriture: ['sante.probleme', 'sante.vaccin', 'sante.traitement', 'sante.isolement'], annulation: ['sante.annuler'] },
  operations: {
    lecture: [...module('finances'), ...module('salaires')],
    ecriture: ['finances.saisir_depense', 'finances.saisir_facture', 'finances.encaisser', 'finances.payer', 'finances.valider_depense', 'finances.valider_achat', 'salaires.payer'],
    annulation: ['finances.annuler_depense', 'finances.annuler_vente'],
  },
  paiements: {
    lecture: [...module('finances'), ...module('salaires')],
    ecriture: ['finances.encaisser', 'finances.payer', 'finances.saisir_depense', 'finances.saisir_facture', 'finances.valider_paiement', 'salaires.payer'],
    annulation: ['finances.annuler_depense', 'finances.annuler_vente'],
  },
  tiers: { lecture: [...module('finances'), 'cheptel.voir'], ecriture: ['finances.carnet', 'finances.saisir_depense', 'finances.saisir_facture', 'finances.encaisser'], annulation: ['finances.carnet'] },
  employes: { lecture: module('salaires'), ecriture: ['salaires.gerer'], annulation: ['salaires.gerer'] },
  quarantaines: { lecture: module('quarantaine'), ecriture: ['quarantaine.arrivee', 'quarantaine.controles', 'quarantaine.decision'], annulation: ['quarantaine.annuler', 'quarantaine.decision'] },
  notesQuarantaine: { lecture: module('quarantaine'), ecriture: ['quarantaine.notes'], annulation: ['quarantaine.annuler'] },
  profil: { lecture: 'base', ecriture: ['admin.elevage'], annulation: ['admin.elevage'] },
};

export function peutLireTable(droits: readonly string[], table: TableSynchronisee): boolean {
  if (droits.length === 0) return false;
  const l = REGLES_TABLES[table].lecture;
  return l === 'base' ? true : aUnDroit(droits, l);
}

export const peutEcrireTable = (droits: readonly string[], table: TableSynchronisee): boolean => aUnDroit(droits, REGLES_TABLES[table].ecriture);

/** Tables que ces droits permettent de modifier (pour n'envoyer que cela au serveur). */
export const tablesEcrivables = (droits: readonly string[]): TableSynchronisee[] =>
  (Object.keys(REGLES_TABLES) as TableSynchronisee[]).filter((t) => peutEcrireTable(droits, t));

/** Une fiche de la table peut-elle être annulée ? Pour les opérations, le sens (dépense ou recette) décide. */
export function peutAnnuler(droits: readonly string[], table: TableSynchronisee, enregistrement: { sens?: unknown } = {}): boolean {
  if (table === 'operations' || table === 'paiements') {
    if (enregistrement.sens === 'recette') return aDroit(droits, 'finances.annuler_vente');
    if (enregistrement.sens === 'depense') return aDroit(droits, 'finances.annuler_depense');
  }
  return aUnDroit(droits, REGLES_TABLES[table].annulation);
}

/* ---------- Validation des dépenses et des paiements ---------- */

/** Dépenses qui relèvent des « achats » : elles se valident avec le droit de valider les achats. */
export const CATEGORIES_ACHATS = ['aliment', 'achat_animaux', 'materiel'] as const;

/** Droit nécessaire pour valider une dépense, selon sa catégorie. */
export const droitPourValiderDepense = (categorie: string): string =>
  (CATEGORIES_ACHATS as readonly string[]).includes(categorie) ? 'finances.valider_achat' : 'finances.valider_depense';

export function peutValiderDepense(droits: readonly string[], categorie: string): boolean {
  return aDroit(droits, droitPourValiderDepense(categorie));
}
