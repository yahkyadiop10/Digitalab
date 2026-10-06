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
  await db.entreesStock.add({ id: nouvelId(), ...bruit, date: j(8), quantiteKg: 120, prixTotal: 54000 });
  await repo.ecrireReglage('nomElevage', 'Ferme de démonstration');
  await repo.ecrireReglage('demarrageFait', true);
}
