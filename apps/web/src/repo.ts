import { effectifs, jourLocal, type Jour, type Lot, type TypeLogement, type TypeMouvement } from '@digitalab/core';
import { db, TABLES_DONNEES, type BaseElevage } from './db';

export class ErreurSaisie extends Error {}

export const nouvelId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const maintenant = () => Date.now();
export const aujourdhui = (): Jour => jourLocal(new Date());

export type TableAnnulable = 'mouvements' | 'pontes' | 'distributions' | 'entreesStock';

/** Référence d'un enregistrement créé, pour pouvoir l'annuler juste après. */
export interface Annulation {
  table: TableAnnulable;
  id: string;
}

function entierPositif(n: number, libelle: string): number {
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) throw new ErreurSaisie(`${libelle} : entrez un nombre entier supérieur à zéro.`);
  return n;
}

function decimalPositif(n: number, libelle: string): number {
  if (!Number.isFinite(n) || n <= 0) throw new ErreurSaisie(`${libelle} : entrez un nombre supérieur à zéro.`);
  return n;
}

export function creerRepo(base: BaseElevage = db) {
  const effectifLot = async (lotId: string): Promise<number> => {
    const m = await base.mouvements.where('lotId').equals(lotId).toArray();
    return effectifs(m).get(lotId) ?? 0;
  };

  const ajouterMouvement = async (lotId: string, type: TypeMouvement, quantite: number, extra: { cause?: string; note?: string; date?: Jour } = {}): Promise<Annulation> => {
    const id = nouvelId();
    await base.mouvements.add({ id, misAJour: maintenant(), lotId, type, quantite, date: extra.date ?? aujourdhui(), ...(extra.cause ? { cause: extra.cause } : {}), ...(extra.note ? { note: extra.note } : {}) });
    return { table: 'mouvements', id };
  };

  return {
    async creerLogement(d: { nom: string; type: TypeLogement; surfaceM2?: number | null }): Promise<string> {
      const nom = d.nom.trim();
      if (!nom) throw new ErreurSaisie('Donnez un nom au local.');
      const id = nouvelId();
      await base.logements.add({ id, misAJour: maintenant(), nom, type: d.type, surfaceM2: d.surfaceM2 ?? null });
      return id;
    },

    async modifierLogement(id: string, d: { nom: string; type: TypeLogement; surfaceM2?: number | null }): Promise<void> {
      const nom = d.nom.trim();
      if (!nom) throw new ErreurSaisie('Donnez un nom au local.');
      await base.logements.update(id, { nom, type: d.type, surfaceM2: d.surfaceM2 ?? null, misAJour: maintenant() });
    },

    async supprimerLogement(id: string): Promise<void> {
      const occupe = (await base.lots.where('logementId').equals(id).toArray()).some((l) => !l.supprimeLe && !l.archive);
      if (occupe) throw new ErreurSaisie('Ce local contient encore des lots. Déplacez-les d’abord.');
      await base.logements.update(id, { supprimeLe: maintenant(), misAJour: maintenant() });
    },

    /** Crée un lot et enregistre son effectif de départ dans le journal. */
    async creerLot(d: { nom: string; especeCode: string; race?: string; naissance?: Jour; logementId?: string | null; effectif: number }): Promise<string> {
      const nom = d.nom.trim();
      if (!nom) throw new ErreurSaisie('Donnez un nom au lot.');
      const effectif = entierPositif(d.effectif, 'Nombre d’animaux');
      const id = nouvelId();
      const lot: Lot = { id, misAJour: maintenant(), nom, especeCode: d.especeCode, logementId: d.logementId ?? null, ...(d.race?.trim() ? { race: d.race.trim() } : {}), ...(d.naissance ? { naissance: d.naissance } : {}) };
      await base.transaction('rw', base.lots, base.mouvements, async () => {
        await base.lots.add(lot);
        await ajouterMouvement(id, 'arrivee', effectif, { note: 'Effectif de départ' });
      });
      return id;
    },

    async ajouterAnimaux(lotId: string, nombre: number, type: 'arrivee' | 'naissance' = 'arrivee'): Promise<Annulation> {
      return ajouterMouvement(lotId, type, entierPositif(nombre, 'Nombre d’animaux'));
    },

    async changerLogement(lotId: string, logementId: string | null): Promise<void> {
      await base.lots.update(lotId, { logementId, misAJour: maintenant() });
    },

    async archiverLot(lotId: string): Promise<void> {
      if ((await effectifLot(lotId)) > 0) throw new ErreurSaisie('Ce lot compte encore des animaux. Enregistrez leur sortie avant de l’archiver.');
      await base.lots.update(lotId, { archive: true, misAJour: maintenant() });
    },

    async ajouterPonte(d: { lotId: string; nombre: number; casses?: number; date?: Jour }): Promise<Annulation> {
      if (!Number.isInteger(d.nombre) || d.nombre < 0) throw new ErreurSaisie('Œufs : entrez un nombre entier, zéro ou plus.');
      const casses = d.casses ?? 0;
      if (!Number.isInteger(casses) || casses < 0 || casses > d.nombre) throw new ErreurSaisie('Œufs cassés : le nombre doit être compris entre 0 et le nombre d’œufs.');
      const id = nouvelId();
      await base.pontes.add({ id, misAJour: maintenant(), lotId: d.lotId, date: d.date ?? aujourdhui(), nombre: d.nombre, casses });
      return { table: 'pontes', id };
    },

    async ajouterDistribution(d: { lotId: string; quantiteKg: number; date?: Jour }): Promise<Annulation> {
      const id = nouvelId();
      await base.distributions.add({ id, misAJour: maintenant(), lotId: d.lotId, date: d.date ?? aujourdhui(), quantiteKg: decimalPositif(d.quantiteKg, 'Quantité') });
      return { table: 'distributions', id };
    },

    async ajouterDeces(d: { lotId: string; nombre: number; cause?: string }): Promise<Annulation> {
      const n = entierPositif(d.nombre, 'Nombre de morts');
      const dispo = await effectifLot(d.lotId);
      if (n > dispo) throw new ErreurSaisie(`Ce lot ne compte que ${dispo} animaux.`);
      return ajouterMouvement(d.lotId, 'deces', -n, d.cause ? { cause: d.cause } : {});
    },

    async enregistrerSortie(d: { lotId: string; type: 'vente' | 'reforme'; nombre: number }): Promise<Annulation> {
      const n = entierPositif(d.nombre, 'Nombre d’animaux');
      const dispo = await effectifLot(d.lotId);
      if (n > dispo) throw new ErreurSaisie(`Ce lot ne compte que ${dispo} animaux.`);
      return ajouterMouvement(d.lotId, d.type, -n);
    },

    /** Corrige l'effectif après un comptage physique. */
    async corrigerEffectif(lotId: string, effectifReel: number): Promise<Annulation | null> {
      if (!Number.isInteger(effectifReel) || effectifReel < 0) throw new ErreurSaisie('Entrez le nombre d’animaux comptés.');
      const ecart = effectifReel - (await effectifLot(lotId));
      if (ecart === 0) return null;
      return ajouterMouvement(lotId, 'correction', ecart, { note: 'Comptage' });
    },

    async ajouterAchatAliment(d: { quantiteKg: number; prixTotal?: number | null }): Promise<Annulation> {
      const id = nouvelId();
      await base.entreesStock.add({ id, misAJour: maintenant(), date: aujourdhui(), quantiteKg: decimalPositif(d.quantiteKg, 'Quantité'), prixTotal: d.prixTotal ?? null });
      return { table: 'entreesStock', id };
    },

    /** Aligne le stock sur un comptage : enregistre l'écart (positif ou négatif). */
    async corrigerStock(stockActuelKg: number, stockReelKg: number): Promise<Annulation | null> {
      if (!Number.isFinite(stockReelKg) || stockReelKg < 0) throw new ErreurSaisie('Entrez le stock compté, en kg.');
      const ecart = Math.round((stockReelKg - stockActuelKg) * 100) / 100;
      if (ecart === 0) return null;
      const id = nouvelId();
      await base.entreesStock.add({ id, misAJour: maintenant(), date: aujourdhui(), quantiteKg: ecart, prixTotal: null });
      return { table: 'entreesStock', id };
    },

    /** Suppression logique : la ligne reste dans la base, l'historique est conservé. */
    async annuler(a: Annulation): Promise<void> {
      await base.table(a.table).update(a.id, { supprimeLe: maintenant(), misAJour: maintenant() });
    },

    async lireReglage<T>(cle: string, defaut: T): Promise<T> {
      const r = await base.reglages.get(cle);
      return r ? (r.valeur as T) : defaut;
    },

    async ecrireReglage(cle: string, valeur: unknown): Promise<void> {
      await base.reglages.put({ cle, valeur });
    },

    async prendreEnCharge(cle: string): Promise<void> {
      await base.etatsAlertes.put({ cle, statut: 'prise_en_charge' });
    },

    async reporterAlerte(cle: string, jusqua: number): Promise<void> {
      await base.etatsAlertes.put({ cle, statut: 'reportee', jusqua });
    },

    async rouvrirAlerte(cle: string): Promise<void> {
      await base.etatsAlertes.delete(cle);
    },

    async exporter(): Promise<string> {
      const dump: Record<string, unknown[]> = {};
      for (const t of TABLES_DONNEES) dump[t] = await base.table(t).toArray();
      return JSON.stringify({ application: 'digitalab', version: 1, exporteLe: new Date().toISOString(), donnees: dump });
    },

    /** Remplace toutes les données par celles d'une sauvegarde. */
    async importer(json: string): Promise<void> {
      let obj: { application?: string; donnees?: Record<string, unknown[]> };
      try {
        obj = JSON.parse(json);
      } catch {
        throw new ErreurSaisie('Ce fichier n’est pas une sauvegarde valide.');
      }
      if (obj.application !== 'digitalab' || !obj.donnees) throw new ErreurSaisie('Ce fichier n’est pas une sauvegarde Digitalab.');
      const donnees = obj.donnees;
      await base.transaction('rw', TABLES_DONNEES.map((t) => base.table(t)), async () => {
        for (const t of TABLES_DONNEES) {
          await base.table(t).clear();
          const lignes = donnees[t];
          if (Array.isArray(lignes) && lignes.length) await base.table(t).bulkAdd(lignes);
        }
      });
    },

    async toutEffacer(): Promise<void> {
      await base.transaction('rw', TABLES_DONNEES.map((t) => base.table(t)), async () => {
        for (const t of TABLES_DONNEES) await base.table(t).clear();
      });
    },
  };
}

export const repo = creerRepo();
export type Repo = ReturnType<typeof creerRepo>;
