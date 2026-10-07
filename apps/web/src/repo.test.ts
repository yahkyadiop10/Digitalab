import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { effectifs, stockAlimentKg } from '@digitalab/core';
import { BaseElevage } from './db';
import { ErreurSaisie, creerRepo, type Repo } from './repo';
import { fusionnerReglages } from './reglages';
import { appliquerEtats } from './useElevage';

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

describe('incubation', () => {
  const nouvelleCouveuse = (capacites: Record<string, number> = { poule: 100 }, eclosoirSepare = false) =>
    repo.creerCouveuse({ nom: 'C', type: 'automatique', capacites, eclosoirSepare });

  it('refuse plus d’œufs que la couveuse n’en accepte, et tient compte des œufs déjà présents', async () => {
    const c = await nouvelleCouveuse();
    await repo.mettreEnIncubation({ couveuseId: c, especeCode: 'poule', nom: 'A', nbOeufs: 70 });
    await expect(repo.mettreEnIncubation({ couveuseId: c, especeCode: 'poule', nom: 'B', nbOeufs: 31 })).rejects.toThrow('30 places');
    await repo.mettreEnIncubation({ couveuseId: c, especeCode: 'poule', nom: 'B', nbOeufs: 30 });
    expect(await base.incubations.count()).toBe(2);
  });

  it('ne contrôle pas la place quand la capacité est inconnue, mais refuse les dates futures', async () => {
    const c = await nouvelleCouveuse({});
    await repo.mettreEnIncubation({ couveuseId: c, especeCode: 'poule', nom: 'A', nbOeufs: 5000 });
    await expect(repo.mettreEnIncubation({ couveuseId: c, especeCode: 'poule', nom: 'B', nbOeufs: 5, miseEnPlace: '2999-01-01' })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(repo.mettreEnIncubation({ couveuseId: c, especeCode: 'autre', nom: 'C', nbOeufs: 5 })).rejects.toThrow('repères');
  });

  it('enregistre un mirage, refuse les doublons et les retraits trop grands, puis l’annule', async () => {
    const c = await nouvelleCouveuse();
    const i = await repo.mettreEnIncubation({ couveuseId: c, especeCode: 'poule', nom: 'A', nbOeufs: 20 });
    await expect(repo.enregistrerMirage({ incubationId: i, etape: 7, clairs: 15, morts: 6 })).rejects.toThrow('20 œufs');
    const a = await repo.enregistrerMirage({ incubationId: i, etape: 7, clairs: 4, morts: 1 });
    await expect(repo.enregistrerMirage({ incubationId: i, etape: 7, clairs: 0, morts: 0 })).rejects.toThrow('déjà noté');
    await repo.annuler(a);
    await repo.enregistrerMirage({ incubationId: i, etape: 7, clairs: 0, morts: 0 });
  });

  it('crée le lot de poussins à l’éclosion et sait l’annuler', async () => {
    const c = await nouvelleCouveuse();
    const i = await repo.mettreEnIncubation({ couveuseId: c, especeCode: 'caille', nom: 'Cailles', nbOeufs: 30 });
    await repo.enregistrerMirage({ incubationId: i, etape: 7, clairs: 5, morts: 0 });
    await expect(repo.enregistrerEclosion({ incubationId: i, nes: 26 })).rejects.toThrow('25 œufs');
    const lotId = await repo.enregistrerEclosion({ incubationId: i, nes: 22, mortsCoquille: 3 });
    expect(lotId).toBeTruthy();
    expect(await effectif(lotId!)).toBe(22);
    expect(await base.lots.get(lotId!)).toMatchObject({ especeCode: 'caille', incubationId: i });
    expect((await base.incubations.get(i))?.eclosion).toMatchObject({ nes: 22, mortsCoquille: 3, lotId });
    await expect(repo.enregistrerEclosion({ incubationId: i, nes: 1 })).rejects.toThrow('déjà notée');

    await repo.annulerEclosion(i);
    expect((await base.incubations.get(i))?.eclosion).toBeUndefined();
    expect((await base.lots.get(lotId!))?.supprimeLe).toBeTruthy();
    expect(await effectif(lotId!)).toBeUndefined();
  });

  it('refuse d’annuler l’éclosion quand les poussins ont déjà un historique', async () => {
    const c = await nouvelleCouveuse();
    const i = await repo.mettreEnIncubation({ couveuseId: c, especeCode: 'poule', nom: 'A', nbOeufs: 10 });
    const lotId = (await repo.enregistrerEclosion({ incubationId: i, nes: 8 }))!;
    await repo.ajouterDeces({ lotId, nombre: 1 });
    await expect(repo.annulerEclosion(i)).rejects.toThrow('historique');
  });

  it('coche les étapes sans chiffres et refuse de supprimer une couveuse occupée', async () => {
    const c = await nouvelleCouveuse();
    const i = await repo.mettreEnIncubation({ couveuseId: c, especeCode: 'poule', nom: 'A', nbOeufs: 10 });
    await repo.definirFait(i, 'transfert', true);
    expect((await base.incubations.get(i))?.faits).toEqual(['transfert']);
    await repo.definirFait(i, 'transfert', false);
    expect((await base.incubations.get(i))?.faits).toEqual([]);
    await expect(repo.supprimerCouveuse(c)).rejects.toBeInstanceOf(ErreurSaisie);
    await repo.supprimerIncubation(i);
    await repo.supprimerCouveuse(c);
  });

  it('restaure aussi les données d’incubation depuis une sauvegarde', async () => {
    const c = await nouvelleCouveuse();
    await repo.mettreEnIncubation({ couveuseId: c, especeCode: 'poule', nom: 'A', nbOeufs: 10 });
    const json = await repo.exporter();
    await repo.toutEffacer();
    await repo.importer(json);
    expect(await base.couveuses.count()).toBe(1);
    expect(await base.incubations.count()).toBe(1);
  });
});
