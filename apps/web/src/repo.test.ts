import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { effectifs, stockAlimentKg } from '@digitalab/core';
import { BaseElevage } from './db';
import { ErreurSaisie, creerRepo, type Repo } from './repo';
import { appliquerEtats, fusionnerReglages } from './useElevage';

let n = 0;
let base: BaseElevage;
let repo: Repo;
beforeEach(() => {
  base = new BaseElevage(`test-${++n}`);
  repo = creerRepo(base);
});

const effectif = async (lotId: string) => effectifs(await base.mouvements.toArray()).get(lotId);

describe('lots et effectifs', () => {
  it('crée un lot avec son effectif de départ dans le journal', async () => {
    const id = await repo.creerLot({ nom: ' Soie ', especeCode: 'poule', effectif: 12 });
    expect((await base.lots.get(id))?.nom).toBe('Soie');
    expect(await effectif(id)).toBe(12);
  });

  it('refuse un lot sans nom ou sans animaux', async () => {
    await expect(repo.creerLot({ nom: ' ', especeCode: 'poule', effectif: 5 })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(repo.creerLot({ nom: 'A', especeCode: 'poule', effectif: 0 })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(repo.creerLot({ nom: 'A', especeCode: 'poule', effectif: 2.5 })).rejects.toBeInstanceOf(ErreurSaisie);
  });

  it('enregistre un décès, refuse plus de morts que d’animaux, et sait l’annuler', async () => {
    const id = await repo.creerLot({ nom: 'A', especeCode: 'poule', effectif: 10 });
    const a = await repo.ajouterDeces({ lotId: id, nombre: 3, cause: 'Maladie' });
    expect(await effectif(id)).toBe(7);
    await expect(repo.ajouterDeces({ lotId: id, nombre: 8 })).rejects.toThrow('7 animaux');
    await repo.annuler(a);
    expect(await effectif(id)).toBe(10);
    // l'enregistrement n'est pas effacé : suppression logique
    expect(await base.mouvements.get(a.id)).toMatchObject({ supprimeLe: expect.any(Number) });
  });

  it('corrige l’effectif après comptage', async () => {
    const id = await repo.creerLot({ nom: 'A', especeCode: 'poule', effectif: 10 });
    await repo.corrigerEffectif(id, 8);
    expect(await effectif(id)).toBe(8);
    expect(await repo.corrigerEffectif(id, 8)).toBeNull();
  });

  it('n’archive pas un lot qui compte encore des animaux', async () => {
    const id = await repo.creerLot({ nom: 'A', especeCode: 'poule', effectif: 2 });
    await expect(repo.archiverLot(id)).rejects.toBeInstanceOf(ErreurSaisie);
    await repo.enregistrerSortie({ lotId: id, type: 'vente', nombre: 2 });
    await repo.archiverLot(id);
    expect((await base.lots.get(id))?.archive).toBe(true);
  });
});

describe('ponte, aliment et stock', () => {
  it('valide les œufs cassés', async () => {
    const id = await repo.creerLot({ nom: 'A', especeCode: 'poule', effectif: 5 });
    await expect(repo.ajouterPonte({ lotId: id, nombre: 4, casses: 5 })).rejects.toBeInstanceOf(ErreurSaisie);
    await repo.ajouterPonte({ lotId: id, nombre: 0 });
    expect(await base.pontes.count()).toBe(1);
  });

  it('tient le stock : achat, distribution, comptage', async () => {
    const id = await repo.creerLot({ nom: 'A', especeCode: 'poule', effectif: 5 });
    await repo.ajouterAchatAliment({ quantiteKg: 50, prixTotal: 20000 });
    await repo.ajouterDistribution({ lotId: id, quantiteKg: 2.5 });
    const donnees = async () => ({ entreesStock: await base.entreesStock.toArray(), distributions: await base.distributions.toArray() });
    expect(stockAlimentKg(await donnees())).toBe(47.5);
    await repo.corrigerStock(47.5, 40);
    expect(stockAlimentKg(await donnees())).toBe(40);
    await expect(repo.ajouterDistribution({ lotId: id, quantiteKg: 0 })).rejects.toBeInstanceOf(ErreurSaisie);
  });
});

describe('locaux', () => {
  it('refuse de supprimer un local occupé', async () => {
    const lg = await repo.creerLogement({ nom: 'Poulailler', type: 'batiment', surfaceM2: 10 });
    const lot = await repo.creerLot({ nom: 'A', especeCode: 'poule', effectif: 3, logementId: lg });
    await expect(repo.supprimerLogement(lg)).rejects.toBeInstanceOf(ErreurSaisie);
    await repo.changerLogement(lot, null);
    await repo.supprimerLogement(lg);
    expect((await base.logements.get(lg))?.supprimeLe).toBeTruthy();
  });
});

describe('sauvegarde', () => {
  it('exporte puis restaure toutes les données', async () => {
    const id = await repo.creerLot({ nom: 'A', especeCode: 'caille', effectif: 40 });
    await repo.ajouterPonte({ lotId: id, nombre: 30 });
    await repo.ecrireReglage('nomElevage', 'Ferme');
    const json = await repo.exporter();
    await repo.toutEffacer();
    expect(await base.lots.count()).toBe(0);
    await repo.importer(json);
    expect(await base.lots.count()).toBe(1);
    expect(await base.pontes.count()).toBe(1);
    expect(await repo.lireReglage('nomElevage', '')).toBe('Ferme');
  });

  it('refuse un fichier qui n’est pas une sauvegarde', async () => {
    await expect(repo.importer('pas du json')).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(repo.importer('{"a":1}')).rejects.toBeInstanceOf(ErreurSaisie);
  });
});

describe('réglages et états d’alerte', () => {
  it('fusionne les réglages enregistrés avec les valeurs de départ', () => {
    const r = fusionnerReglages({ seuils: { minDeces: 5 }, especes: { poule: { m2ParAnimal: 0.5 } } });
    expect(r.seuils.minDeces).toBe(5);
    expect(r.seuils.heureBilanPonte).toBe(17);
    expect(r.especes['poule']?.m2ParAnimal).toBe(0.5);
    expect(r.especes['caille']?.m2ParAnimal).toBe(0.015);
  });

  it('masque une alerte reportée jusqu’à l’échéance et marque celles prises en charge', () => {
    const a = (cle: string) => ({ cle, code: 'densite' as const, niveau: 'rouge' as const, params: {} });
    const etats = [
      { cle: 'x', statut: 'reportee' as const, jusqua: 2000 },
      { cle: 'y', statut: 'prise_en_charge' as const },
    ];
    expect(appliquerEtats([a('x'), a('y'), a('z')], etats, 1000).map((e) => [e.alerte.cle, e.priseEnCharge])).toEqual([['y', true], ['z', false]]);
    expect(appliquerEtats([a('x')], etats, 3000)).toHaveLength(1);
  });
});
