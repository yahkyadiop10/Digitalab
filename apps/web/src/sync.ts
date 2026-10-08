import { normaliserTelephone, TABLES_SYNCHRONISEES, type EntreeJournal, tablesEcrivables, type ChangementSync, type DemandeSync, type DroitsMembre, type EnregistrementSync, type ReponseSync, type RoleMembre, type TableSynchronisee } from '@digitalab/core';
import { db, type BaseElevage, type Connexion } from './db';
import { URL_SERVEUR_APERCU, creerServeurDemo } from './serveur-demo';

/** Le serveur a répondu par un refus (mauvais code, accès retiré, session expirée…). */
export class ErreurServeur extends Error {
  constructor(readonly statut: number, message: string) {
    super(message);
  }
}

/** Le serveur n'est pas joignable : on reste simplement hors ligne. */
export class ErreurReseau extends Error {}

export type Fetch = typeof fetch;

export interface OrganisationServeur extends DroitsMembre {
  id: string;
  nom: string;
}

export interface Membre {
  telephone: string;
  role: RoleMembre;
  nom: string | null;
  fonction: string | null;
  droits: string[];
  zones: string[];
  /** S'est déjà connecté au moins une fois. */
  actif: boolean;
  /** Un code de connexion donné par l'administrateur attend d'être utilisé. */
  invitationEnCours: boolean;
}

/** Ce que l'administrateur remplit pour ajouter ou modifier une personne. */
export interface FicheMembre {
  telephone: string;
  nom?: string;
  fonction?: string;
  role?: RoleMembre;
  droits?: string[];
  zones?: string[];
  /** Donne un nouveau code de connexion (téléphone perdu, code oublié). */
  nouveauCode?: boolean;
}

export type ResultatSync =
  | { etat: 'ok'; envoyes: number; recus: number; ecartes: number; refuses: number }
  | { etat: 'hors_ligne' }
  | { etat: 'non_connecte' }
  | { etat: 'refuse'; message: string };

export interface EtatSynchro {
  enCours: boolean;
}

const TAILLE_LOT = 200;
const DELAI_REQUETE_MS = 30_000;

/** Adresse du serveur par défaut (variable VITE_API_URL à la construction) ; vide = à saisir. */
/** L'aperçu en une page n'a pas de vrai serveur : il en simule un dans la page, pour pouvoir essayer les comptes et les droits. */
export const MODE_APERCU: boolean = import.meta.env?.MODE === 'apercu';
export const URL_SERVEUR_DEFAUT: string = MODE_APERCU ? URL_SERVEUR_APERCU : ((import.meta.env?.VITE_API_URL as string | undefined) ?? '');

export function creerSynchro(base: BaseElevage = db, f: Fetch = (...a) => fetch(...a)) {
  let enCours: Promise<ResultatSync> | null = null;
  let applique = false;
  const ecouteurs = new Set<(e: EtatSynchro) => void>();
  const prevenir = () => ecouteurs.forEach((fn) => fn({ enCours: enCours !== null }));

  async function appeler<T>(url: string, chemin: string, opts: { methode?: string; jeton?: string; corps?: unknown } = {}): Promise<T> {
    const aCorps = opts.corps !== undefined;
    let rep: Response;
    try {
      rep = await f(`${url.replace(/\/+$/, '')}${chemin}`, {
        method: opts.methode ?? (aCorps ? 'POST' : 'GET'),
        headers: { ...(aCorps ? { 'content-type': 'application/json' } : {}), ...(opts.jeton ? { authorization: `Bearer ${opts.jeton}` } : {}) },
        ...(aCorps ? { body: JSON.stringify(opts.corps) } : {}),
        signal: AbortSignal.timeout(DELAI_REQUETE_MS),
      });
    } catch {
      throw new ErreurReseau('Le serveur n’est pas joignable.');
    }
    const texte = await rep.text();
    let json: unknown = null;
    try {
      json = texte ? JSON.parse(texte) : null;
    } catch {
      /* réponse non JSON (passerelle, page d'erreur…) */
    }
    if (!rep.ok) throw new ErreurServeur(rep.status, (json as { erreur?: string } | null)?.erreur ?? `Le serveur a répondu par une erreur (${rep.status}).`);
    return json as T;
  }

  const lire = (): Promise<Connexion | undefined> => base.connexion.get('serveur');

  /** Applique les modifications reçues : pour chaque fiche, la version la plus récente l'emporte. */
  async function appliquer(changements: ChangementSync[]): Promise<number> {
    const parTable = new Map<TableSynchronisee, EnregistrementSync[]>();
    for (const ch of changements) {
      if (!(TABLES_SYNCHRONISEES as readonly string[]).includes(ch.table)) continue;
      const liste = parTable.get(ch.table) ?? [];
      liste.push(ch.enregistrement);
      parTable.set(ch.table, liste);
    }
    if (parTable.size === 0) return 0;
    let recus = 0;
    applique = true;
    try {
      await base.transaction('rw', [...parTable.keys()].map((t) => base.table(t)), async () => {
        for (const [t, recs] of parTable) {
          const table = base.table<EnregistrementSync, string>(t);
          const existants = await table.bulkGet(recs.map((r) => r.id));
          const nouveaux = recs.filter((r, i) => !existants[i] || existants[i]!.misAJour < r.misAJour);
          if (nouveaux.length) await table.bulkPut(nouveaux);
          recus += nouveaux.length;
        }
      });
    } finally {
      applique = false;
    }
    return recus;
  }

  async function modifications(depuis: number, droits: string[]): Promise<ChangementSync[]> {
    const out: ChangementSync[] = [];
    const permises = new Set<string>(tablesEcrivables(droits));
    for (const t of TABLES_SYNCHRONISEES) {
      if (!permises.has(t)) continue;
      const lignes = await base.table<EnregistrementSync, string>(t).filter((r) => r.misAJour >= depuis).toArray();
      for (const enregistrement of lignes) out.push({ table: t, enregistrement });
    }
    return out;
  }

  async function executer(): Promise<ResultatSync> {
    const debut = Date.now();
    const c = await lire();
    if (!c) return { etat: 'non_connecte' };
    const chemin = `/v1/organisations/${c.organisationId}/sync`;
    try {
      const aEnvoyer = await modifications(c.dernierEnvoi, c.droits);
      const lots: ChangementSync[][] = [];
      for (let i = 0; i < aEnvoyer.length; i += TAILLE_LOT) lots.push(aEnvoyer.slice(i, i + TAILLE_LOT));
      if (lots.length === 0) lots.push([]);
      let seq = c.derniereSeq;
      let recus = 0;
      let ecartes = 0;
      let refuses = 0;
      let connus = [...c.droits].sort().join(',');
      for (const lot of lots) {
        let envoi = lot;
        let rep: ReponseSync;
        do {
          const demande: DemandeSync = { depuisSeq: seq, changements: envoi };
          rep = await appeler<ReponseSync>(c.url, chemin, { jeton: c.jeton, corps: demande });
          envoi = [];
          recus += await appliquer(rep.changements);
          ecartes += rep.ecartes;
          refuses += rep.refuses ?? 0;
          seq = rep.seq;
          // Si l'administrateur a changé les droits, ce que le serveur renvoie change : on repart du début pour récupérer ce qui devient visible.
          const nouveaux = rep.moi ? [...rep.moi.droits].sort().join(',') : connus;
          if (nouveaux !== connus) {
            connus = nouveaux;
            seq = 0;
            rep = { ...rep, reste: true };
          }
          await base.connexion.where('cle').equals('serveur').modify((ligne) => {
            ligne.derniereSeq = seq;
            if (rep.moi) {
              ligne.role = rep.moi.role;
              ligne.droits = rep.moi.droits;
              ligne.zones = rep.moi.zones;
              if (rep.moi.fonction) ligne.fonction = rep.moi.fonction;
              else delete ligne.fonction;
            }
          });
        } while (rep.reste);
      }
      // Mise à jour ciblée : le nom de l'élevage ou le rôle ont pu changer pendant l'échange.
      await base.connexion.where('cle').equals('serveur').modify((ligne) => {
        ligne.derniereSeq = seq;
        ligne.dernierEnvoi = debut;
        ligne.derniereSync = Date.now();
        delete ligne.erreur;
      });
      return { etat: 'ok', envoyes: aEnvoyer.length, recus, ecartes, refuses };
    } catch (e) {
      if (e instanceof ErreurReseau) return { etat: 'hors_ligne' };
      if (e instanceof ErreurServeur) {
        const message = e.statut === 401 ? 'Votre session a expiré. Reconnectez-vous pour reprendre la synchronisation.' : e.statut === 404 ? 'Vous n’avez plus accès à cet élevage.' : e.message;
        await base.connexion.update('serveur', { erreur: message });
        return { etat: 'refuse', message };
      }
      throw e;
    }
  }

  /** Une seule synchronisation à la fois ; un appel pendant qu'une autre tourne attend la même. */
  function synchroniser(): Promise<ResultatSync> {
    if (!enCours) {
      enCours = executer().finally(() => {
        enCours = null;
        prevenir();
      });
      prevenir();
    }
    return enCours;
  }

  let minuteur: ReturnType<typeof setTimeout> | undefined;

  return {
    lire,

    async demanderCode(url: string, telephone: string): Promise<{ telephone: string; codeDemo?: string }> {
      const tel = normaliserTelephone(telephone);
      if (!tel) throw new ErreurServeur(400, 'Numéro de téléphone invalide. Exemple : 77 123 45 67.');
      return appeler(url, '/v1/auth/code', { corps: { telephone: tel } });
    },

    async seConnecter(url: string, telephone: string, code: string): Promise<{ jeton: string; telephone: string; organisations: OrganisationServeur[] }> {
      const tel = normaliserTelephone(telephone);
      if (!tel) throw new ErreurServeur(400, 'Numéro de téléphone invalide.');
      const r = await appeler<{ jeton: string; organisations: OrganisationServeur[] }>(url, '/v1/auth/connexion', { corps: { telephone: tel, code: code.trim(), appareil: (typeof navigator !== 'undefined' ? navigator.userAgent : 'appareil').slice(0, 80) } });
      return { ...r, telephone: tel };
    },

    /** Relie cet appareil à un élevage du serveur ; la première synchronisation envoie ce qui existe déjà ici et récupère le reste. */
    async lier(url: string, jeton: string, telephone: string, org: OrganisationServeur): Promise<void> {
      await base.connexion.put({
        cle: 'serveur', url: url.replace(/\/+$/, ''), jeton, telephone, organisationId: org.id, organisationNom: org.nom,
        role: org.role, droits: org.droits, zones: org.zones, ...(org.fonction ? { fonction: org.fonction } : {}), derniereSeq: 0, dernierEnvoi: 0,
      });
      await base.reglages.put({ cle: 'demarrageFait', valeur: true });
      const local = await base.reglages.get('nomElevage');
      const nomLocal = typeof local?.valeur === 'string' ? local.valeur.trim() : '';
      if (!nomLocal) {
        await base.reglages.put({ cle: 'nomElevage', valeur: org.nom });
      } else if (org.role === 'proprietaire' && org.nom === 'Mon élevage' && nomLocal !== org.nom) {
        // Premier élevage créé par la connexion : il prend le nom choisi sur cet appareil.
        try {
          await appeler(url, `/v1/organisations/${org.id}`, { jeton, methode: 'PATCH', corps: { nom: nomLocal } });
          await base.connexion.update('serveur', { organisationNom: nomLocal });
        } catch {
          /* sans importance : le nom pourra être changé plus tard */
        }
      }
    },

    /** Quitte le compte sur cet appareil. Les données restent ici ; elles ne sont plus échangées. */
    async deconnecter(): Promise<void> {
      const c = await lire();
      if (!c) return;
      try {
        await appeler(c.url, '/v1/auth/deconnexion', { jeton: c.jeton, methode: 'POST' });
      } catch {
        /* sans réseau ou session déjà expirée : on oublie quand même la connexion ici */
      }
      await base.connexion.delete('serveur');
    },

    async membres(): Promise<Membre[]> {
      const c = await lire();
      if (!c) return [];
      return (await appeler<{ membres: Membre[] }>(c.url, `/v1/organisations/${c.organisationId}/membres`, { jeton: c.jeton })).membres;
    },

    /** Ajoute ou modifie une personne. Renvoie le code de connexion à lui donner, tant qu'elle ne s'est pas encore connectée. */
    async enregistrerMembre(fiche: FicheMembre): Promise<{ telephone: string; codeInvitation?: string }> {
      const c = await lire();
      if (!c) throw new ErreurReseau('Non connecté.');
      return appeler(c.url, `/v1/organisations/${c.organisationId}/membres`, { jeton: c.jeton, corps: fiche });
    },

    async retirer(telephone: string): Promise<void> {
      const c = await lire();
      if (!c) throw new ErreurReseau('Non connecté.');
      await appeler(c.url, `/v1/organisations/${c.organisationId}/membres/${encodeURIComponent(telephone)}`, { jeton: c.jeton, methode: 'DELETE' });
    },

    /** Déconnecte tous les appareils d'une personne. */
    async deconnecterAppareils(telephone: string): Promise<void> {
      const c = await lire();
      if (!c) throw new ErreurReseau('Non connecté.');
      await appeler(c.url, `/v1/organisations/${c.organisationId}/membres/${encodeURIComponent(telephone)}/deconnexion`, { jeton: c.jeton, methode: 'POST', corps: {} });
    },

    /** Le nom affiché dans le journal et la liste des utilisateurs. */
    async definirMonNom(nom: string): Promise<void> {
      const c = await lire();
      if (!c) throw new ErreurReseau('Non connecté.');
      await appeler(c.url, '/v1/moi', { jeton: c.jeton, methode: 'PATCH', corps: { nom: nom.trim() } });
    },

    /** Journal d'activité, du plus récent au plus ancien ; `avant` est l'identifiant de la dernière ligne déjà reçue. */
    async journal(opts: { avant?: number; telephone?: string; limite?: number } = {}): Promise<{ entrees: EntreeJournal[]; reste: boolean }> {
      const c = await lire();
      if (!c) throw new ErreurReseau('Non connecté.');
      const q = new URLSearchParams();
      if (opts.avant) q.set('avant', String(opts.avant));
      if (opts.telephone) q.set('telephone', opts.telephone);
      q.set('limite', String(opts.limite ?? 50));
      return appeler(c.url, `/v1/organisations/${c.organisationId}/journal?${q}`, { jeton: c.jeton });
    },

    synchroniser,

    abonner(fn: (e: EtatSynchro) => void): () => void {
      ecouteurs.add(fn);
      return () => ecouteurs.delete(fn);
    },

    /** Lance une synchronisation peu après chaque saisie locale (hors réception de données), puis régulièrement et au retour du réseau. */
    demarrerAuto(): () => void {
      const planifier = () => {
        if (applique) return;
        clearTimeout(minuteur);
        minuteur = setTimeout(() => void synchroniser(), 3000);
      };
      const hooks: (() => void)[] = [];
      for (const t of TABLES_SYNCHRONISEES) {
        const table = base.table(t);
        const f1 = () => planifier();
        table.hook('creating', f1);
        table.hook('updating', f1);
        hooks.push(() => {
          table.hook('creating').unsubscribe(f1);
          table.hook('updating').unsubscribe(f1);
        });
      }
      const aller = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        void synchroniser();
      };
      aller();
      const intervalle = setInterval(aller, 60_000);
      window.addEventListener('online', aller);
      document.addEventListener('visibilitychange', aller);
      return () => {
        clearInterval(intervalle);
        clearTimeout(minuteur);
        window.removeEventListener('online', aller);
        document.removeEventListener('visibilitychange', aller);
        hooks.forEach((h) => h());
      };
    },
  };
}

export const synchro = creerSynchro(db, MODE_APERCU ? creerServeurDemo() : undefined);
export type Synchro = ReturnType<typeof creerSynchro>;
