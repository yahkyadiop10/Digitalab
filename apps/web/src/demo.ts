import { ajouterJours } from '@digitalab/core';
import { db } from './db';
import { aujourdhui, nouvelId, repo } from './repo';

/** Charge un petit élevage d'exemple pour essayer l'application. */
export async function chargerDemo(): Promise<void> {
  const auj = aujourdhui();
  const j = (n: number) => ajouterJours(auj, -n);
  const t = Date.now();
  const bruit = { misAJour: t };

  const poulailler = await repo.creerLogement({ nom: 'Poulailler 1', type: 'batiment', surfaceM2: 12 });
  const cages = await repo.creerLogement({ nom: 'Batterie cailles A', type: 'cage', surfaceM2: 1.2 });
  const soie = await repo.creerLot({ nom: 'Soie blanche – lot A', especeCode: 'poule', race: 'Soie', naissance: j(25), logementId: poulailler, effectif: 18 });
  const brahma = await repo.creerLot({ nom: 'Brahma reproducteurs', especeCode: 'poule', race: 'Brahma', logementId: poulailler, effectif: 10 });
  const cailles = await repo.creerLot({ nom: 'Cailles japonaises – lot 1', especeCode: 'caille', race: 'Japonaise', logementId: cages, effectif: 60 });

  // Les lots existent depuis deux semaines : l'historique ci-dessous n'est pas antérieur à leur arrivée.
  await db.mouvements.toCollection().modify({ date: j(14) });

  const series: [string, number[], number][] = [
    [soie, [9, 10, 9, 10, 9, 10, 9], 2.4],
    [brahma, [4, 4, 5, 4, 5, 4, 4], 1.8],
    [cailles, [48, 50, 49, 50, 48, 49, 50], 1.5],
  ];
  for (const [lotId, oeufs, kg] of series) {
    for (let i = 0; i < oeufs.length; i++) {
      const jour = j(oeufs.length - i);
      await db.pontes.add({ id: nouvelId(), ...bruit, lotId, date: jour, nombre: oeufs[i] ?? 0, casses: 0 });
      await db.distributions.add({ id: nouvelId(), ...bruit, lotId, date: jour, quantiteKg: kg });
    }
  }
  // Santé : Soie blanche (25 jours) a reçu Newcastle et Gumboro ; le rappel Gumboro est en retard.
  await db.evenementsSante.bulkAdd([
    { id: nouvelId(), ...bruit, lotId: soie, type: 'vaccin', date: j(18), nom: 'Newcastle (1re dose)', protocoleId: 'poule-newcastle-1', numeroLotProduit: 'NC-2291' },
    { id: nouvelId(), ...bruit, lotId: soie, type: 'vaccin', date: j(11), nom: 'Gumboro (1re dose)', protocoleId: 'poule-gumboro-1' },
    { id: nouvelId(), ...bruit, lotId: soie, type: 'vaccin', date: j(4), nom: 'Newcastle (rappel)', protocoleId: 'poule-newcastle-2' },
    { id: nouvelId(), ...bruit, lotId: soie, type: 'traitement', date: j(2), nom: 'Vitamines dans l’eau', voie: 'eau', dureeJours: 5, delaiAttenteJours: 2, note: 'Après la chaleur' },
    { id: nouvelId(), ...bruit, lotId: brahma, type: 'observation', date: j(20), symptomes: ['eternuements', 'toux'], gravite: 1 },
    { id: nouvelId(), ...bruit, lotId: brahma, type: 'traitement', date: j(19), nom: 'Tisane de thym', voie: 'eau', dureeJours: 5, delaiAttenteJours: 0, resultat: 'gueri' },
  ]);

  // Couveuse de 150 œufs de poule, avec deux mises en incubation à des stades différents.
  const couveuse = await repo.creerCouveuse({ nom: 'Couveuse 150 œufs', type: 'automatique', capacites: { poule: 150 }, eclosoirSepare: false });
  const a = nouvelId();
  const b = nouvelId();
  await db.incubations.bulkAdd([
    { id: a, ...bruit, couveuseId: couveuse, especeCode: 'poule', nom: 'Soie blanche – série 1', miseEnPlace: j(13), nbOeufs: 60, origine: 'Mes Soie blanche', faits: [] },
    { id: b, ...bruit, couveuseId: couveuse, especeCode: 'poule', nom: 'Brahma – série 1', miseEnPlace: j(18), nbOeufs: 50, origine: 'Mes Brahma', faits: [] },
  ]);
  await db.mirages.bulkAdd([
    { id: nouvelId(), ...bruit, incubationId: a, etape: 7, jour: j(6), clairs: 8, morts: 1 },
    { id: nouvelId(), ...bruit, incubationId: b, etape: 7, jour: j(11), clairs: 6, morts: 1 },
    { id: nouvelId(), ...bruit, incubationId: b, etape: 14, jour: j(4), clairs: 1, morts: 2 },
  ]);
  await db.entreesStock.add({ id: nouvelId(), ...bruit, date: j(8), quantiteKg: 120, prixTotal: 54000 });
  // Zone de quarantaine : un arrivage de 8 poules Padoue arrivé il y a 9 jours, avec son journal.
  const arrivage = await repo.creerQuarantaine({
    nom: 'Padoue – arrivage de M. Sow', especeCode: 'poule', race: 'Padoue', nombre: 8, ageJours: 120, origine: 'M. Sow, Thiès', arrivee: j(9), dureeJours: 21,
    alimentation: 'Aliment ponte, 110 g par poule et par jour', etatArrivee: 'moyen', noteArrivee: 'Fatiguées par le transport, deux ont les plumes abîmées.', prixTotal: 64000,
  });
  await repo.definirEtapeQuarantaine(arrivage, 'examen', true);
  await db.notesQuarantaine.bulkAdd([
    { id: nouvelId(), ...bruit, quarantaineId: arrivage, date: j(8), etat: 'moyen', comportements: ['mange_peu', 'plumes'], alimentation: 'Aliment ponte', poidsMoyenG: 1350, note: 'Elles se reposent beaucoup.' },
    { id: nouvelId(), ...bruit, quarantaineId: arrivage, date: j(4), etat: 'bien', comportements: ['mange_bien', 'actif', 'fientes_normales'], poidsMoyenG: 1420 },
    { id: nouvelId(), ...bruit, quarantaineId: arrivage, date: j(1), etat: 'bien', comportements: ['mange_bien', 'actif', 'sociable'], poidsMoyenG: 1480, note: 'Rien à signaler.' },
  ]);

  await db.operations.bulkAdd([
    { id: nouvelId(), ...bruit, date: j(6), sens: 'recette', categorie: 'oeufs', montant: 18000, paye: true, payeLe: j(6), tiers: 'Marché' },
    { id: nouvelId(), ...bruit, date: j(3), sens: 'recette', categorie: 'poussins', montant: 45000, paye: false, tiers: 'M. Diop', lotId: soie },
    { id: nouvelId(), ...bruit, date: j(5), sens: 'depense', categorie: 'soins', montant: 6500, paye: true, payeLe: j(5), lotId: soie },
    { id: nouvelId(), ...bruit, date: j(2), sens: 'depense', categorie: 'materiel', montant: 12000, paye: false, tiers: 'Quincaillerie' },
  ]);
  await repo.ecrireReglage('nomElevage', 'Ferme de démonstration');
  await repo.ecrireReglage('demarrageFait', true);
}
