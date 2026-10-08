import { ajouterJours, ecartJours, jourLocal, type Jour } from './dates';
import { effectifs } from './effectif';
import { enAttente, enRetard, lignesFinance, resume, suiviSalaires, type Employe, type OperationFinanciere, type Paiement } from './finances';
import { etapesIncubation, incubationsEnCours, oeufsRestants, profilDe } from './incubation';
import { quarantainesActives } from './quarantaine';
import { delaisEnCours, finEvenement, vaccinsAFaire } from './sante';
import type { DonneesElevage, EspeceConfig, ProtocoleVaccin, TypeLogement } from './types';

/** Repères d'âge indicatifs, communs à toutes les espèces. */
export const AGE_POUSSIN_MAX_JOURS = 28;
export const AGE_JEUNE_MAX_JOURS = 120;

export interface LigneLocal {
  logementId: string;
  nom: string;
  type: TypeLogement;
  surfaceM2: number | null;
  effectif: number;
  lots: { lotId: string; nom: string; effectif: number }[];
  /** Part de la place conseillée occupée, en %, ou `null` sans surface. */
  densitePct: number | null;
}

export interface TableauDeBord {
  cheptel: {
    total: number;
    lotsActifs: number;
    parEspece: { code: string; nom: string; effectif: number; lots: number }[];
    parRace: { espece: string; race: string; effectif: number }[];
    parAge: { poussins: number; jeunes: number; adultes: number; inconnu: number };
    enQuarantaine: number;
  };
  locaux: LigneLocal[];
  sansLocal: { effectif: number; lots: number };
  production: {
    oeufsAujourdhui: number;
    oeufs7j: { jour: Jour; n: number }[];
    /** Œufs des 7 derniers jours par pondeuse et par jour, en %. */
    tauxPonte7jPct: number | null;
  };
  incubation: { misesEnCours: number; oeufsEnCours: number; prochaineEclosion: { date: Jour; nom: string } | null };
  finances: {
    recettesTotal: number;
    depensesTotal: number;
    resultatTotal: number;
    recettesMois: number;
    depensesMois: number;
    resultatMois: number;
    aEncaisser: number;
    aPayer: number;
    /** Factures dont la date limite est dépassée. */
    enRetard: number;
    /** Employés dont le salaire du mois n'est pas soldé (rappel à partir du 25). */
    salairesAPayer: number;
  };
  sante: { vaccinsAFaire: number; traitementsEnCours: number; delaisAttente: number };
}

interface Entree {
  donnees: DonneesElevage;
  operations: OperationFinanciere[];
  paiements?: Paiement[];
  employes?: Employe[];
  especes: Record<string, EspeceConfig>;
  protocoles: ProtocoleVaccin[];
  maintenant: Date;
}

const vivants = <T extends { supprimeLe?: number | null }>(xs: T[]) => xs.filter((x) => !x.supprimeLe);

/** Rassemble en un seul calcul tout ce que montre le tableau de bord de l'accueil. */
export function tableauDeBord({ donnees, operations, paiements = [], employes = [], especes, protocoles, maintenant }: Entree): TableauDeBord {
  const auj = jourLocal(maintenant);
  const eff = effectifs(donnees.mouvements);
  const lots = vivants(donnees.lots).filter((l) => !l.archive && (eff.get(l.id) ?? 0) > 0);
  const effectifLot = (id: string) => eff.get(id) ?? 0;

  // Cheptel
  const especeMap = new Map<string, { code: string; nom: string; effectif: number; lots: number }>();
  const raceMap = new Map<string, { espece: string; race: string; effectif: number }>();
  const parAge = { poussins: 0, jeunes: 0, adultes: 0, inconnu: 0 };
  for (const l of lots) {
    const n = effectifLot(l.id);
    const nom = especes[l.especeCode]?.nom ?? l.especeCode;
    const e = especeMap.get(l.especeCode) ?? { code: l.especeCode, nom, effectif: 0, lots: 0 };
    e.effectif += n;
    e.lots += 1;
    especeMap.set(l.especeCode, e);
    const race = l.race?.trim() || 'Race non précisée';
    const cleRace = `${l.especeCode}|${race}`;
    const r = raceMap.get(cleRace) ?? { espece: nom, race, effectif: 0 };
    r.effectif += n;
    raceMap.set(cleRace, r);
    if (!l.naissance) parAge.inconnu += n;
    else {
      const age = ecartJours(l.naissance, auj);
      if (age < AGE_POUSSIN_MAX_JOURS) parAge.poussins += n;
      else if (age < AGE_JEUNE_MAX_JOURS) parAge.jeunes += n;
      else parAge.adultes += n;
    }
  }
  const lotsEnQuarantaine = new Set(quarantainesActives(donnees.quarantaines).map((q) => q.lotId));
  const enQuarantaine = lots.filter((l) => lotsEnQuarantaine.has(l.id)).reduce((a, l) => a + effectifLot(l.id), 0);

  // Locaux
  const locaux: LigneLocal[] = vivants(donnees.logements).map((lg) => {
    const dedans = lots.filter((l) => l.logementId === lg.id);
    const besoin = dedans.reduce((a, l) => a + effectifLot(l.id) * (especes[l.especeCode]?.m2ParAnimal ?? 0), 0);
    return {
      logementId: lg.id, nom: lg.nom, type: lg.type, surfaceM2: lg.surfaceM2 ?? null,
      effectif: dedans.reduce((a, l) => a + effectifLot(l.id), 0),
      lots: dedans.map((l) => ({ lotId: l.id, nom: l.nom, effectif: effectifLot(l.id) })),
      densitePct: lg.surfaceM2 && lg.surfaceM2 > 0 ? Math.round((besoin / lg.surfaceM2) * 100) : null,
    };
  }).sort((a, b) => a.type.localeCompare(b.type) || a.nom.localeCompare(b.nom));
  const idsLocaux = new Set(locaux.map((l) => l.logementId));
  const orphelins = lots.filter((l) => !l.logementId || !idsLocaux.has(l.logementId));

  // Production
  const pondeuses = lots.filter((l) => especes[l.especeCode]?.pondeuse);
  const oeufs7j = Array.from({ length: 7 }, (_, i) => {
    const jour = ajouterJours(auj, i - 6);
    return { jour, n: vivants(donnees.pontes).filter((p) => p.date === jour).reduce((a, p) => a + p.nombre, 0) };
  });
  const total7j = oeufs7j.reduce((a, x) => a + x.n, 0);
  const nbPondeuses = pondeuses.reduce((a, l) => a + effectifLot(l.id), 0);

  // Incubation
  const enCours = incubationsEnCours(donnees.incubations);
  let prochaineEclosion: { date: Jour; nom: string } | null = null;
  for (const inc of enCours) {
    const profil = profilDe(especes, inc.especeCode);
    if (!profil) continue;
    const date = etapesIncubation(inc, profil, false).find((e) => e.type === 'eclosion')?.date;
    if (date && (!prochaineEclosion || date < prochaineEclosion.date)) prochaineEclosion = { date, nom: inc.nom };
  }

  // Finances
  const lignes = lignesFinance(operations, donnees.entreesStock, paiements);
  const tout = resume(lignes);
  const mois = resume(lignes, auj.slice(0, 7));
  const attente = enAttente(lignes);
  // Les salaires du mois se rappellent à partir du 25.
  const salairesAPayer = Number(auj.slice(8, 10)) >= 25 ? suiviSalaires(employes, operations, auj.slice(0, 7)).filter((x) => x.statut !== 'paye').length : 0;

  // Santé
  const vaccins = vaccinsAFaire(donnees.lots, donnees.mouvements, donnees.evenementsSante, protocoles, auj).filter((v) => v.statut !== 'a_renseigner');
  const traitements = vivants(donnees.evenementsSante).filter((e) => e.type === 'traitement' && e.date <= auj && auj <= finEvenement(e)).length;

  return {
    cheptel: {
      total: lots.reduce((a, l) => a + effectifLot(l.id), 0),
      lotsActifs: lots.length,
      parEspece: [...especeMap.values()].sort((a, b) => b.effectif - a.effectif),
      parRace: [...raceMap.values()].sort((a, b) => b.effectif - a.effectif),
      parAge,
      enQuarantaine,
    },
    locaux,
    sansLocal: { effectif: orphelins.reduce((a, l) => a + effectifLot(l.id), 0), lots: orphelins.length },
    production: {
      oeufsAujourdhui: oeufs7j.at(-1)?.n ?? 0,
      oeufs7j,
      tauxPonte7jPct: nbPondeuses > 0 && total7j > 0 ? Math.round((total7j / (nbPondeuses * 7)) * 100) : null,
    },
    incubation: { misesEnCours: enCours.length, oeufsEnCours: enCours.reduce((a, i) => a + oeufsRestants(i, donnees.mirages, auj), 0), prochaineEclosion },
    finances: {
      recettesTotal: tout.recettes, depensesTotal: tout.depenses, resultatTotal: tout.resultat,
      recettesMois: mois.recettes, depensesMois: mois.depenses, resultatMois: mois.resultat,
      aEncaisser: attente.totalAEncaisser, aPayer: attente.totalAPayer,
      enRetard: lignes.filter((l) => enRetard(l, auj)).length,
      salairesAPayer,
    },
    sante: { vaccinsAFaire: vaccins.length, traitementsEnCours: traitements, delaisAttente: delaisEnCours(donnees.evenementsSante, auj).length },
  };
}
