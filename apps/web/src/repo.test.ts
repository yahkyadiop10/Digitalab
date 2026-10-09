import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { effectifs, soldesComptes, stockAlimentKg } from '@digitalab/core';
import { BaseElevage } from './db';
import { ErreurSaisie, aujourdhui, creerRepo, type Repo } from './repo';
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

describe('finances', () => {
  it('note une dépense payée et une recette à encaisser, puis la marque encaissée', async () => {
    const a = await repo.ajouterOperation({ sens: 'depense', categorie: 'materiel', montant: 12000, tiers: ' Quincaillerie ' });
    expect(await base.operations.get(a.id)).toMatchObject({ sens: 'depense', montant: 12000, tiers: 'Quincaillerie' });
    expect(await base.paiements.where('operationId').equals(a.id).toArray()).toMatchObject([{ montant: 12000, mode: 'especes' }]);
    const b = await repo.ajouterOperation({ sens: 'recette', categorie: 'poussins', montant: 45000, paye: false });
    expect(await base.paiements.where('operationId').equals(b.id).count()).toBe(0);
    await repo.marquerPaye(b.id, 'wave');
    expect(await base.paiements.where('operationId').equals(b.id).toArray()).toMatchObject([{ montant: 45000, mode: 'wave' }]);
    await repo.annuler(a);
    expect((await base.operations.get(a.id))?.supprimeLe).toBeTruthy();
  });

  it('crée une facture détaillée numérotée, avec remise et acompte', async () => {
    const f = await repo.ajouterOperation({
      sens: 'recette', categorie: 'oeufs', tiers: 'Boutique Awa', telephoneTiers: '77 111 22 33', paye: false, acompte: 20000, mode: 'wave', remise: 2500, echeance: aujourdhui(),
      lignes: [{ libelle: ' Plateaux d’œufs ', quantite: 30, prixUnitaire: 2500 }, { libelle: 'Poulets', quantite: 2, prixUnitaire: 3000 }],
    });
    const op = (await base.operations.get(f.id))!;
    expect(op).toMatchObject({ montant: 78500, remise: 2500, numero: `F-${aujourdhui().slice(0, 4)}-0001`, tiers: 'Boutique Awa' });
    expect(op.lignes?.[0]?.libelle).toBe('Plateaux d’œufs');
    expect((await base.tiers.get(op.tiersId!))?.telephone).toBe('77 111 22 33');
    const g = await repo.ajouterOperation({ sens: 'recette', categorie: 'oeufs', paye: false, lignes: [{ libelle: 'Œufs', quantite: 1, prixUnitaire: 1000 }] });
    expect((await base.operations.get(g.id))?.numero).toBe(`F-${aujourdhui().slice(0, 4)}-0002`);
  });

  it('retrouve le client du carnet au lieu d’en créer un second', async () => {
    await repo.ajouterOperation({ sens: 'recette', categorie: 'oeufs', montant: 1000, tiers: 'M. Diop' });
    await repo.ajouterOperation({ sens: 'recette', categorie: 'oeufs', montant: 2000, tiers: 'm. diop' });
    expect(await base.tiers.count()).toBe(1);
  });

  it('refuse un règlement qui dépasse le reste, et accepte les règlements successifs', async () => {
    const f = await repo.ajouterOperation({ sens: 'recette', categorie: 'poussins', montant: 100000, paye: false, acompte: 30000 });
    await expect(repo.ajouterPaiement(f.id, 80000, 'especes')).rejects.toThrow(/70000/);
    await repo.ajouterPaiement(f.id, 70000, 'orange_money');
    await expect(repo.ajouterPaiement(f.id, 1, 'especes')).rejects.toThrow(/déjà entièrement réglée/);
  });

  it('annuler un règlement rouvre le reste à payer', async () => {
    const f = await repo.ajouterOperation({ sens: 'depense', categorie: 'materiel', montant: 10000, paye: false });
    const p = await repo.ajouterPaiement(f.id, 10000, 'especes');
    await repo.annuler(p);
    await repo.ajouterPaiement(f.id, 10000, 'wave');
  });

  it('refuse un acompte supérieur au total, une ligne sans nom ou sans quantité, une échéance passée', async () => {
    await expect(repo.ajouterOperation({ sens: 'recette', categorie: 'oeufs', montant: 1000, paye: false, acompte: 2000 })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(repo.ajouterOperation({ sens: 'recette', categorie: 'oeufs', lignes: [{ libelle: ' ', quantite: 1, prixUnitaire: 5 }] })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(repo.ajouterOperation({ sens: 'recette', categorie: 'oeufs', lignes: [{ libelle: 'A', quantite: 0, prixUnitaire: 5 }] })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(repo.ajouterOperation({ sens: 'recette', categorie: 'oeufs', montant: 100, paye: false, echeance: '2000-01-01' })).rejects.toBeInstanceOf(ErreurSaisie);
  });

  it('verse un salaire : dépense de main-d’œuvre payée, rattachée à l’employé et au mois', async () => {
    const e = await repo.enregistrerEmploye({ nom: 'Moussa', poste: 'Soigneur', salaire: 45000 });
    const p = await repo.payerSalaire({ employeId: e, periode: '2026-10', montant: 15000, nature: 'avance', mode: 'wave' });
    expect(await base.operations.get(p.id)).toMatchObject({ sens: 'depense', categorie: 'main_oeuvre', employeId: e, periode: '2026-10', nature: 'avance', tiers: 'Moussa' });
    expect(await base.paiements.where('operationId').equals(p.id).toArray()).toMatchObject([{ montant: 15000, mode: 'wave' }]);
    await expect(repo.payerSalaire({ employeId: 'x', periode: '2026-10', montant: 1000, nature: 'salaire' })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(repo.payerSalaire({ employeId: e, periode: 'octobre', montant: 1000, nature: 'salaire' })).rejects.toBeInstanceOf(ErreurSaisie);
  });

  it('une dépense saisie sans droit de validation n’entre dans aucun chiffre avant d’être validée', async () => {
    const d = await repo.ajouterOperation({ sens: 'depense', categorie: 'materiel', montant: 20000, aValider: true, paiementAValider: true });
    expect(await base.operations.get(d.id)).toMatchObject({ statut: 'a_valider' });
    const [p] = await base.paiements.where('operationId').equals(d.id).toArray();
    expect(p).toMatchObject({ statut: 'a_valider', montant: 20000 });
    await repo.valider({ table: 'operations', id: d.id });
    await repo.valider({ table: 'paiements', id: p!.id });
    expect(await base.operations.get(d.id)).toMatchObject({ statut: 'validee' });
    expect((await base.paiements.get(p!.id))?.statut).toBe('validee');
  });

  it('enregistre le profil de l’élevage : coordonnées et logo, une seule fiche partagée', async () => {
    await repo.enregistrerProfil({ nom: ' Ferme Sow ', adresse: 'Thiès', ninea: '12345' });
    await repo.enregistrerProfil({ logo: 'data:image/png;base64,AAAA' });
    expect(await base.profil.count()).toBe(1);
    expect(await base.profil.get('elevage')).toMatchObject({ nom: 'Ferme Sow', adresse: 'Thiès', ninea: '12345', logo: 'data:image/png;base64,AAAA' });
    await repo.enregistrerProfil({ logo: null });
    expect((await base.profil.get('elevage'))?.logo).toBeUndefined();
    await expect(repo.enregistrerProfil({ logo: `data:image/png;base64,${'A'.repeat(41_000)}` })).rejects.toBeInstanceOf(ErreurSaisie);
  });

  it('contrôle la fiche d’un employé et d’un client', async () => {
    await expect(repo.enregistrerEmploye({ nom: '', salaire: 1000 })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(repo.enregistrerEmploye({ nom: 'A', salaire: 0 })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(repo.enregistrerEmploye({ nom: 'A', salaire: 1000, debut: '2026-10', fin: '2026-09' })).rejects.toBeInstanceOf(ErreurSaisie);
    await repo.enregistrerTiers({ nom: 'Diop' });
    await expect(repo.enregistrerTiers({ nom: ' diop ' })).rejects.toBeInstanceOf(ErreurSaisie);
  });

  it('renommer un client met à jour ses factures', async () => {
    const o = await repo.ajouterOperation({ sens: 'recette', categorie: 'oeufs', montant: 1000, tiers: 'Diop' });
    const tiersId = (await base.operations.get(o.id))!.tiersId!;
    await repo.enregistrerTiers({ id: tiersId, nom: 'Ibrahima Diop', telephone: '77 000 11 22' });
    expect((await base.operations.get(o.id))?.tiers).toBe('Ibrahima Diop');
  });

  it('refuse un montant nul, décimal ou une date future', async () => {
    await expect(repo.ajouterOperation({ sens: 'depense', categorie: 'autre', montant: 0 })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(repo.ajouterOperation({ sens: 'depense', categorie: 'autre', montant: 10.5 })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(repo.ajouterOperation({ sens: 'recette', categorie: 'oeufs', montant: 100, date: '2999-01-01' })).rejects.toBeInstanceOf(ErreurSaisie);
  });

  it('sauvegarde aussi les opérations, les règlements, le carnet et les employés', async () => {
    await repo.ajouterOperation({ sens: 'recette', categorie: 'oeufs', montant: 5000, tiers: 'Awa' });
    await repo.enregistrerEmploye({ nom: 'Moussa', salaire: 45000 });
    const json = await repo.exporter();
    await repo.toutEffacer();
    await repo.importer(json);
    expect(await base.operations.count()).toBe(1);
    expect(await base.paiements.count()).toBe(1);
    expect(await base.tiers.count()).toBe(1);
    expect(await base.employes.count()).toBe(1);
  });
});

describe('quarantaine des nouveaux arrivants', () => {
  const arrivage = (partiel: Partial<Parameters<Repo['creerQuarantaine']>[0]> = {}) =>
    repo.creerQuarantaine({ nom: 'Arrivage', especeCode: 'poule', nombre: 8, dureeJours: 21, ...partiel });

  it('crée le lot dans la zone de quarantaine, avec sa fiche, son effectif et sa naissance estimée', async () => {
    const id = await arrivage({ race: ' Padoue ', ageJours: 56, origine: 'M. Sow', arrivee: '2026-10-01', alimentation: 'Aliment ponte' });
    const q = (await base.quarantaines.get(id))!;
    expect(q).toMatchObject({ nombre: 8, dureeJours: 21, race: 'Padoue', ageJours: 56, origine: 'M. Sow', arrivee: '2026-10-01', etapes: [] });
    const lot = (await base.lots.get(q.lotId))!;
    expect(lot).toMatchObject({ nom: 'Arrivage', race: 'Padoue', naissance: '2026-08-06' });
    expect(await effectif(q.lotId)).toBe(8);
    const zone = (await base.logements.toArray()).filter((l) => l.type === 'quarantaine');
    expect(zone).toHaveLength(1);
    expect(lot.logementId).toBe(zone[0]!.id);
    await arrivage();
    expect((await base.logements.toArray()).filter((l) => l.type === 'quarantaine')).toHaveLength(1);
  });

  it('note l’achat dans les finances quand un prix est donné', async () => {
    const id = await arrivage({ prixTotal: 64000, origine: 'M. Sow' });
    const lotId = (await base.quarantaines.get(id))!.lotId;
    expect((await base.operations.toArray())[0]).toMatchObject({ sens: 'depense', categorie: 'achat_animaux', montant: 64000, lotId, tiers: 'M. Sow', paye: true });
  });

  it('refuse un arrivage sans nom, sans animaux, sans durée ou daté du futur', async () => {
    await expect(arrivage({ nom: ' ' })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(arrivage({ nombre: 0 })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(arrivage({ dureeJours: 0 })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(arrivage({ arrivee: '2999-01-01' })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(arrivage({ ageJours: -3 })).rejects.toBeInstanceOf(ErreurSaisie);
    expect(await base.lots.count()).toBe(0);
  });

  it('tient le journal : comportements, poids, annulation, et refuse une note vide', async () => {
    const id = await arrivage();
    await expect(repo.ajouterNoteQuarantaine({ quarantaineId: id, etat: 'bien', comportements: [] })).rejects.toBeInstanceOf(ErreurSaisie);
    const a = await repo.ajouterNoteQuarantaine({ quarantaineId: id, etat: 'moyen', comportements: ['mange_peu'], poidsMoyenG: 1350, note: 'Fatiguées' });
    expect(await base.notesQuarantaine.get(a.id)).toMatchObject({ etat: 'moyen', poidsMoyenG: 1350, comportements: ['mange_peu'] });
    await expect(repo.ajouterNoteQuarantaine({ quarantaineId: id, etat: 'bien', comportements: ['actif'], poidsMoyenG: -2 })).rejects.toBeInstanceOf(ErreurSaisie);
    await repo.annuler(a);
    expect((await base.notesQuarantaine.get(a.id))?.supprimeLe).toBeTruthy();
  });

  it('prolonge, coche les contrôles, puis intègre les animaux dans le local choisi', async () => {
    const lg = await repo.creerLogement({ nom: 'Poulailler', type: 'batiment', surfaceM2: 20 });
    const id = await arrivage();
    await repo.prolongerQuarantaine(id, 7);
    expect((await base.quarantaines.get(id))?.dureeJours).toBe(28);
    await repo.definirEtapeQuarantaine(id, 'examen', true);
    await repo.definirEtapeQuarantaine(id, 'pesee', true);
    await repo.definirEtapeQuarantaine(id, 'pesee', false);
    expect((await base.quarantaines.get(id))?.etapes).toEqual(['examen']);
    await repo.terminerQuarantaine({ id, decision: 'integre', logementId: lg, note: 'Tout va bien' });
    const q = (await base.quarantaines.get(id))!;
    expect(q.sortie).toMatchObject({ decision: 'integre', logementId: lg, note: 'Tout va bien' });
    expect((await base.lots.get(q.lotId))?.logementId).toBe(lg);
    await expect(repo.terminerQuarantaine({ id, decision: 'ecarte' })).rejects.toThrow('déjà terminée');
    await repo.rouvrirQuarantaine(id);
    expect((await base.quarantaines.get(id))?.sortie).toBeUndefined();
  });

  it('ne déplace pas le lot quand les animaux sont écartés', async () => {
    const id = await arrivage();
    const q0 = (await base.quarantaines.get(id))!;
    const avant = (await base.lots.get(q0.lotId))?.logementId;
    await repo.terminerQuarantaine({ id, decision: 'ecarte', logementId: 'ailleurs' });
    expect((await base.lots.get(q0.lotId))?.logementId).toBe(avant);
  });

  it('sauvegarde et restaure aussi les quarantaines et leur journal', async () => {
    const id = await arrivage();
    await repo.ajouterNoteQuarantaine({ quarantaineId: id, etat: 'bien', comportements: ['actif'] });
    const json = await repo.exporter();
    await repo.toutEffacer();
    await repo.importer(json);
    expect(await base.quarantaines.count()).toBe(1);
    expect(await base.notesQuarantaine.count()).toBe(1);
  });
});

describe('trésorerie', () => {
  const soldeDe = async (nom: string) => {
    const [comptes, operations, paiements, entreesStock, transferts, pointages] = await Promise.all([base.comptes.toArray(), base.operations.toArray(), base.paiements.toArray(), base.entreesStock.toArray(), base.transferts.toArray(), base.pointages.toArray()]);
    return soldesComptes({ comptes, operations, paiements, entreesStock, transferts, pointages }).find((s) => s.compte.nom === nom)!.solde;
  };
  const idDe = async (nom: string) => (await base.comptes.toArray()).find((c) => c.nom === nom)!.id;
  const preparer = async () => {
    await repo.creerComptesParDefaut();
    for (const c of await base.comptes.toArray()) await repo.enregistrerCompte({ id: c.id, nom: c.nom, type: c.type, soldeInitial: c.nom === 'Caisse' ? 20000 : c.nom === 'Wave' ? 50000 : 0, dateInitiale: aujourdhui(), modes: c.modes });
  };

  it('crée les comptes habituels une seule fois, avec leurs moyens de paiement', async () => {
    await repo.creerComptesParDefaut();
    await repo.creerComptesParDefaut();
    const comptes = await base.comptes.toArray();
    expect(comptes.map((c) => c.nom).sort()).toEqual(['Banque', 'Caisse', 'Orange Money', 'Wave']);
    expect(comptes.find((c) => c.nom === 'Banque')?.modes).toEqual(['virement', 'cheque']);
  });

  it('un règlement par Wave entre dans le compte Wave, un paiement en espèces sort de la caisse', async () => {
    await preparer();
    await repo.ajouterOperation({ sens: 'recette', categorie: 'oeufs', montant: 30000, paye: false, acompte: 12000, mode: 'wave' });
    await repo.ajouterOperation({ sens: 'depense', categorie: 'soins', montant: 5000, mode: 'especes' });
    expect(await soldeDe('Wave')).toBe(62000);
    expect(await soldeDe('Caisse')).toBe(15000);
  });

  it('refuse deux comptes pour le même moyen de paiement, un nom en double, un solde décimal', async () => {
    await preparer();
    await expect(repo.enregistrerCompte({ nom: 'Wave pro', type: 'mobile_money', soldeInitial: 0, dateInitiale: aujourdhui(), modes: ['wave'] })).rejects.toThrow(/déjà suivi/);
    await expect(repo.enregistrerCompte({ nom: ' wave ', type: 'mobile_money', soldeInitial: 0, dateInitiale: aujourdhui(), modes: [] })).rejects.toThrow(/existe déjà/);
    await expect(repo.enregistrerCompte({ nom: 'X', type: 'autre', soldeInitial: 10.5, dateInitiale: aujourdhui(), modes: [] })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(repo.enregistrerCompte({ nom: 'X', type: 'autre', soldeInitial: 0, dateInitiale: '2999-01-01', modes: [] })).rejects.toBeInstanceOf(ErreurSaisie);
  });

  it('un transfert déplace l’argent, ses frais sortent du compte d’origine et deviennent une dépense ; l’annuler rétablit tout', async () => {
    await preparer();
    const t = await repo.creerTransfert({ deId: await idDe('Wave'), versId: await idDe('Caisse'), montant: 30000, frais: 300 });
    expect(await soldeDe('Wave')).toBe(50000 - 30300);
    expect(await soldeDe('Caisse')).toBe(50000);
    await repo.annuler(t);
    expect(await soldeDe('Wave')).toBe(50000);
    expect(await soldeDe('Caisse')).toBe(20000);
  });

  it('refuse un transfert vers le même compte, nul, ou avec des frais négatifs', async () => {
    await preparer();
    const w = await idDe('Wave');
    const c = await idDe('Caisse');
    await expect(repo.creerTransfert({ deId: w, versId: w, montant: 100 })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(repo.creerTransfert({ deId: w, versId: c, montant: 0 })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(repo.creerTransfert({ deId: w, versId: c, montant: 100, frais: -5 })).rejects.toBeInstanceOf(ErreurSaisie);
    await expect(repo.creerTransfert({ deId: w, versId: 'inconnu', montant: 100 })).rejects.toBeInstanceOf(ErreurSaisie);
  });

  it('un comptage compare le solde réel au solde annoncé ; l’écart reste à expliquer jusqu’à ce qu’on le corrige', async () => {
    await preparer();
    const c = await idDe('Caisse');
    const p = await repo.pointer({ compteId: c, soldeReel: 19000 });
    expect(p.ecart).toBe(-1000);
    expect(await base.pointages.get(p.id)).toMatchObject({ soldeTheorique: 20000, soldeReel: 19000, ecart: -1000, regularise: false });
    expect(await soldeDe('Caisse')).toBe(20000);
    await expect(repo.regulariserPointage(p.id, ' ')).rejects.toBeInstanceOf(ErreurSaisie);
    await repo.regulariserPointage(p.id, 'rendu de monnaie');
    expect(await soldeDe('Caisse')).toBe(19000);
    expect((await repo.pointer({ compteId: c, soldeReel: 19000 })).ecart).toBe(0);
  });

  it('exige une explication pour corriger tout de suite, et accepte un comptage sans écart', async () => {
    await preparer();
    const c = await idDe('Caisse');
    await expect(repo.pointer({ compteId: c, soldeReel: 21000, regulariser: true })).rejects.toThrow(/Expliquez/);
    await repo.pointer({ compteId: c, soldeReel: 21000, regulariser: true, note: 'vente non notée' });
    expect(await soldeDe('Caisse')).toBe(21000);
  });

  it('l’achat d’aliment payé par un moyen sort du compte correspondant', async () => {
    await preparer();
    await repo.ajouterAchatAliment({ quantiteKg: 50, prixTotal: 20000, mode: 'especes' });
    expect(await soldeDe('Caisse')).toBe(0);
  });

  it('ne retire pas un compte qui a des transferts', async () => {
    await preparer();
    const w = await idDe('Wave');
    const t = await repo.creerTransfert({ deId: w, versId: await idDe('Caisse'), montant: 100 });
    await expect(repo.supprimerCompte(w)).rejects.toBeInstanceOf(ErreurSaisie);
    await repo.annuler(t);
    await repo.supprimerCompte(w);
  });

  it('sauvegarde aussi les comptes, transferts et comptages', async () => {
    await preparer();
    await repo.creerTransfert({ deId: await idDe('Wave'), versId: await idDe('Caisse'), montant: 100 });
    await repo.pointer({ compteId: await idDe('Caisse'), soldeReel: 20000 });
    const json = await repo.exporter();
    await repo.toutEffacer();
    await repo.importer(json);
    expect([await base.comptes.count(), await base.transferts.count(), await base.pointages.count()]).toEqual([4, 1, 1]);
  });
});
