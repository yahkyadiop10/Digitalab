import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChangementSync, DemandeSync, ReponseSync, RoleMembre } from '@digitalab/core';
import { BaseElevage } from './db';
import { creerRepo } from './repo';
import { creerSynchro, type Fetch } from './sync';

/** Un petit serveur en mémoire qui applique la même règle que le vrai : la version la plus récente l'emporte. */
function fauxServeur(limite = 1000) {
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
    for (const ch of d.changements) {
      const cle = `${ch.table}/${ch.enregistrement.id}`;
      const existant = lignes.get(cle);
      if (!existant || existant.ch.enregistrement.misAJour < ch.enregistrement.misAJour) lignes.set(cle, { seq: ++seq, ch });
      else if (existant.ch.enregistrement.misAJour > ch.enregistrement.misAJour) ecartes += 1;
    }
    const apres = [...lignes.values()].filter((l) => l.seq > d.depuisSeq).sort((a, b) => a.seq - b.seq);
    const gardees = apres.slice(0, limite);
    const rep: ReponseSync = { seq: gardees.at(-1)?.seq ?? d.depuisSeq, changements: gardees.map((l) => l.ch), reste: apres.length > limite, ecartes };
    return new Response(JSON.stringify(rep), { status: 200 });
  };
  return { fetch: fetchFictif, appels, lignes, coupure: (v: boolean) => { horsLigne = v; }, refuser: (r: typeof refus) => { refus = r; } };
}

let n = 0;
async function appareil(serveur: ReturnType<typeof fauxServeur>, role: RoleMembre = 'proprietaire') {
  const base = new BaseElevage(`sync-${++n}`);
  const synchro = creerSynchro(base, serveur.fetch);
  await synchro.lier('http://serveur.test', 'jeton', '+221771234567', { id: 'org-1', nom: 'Ferme test', role });
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
