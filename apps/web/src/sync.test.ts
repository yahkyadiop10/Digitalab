import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { droitsEffectifs, peutEcrireTable, type ChangementSync, type DemandeSync, type DroitsMembre, type ReponseSync, type RoleMembre } from '@digitalab/core';
import { BaseElevage } from './db';
import { creerRepo } from './repo';
import { ErreurAppareilAutre, creerSynchro, type Fetch } from './sync';

/** Un petit serveur en mémoire qui applique la même règle que le vrai : la version la plus récente l'emporte. */
function fauxServeur(limite = 1000) {
  let moi: DroitsMembre = { role: 'proprietaire', droits: droitsEffectifs('proprietaire', null), zones: [] };
  const lignes = new Map<string, { seq: number; ch: ChangementSync }>();
  let seq = 0;
  let horsLigne = false;
  let refus: { statut: number; erreur: string } | null = null;
  const appels: DemandeSync[] = [];
  const fetchFictif: Fetch = async (_url, init) => {
    if (horsLigne) throw new TypeError('réseau coupé');
    if (refus) return new Response(JSON.stringify({ erreur: refus.erreur }), { status: refus.statut });
    const d = JSON.parse(String(init?.body)) as DemandeSync;
    appels.push(d);
    let ecartes = 0;
    let refuses = 0;
    for (const ch of d.changements) {
      if (!peutEcrireTable(moi.droits, ch.table)) {
        refuses += 1;
        continue;
      }
      const cle = `${ch.table}/${ch.enregistrement.id}`;
      const existant = lignes.get(cle);
      if (!existant || existant.ch.enregistrement.misAJour < ch.enregistrement.misAJour) lignes.set(cle, { seq: ++seq, ch });
      else if (existant.ch.enregistrement.misAJour > ch.enregistrement.misAJour) ecartes += 1;
    }
    const apres = [...lignes.values()].filter((l) => l.seq > d.depuisSeq).sort((a, b) => a.seq - b.seq);
    const gardees = apres.slice(0, limite);
    const rep: ReponseSync = { seq: gardees.at(-1)?.seq ?? d.depuisSeq, changements: gardees.map((l) => l.ch), reste: apres.length > limite, ecartes, refuses, moi };
    return new Response(JSON.stringify(rep), { status: 200 });
  };
  return { fetch: fetchFictif, appels, lignes, coupure: (v: boolean) => { horsLigne = v; }, definirDroits: (d: DroitsMembre) => { moi = d; }, refuser: (r: typeof refus) => { refus = r; } };
}

let n = 0;
async function appareil(serveur: ReturnType<typeof fauxServeur>, role: RoleMembre = 'proprietaire') {
  const base = new BaseElevage(`sync-${++n}`);
  const synchro = creerSynchro(base, serveur.fetch);
  await synchro.lier('http://serveur.test', 'jeton', 'ndiaye.moussa', { id: 'org-1', nom: 'Ferme test', role, droits: droitsEffectifs(role, null), zones: [] });
  return { base, repo: creerRepo(base), synchro };
}

describe('synchronisation côté appareil', () => {
  let serveur: ReturnType<typeof fauxServeur>;
  beforeEach(() => {
    serveur = fauxServeur();
  });

  it('envoie ce qui existe, puis un second appareil le retrouve', async () => {
    const a = await appareil(serveur);
    const lotId = await a.repo.creerLot({ nom: 'Soie', especeCode: 'poule', effectif: 12 });
    expect(await a.synchro.synchroniser()).toMatchObject({ etat: 'ok', envoyes: 2 });

    const b = await appareil(serveur);
    expect(await b.synchro.synchroniser()).toMatchObject({ etat: 'ok', recus: 2 });
    expect((await b.base.lots.get(lotId))?.nom).toBe('Soie');
    expect(await b.base.mouvements.count()).toBe(1);
  });

  it('n’envoie plus rien tant que rien ne change', async () => {
    const a = await appareil(serveur);
    await a.repo.creerLot({ nom: 'Soie', especeCode: 'poule', effectif: 12 });
    await a.synchro.synchroniser();
    await a.synchro.synchroniser(); // une fiche écrite pendant la même milliseconde peut repartir une fois, sans effet
    expect(await a.synchro.synchroniser()).toMatchObject({ etat: 'ok', envoyes: 0, recus: 0 });
  });

  it('garde la modification la plus récente quand deux appareils changent la même fiche', async () => {
    const a = await appareil(serveur);
    const b = await appareil(serveur);
    const id = await a.repo.creerLogement({ nom: 'Poulailler', type: 'batiment', surfaceM2: 10 });
    await a.synchro.synchroniser();
    await b.synchro.synchroniser();
    await a.repo.modifierLogement(id, { nom: 'Poulailler A', type: 'batiment', surfaceM2: 10 });
    await b.repo.modifierLogement(id, { nom: 'Poulailler B', type: 'batiment', surfaceM2: 10 });
    await a.synchro.synchroniser();
    await b.synchro.synchroniser();
    await a.synchro.synchroniser();
    expect((await a.base.logements.get(id))?.nom).toBe('Poulailler B');
    expect((await b.base.logements.get(id))?.nom).toBe('Poulailler B');
  });

  it('partage factures, règlements, carnet et employés entre appareils', async () => {
    const a = await appareil(serveur);
    const b = await appareil(serveur);
    const f = await a.repo.ajouterOperation({ sens: 'recette', categorie: 'oeufs', tiers: 'Awa', paye: false, acompte: 1000, lignes: [{ libelle: 'Œufs', quantite: 2, prixUnitaire: 1500 }] });
    await a.repo.enregistrerEmploye({ nom: 'Moussa', salaire: 45000 });
    await a.synchro.synchroniser();
    await b.synchro.synchroniser();
    expect(await b.base.operations.get(f.id)).toMatchObject({ montant: 3000, numero: expect.stringMatching(/^F-\d{4}-0001$/) });
    expect(await b.base.paiements.count()).toBe(1);
    expect(await b.base.tiers.count()).toBe(1);
    expect(await b.base.employes.count()).toBe(1);
    // Deux règlements saisis en même temps sur deux téléphones sont tous deux conservés.
    await a.repo.ajouterPaiement(f.id, 500, 'wave');
    await b.repo.ajouterPaiement(f.id, 700, 'especes');
    await a.synchro.synchroniser();
    await b.synchro.synchroniser();
    await a.synchro.synchroniser();
    expect(await a.base.paiements.count()).toBe(3);
    expect(await b.base.paiements.count()).toBe(3);
  });

  it('partage comptes, transferts et comptages : les deux appareils voient les mêmes soldes', async () => {
    const a = await appareil(serveur);
    const b = await appareil(serveur);
    await a.repo.creerComptesParDefaut();
    const [wave, caisse] = ['Wave', 'Caisse'].map((nom) => nom);
    const ids = Object.fromEntries((await a.base.comptes.toArray()).map((c) => [c.nom, c.id]));
    await a.repo.creerTransfert({ deId: ids[wave!]!, versId: ids[caisse!]!, montant: 1000, frais: 10 });
    await a.repo.pointer({ compteId: ids[caisse!]!, soldeReel: 900 });
    await a.synchro.synchroniser();
    await b.synchro.synchroniser();
    expect([await b.base.comptes.count(), await b.base.transferts.count(), await b.base.pointages.count()]).toEqual([4, 1, 1]);
  });

  it('propage une annulation (suppression logique)', async () => {
    const a = await appareil(serveur);
    const b = await appareil(serveur);
    const lotId = await a.repo.creerLot({ nom: 'Soie', especeCode: 'poule', effectif: 5 });
    const annul = await a.repo.ajouterPonte({ lotId, nombre: 3 });
    await a.synchro.synchroniser();
    await b.synchro.synchroniser();
    await a.repo.annuler(annul);
    await a.synchro.synchroniser();
    await b.synchro.synchroniser();
    expect((await b.base.pontes.get(annul.id))?.supprimeLe).toBeTruthy();
  });

  it('reprend les réponses partielles jusqu’au bout', async () => {
    const petit = fauxServeur(2);
    const a = await appareil(petit);
    for (let i = 0; i < 5; i++) await a.repo.creerLogement({ nom: `Local ${i}`, type: 'batiment', surfaceM2: 5 });
    await a.synchro.synchroniser();
    const b = await appareil(petit);
    expect(await b.synchro.synchroniser()).toMatchObject({ etat: 'ok', recus: 5 });
    expect(await b.base.logements.count()).toBe(5);
  });

  it('reste silencieux hors connexion et envoie tout au retour du réseau', async () => {
    const a = await appareil(serveur);
    serveur.coupure(true);
    await a.repo.creerLot({ nom: 'Soie', especeCode: 'poule', effectif: 12 });
    expect(await a.synchro.synchroniser()).toEqual({ etat: 'hors_ligne' });
    serveur.coupure(false);
    expect(await a.synchro.synchroniser()).toMatchObject({ etat: 'ok', envoyes: 2 });
  });

  it('un rôle en lecture seule ne propose aucune modification', async () => {
    const a = await appareil(serveur);
    await a.repo.creerLot({ nom: 'Soie', especeCode: 'poule', effectif: 12 });
    await a.synchro.synchroniser();
    const vet = await appareil(serveur, 'veterinaire');
    await vet.repo.creerLogement({ nom: 'Brouillon', type: 'batiment', surfaceM2: 1 });
    const r = await vet.synchro.synchroniser();
    expect(r).toMatchObject({ etat: 'ok', envoyes: 0 });
    expect(serveur.appels.at(-1)?.changements).toEqual([]);
    expect([...serveur.lignes.keys()].some((k) => k.startsWith('logements/'))).toBe(false);
  });

  it('repart du début et met à jour ses droits quand l’administrateur les change', async () => {
    const a = await appareil(serveur);
    await a.repo.creerLot({ nom: 'Soie', especeCode: 'poule', effectif: 5 });
    await a.synchro.synchroniser();
    const b = await appareil(serveur, 'soigneur');
    serveur.definirDroits({ role: 'soigneur', droits: droitsEffectifs('soigneur', null), zones: [] });
    await b.synchro.synchroniser();
    const seqAvant = (await b.synchro.lire())!.derniereSeq;
    expect(seqAvant).toBeGreaterThan(0);
    serveur.definirDroits({ role: 'personnalise', fonction: 'Responsable bâtiment A', droits: ['cheptel.voir', 'finances.voir_recettes'], zones: ['bat-a'] });
    await b.synchro.synchroniser();
    expect(serveur.appels.slice(-2).map((x) => x.depuisSeq)).toEqual([seqAvant, 0]);
    expect(await b.synchro.lire()).toMatchObject({ role: 'personnalise', fonction: 'Responsable bâtiment A', droits: ['cheptel.voir', 'finances.voir_recettes'], zones: ['bat-a'] });
  });

  it('n’envoie pas les tables que les droits ne permettent pas d’écrire', async () => {
    const a = await appareil(serveur, 'soigneur');
    serveur.definirDroits({ role: 'soigneur', droits: droitsEffectifs('soigneur', null), zones: [] });
    await a.repo.ajouterPonte({ lotId: 'x', nombre: 3 });
    await a.repo.ajouterOperation({ sens: 'depense', categorie: 'soins', montant: 100 });
    await a.synchro.synchroniser();
    const envoyes = serveur.appels.flatMap((x) => x.changements.map((c) => c.table));
    expect(envoyes).toContain('pontes');
    expect(envoyes).not.toContain('operations');
    expect(envoyes).not.toContain('paiements');
  });

  it('mémorise un refus du serveur (session expirée) pour l’afficher', async () => {
    const a = await appareil(serveur);
    serveur.refuser({ statut: 401, erreur: 'Session expirée. Reconnectez-vous.' });
    const r = await a.synchro.synchroniser();
    expect(r).toMatchObject({ etat: 'refuse' });
    expect((await a.synchro.lire())?.erreur).toMatch(/expiré/);
    serveur.refuser(null);
    await a.synchro.synchroniser();
    expect((await a.synchro.lire())?.erreur).toBeUndefined();
  });

  it('sans compte, ne fait rien', async () => {
    const base = new BaseElevage(`sync-${++n}`);
    expect(await creerSynchro(base, serveur.fetch).synchroniser()).toEqual({ etat: 'non_connecte' });
  });

  it('après une restauration, repart de zéro', async () => {
    const a = await appareil(serveur);
    await a.repo.creerLot({ nom: 'Soie', especeCode: 'poule', effectif: 12 });
    await a.synchro.synchroniser();
    await a.repo.toutEffacer();
    expect((await a.synchro.lire())?.derniereSeq).toBe(0);
    await a.synchro.synchroniser();
    expect(await a.base.lots.count()).toBe(1);
  });

  it('des saisies rapprochées gardent des instants distincts', async () => {
    const a = await appareil(serveur);
    const id = await a.repo.creerLogement({ nom: 'A', type: 'batiment', surfaceM2: 1 });
    const avant = (await a.base.logements.get(id))!.misAJour;
    await a.repo.modifierLogement(id, { nom: 'B', type: 'batiment', surfaceM2: 1 });
    expect((await a.base.logements.get(id))!.misAJour).toBeGreaterThan(avant);
  });
});

describe('appareil relié à un compte', () => {
  const org = (id: string, role: RoleMembre = 'proprietaire') => ({ id, nom: 'Ferme', role, droits: droitsEffectifs(role, null), zones: [] as string[] });

  it('une fois relié, l’appareil ne s’ouvre plus sans compte, même après déconnexion', async () => {
    const serveur = fauxServeur();
    const a = await appareil(serveur);
    expect((await a.base.appareil.get('compteRequis'))?.valeur).toBe(true);
    await a.synchro.deconnecter();
    expect(await a.synchro.lire()).toBeUndefined();
    expect((await a.base.appareil.get('compteRequis'))?.valeur).toBe(true);
    // Les données restent sur l'appareil.
    expect(await a.base.logements.count()).toBe(0);
  });

  it('garde les données quand la même personne se reconnecte et renvoie ce qui n’était pas parti', async () => {
    const serveur = fauxServeur();
    const a = await appareil(serveur);
    await a.repo.creerLogement({ nom: 'Poulailler', type: 'batiment', surfaceM2: 10 });
    await a.synchro.deconnecter({ auto: true });
    expect((await a.base.appareil.get('deconnecteAuto'))?.valeur).toBe(true);
    expect((await a.base.appareil.get('proprietaire'))?.valeur).toMatchObject({ nonEnvoyes: 1 });
    await a.synchro.lier('http://serveur.test', 'jeton2', 'ndiaye.moussa', org('org-1'));
    expect((await a.base.appareil.get('deconnecteAuto'))).toBeUndefined();
    expect(await a.base.logements.count()).toBe(1);
    await a.synchro.synchroniser();
    expect(serveur.lignes.size).toBe(1);
  });

  it('refuse de mélanger les données d’une autre personne ou d’un autre élevage, sauf si l’on efface l’appareil', async () => {
    const serveur = fauxServeur();
    const a = await appareil(serveur);
    await a.repo.creerLogement({ nom: 'Poulailler', type: 'batiment', surfaceM2: 10 });
    await a.synchro.deconnecter();
    await expect(a.synchro.lier('http://serveur.test', 'j', 'autre.personne', org('org-1', 'soigneur'))).rejects.toBeInstanceOf(ErreurAppareilAutre);
    await expect(a.synchro.lier('http://serveur.test', 'j', 'ndiaye.moussa', org('org-2'))).rejects.toBeInstanceOf(ErreurAppareilAutre);
    expect(await a.base.logements.count()).toBe(1);
    await a.synchro.lier('http://serveur.test', 'j', 'autre.personne', org('org-1', 'soigneur'), { effacer: true });
    expect(await a.base.logements.count()).toBe(0);
    expect((await a.base.appareil.get('proprietaire'))?.valeur).toMatchObject({ identifiant: 'autre.personne' });
  });

  it('prévient du nombre de saisies jamais envoyées avant d’effacer', async () => {
    const serveur = fauxServeur();
    const a = await appareil(serveur);
    await a.repo.creerLogement({ nom: 'A', type: 'batiment', surfaceM2: 1 });
    await a.repo.creerLogement({ nom: 'B', type: 'batiment', surfaceM2: 1 });
    await a.synchro.deconnecter();
    const e = await a.synchro.lier('http://serveur.test', 'j', '+221770000000', org('org-1')).catch((x) => x);
    expect(e).toBeInstanceOf(ErreurAppareilAutre);
    expect(e.nonEnvoyes).toBe(2);
  });

  it('effacer l’appareil le remet à neuf : plus de compte requis, plus de code', async () => {
    const serveur = fauxServeur();
    const a = await appareil(serveur);
    await a.base.appareil.put({ cle: 'verrou', valeur: { sel: 'x' } });
    await a.synchro.effacerAppareil();
    expect(await a.base.appareil.count()).toBe(0);
    expect(await a.base.connexion.count()).toBe(0);
  });
});

describe('comptes : identifiant et mot de passe', () => {
  /** Enregistre les appels et renvoie des réponses prévues. */
  interface Refus { statut: number; erreur: string }
  function appelsFictifs(reponses: Record<string, unknown>) {
    const vus: { chemin: string; methode: string; corps: Record<string, unknown>; autorisation: string | null }[] = [];
    const f: Fetch = async (entree, init) => {
      const chemin = new URL(String(entree)).pathname;
      const methode = (init?.method ?? 'GET').toUpperCase();
      vus.push({ chemin, methode, corps: init?.body ? JSON.parse(String(init.body)) : {}, autorisation: new Headers(init?.headers).get('authorization') });
      const r = reponses[`${methode} ${chemin}`];
      if (r && typeof r === 'object' && 'statut' in r) {
        const refus = r as Refus;
        return new Response(JSON.stringify({ erreur: refus.erreur }), { status: refus.statut });
      }
      return new Response(JSON.stringify(r ?? { ok: true }), { status: 200 });
    };
    return { f, vus };
  }
  const synchroAvec = (f: Fetch) => creerSynchro(new BaseElevage(`comptes-${++n}`), f);
  const org = { id: 'org-1', nom: 'Ferme test', role: 'soigneur', droits: [], zones: [] };

  it('se connecte avec l’identifiant (sans espaces autour) et le mot de passe, sans rien envoyer d’autre', async () => {
    const { f, vus } = appelsFictifs({ 'POST /v1/auth/connexion': { jeton: 'j1', utilisateur: { identifiant: 'ndiaye.moussa', nom: 'Moussa Ndiaye' }, doitChanger: true, organisations: [org] } });
    const s = await synchroAvec(f).seConnecter('http://serveur.test', '  ndiaye.moussa ', 'k7mq-x9pt-4tnw');
    expect(s).toMatchObject({ jeton: 'j1', identifiant: 'ndiaye.moussa', doitChanger: true });
    expect(vus[0]!.corps).toMatchObject({ identifiant: 'ndiaye.moussa', motDePasse: 'k7mq-x9pt-4tnw' });
    expect(Object.keys(vus[0]!.corps).sort()).toEqual(['appareil', 'identifiant', 'motDePasse']);
  });

  it('remonte le message du serveur quand les identifiants sont faux', async () => {
    const { f } = appelsFictifs({ 'POST /v1/auth/connexion': { statut: 401, erreur: 'Identifiant ou mot de passe incorrect.' } });
    await expect(synchroAvec(f).seConnecter('http://serveur.test', 'x', 'y')).rejects.toMatchObject({ statut: 401, message: 'Identifiant ou mot de passe incorrect.' });
  });

  it('choisit son mot de passe avec la session reçue, pas avec celle de l’appareil', async () => {
    const { f, vus } = appelsFictifs({});
    await synchroAvec(f).choisirMotDePasse('http://serveur.test', 'jeton-provisoire', 'k7mq-x9pt-4tnw', 'Mon-Nouveau-Mot-2');
    expect(vus[0]).toMatchObject({ chemin: '/v1/moi/mot-de-passe', methode: 'POST', autorisation: 'Bearer jeton-provisoire', corps: { ancien: 'k7mq-x9pt-4tnw', nouveau: 'Mon-Nouveau-Mot-2' } });
  });

  it('crée l’administrateur au premier lancement et rend les codes de secours', async () => {
    const { f, vus } = appelsFictifs({
      'GET /v1/installation': { aInitialiser: true, cleRequise: true },
      'POST /v1/installation': { jeton: 'j0', utilisateur: { identifiant: 'admin', nom: 'Aminata' }, doitChanger: false, organisations: [{ ...org, role: 'proprietaire' }], codesSecours: ['aaaa-bbbb-cccc'] },
    });
    const s = synchroAvec(f);
    expect(await s.etatInstallation('http://serveur.test')).toEqual({ aInitialiser: true, cleRequise: true });
    const r = await s.installer('http://serveur.test', { cle: 'k7mq-x9pt', identifiant: 'admin', motDePasse: 'Poule-Pondeuse-7', nom: 'Aminata', nomElevage: 'Ferme Sow' });
    expect(r).toMatchObject({ jeton: 'j0', identifiant: 'admin', codesSecours: ['aaaa-bbbb-cccc'] });
    expect(vus[1]!.corps).toMatchObject({ cle: 'k7mq-x9pt', identifiant: 'admin', nomElevage: 'Ferme Sow' });
  });

  it('une fois relié, l’administrateur ajoute une personne et obtient son mot de passe provisoire', async () => {
    const { f, vus } = appelsFictifs({
      'POST /v1/organisations/org-1/membres': { ok: true, identifiant: 'sow.awa', nom: 'Awa Sow', motDePasseProvisoire: 'k7mq-x9pt-4tnw', expireLe: '2026-10-13T10:00:00.000Z' },
      'POST /v1/organisations/org-1/membres/sow.awa/mot-de-passe': { ok: true, identifiant: 'sow.awa', nom: 'Awa Sow', motDePasseProvisoire: 'ccdd-eeff-ghjk', expireLe: '2026-10-13T10:00:00.000Z' },
    });
    const s = synchroAvec(f);
    await s.lier('http://serveur.test', 'jeton', 'admin', { id: 'org-1', nom: 'Ferme test', role: 'proprietaire', droits: droitsEffectifs('proprietaire', null), zones: [] });
    const cree = await s.ajouterMembre({ prenom: 'Awa', nom: 'Sow', role: 'soigneur' });
    expect(cree).toMatchObject({ identifiant: 'sow.awa', motDePasseProvisoire: 'k7mq-x9pt-4tnw' });
    expect(vus.at(-1)).toMatchObject({ autorisation: 'Bearer jeton', corps: { prenom: 'Awa', nom: 'Sow', role: 'soigneur' } });
    expect((await s.reinitialiserMotDePasse('sow.awa')).motDePasseProvisoire).toBe('ccdd-eeff-ghjk');
    await s.modifierMembre('sow.awa', { fonction: 'Aide' });
    expect(vus.at(-1)).toMatchObject({ chemin: '/v1/organisations/org-1/membres/sow.awa', methode: 'PATCH', corps: { fonction: 'Aide' } });
  });

  it('mémorise l’identifiant (et non un numéro) comme propriétaire de l’appareil à la déconnexion', async () => {
    const { f } = appelsFictifs({});
    const base = new BaseElevage(`comptes-${++n}`);
    const s = creerSynchro(base, f);
    await s.lier('http://serveur.test', 'jeton', 'sow.awa', { id: 'org-1', nom: 'Ferme test', role: 'soigneur', droits: droitsEffectifs('soigneur', null), zones: [] });
    await s.deconnecter();
    expect((await base.appareil.get('proprietaire'))?.valeur).toMatchObject({ identifiant: 'sow.awa', organisationId: 'org-1' });
    expect((await base.connexion.get('serveur'))).toBeUndefined();
  });
});
