import { ecartJours, type Jour } from './dates';
import { effectifs } from './effectif';
import { finEvenement, maladiePar } from './sante';
import type { DonneesElevage, EspeceConfig, Lot } from './types';

/** Rubriques que le vendeur peut montrer ou cacher. */
export type RubriqueFiche = 'identite' | 'origine' | 'sante' | 'mortalite' | 'production';

export const RUBRIQUES_FICHE: Record<RubriqueFiche, string> = {
  identite: 'Identité (espèce, race, âge, effectif)',
  origine: 'Origine (naissance, provenance)',
  sante: 'Santé (vaccins, traitements, observations)',
  mortalite: 'Mortalité du lot',
  production: 'Production d’œufs',
};

export interface LigneSante {
  date: Jour;
  type: 'vaccin' | 'traitement' | 'observation' | 'quarantaine';
  texte: string;
}

/** Contenu figé d'une fiche de suivi : ce que l'acheteur verra, rien de plus. Aucune donnée financière. */
export interface FicheSuivi {
  version: 1;
  genereLe: Jour;
  /** « declaratif » : informations saisies par l'éleveur, non vérifiées. */
  mention: 'declaratif';
  nom: string;
  identite?: { espece: string; race?: string; effectif: number; ageJours?: number };
  origine?: { naissance?: Jour; incubation?: string };
  sante?: LigneSante[];
  mortalite?: { deces: number; tauxPct: number };
  production?: { oeufs30j: number };
}

/** Assemble la fiche d'un lot avec les seules rubriques choisies. */
export function construireFiche(lot: Lot, donnees: DonneesElevage, especes: Record<string, EspeceConfig>, rubriques: RubriqueFiche[], aujourdhui: Jour): FicheSuivi {
  const choix = new Set(rubriques);
  const vivants = <T extends { supprimeLe?: number | null }>(xs: T[]) => xs.filter((x) => !x.supprimeLe);
  const effectif = effectifs(vivants(donnees.mouvements)).get(lot.id) ?? 0;
  const fiche: FicheSuivi = { version: 1, genereLe: aujourdhui, mention: 'declaratif', nom: lot.nom };

  if (choix.has('identite')) {
    fiche.identite = {
      espece: especes[lot.especeCode]?.nom ?? lot.especeCode,
      effectif,
      ...(lot.race ? { race: lot.race } : {}),
      ...(lot.naissance ? { ageJours: Math.max(0, ecartJours(lot.naissance, aujourdhui)) } : {}),
    };
  }
  if (choix.has('origine')) {
    const inc = lot.incubationId ? donnees.incubations.find((i) => i.id === lot.incubationId) : undefined;
    fiche.origine = { ...(lot.naissance ? { naissance: lot.naissance } : {}), ...(inc ? { incubation: inc.origine ? `${inc.nom} (${inc.origine})` : inc.nom } : {}) };
  }
  if (choix.has('sante')) {
    fiche.sante = vivants(donnees.evenementsSante)
      .filter((e) => e.lotId === lot.id)
      .map((e): LigneSante => {
        if (e.type === 'vaccin') return { date: e.date, type: 'vaccin', texte: `Vaccin : ${e.nom ?? 'non précisé'}` };
        if (e.type === 'traitement') {
          const delai = e.delaiAttenteJours ? `, délai d’attente ${e.delaiAttenteJours} j après le ${finEvenement(e)}` : '';
          return { date: e.date, type: 'traitement', texte: `Traitement : ${e.nom ?? 'non précisé'}${delai}` };
        }
        if (e.type === 'quarantaine') return { date: e.date, type: 'quarantaine', texte: `Quarantaine de ${e.dureeJours ?? 1} jour(s)` };
        const maladie = e.maladie ? maladiePar(e.maladie)?.nom : undefined;
        return { date: e.date, type: 'observation', texte: `Observation${maladie ? ` : ${maladie} soupçonnée` : ''}` };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  if (choix.has('mortalite')) {
    const deces = vivants(donnees.mouvements).filter((m) => m.lotId === lot.id && m.type === 'deces').reduce((a, m) => a - m.quantite, 0);
    const base = effectif + deces;
    fiche.mortalite = { deces, tauxPct: base > 0 ? Math.round((deces / base) * 1000) / 10 : 0 };
  }
  if (choix.has('production')) {
    const debut = new Date(`${aujourdhui}T12:00:00Z`);
    debut.setUTCDate(debut.getUTCDate() - 29);
    const d0 = debut.toISOString().slice(0, 10);
    fiche.production = { oeufs30j: vivants(donnees.pontes).filter((p) => p.lotId === lot.id && p.date >= d0 && p.date <= aujourdhui).reduce((a, p) => a + p.nombre, 0) };
  }
  return fiche;
}

const enBase64Url = (octets: Uint8Array): string => {
  let bin = '';
  for (const o of octets) bin += String.fromCharCode(o);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Encode une fiche dans un texte utilisable dans un lien. */
export function encoderFiche(f: FicheSuivi): string {
  return enBase64Url(new TextEncoder().encode(JSON.stringify(f)));
}

/** Relit une fiche depuis un lien ; `null` si le texte n'est pas une fiche valide. */
export function decoderFiche(jeton: string): FicheSuivi | null {
  try {
    const b64 = jeton.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const obj = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as Partial<FicheSuivi>;
    if (obj.version !== 1 || obj.mention !== 'declaratif' || typeof obj.nom !== 'string' || typeof obj.genereLe !== 'string') return null;
    return obj as FicheSuivi;
  } catch {
    return null;
  }
}
