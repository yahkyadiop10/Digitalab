import { effectifs, jourLocal, MODES_PAIEMENT, prochainNumeroFacture, reglement, totalLignes, type Employe, type LigneDocument, type ModePaiement, type NatureSalaire, type Tiers, naissanceEstimee, type EtatArrivee, type EtatNote, type SensOperation, oeufsRestants, type EvenementSante, type ProtocoleVaccin, type ResultatTraitement, placesPourNouvelleMise, profilDe, type Jour, type Lot, type TypeCouveuse, type TypeLogement, type TypeMouvement } from '@digitalab/core';
import { db, TABLES_DONNEES, type BaseElevage } from './db';
import { fusionnerReglages } from './reglages';

export class ErreurSaisie extends Error {}

export const nouvelId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// Strictement croissant sur l'appareil : deux modifications d'une même fiche ne portent jamais le même instant,
// sinon la synchronisation (la plus récente l'emporte) pourrait garder la mauvaise.
let dernierInstant = 0;
const maintenant = () => (dernierInstant = Math.max(Date.now(), dernierInstant + 1));
export const aujourdhui = (): Jour => jourLocal(new Date());

export type TableAnnulable = 'mouvements' | 'pontes' | 'distributions' | 'entreesStock' | 'mirages' | 'evenementsSante' | 'operations' | 'notesQuarantaine' | 'paiements';

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

  const ajouterSante = async (d: Omit<Partial<EvenementSante>, 'id' | 'misAJour'> & { lotId: string; type: EvenementSante['type'] }): Promise<Annulation> => {
    const lot = await base.lots.get(d.lotId);
    if (!lot || lot.supprimeLe) throw new ErreurSaisie('Choisissez un lot.');
    const id = nouvelId();
    const propre = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined && v !== '' && !(typeof v === 'string' && v.trim() === '')));
    await base.evenementsSante.add({ ...(propre as object), id, misAJour: maintenant(), lotId: d.lotId, type: d.type, date: d.date ?? aujourdhui() } as EvenementSante);
    return { table: 'evenementsSante', id };
  };

  const ajouterMouvement = async (lotId: string, type: TypeMouvement, quantite: number, extra: { cause?: string; note?: string; date?: Jour } = {}): Promise<Annulation> => {
    const id = nouvelId();
    await base.mouvements.add({ id, misAJour: maintenant(), lotId, type, quantite, date: extra.date ?? aujourdhui(), ...(extra.cause ? { cause: extra.cause } : {}), ...(extra.note ? { note: extra.note } : {}) });
    return { table: 'mouvements', id };
  };

  /** Après une restauration ou un effacement, la prochaine synchronisation renvoie et reprend tout. */
  const repartirDeZero = async () => {
    await base.connexion.where('cle').equals('serveur').modify({ derniereSeq: 0, dernierEnvoi: 0 });
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

        /* ---------- Santé ---------- */

    async ajouterObservation(d: { lotId: string; symptomes: string[]; gravite: 1 | 2 | 3; maladie?: string; note?: string; date?: Jour }): Promise<Annulation> {
      if (d.symptomes.length === 0 && !d.note?.trim()) throw new ErreurSaisie('Choisissez au moins un symptôme ou écrivez une note.');
      return ajouterSante({ lotId: d.lotId, type: 'observation', date: d.date, symptomes: d.symptomes, gravite: d.gravite, maladie: d.maladie, note: d.note });
    },

    async ajouterVaccin(d: { lotId: string; nom: string; protocoleId?: string; dose?: string; numeroLotProduit?: string; date?: Jour }): Promise<Annulation> {
      if (!d.nom.trim()) throw new ErreurSaisie('Indiquez le nom du vaccin.');
      return ajouterSante({ lotId: d.lotId, type: 'vaccin', date: d.date, nom: d.nom, protocoleId: d.protocoleId, dose: d.dose, numeroLotProduit: d.numeroLotProduit });
    },

    async ajouterTraitement(d: { lotId: string; nom: string; dose?: string; voie?: string; dureeJours: number; delaiAttenteJours?: number; maladie?: string; note?: string; date?: Jour }): Promise<Annulation> {
      if (!d.nom.trim()) throw new ErreurSaisie('Indiquez le nom du produit ou du remède.');
      const duree = entierPositif(d.dureeJours, 'Durée du traitement');
      const delai = d.delaiAttenteJours ?? 0;
      if (!Number.isInteger(delai) || delai < 0) throw new ErreurSaisie('Délai d’attente : entrez un nombre de jours entier, zéro ou plus.');
      return ajouterSante({ lotId: d.lotId, type: 'traitement', date: d.date, nom: d.nom, dose: d.dose, voie: d.voie, dureeJours: duree, delaiAttenteJours: delai, maladie: d.maladie, note: d.note });
    },

    async ajouterQuarantaine(d: { lotId: string; dureeJours: number; note?: string }): Promise<Annulation> {
      return ajouterSante({ lotId: d.lotId, type: 'quarantaine', dureeJours: entierPositif(d.dureeJours, 'Durée'), note: d.note });
    },

    async definirResultat(evenementId: string, resultat: ResultatTraitement | undefined): Promise<void> {
      await base.evenementsSante.update(evenementId, { resultat, misAJour: maintenant() });
    },

    async enregistrerProtocoles(protocoles: ProtocoleVaccin[]): Promise<void> {
      await base.reglages.put({ cle: 'protocoles', valeur: protocoles });
    },

        /* ---------- Finances ---------- */

    /**
     * Note une dépense ou une recette. Avec des `lignes`, le montant est calculé (lignes moins remise) et une vente reçoit un numéro de facture.
     * Règlement : `paye` (par défaut vrai) = tout réglé maintenant ; sinon `acompte` = une partie maintenant, le reste plus tard.
     */
    async ajouterOperation(d: {
      sens: SensOperation; categorie: string; montant?: number; date?: Jour; lotId?: string | null; tiers?: string; telephoneTiers?: string; paye?: boolean; note?: string;
      lignes?: LigneDocument[]; remise?: number; numero?: string; echeance?: Jour; acompte?: number; mode?: ModePaiement;
      employeId?: string; periode?: string; nature?: NatureSalaire;
    }): Promise<Annulation> {
      const lignes = (d.lignes ?? []).filter((l) => l.libelle.trim() || l.quantite || l.prixUnitaire);
      for (const l of lignes) {
        if (!l.libelle.trim()) throw new ErreurSaisie('Chaque ligne de la facture doit avoir un nom (ex. « Plateaux d’œufs »).');
        if (!Number.isFinite(l.quantite) || l.quantite <= 0) throw new ErreurSaisie(`« ${l.libelle.trim()} » : la quantité doit être supérieure à zéro.`);
        if (!Number.isInteger(l.prixUnitaire) || l.prixUnitaire < 0) throw new ErreurSaisie(`« ${l.libelle.trim()} » : le prix doit être un nombre entier de FCFA.`);
      }
      const remise = d.remise ?? 0;
      if (!Number.isInteger(remise) || remise < 0) throw new ErreurSaisie('Remise : entrez un nombre entier de FCFA, zéro ou plus.');
      const montant = lignes.length > 0 ? totalLignes(lignes, remise) : d.montant ?? 0;
      if (!Number.isInteger(montant) || montant <= 0) throw new ErreurSaisie('Montant : entrez un nombre entier de FCFA supérieur à zéro.');
      const date = d.date ?? aujourdhui();
      if (date > aujourdhui()) throw new ErreurSaisie('La date ne peut pas être dans le futur.');
      if (d.echeance && d.echeance < date) throw new ErreurSaisie('La date limite de paiement ne peut pas précéder la date de l’opération.');
      const paye = d.paye ?? true;
      const mode = d.mode ?? 'especes';
      if (!MODES_PAIEMENT.includes(mode)) throw new ErreurSaisie('Moyen de paiement inconnu.');
      const acompte = paye ? montant : d.acompte ?? 0;
      if (!Number.isInteger(acompte) || acompte < 0 || acompte > montant) throw new ErreurSaisie('Acompte : entrez un nombre entier de FCFA, sans dépasser le total.');

      const id = nouvelId();
      await base.transaction('rw', base.operations, base.paiements, base.tiers, async () => {
        const nomTiers = d.tiers?.trim();
        let tiersId: string | undefined;
        if (nomTiers) {
          const connu = (await base.tiers.toArray()).find((t) => !t.supprimeLe && t.nom.toLowerCase() === nomTiers.toLowerCase());
          if (connu) {
            tiersId = connu.id;
            if (d.telephoneTiers?.trim() && !connu.telephone) await base.tiers.update(connu.id, { telephone: d.telephoneTiers.trim(), misAJour: maintenant() });
          } else {
            tiersId = nouvelId();
            await base.tiers.add({ id: tiersId, misAJour: maintenant(), nom: nomTiers, ...(d.telephoneTiers?.trim() ? { telephone: d.telephoneTiers.trim() } : {}) });
          }
        }
        const numero = d.numero?.trim() || (d.sens === 'recette' && lignes.length > 0 ? prochainNumeroFacture(await base.operations.toArray(), Number(date.slice(0, 4))) : undefined);
        await base.operations.add({
          id, misAJour: maintenant(), date, sens: d.sens, categorie: d.categorie, montant, paye: false,
          ...(d.lotId ? { lotId: d.lotId } : {}),
          ...(nomTiers ? { tiers: nomTiers } : {}),
          ...(tiersId ? { tiersId } : {}),
          ...(d.note?.trim() ? { note: d.note.trim() } : {}),
          ...(numero ? { numero } : {}),
          ...(lignes.length > 0 ? { lignes: lignes.map((l) => ({ libelle: l.libelle.trim(), quantite: l.quantite, prixUnitaire: l.prixUnitaire })) } : {}),
          ...(lignes.length > 0 && remise > 0 ? { remise } : {}),
          ...(d.echeance && acompte < montant ? { echeance: d.echeance } : {}),
          ...(d.employeId ? { employeId: d.employeId } : {}),
          ...(d.periode ? { periode: d.periode } : {}),
          ...(d.nature ? { nature: d.nature } : {}),
        });
        if (acompte > 0) await base.paiements.add({ id: nouvelId(), misAJour: maintenant(), operationId: id, date, montant: acompte, mode });
      });
      return { table: 'operations', id };
    },

    /** Enregistre un règlement (acompte ou solde) sur une facture ou une dépense. */
    async ajouterPaiement(operationId: string, montant: number, mode: ModePaiement, date?: Jour): Promise<Annulation> {
      const op = await base.operations.get(operationId);
      if (!op || op.supprimeLe) throw new ErreurSaisie('Opération introuvable.');
      if (!Number.isInteger(montant) || montant <= 0) throw new ErreurSaisie('Montant : entrez un nombre entier de FCFA supérieur à zéro.');
      if (!MODES_PAIEMENT.includes(mode)) throw new ErreurSaisie('Moyen de paiement inconnu.');
      const jour = date ?? aujourdhui();
      if (jour > aujourdhui()) throw new ErreurSaisie('La date ne peut pas être dans le futur.');
      const { reste } = reglement(op, await base.paiements.where('operationId').equals(operationId).toArray());
      if (montant > reste) throw new ErreurSaisie(reste === 0 ? 'Cette opération est déjà entièrement réglée.' : `Il ne reste que ${reste} FCFA à régler.`);
      const id = nouvelId();
      await base.paiements.add({ id, misAJour: maintenant(), operationId, date: jour, montant, mode });
      return { table: 'paiements', id };
    },

    /** Règle d'un coup tout ce qui reste sur une opération. */
    async marquerPaye(id: string, mode: ModePaiement = 'autre'): Promise<void> {
      const op = await base.operations.get(id);
      if (!op) throw new ErreurSaisie('Opération introuvable.');
      const { reste } = reglement(op, await base.paiements.where('operationId').equals(id).toArray());
      if (reste > 0) await this.ajouterPaiement(id, reste, mode);
    },

    /* ---------- Clients, fournisseurs, employés et paie ---------- */

    async enregistrerTiers(d: { id?: string; nom: string; telephone?: string; note?: string }): Promise<string> {
      const nom = d.nom.trim();
      if (!nom) throw new ErreurSaisie('Donnez un nom.');
      const homonyme = (await base.tiers.toArray()).find((t) => !t.supprimeLe && t.id !== d.id && t.nom.toLowerCase() === nom.toLowerCase());
      if (homonyme) throw new ErreurSaisie(`« ${homonyme.nom} » existe déjà dans votre carnet.`);
      const fiche: Omit<Tiers, 'id' | 'misAJour'> = { nom, ...(d.telephone?.trim() ? { telephone: d.telephone.trim() } : {}), ...(d.note?.trim() ? { note: d.note.trim() } : {}) };
      if (d.id) {
        const avant = await base.tiers.get(d.id);
        if (!avant) throw new ErreurSaisie('Fiche introuvable.');
        await base.tiers.put({ id: d.id, misAJour: maintenant(), ...fiche });
        // Les anciennes opérations gardent le nom écrit à l'époque ; on les met à jour pour rester cohérent.
        if (avant.nom !== nom) {
          for (const o of await base.operations.filter((o) => o.tiersId === d.id).toArray()) await base.operations.update(o.id, { tiers: nom, misAJour: maintenant() });
        }
        return d.id;
      }
      const id = nouvelId();
      await base.tiers.add({ id, misAJour: maintenant(), ...fiche });
      return id;
    },

    async supprimerTiers(id: string): Promise<void> {
      await base.tiers.update(id, { supprimeLe: maintenant(), misAJour: maintenant() });
    },

    async enregistrerEmploye(d: { id?: string; nom: string; poste?: string; salaire: number; telephone?: string; debut?: string; fin?: string }): Promise<string> {
      const nom = d.nom.trim();
      if (!nom) throw new ErreurSaisie('Donnez un nom à l’employé.');
      if (!Number.isInteger(d.salaire) || d.salaire <= 0) throw new ErreurSaisie('Salaire mensuel : entrez un nombre entier de FCFA supérieur à zéro.');
      for (const m of [d.debut, d.fin]) if (m && !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new ErreurSaisie('Les mois se notent ainsi : 2026-10.');
      if (d.debut && d.fin && d.fin < d.debut) throw new ErreurSaisie('Le dernier mois ne peut pas précéder le premier.');
      const fiche: Omit<Employe, 'id' | 'misAJour'> = {
        nom, salaire: d.salaire,
        ...(d.poste?.trim() ? { poste: d.poste.trim() } : {}), ...(d.telephone?.trim() ? { telephone: d.telephone.trim() } : {}),
        ...(d.debut ? { debut: d.debut } : {}), ...(d.fin ? { fin: d.fin } : {}),
      };
      if (d.id) {
        if (!(await base.employes.get(d.id))) throw new ErreurSaisie('Employé introuvable.');
        await base.employes.put({ id: d.id, misAJour: maintenant(), ...fiche });
        return d.id;
      }
      const id = nouvelId();
      await base.employes.add({ id, misAJour: maintenant(), ...fiche });
      return id;
    },

    /** Retire un employé de la liste (ses paies passées restent dans les comptes). */
    async supprimerEmploye(id: string): Promise<void> {
      await base.employes.update(id, { supprimeLe: maintenant(), misAJour: maintenant() });
    },

    /** Verse un salaire, une avance ou une prime : c'est une dépense « main-d'œuvre » payée, rattachée à l'employé et au mois. */
    async payerSalaire(d: { employeId: string; periode: string; montant: number; nature: NatureSalaire; mode?: ModePaiement; date?: Jour; note?: string }): Promise<Annulation> {
      const e = await base.employes.get(d.employeId);
      if (!e || e.supprimeLe) throw new ErreurSaisie('Employé introuvable.');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(d.periode)) throw new ErreurSaisie('Mois invalide.');
      return this.ajouterOperation({
        sens: 'depense', categorie: 'main_oeuvre', montant: d.montant, tiers: e.nom, paye: true, employeId: e.id, periode: d.periode, nature: d.nature,
        ...(d.mode ? { mode: d.mode } : {}), ...(d.date ? { date: d.date } : {}), ...(d.note ? { note: d.note } : {}),
      });
    },

    /* ---------- Quarantaine des nouveaux arrivants ---------- */

    /** Retrouve la zone de quarantaine, ou la crée si l'élevage n'en a pas encore. */
    async assurerZoneQuarantaine(): Promise<string> {
      const existante = (await base.logements.toArray()).find((l) => l.type === 'quarantaine' && !l.supprimeLe);
      if (existante) return existante.id;
      const id = nouvelId();
      await base.logements.add({ id, misAJour: maintenant(), nom: 'Zone de quarantaine', type: 'quarantaine', surfaceM2: null });
      return id;
    },

    /**
     * Enregistre l'arrivée d'animaux : crée leur lot (dans la zone de quarantaine), leur effectif de départ,
     * leur fiche de quarantaine et, si un prix est donné, la dépense d'achat.
     */
    async creerQuarantaine(d: {
      nom: string; especeCode: string; race?: string; nombre: number; ageJours?: number; origine?: string; arrivee?: Jour; dureeJours: number;
      logementId?: string | null; alimentation?: string; etatArrivee?: EtatArrivee; noteArrivee?: string; prixTotal?: number;
    }): Promise<string> {
      const nom = d.nom.trim();
      if (!nom) throw new ErreurSaisie('Donnez un nom à cet arrivage.');
      const nombre = entierPositif(d.nombre, 'Nombre d’animaux');
      const dureeJours = entierPositif(d.dureeJours, 'Durée de quarantaine');
      const arrivee = d.arrivee ?? aujourdhui();
      if (arrivee > aujourdhui()) throw new ErreurSaisie('La date d’arrivée ne peut pas être dans le futur.');
      if (d.ageJours !== undefined && (!Number.isFinite(d.ageJours) || d.ageJours < 0)) throw new ErreurSaisie('Âge : entrez un nombre de jours, zéro ou plus.');
      if (d.prixTotal !== undefined && (!Number.isInteger(d.prixTotal) || d.prixTotal <= 0)) throw new ErreurSaisie('Prix : entrez un nombre entier de FCFA supérieur à zéro.');
      const logementId = d.logementId || (await this.assurerZoneQuarantaine());
      const lotId = nouvelId();
      const id = nouvelId();
      await base.transaction('rw', base.lots, base.mouvements, base.quarantaines, base.operations, async () => {
        await base.lots.add({
          id: lotId, misAJour: maintenant(), nom, especeCode: d.especeCode, logementId,
          ...(d.race?.trim() ? { race: d.race.trim() } : {}),
          ...(d.ageJours !== undefined ? { naissance: naissanceEstimee(arrivee, d.ageJours) } : {}),
        });
        await ajouterMouvement(lotId, 'arrivee', nombre, { date: arrivee, note: 'Arrivée en quarantaine' });
        await base.quarantaines.add({
          id, misAJour: maintenant(), nom, lotId, especeCode: d.especeCode, nombre, arrivee, dureeJours, logementId, etapes: [],
          ...(d.race?.trim() ? { race: d.race.trim() } : {}),
          ...(d.ageJours !== undefined ? { ageJours: Math.round(d.ageJours) } : {}),
          ...(d.origine?.trim() ? { origine: d.origine.trim() } : {}),
          ...(d.alimentation?.trim() ? { alimentation: d.alimentation.trim() } : {}),
          ...(d.etatArrivee ? { etatArrivee: d.etatArrivee } : {}),
          ...(d.noteArrivee?.trim() ? { noteArrivee: d.noteArrivee.trim() } : {}),
        });
        if (d.prixTotal) {
          await base.operations.add({ id: nouvelId(), misAJour: maintenant(), date: arrivee, sens: 'depense', categorie: 'achat_animaux', montant: d.prixTotal, lotId, paye: true, payeLe: arrivee, ...(d.origine?.trim() ? { tiers: d.origine.trim() } : {}) });
        }
      });
      return id;
    },

    /** Ajoute une ligne au journal d'observation de la quarantaine. */
    async ajouterNoteQuarantaine(d: { quarantaineId: string; date?: Jour; etat: EtatNote; comportements: string[]; alimentation?: string; poidsMoyenG?: number; malades?: number; note?: string }): Promise<Annulation> {
      const q = await base.quarantaines.get(d.quarantaineId);
      if (!q || q.supprimeLe) throw new ErreurSaisie('Quarantaine introuvable.');
      if (d.comportements.length === 0 && !d.note?.trim() && !d.alimentation?.trim() && d.poidsMoyenG === undefined) {
        throw new ErreurSaisie('Notez au moins un comportement, une alimentation, un poids ou une remarque.');
      }
      if (d.poidsMoyenG !== undefined && (!Number.isFinite(d.poidsMoyenG) || d.poidsMoyenG <= 0)) throw new ErreurSaisie('Poids : entrez un nombre de grammes supérieur à zéro.');
      if (d.malades !== undefined && (!Number.isInteger(d.malades) || d.malades < 0)) throw new ErreurSaisie('Animaux malades : entrez un nombre entier, zéro ou plus.');
      const date = d.date ?? aujourdhui();
      if (date > aujourdhui()) throw new ErreurSaisie('La date ne peut pas être dans le futur.');
      const id = nouvelId();
      await base.notesQuarantaine.add({
        id, misAJour: maintenant(), quarantaineId: q.id, date, etat: d.etat, comportements: d.comportements,
        ...(d.alimentation?.trim() ? { alimentation: d.alimentation.trim() } : {}),
        ...(d.poidsMoyenG !== undefined ? { poidsMoyenG: d.poidsMoyenG } : {}),
        ...(d.malades !== undefined ? { malades: d.malades } : {}),
        ...(d.note?.trim() ? { note: d.note.trim() } : {}),
      });
      return { table: 'notesQuarantaine', id };
    },

    /** Coche ou décoche un contrôle de la quarantaine (examen, déparasitage…). */
    async definirEtapeQuarantaine(id: string, code: string, fait: boolean): Promise<void> {
      const q = await base.quarantaines.get(id);
      if (!q) throw new ErreurSaisie('Quarantaine introuvable.');
      const etapes = new Set(q.etapes);
      if (fait) etapes.add(code);
      else etapes.delete(code);
      await base.quarantaines.update(id, { etapes: [...etapes], misAJour: maintenant() });
    },

    async prolongerQuarantaine(id: string, jours: number): Promise<void> {
      const q = await base.quarantaines.get(id);
      if (!q) throw new ErreurSaisie('Quarantaine introuvable.');
      await base.quarantaines.update(id, { dureeJours: q.dureeJours + entierPositif(jours, 'Prolongation'), misAJour: maintenant() });
    },

    /** Termine la quarantaine : les animaux entrent dans l'élevage (dans le local choisi) ou restent écartés. */
    async terminerQuarantaine(d: { id: string; decision: 'integre' | 'ecarte'; logementId?: string | null; note?: string }): Promise<void> {
      const q = await base.quarantaines.get(d.id);
      if (!q || q.supprimeLe) throw new ErreurSaisie('Quarantaine introuvable.');
      if (q.sortie) throw new ErreurSaisie('Cette quarantaine est déjà terminée.');
      await base.transaction('rw', base.lots, base.quarantaines, async () => {
        if (d.decision === 'integre') await base.lots.update(q.lotId, { logementId: d.logementId ?? null, misAJour: maintenant() });
        await base.quarantaines.update(q.id, {
          sortie: { jour: aujourdhui(), decision: d.decision, ...(d.decision === 'integre' ? { logementId: d.logementId ?? null } : {}), ...(d.note?.trim() ? { note: d.note.trim() } : {}) },
          misAJour: maintenant(),
        });
      });
    },

    /** Rouvre une quarantaine terminée par erreur (le lot reste où il est). */
    async rouvrirQuarantaine(id: string): Promise<void> {
      await base.quarantaines.update(id, { sortie: undefined, misAJour: maintenant() });
    },

    /** Suppression logique : la ligne reste dans la base, l'historique est conservé. */
    async restaurerOperation(id: string): Promise<void> {
      await base.operations.update(id, { supprimeLe: null, misAJour: maintenant() });
    },

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
      await repartirDeZero();
    },

    async toutEffacer(): Promise<void> {
      await base.transaction('rw', TABLES_DONNEES.map((t) => base.table(t)), async () => {
        for (const t of TABLES_DONNEES) await base.table(t).clear();
      });
      await repartirDeZero();
    },
  };
}

export const repo = creerRepo();
export type Repo = ReturnType<typeof creerRepo>;
