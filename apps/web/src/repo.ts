import { effectifs, jourLocal, oeufsRestants, placesPourNouvelleMise, profilDe, type Jour, type Lot, type TypeCouveuse, type TypeLogement, type TypeMouvement } from '@digitalab/core';
import { db, TABLES_DONNEES, type BaseElevage } from './db';
import { fusionnerReglages } from './reglages';

export class ErreurSaisie extends Error {}

export const nouvelId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const maintenant = () => Date.now();
export const aujourdhui = (): Jour => jourLocal(new Date());

export type TableAnnulable = 'mouvements' | 'pontes' | 'distributions' | 'entreesStock' | 'mirages';

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

function nettoyerCapacites(c: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(c)) {
    if (v !== undefined && v !== null && (!Number.isInteger(v) || v <= 0)) throw new ErreurSaisie('Capacité : entrez un nombre d’œufs entier supérieur à zéro, ou laissez vide.');
    if (v > 0) out[k] = v;
  }
  return out;
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

        /* ---------- Incubation ---------- */

    async creerCouveuse(d: { nom: string; type: TypeCouveuse; capacites: Record<string, number>; eclosoirSepare: boolean }): Promise<string> {
      const nom = d.nom.trim();
      if (!nom) throw new ErreurSaisie('Donnez un nom à la couveuse.');
      const id = nouvelId();
      await base.couveuses.add({ id, misAJour: maintenant(), nom, type: d.type, capacites: nettoyerCapacites(d.capacites), eclosoirSepare: d.eclosoirSepare });
      return id;
    },

    async modifierCouveuse(id: string, d: { nom: string; type: TypeCouveuse; capacites: Record<string, number>; eclosoirSepare: boolean }): Promise<void> {
      const nom = d.nom.trim();
      if (!nom) throw new ErreurSaisie('Donnez un nom à la couveuse.');
      await base.couveuses.update(id, { nom, type: d.type, capacites: nettoyerCapacites(d.capacites), eclosoirSepare: d.eclosoirSepare, misAJour: maintenant() });
    },

    async supprimerCouveuse(id: string): Promise<void> {
      const enCours = (await base.incubations.where('couveuseId').equals(id).toArray()).some((i) => !i.supprimeLe && !i.eclosion);
      if (enCours) throw new ErreurSaisie('Cette couveuse contient des œufs en cours d’incubation.');
      await base.couveuses.update(id, { supprimeLe: maintenant(), misAJour: maintenant() });
    },

    /** Place des œufs dans une couveuse, après vérification de la place disponible pendant toute l'incubation. */
    async mettreEnIncubation(d: { couveuseId: string; especeCode: string; nom: string; nbOeufs: number; miseEnPlace?: Jour; origine?: string }): Promise<string> {
      const nom = d.nom.trim();
      if (!nom) throw new ErreurSaisie('Donnez un nom à cette mise en incubation.');
      const nbOeufs = entierPositif(d.nbOeufs, 'Nombre d’œufs');
      const miseEnPlace = d.miseEnPlace ?? aujourdhui();
      if (miseEnPlace > aujourdhui()) throw new ErreurSaisie('La date de mise en place ne peut pas être dans le futur.');
      const couveuse = await base.couveuses.get(d.couveuseId);
      if (!couveuse || couveuse.supprimeLe) throw new ErreurSaisie('Choisissez une couveuse.');
      const reglages = fusionnerReglages(Object.fromEntries((await base.reglages.toArray()).map((r) => [r.cle, r.valeur])));
      if (!profilDe(reglages.especes, d.especeCode)) throw new ErreurSaisie('Cette espèce n’a pas de repères d’incubation.');
      const incubations = (await base.incubations.toArray()).filter((i) => !i.supprimeLe);
      const mirages = (await base.mirages.toArray()).filter((m) => !m.supprimeLe);
      const libres = placesPourNouvelleMise(couveuse, incubations, mirages, reglages.especes, d.especeCode, miseEnPlace);
      if (libres !== null && nbOeufs > libres) throw new ErreurSaisie(`Il ne reste que ${libres} places pour ces œufs dans cette couveuse à cette date.`);
      const id = nouvelId();
      await base.incubations.add({ id, misAJour: maintenant(), couveuseId: d.couveuseId, especeCode: d.especeCode, nom, miseEnPlace, nbOeufs, faits: [], ...(d.origine?.trim() ? { origine: d.origine.trim() } : {}) });
      return id;
    },

    async enregistrerMirage(d: { incubationId: string; etape: number; clairs: number; morts: number }): Promise<Annulation> {
      const inc = await base.incubations.get(d.incubationId);
      if (!inc || inc.supprimeLe) throw new ErreurSaisie('Mise en incubation introuvable.');
      for (const [v, l] of [[d.clairs, 'Œufs clairs'], [d.morts, 'Œufs morts']] as const) {
        if (!Number.isInteger(v) || v < 0) throw new ErreurSaisie(`${l} : entrez un nombre entier, zéro ou plus.`);
      }
      const mirages = (await base.mirages.where('incubationId').equals(inc.id).toArray()).filter((m) => !m.supprimeLe);
      if (mirages.some((m) => m.etape === d.etape)) throw new ErreurSaisie('Ce mirage est déjà noté. Annulez-le d’abord pour le refaire.');
      const dispo = oeufsRestants(inc, mirages, aujourdhui());
      if (d.clairs + d.morts > dispo) throw new ErreurSaisie(`Il ne reste que ${dispo} œufs dans cette mise en incubation.`);
      const id = nouvelId();
      await base.mirages.add({ id, misAJour: maintenant(), incubationId: inc.id, etape: d.etape, jour: aujourdhui(), clairs: d.clairs, morts: d.morts });
      return { table: 'mirages', id };
    },

    /** Coche ou décoche une étape sans saisie chiffrée (« transfert », « tour:AAAA-MM-JJ »). */
    async definirFait(incubationId: string, cle: string, fait: boolean): Promise<void> {
      const inc = await base.incubations.get(incubationId);
      if (!inc) throw new ErreurSaisie('Mise en incubation introuvable.');
      const faits = new Set(inc.faits);
      if (fait) faits.add(cle);
      else faits.delete(cle);
      await base.incubations.update(incubationId, { faits: [...faits], misAJour: maintenant() });
    },

    /** Note l'éclosion et crée le lot de poussins, relié à sa mise en incubation. */
    async enregistrerEclosion(d: { incubationId: string; nes: number; mortsCoquille?: number; logementId?: string | null }): Promise<string | null> {
      const inc = await base.incubations.get(d.incubationId);
      if (!inc || inc.supprimeLe) throw new ErreurSaisie('Mise en incubation introuvable.');
      if (inc.eclosion) throw new ErreurSaisie('L’éclosion est déjà notée.');
      if (!Number.isInteger(d.nes) || d.nes < 0) throw new ErreurSaisie('Poussins nés : entrez un nombre entier, zéro ou plus.');
      const mortsCoquille = d.mortsCoquille ?? 0;
      if (!Number.isInteger(mortsCoquille) || mortsCoquille < 0) throw new ErreurSaisie('Morts en coquille : entrez un nombre entier, zéro ou plus.');
      const mirages = (await base.mirages.where('incubationId').equals(inc.id).toArray()).filter((m) => !m.supprimeLe);
      const dispo = oeufsRestants(inc, mirages, aujourdhui());
      if (d.nes + mortsCoquille > dispo) throw new ErreurSaisie(`Il ne reste que ${dispo} œufs dans cette mise en incubation.`);
      let lotId: string | null = null;
      await base.transaction('rw', base.lots, base.mouvements, base.incubations, async () => {
        if (d.nes > 0) {
          lotId = nouvelId();
          await base.lots.add({ id: lotId, misAJour: maintenant(), nom: `${inc.nom} – poussins`, especeCode: inc.especeCode, naissance: aujourdhui(), logementId: d.logementId ?? null, incubationId: inc.id });
          await ajouterMouvement(lotId, 'naissance', d.nes, { note: 'Éclosion' });
        }
        await base.incubations.update(inc.id, { eclosion: { jour: aujourdhui(), nes: d.nes, mortsCoquille, lotId }, misAJour: maintenant() });
      });
      return lotId;
    },

    /** Annule une éclosion notée par erreur, tant que le lot de poussins n'a pas d'autre historique. */
    async annulerEclosion(incubationId: string): Promise<void> {
      const inc = await base.incubations.get(incubationId);
      if (!inc?.eclosion) throw new ErreurSaisie('Aucune éclosion à annuler.');
      const lotId = inc.eclosion.lotId;
      await base.transaction('rw', base.lots, base.mouvements, base.pontes, base.distributions, base.incubations, async () => {
        if (lotId) {
          const mouvements = (await base.mouvements.where('lotId').equals(lotId).toArray()).filter((m) => !m.supprimeLe);
          const autres = mouvements.filter((m) => m.type !== 'naissance').length + (await base.pontes.where('lotId').equals(lotId).filter((p) => !p.supprimeLe).count()) + (await base.distributions.where('lotId').equals(lotId).filter((x) => !x.supprimeLe).count());
          if (autres > 0) throw new ErreurSaisie('Le lot de poussins a déjà un historique : supprimez-le d’abord.');
          for (const m of mouvements) await base.mouvements.update(m.id, { supprimeLe: maintenant(), misAJour: maintenant() });
          await base.lots.update(lotId, { supprimeLe: maintenant(), misAJour: maintenant() });
        }
        await base.incubations.update(incubationId, { eclosion: undefined, misAJour: maintenant() });
      });
    },

    async supprimerIncubation(id: string): Promise<void> {
      const inc = await base.incubations.get(id);
      if (inc?.eclosion) throw new ErreurSaisie('Annulez d’abord l’éclosion.');
      await base.incubations.update(id, { supprimeLe: maintenant(), misAJour: maintenant() });
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
