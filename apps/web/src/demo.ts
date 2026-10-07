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
  const soie = await repo.creerLot({ nom: 'Soie blanche – lot A', especeCode: 'poule', race: 'Soie', logementId: poulailler, effectif: 18 });
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
  // Couveuse de 150 œufs de poule, avec deux mises en incubation à des stades différents.
  const couveuse = await repo.creerCouveuse({ nom: 'Couveuse 150 œufs', type: 'automatique', capacites: { poule: 150 }, eclosoirSepare: false });
  const a = nouvelId();
  const b = nouvelId();
  await db.incubations.bulkAdd([
    { id: a, ...bruit, couveuseId: couveuse, especeCode: 'poule', nom: 'Soie blanche – série 1', miseEnPlace: j(9), nbOeufs: 60, origine: 'Mes Soie blanche', faits: [] },
    { id: b, ...bruit, couveuseId: couveuse, especeCode: 'poule', nom: 'Brahma – série 1', miseEnPlace: j(18), nbOeufs: 50, origine: 'Mes Brahma', faits: [] },
  ]);
  await db.mirages.bulkAdd([
    { id: nouvelId(), ...bruit, incubationId: a, etape: 7, jour: j(2), clairs: 8, morts: 1 },
    { id: nouvelId(), ...bruit, incubationId: b, etape: 7, jour: j(11), clairs: 6, morts: 1 },
    { id: nouvelId(), ...bruit, incubationId: b, etape: 14, jour: j(4), clairs: 1, morts: 2 },
  ]);
  await db.entreesStock.add({ id: nouvelId(), ...bruit, date: j(8), quantiteKg: 120, prixTotal: 54000 });
  await repo.ecrireReglage('nomElevage', 'Ferme de démonstration');
  await repo.ecrireReglage('demarrageFait', true);
}
