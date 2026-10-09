import { ajouterJours, ecartJours, type Jour } from './dates';
import { effectifs } from './effectif';
import type { EvenementSante, Lot, Mouvement, ProtocoleVaccin } from './types';

const vivants = <T extends { supprimeLe?: number | null }>(xs: T[]) => xs.filter((x) => !x.supprimeLe);

/* ---------- Symptômes ---------- */

export type CategorieSymptome = 'respiration' | 'tete' | 'digestion' | 'nerveux' | 'general' | 'ponte' | 'peau';

export interface Symptome {
  code: string;
  libelle: string;
  categorie: CategorieSymptome;
}

export const CATEGORIES_SYMPTOMES: Record<CategorieSymptome, string> = {
  respiration: 'Respiration',
  tete: 'Tête et yeux',
  digestion: 'Digestion',
  nerveux: 'Mouvements et nerfs',
  general: 'État général',
  ponte: 'Ponte',
  peau: 'Peau, plumes et parasites',
};

export const SYMPTOMES: Symptome[] = [
  { code: 'toux', libelle: 'Toux', categorie: 'respiration' },
  { code: 'eternuements', libelle: 'Éternuements', categorie: 'respiration' },
  { code: 'rales', libelle: 'Bruits en respirant (râles)', categorie: 'respiration' },
  { code: 'bec_ouvert', libelle: 'Respire le bec ouvert', categorie: 'respiration' },
  { code: 'ecoulement_nasal', libelle: 'Écoulement du nez', categorie: 'respiration' },
  { code: 'yeux_gonfles', libelle: 'Yeux ou face gonflés', categorie: 'tete' },
  { code: 'yeux_ecoulement', libelle: 'Yeux qui coulent', categorie: 'tete' },
  { code: 'oeil_gris', libelle: 'Œil gris ou pupille déformée', categorie: 'tete' },
  { code: 'crete_pale', libelle: 'Crête pâle', categorie: 'tete' },
  { code: 'crete_bleutee', libelle: 'Crête violacée ou bleutée', categorie: 'tete' },
  { code: 'gonflement_tete', libelle: 'Tête ou cou très gonflés', categorie: 'tete' },
  { code: 'lesions_bouche', libelle: 'Plaques ou lésions dans la bouche', categorie: 'tete' },
  { code: 'diarrhee', libelle: 'Diarrhée', categorie: 'digestion' },
  { code: 'diarrhee_sanglante', libelle: 'Diarrhée avec du sang', categorie: 'digestion' },
  { code: 'diarrhee_verte', libelle: 'Diarrhée verdâtre', categorie: 'digestion' },
  { code: 'diarrhee_blanche', libelle: 'Diarrhée blanchâtre', categorie: 'digestion' },
  { code: 'vers_visibles', libelle: 'Vers visibles dans les fientes', categorie: 'digestion' },
  { code: 'torticolis', libelle: 'Tête tordue (torticolis)', categorie: 'nerveux' },
  { code: 'paralysie', libelle: 'Paralysie des pattes ou des ailes', categorie: 'nerveux' },
  { code: 'tremblements', libelle: 'Tremblements', categorie: 'nerveux' },
  { code: 'boiterie', libelle: 'Boiterie', categorie: 'nerveux' },
  { code: 'apathie', libelle: 'Abattu, immobile', categorie: 'general' },
  { code: 'plumes_ebouriffees', libelle: 'Plumes ébouriffées', categorie: 'general' },
  { code: 'perte_appetit', libelle: 'Mange moins', categorie: 'general' },
  { code: 'soif_intense', libelle: 'Boit beaucoup', categorie: 'general' },
  { code: 'amaigrissement', libelle: 'Maigrit', categorie: 'general' },
  { code: 'odeur_forte', libelle: 'Mauvaise odeur de la tête', categorie: 'general' },
  { code: 'mort_brutale', libelle: 'Morts brutales, sans signe avant', categorie: 'general' },
  { code: 'mortalite_elevee', libelle: 'Plusieurs morts en peu de temps', categorie: 'general' },
  { code: 'baisse_ponte', libelle: 'Ponte en baisse', categorie: 'ponte' },
  { code: 'oeufs_deformes', libelle: 'Œufs déformés ou à coquille molle', categorie: 'ponte' },
  { code: 'croutes', libelle: 'Croûtes ou boutons sur la crête et la face', categorie: 'peau' },
  { code: 'demangeaisons', libelle: 'Se gratte, picore ses plumes', categorie: 'peau' },
  { code: 'plumes_abimees', libelle: 'Plumes abîmées ou manquantes', categorie: 'peau' },
  { code: 'parasites_visibles', libelle: 'Poux ou acariens visibles', categorie: 'peau' },
];

export const symptomePar = (code: string): Symptome | undefined => SYMPTOMES.find((s) => s.code === code);

/* ---------- Maladies : repères généraux, à faire relire par un vétérinaire ---------- */

export type Declaration = 'obligatoire' | 'reglementee' | null;

export interface Maladie {
  code: string;
  nom: string;
  /** Espèces concernées ; vide = toutes les volailles. */
  especes: string[];
  /** Symptômes évocateurs, avec un poids (1 = peu spécifique, 4 = très évocateur). */
  symptomes: Record<string, number>;
  resume: string;
  conduite: string;
  declaration: Declaration;
}

const CONDUITE_GENERALE = 'Isolez les animaux malades, notez les symptômes, nettoyez et désinfectez, et demandez conseil à un vétérinaire avant tout traitement.';

export const MALADIES: Maladie[] = [
  {
    code: 'newcastle', nom: 'Maladie de Newcastle', especes: [],
    symptomes: { toux: 1, eternuements: 1, bec_ouvert: 2, diarrhee_verte: 2, torticolis: 3, paralysie: 2, tremblements: 1, baisse_ponte: 2, oeufs_deformes: 1, apathie: 1, mortalite_elevee: 2, perte_appetit: 1 },
    resume: 'Maladie virale très contagieuse : atteinte respiratoire, digestive et nerveuse, forte mortalité.',
    conduite: 'Isolez immédiatement, ne déplacez ni animaux ni matériel, et prévenez un vétérinaire ou les services vétérinaires. Il n’existe pas de traitement ; la vaccination prévient la maladie.',
    declaration: 'obligatoire',
  },
  {
    code: 'influenza', nom: 'Grippe aviaire (influenza)', especes: [],
    symptomes: { mort_brutale: 4, gonflement_tete: 3, crete_bleutee: 3, bec_ouvert: 1, baisse_ponte: 1, diarrhee: 1, apathie: 1, mortalite_elevee: 2 },
    resume: 'Maladie virale à déclaration obligatoire : morts brutales nombreuses, tête gonflée, crête violacée.',
    conduite: 'Ne touchez plus aux animaux sans protection, ne déplacez rien et prévenez immédiatement les services vétérinaires.',
    declaration: 'obligatoire',
  },
  {
    code: 'gumboro', nom: 'Maladie de Gumboro (bursite infectieuse)', especes: ['poule'],
    symptomes: { diarrhee_blanche: 3, apathie: 2, plumes_ebouriffees: 1, mortalite_elevee: 2, tremblements: 1, soif_intense: 1 },
    resume: 'Maladie virale des jeunes poulets (surtout de 3 à 6 semaines) : abattement, diarrhée blanchâtre, mortalité.',
    conduite: 'Réglementée au Sénégal d’après les sources consultées : informez les services vétérinaires. La vaccination des jeunes la prévient.',
    declaration: 'reglementee',
  },
  {
    code: 'bronchite', nom: 'Bronchite infectieuse', especes: ['poule'],
    symptomes: { toux: 2, eternuements: 2, rales: 2, ecoulement_nasal: 1, yeux_ecoulement: 1, baisse_ponte: 2, oeufs_deformes: 3 },
    resume: 'Maladie virale respiratoire : toux, râles, et chez les pondeuses œufs déformés et baisse de ponte.',
    conduite: CONDUITE_GENERALE,
    declaration: null,
  },
  {
    code: 'coryza', nom: 'Coryza infectieux', especes: ['poule'],
    symptomes: { yeux_gonfles: 3, ecoulement_nasal: 3, eternuements: 1, odeur_forte: 2, baisse_ponte: 1, bec_ouvert: 1 },
    resume: 'Maladie bactérienne : face gonflée, écoulement du nez et des yeux, mauvaise odeur.',
    conduite: CONDUITE_GENERALE,
    declaration: null,
  },
  {
    code: 'coccidiose', nom: 'Coccidiose', especes: [],
    symptomes: { diarrhee_sanglante: 4, diarrhee: 2, apathie: 1, plumes_ebouriffees: 2, perte_appetit: 1, amaigrissement: 1, crete_pale: 1, mortalite_elevee: 1 },
    resume: 'Maladie parasitaire de l’intestin, fréquente chez les jeunes et sur litière humide : fientes sanglantes, abattement.',
    conduite: 'Gardez la litière sèche et propre, isolez les malades et demandez à un vétérinaire le traitement adapté.',
    declaration: null,
  },
  {
    code: 'marek', nom: 'Maladie de Marek', especes: ['poule'],
    symptomes: { paralysie: 4, boiterie: 2, oeil_gris: 3, amaigrissement: 1, crete_pale: 1 },
    resume: 'Maladie virale des jeunes poules (2 à 6 mois) : paralysie des pattes ou des ailes, œil gris.',
    conduite: 'Pas de traitement ; la vaccination des poussins à l’éclosion la prévient. Isolez et réformez les atteints, avis vétérinaire conseillé.',
    declaration: null,
  },
  {
    code: 'variole', nom: 'Variole aviaire', especes: [],
    symptomes: { croutes: 4, lesions_bouche: 3, yeux_gonfles: 1, perte_appetit: 1 },
    resume: 'Maladie virale : croûtes sur la crête et la face, ou plaques dans la bouche.',
    conduite: CONDUITE_GENERALE,
    declaration: null,
  },
  {
    code: 'enterite_ulcereuse', nom: 'Entérite ulcéreuse', especes: ['caille'],
    symptomes: { mort_brutale: 2, diarrhee: 2, apathie: 2, plumes_ebouriffees: 1, perte_appetit: 1, mortalite_elevee: 2 },
    resume: 'Maladie bactérienne surtout vue chez la caille : morts brutales, diarrhée, abattement.',
    conduite: CONDUITE_GENERALE,
    declaration: null,
  },
  {
    code: 'parasites_externes', nom: 'Poux ou acariens', especes: [],
    symptomes: { demangeaisons: 3, plumes_abimees: 2, parasites_visibles: 4, crete_pale: 1, baisse_ponte: 1, amaigrissement: 1 },
    resume: 'Parasites externes : grattage, plumes abîmées, parfois anémie.',
    conduite: 'Examinez la base des plumes et les perchoirs ; nettoyez le local et demandez un traitement antiparasitaire adapté.',
    declaration: null,
  },
  {
    code: 'vers', nom: 'Vers intestinaux', especes: [],
    symptomes: { amaigrissement: 3, vers_visibles: 3, diarrhee: 1, apathie: 1, plumes_ebouriffees: 1, baisse_ponte: 1 },
    resume: 'Parasites internes : amaigrissement malgré l’appétit, parfois vers dans les fientes.',
    conduite: 'Un déparasitage régulier est prévu dans le calendrier ; demandez la molécule et la dose à un vétérinaire.',
    declaration: null,
  },
  {
    code: 'chaleur', nom: 'Coup de chaleur', especes: [],
    symptomes: { bec_ouvert: 2, soif_intense: 3, apathie: 1, baisse_ponte: 2, oeufs_deformes: 1, mort_brutale: 1 },
    resume: 'Pas une infection : respiration bec ouvert, soif intense, baisse de ponte en période de forte chaleur.',
    conduite: 'Donnez de l’eau fraîche en abondance, de l’ombre et de la ventilation ; évitez de manipuler les animaux aux heures chaudes.',
    declaration: null,
  },
];

export const maladiePar = (code: string): Maladie | undefined => MALADIES.find((m) => m.code === code);

export interface PistesDiagnostic {
  maladie: Maladie;
  /** Part du poids des symptômes de la maladie retrouvée chez l'animal, de 0 à 100. */
  correspondance: number;
  retrouves: string[];
}

/**
 * Pistes à vérifier, classées. Ce n'est jamais un diagnostic : seul un vétérinaire peut en poser un.
 * Une maladie sort si au moins deux des symptômes choisis lui correspondent (un seul si un seul est choisi).
 */
export function pistesDiagnostic(symptomes: string[], especeCode?: string): PistesDiagnostic[] {
  const choisis = new Set(symptomes);
  if (choisis.size === 0) return [];
  const minimum = choisis.size === 1 ? 1 : 2;
  const out: PistesDiagnostic[] = [];
  for (const m of MALADIES) {
    if (especeCode && m.especes.length > 0 && !m.especes.includes(especeCode)) continue;
    const retrouves = Object.keys(m.symptomes).filter((c) => choisis.has(c));
    if (retrouves.length < minimum) continue;
    const total = Object.values(m.symptomes).reduce((a, b) => a + b, 0);
    const vu = retrouves.reduce((a, c) => a + (m.symptomes[c] ?? 0), 0);
    out.push({ maladie: m, correspondance: Math.round((vu / total) * 100), retrouves });
  }
  return out.sort((a, b) => b.correspondance - a.correspondance || a.maladie.nom.localeCompare(b.maladie.nom)).slice(0, 4);
}

/* ---------- Traitements et délais d'attente ---------- */

/** Dernier jour d'un traitement ou d'une quarantaine. */
export function finEvenement(e: EvenementSante): Jour {
  return ajouterJours(e.date, Math.max(1, e.dureeJours ?? 1) - 1);
}

export interface DelaiAttente {
  evenement: EvenementSante;
  /** Dernier jour pendant lequel œufs et viande ne doivent être ni consommés ni vendus. */
  jusqua: Jour;
  /** Le traitement dure encore. */
  enCours: boolean;
}

/** Traitements en cours ou dont le délai d'attente n'est pas écoulé. */
export function delaisEnCours(evenements: EvenementSante[], aujourdhui: Jour): DelaiAttente[] {
  const out: DelaiAttente[] = [];
  for (const e of vivants(evenements)) {
    if (e.type !== 'traitement' || e.date > aujourdhui) continue;
    const fin = finEvenement(e);
    const jusqua = ajouterJours(fin, e.delaiAttenteJours ?? 0);
    if ((e.delaiAttenteJours ?? 0) > 0 && aujourdhui <= jusqua) out.push({ evenement: e, jusqua, enCours: aujourdhui <= fin });
  }
  return out.sort((a, b) => a.jusqua.localeCompare(b.jusqua));
}

export function quarantainesEnCours(evenements: EvenementSante[], aujourdhui: Jour): { evenement: EvenementSante; jusqua: Jour }[] {
  return vivants(evenements)
    .filter((e) => e.type === 'quarantaine' && e.date <= aujourdhui && aujourdhui <= finEvenement(e))
    .map((e) => ({ evenement: e, jusqua: finEvenement(e) }));
}

/* ---------- Calendrier de vaccination ---------- */

/**
 * Exemple de départ, à faire valider par un vétérinaire pour chaque espèce et chaque région.
 * La vaccination contre Newcastle et Gumboro est présentée comme obligatoire au Sénégal par les sources consultées.
 */
export const PROTOCOLES_PAR_DEFAUT: ProtocoleVaccin[] = [
  { id: 'poule-newcastle-1', nom: 'Newcastle (1re dose)', especeCode: 'poule', ageJours: 7, repeterTousLesJours: null },
  { id: 'poule-gumboro-1', nom: 'Gumboro (1re dose)', especeCode: 'poule', ageJours: 14, repeterTousLesJours: null },
  { id: 'poule-gumboro-2', nom: 'Gumboro (rappel)', especeCode: 'poule', ageJours: 21, repeterTousLesJours: null },
  { id: 'poule-newcastle-2', nom: 'Newcastle (rappel)', especeCode: 'poule', ageJours: 21, repeterTousLesJours: 90 },
];

export type StatutVaccin = 'bientot' | 'aujourdhui' | 'retard' | 'a_renseigner';

export interface VaccinDu {
  lot: Lot;
  protocole: ProtocoleVaccin;
  /** Date prévue de la prochaine dose. */
  date: Jour;
  statut: StatutVaccin;
  /** Jours de retard (statut « retard »). */
  retard: number;
  /** Jours avant la dose (statut « bientot »). */
  dans: number;
}

export const VACCIN_AVERTISSEMENT_JOURS = 3;
/** Au-delà de ce retard sans aucune dose notée, on demande de renseigner l'historique plutôt que d'alerter. */
export const VACCIN_RETARD_MAX_JOURS = 30;

/**
 * Prochaines doses de chaque lot actif, selon le calendrier. Les lots sans date de naissance ne sont pas suivis.
 * Sans dose notée : première dose à `naissance + âge`. Avec une dose notée : rappel si le protocole en prévoit un.
 */
export function vaccinsAFaire(lots: Lot[], mouvements: Mouvement[], evenements: EvenementSante[], protocoles: ProtocoleVaccin[], aujourdhui: Jour): VaccinDu[] {
  const eff = effectifs(mouvements);
  const out: VaccinDu[] = [];
  for (const lot of vivants(lots)) {
    if (lot.archive || (eff.get(lot.id) ?? 0) <= 0) continue;
    for (const p of protocoles) {
      if (p.especeCode !== lot.especeCode) continue;
      const faits = vivants(evenements).filter((e) => e.type === 'vaccin' && e.lotId === lot.id && e.protocoleId === p.id).map((e) => e.date).sort();
      const dernier = faits.at(-1);
      let date: Jour;
      if (dernier) {
        if (!p.repeterTousLesJours) continue;
        date = ajouterJours(dernier, p.repeterTousLesJours);
      } else {
        if (!lot.naissance) continue;
        date = ajouterJours(lot.naissance, p.ageJours);
      }
      const ecart = ecartJours(date, aujourdhui);
      let statut: StatutVaccin | null = null;
      if (ecart === 0) statut = 'aujourdhui';
      else if (ecart > 0) statut = !dernier && ecart > VACCIN_RETARD_MAX_JOURS ? 'a_renseigner' : 'retard';
      else if (-ecart <= VACCIN_AVERTISSEMENT_JOURS) statut = 'bientot';
      if (statut) out.push({ lot, protocole: p, date, statut, retard: Math.max(ecart, 0), dans: Math.max(-ecart, 0) });
    }
  }
  const ordre: Record<StatutVaccin, number> = { retard: 0, aujourdhui: 1, bientot: 2, a_renseigner: 3 };
  return out.sort((a, b) => ordre[a.statut] - ordre[b.statut] || a.date.localeCompare(b.date));
}

/* ---------- Remèdes essayés ---------- */

export interface BilanRemede {
  nom: string;
  essais: number;
  gueri: number;
  ameliore: number;
  sansEffet: number;
  sansResultat: number;
}

/** Résume, par produit, ce qui a été essayé et ce que l'éleveur en a retenu. */
export function bilanRemedes(evenements: EvenementSante[]): BilanRemede[] {
  const par = new Map<string, BilanRemede>();
  for (const e of vivants(evenements)) {
    if (e.type !== 'traitement' || !e.nom?.trim()) continue;
    const cle = e.nom.trim().toLowerCase();
    const b = par.get(cle) ?? { nom: e.nom.trim(), essais: 0, gueri: 0, ameliore: 0, sansEffet: 0, sansResultat: 0 };
    b.essais += 1;
    if (e.resultat === 'gueri') b.gueri += 1;
    else if (e.resultat === 'ameliore') b.ameliore += 1;
    else if (e.resultat === 'sans_effet') b.sansEffet += 1;
    else b.sansResultat += 1;
    par.set(cle, b);
  }
  return [...par.values()].sort((a, b) => b.essais - a.essais || a.nom.localeCompare(b.nom));
}
