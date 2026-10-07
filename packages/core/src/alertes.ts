import { ajouterJours, jourLocal } from './dates';
import { decesEntre, effectifs } from './effectif';
import { incubationsEnCours, profilDe, suivreEtapes } from './incubation';
import type {
  Alerte,
  DonneesElevage,
  EspeceConfig,
  Niveau,
  Ponte,
  Seuils,
} from './types';

export interface EntreeAlertes extends DonneesElevage {
  maintenant: Date;
  especes: Record<string, EspeceConfig>;
  seuils: Seuils;
}

const RANG: Record<Niveau, number> = { jaune: 1, orange: 2, rouge: 3 };
export const rangNiveau = (n: Niveau): number => RANG[n];

const arrondi = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const vivants = <T extends { supprimeLe?: number | null }>(xs: T[]) => xs.filter((x) => !x.supprimeLe);

/** Évalue toutes les règles de la phase 1 et renvoie les alertes, la plus grave d'abord. */
export function evaluerAlertes(e: EntreeAlertes): Alerte[] {
  const alertes: Alerte[] = [
    ...alertesDensite(e),
    ...alertesMortalite(e),
    ...alertesPonte(e),
    ...alertesStockAliment(e),
    ...alertesIncubation(e),
  ];
  return alertes.sort((a, b) => RANG[b.niveau] - RANG[a.niveau] || a.cle.localeCompare(b.cle));
}

function alertesDensite(e: EntreeAlertes): Alerte[] {
  const eff = effectifs(e.mouvements);
  const out: Alerte[] = [];
  for (const lg of vivants(e.logements)) {
    if (!lg.surfaceM2 || lg.surfaceM2 <= 0) continue;
    let besoin = 0;
    for (const lot of vivants(e.lots)) {
      if (lot.archive || lot.logementId !== lg.id) continue;
      const espece = e.especes[lot.especeCode];
      besoin += (eff.get(lot.id) ?? 0) * (espece?.m2ParAnimal ?? 0);
    }
    const ratio = besoin / lg.surfaceM2;
    const s = e.seuils.densite;
    const niveau: Niveau | null = ratio >= s.rouge ? 'rouge' : ratio >= s.orange ? 'orange' : ratio >= s.jaune ? 'jaune' : null;
    if (niveau) out.push({ cle: `densite:${lg.id}`, code: 'densite', niveau, logementId: lg.id, params: { pct: Math.round(ratio * 100) } });
  }
  return out;
}

function niveauMortalite(taux: number, deces: number, seuil: { orange: number; rouge: number }, minDeces: number): Niveau | null {
  if (deces <= 0) return null;
  if (taux >= seuil.rouge && deces >= minDeces) return 'rouge';
  if (taux >= seuil.orange && deces >= minDeces) return 'orange';
  // Un seul décès dans un petit lot : à noter, sans alarme.
  if (taux >= seuil.orange) return 'jaune';
  return null;
}

function alertesMortalite(e: EntreeAlertes): Alerte[] {
  const aujourdhui = jourLocal(e.maintenant);
  const eff = effectifs(e.mouvements);
  const out: Alerte[] = [];
  for (const lot of vivants(e.lots)) {
    if (lot.archive) continue;
    const reste = eff.get(lot.id) ?? 0;
    const candidats: { niveau: Niveau; jours: number; deces: number; taux: number }[] = [];
    for (const [jours, seuil] of [[1, e.seuils.mortalite1j], [7, e.seuils.mortalite7j]] as const) {
      const deces = decesEntre(e.mouvements, lot.id, ajouterJours(aujourdhui, -(jours - 1)), aujourdhui);
      const base = reste + deces;
      if (base <= 0) continue;
      const taux = (deces / base) * 100;
      const niveau = niveauMortalite(taux, deces, seuil, e.seuils.minDeces);
      if (niveau) candidats.push({ niveau, jours, deces, taux });
    }
    // Le niveau le plus grave l'emporte ; à égalité, la fenêtre la plus courte.
    candidats.sort((a, b) => RANG[b.niveau] - RANG[a.niveau] || a.jours - b.jours);
    const c = candidats[0];
    if (c) out.push({ cle: `mortalite:${lot.id}:${aujourdhui}`, code: 'mortalite', niveau: c.niveau, lotId: lot.id, params: { deces: c.deces, jours: c.jours, taux: arrondi(c.taux) } });
  }
  return out;
}

function totalParJour(pontes: Ponte[], lotId: string): Map<string, number> {
  const par = new Map<string, number>();
  for (const p of vivants(pontes)) if (p.lotId === lotId) par.set(p.date, (par.get(p.date) ?? 0) + p.nombre);
  return par;
}

function alertesPonte(e: EntreeAlertes): Alerte[] {
  const aujourdhui = jourLocal(e.maintenant);
  // La ponte du jour n'est comparée qu'une fois la collecte terminée.
  const jourBilan = e.maintenant.getHours() >= e.seuils.heureBilanPonte ? aujourdhui : ajouterJours(aujourdhui, -1);
  const out: Alerte[] = [];
  for (const lot of vivants(e.lots)) {
    if (lot.archive || !e.especes[lot.especeCode]?.pondeuse) continue;
    const parJour = totalParJour(e.pontes, lot.id);
    const valeur = parJour.get(jourBilan);
    if (valeur === undefined) continue;
    const precedents = [...parJour.entries()]
      .filter(([j]) => j < jourBilan && j >= ajouterJours(jourBilan, -7))
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 3)
      .map(([, n]) => n);
    if (precedents.length < 2) continue;
    const moyenne = precedents.reduce((a, b) => a + b, 0) / precedents.length;
    if (moyenne < 3) continue; // trop peu d'œufs pour conclure
    const ratio = valeur / moyenne;
    const niveau: Niveau | null = ratio < e.seuils.ponte.rouge ? 'rouge' : ratio < e.seuils.ponte.orange ? 'orange' : null;
    if (niveau) out.push({ cle: `chute_ponte:${lot.id}:${jourBilan}`, code: 'chute_ponte', niveau, lotId: lot.id, params: { valeur, moyenne: arrondi(moyenne), pct: Math.round(ratio * 100) } });
  }
  return out;
}

/** Stock d'aliment en kg : entrées moins distributions. */
export function stockAlimentKg(e: Pick<DonneesElevage, 'entreesStock' | 'distributions'>): number {
  const entrees = vivants(e.entreesStock).reduce((a, x) => a + x.quantiteKg, 0);
  const sorties = vivants(e.distributions).reduce((a, x) => a + x.quantiteKg, 0);
  return arrondi(entrees - sorties, 2);
}

/** Consommation moyenne par jour sur les 7 derniers jours (jours renseignés seulement). */
export function consommationMoyenneKg(e: Pick<DonneesElevage, 'distributions'>, aujourdhui: string): number | null {
  const debut = ajouterJours(aujourdhui, -6);
  const parJour = new Map<string, number>();
  for (const d of vivants(e.distributions)) {
    if (d.date >= debut && d.date <= aujourdhui) parJour.set(d.date, (parJour.get(d.date) ?? 0) + d.quantiteKg);
  }
  if (parJour.size === 0) return null;
  return [...parJour.values()].reduce((a, b) => a + b, 0) / parJour.size;
}

function alertesStockAliment(e: EntreeAlertes): Alerte[] {
  // Le suivi du stock est facultatif : sans aucune entrée enregistrée, aucune alerte.
  if (vivants(e.entreesStock).length === 0) return [];
  const aujourdhui = jourLocal(e.maintenant);
  const stock = stockAlimentKg(e);
  const conso = consommationMoyenneKg(e, aujourdhui);
  if (stock <= 0) return [{ cle: 'stock_aliment', code: 'stock_aliment', niveau: 'rouge', params: { stock: 0, jours: 0 } }];
  if (conso === null || conso <= 0) return [];
  const jours = stock / conso;
  const s = e.seuils.autonomieAliment;
  const niveau: Niveau | null = jours < s.orange ? 'orange' : jours < s.jaune ? 'jaune' : null;
  return niveau ? [{ cle: 'stock_aliment', code: 'stock_aliment', niveau, params: { stock, jours: arrondi(jours) } }] : [];
}

function alertesIncubation(e: EntreeAlertes): Alerte[] {
  const aujourdhui = jourLocal(e.maintenant);
  const out: Alerte[] = [];
  for (const inc of incubationsEnCours(e.incubations)) {
    const profil = profilDe(e.especes, inc.especeCode);
    if (!profil) continue;
    for (const etape of suivreEtapes(inc, profil, e.mirages, aujourdhui)) {
      if (etape.statut !== 'aujourdhui' && etape.statut !== 'retard') continue;
      out.push({
        cle: `incubation:${inc.id}:${etape.cle}`,
        code: 'incubation',
        niveau: etape.statut === 'retard' ? 'orange' : 'jaune',
        incubationId: inc.id,
        etape: etape.type,
        params: { jourJ: etape.jourJ, retard: etape.retard },
      });
    }
  }
  return out;
}
