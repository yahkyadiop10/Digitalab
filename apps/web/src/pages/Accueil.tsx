import { ajouterJours, consommationMoyenneKg, jourLocal, stockAlimentKg, tachesIncubation } from '@digitalab/core';
import { Badge, CarteAlerte } from '../components/ui';
import { NIVEAUX, fr } from '../i18n/fr';
import type { Elevage } from '../useElevage';

export function Accueil({ elevage }: { elevage: Elevage }) {
  const { donnees, reglages, effectifParLot, alertes, niveauGlobal, noms, maintenant } = elevage;
  const auj = jourLocal(maintenant);
  const lotsActifs = donnees.lots.filter((l) => !l.archive && (effectifParLot.get(l.id) ?? 0) > 0);
  const total = lotsActifs.reduce((a, l) => a + (effectifParLot.get(l.id) ?? 0), 0);
  const oeufs = donnees.pontes.filter((p) => p.date === auj).reduce((a, p) => a + p.nombre, 0);
  const debut7 = ajouterJours(auj, -6);
  const morts7 = donnees.mouvements.filter((m) => m.type === 'deces' && m.date >= debut7 && m.date <= auj).reduce((a, m) => a - m.quantite, 0);
  const suitStock = donnees.entreesStock.length > 0;
  const conso = consommationMoyenneKg(donnees, auj);
  const autonomie = suitStock && conso ? Math.floor(stockAlimentKg(donnees) / conso) : null;

  const taches = lotsActifs.flatMap((l) => {
    const t: { libelle: string; lien: string }[] = [];
    if (reglages.especes[l.especeCode]?.pondeuse && !donnees.pontes.some((p) => p.lotId === l.id && p.date === auj)) t.push({ libelle: `Ramasser les œufs : ${l.nom}`, lien: `saisie/ponte?lot=${l.id}` });
    if (!donnees.distributions.some((d) => d.lotId === l.id && d.date === auj)) t.push({ libelle: `Noter l’aliment : ${l.nom}`, lien: `saisie/aliment?lot=${l.id}` });
    return t;
  });

  for (const t of tachesIncubation(donnees.incubations, donnees.couveuses, donnees.mirages, reglages.especes, auj)) {
    const nom = t.incubation.nom;
    if (t.genre === 'tourner') taches.unshift({ libelle: `Tourner les œufs : ${nom}`, lien: `couveuse/${t.incubation.id}` });
    else taches.unshift({ libelle: `${{ mirage: 'Mirage', transfert: 'Transfert', eclosion: 'Éclosion' }[t.etape.type]} J${t.etape.jourJ} : ${nom}`, lien: `couveuse/${t.incubation.id}` });
  }

  const aTraiter = alertes.filter((a) => !a.priseEnCharge);
  const message = niveauGlobal === 'vert' ? NIVEAUX.vert : `${aTraiter.length} ${aTraiter.length > 1 ? 'alertes' : 'alerte'} · ${NIVEAUX[niveauGlobal].toLowerCase()}`;

  return (
    <>
      <p className="muet">{fr.jour(maintenant)}</p>
      <div className={`bandeau n-${niveauGlobal}`} role="status">
        <Badge niveau={niveauGlobal} />
        <strong>{message}</strong>
      </div>

      <div className="tuiles">
        <div className="tuile"><b>{total}</b><span>animaux</span></div>
        <div className="tuile"><b>{oeufs}</b><span>œufs aujourd’hui</span></div>
        <div className="tuile"><b>{morts7}</b><span>morts sur 7 jours</span></div>
        <div className="tuile"><b>{autonomie ?? '–'}</b><span>{autonomie === null ? 'stock non suivi' : 'jours d’aliment'}</span></div>
      </div>

      {aTraiter.length > 0 && (
        <>
          <h2>À traiter</h2>
          {aTraiter.slice(0, 3).map(({ alerte }) => <CarteAlerte key={alerte.cle} alerte={alerte} noms={noms} />)}
          {aTraiter.length > 3 && <p><a className="lien" href="#/alertes">Voir les {aTraiter.length} alertes</a></p>}
        </>
      )}

      <h2>À faire aujourd’hui</h2>
      {taches.length === 0 ? (
        <div className="carte muet">{lotsActifs.length === 0 ? 'Créez votre premier lot pour commencer.' : 'Tout est noté pour aujourd’hui.'}</div>
      ) : (
        taches.slice(0, 6).map((t) => (
          <a key={`${t.lien}|${t.libelle}`} className="gros" href={`#/${t.lien}`}>{t.libelle}<span>Toucher pour saisir</span></a>
        ))
      )}
      {lotsActifs.length === 0 && <a className="gros" href="#/cheptel/nouveau">🐔 Créer un lot<span>Nom, espèce, nombre d’animaux</span></a>}
    </>
  );
}
