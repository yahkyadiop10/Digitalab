import { useEffect, useState } from 'react';
import { Navigation, FournisseurNotif } from './components/ui';
import { db } from './db';
import { Accueil } from './pages/Accueil';
import { Alertes } from './pages/Alertes';
import { FicheLot, ListeCheptel, NouveauLot } from './pages/Cheptel';
import { FicheIncubation, NouvelleIncubation, PageAppareil, PageCouveuse } from './pages/Couveuse';
import { Demarrage } from './pages/Demarrage';
import { Reglages } from './pages/Reglages';
import { Saisie } from './pages/Saisie';
import { useRoute } from './route';
import { useElevage, type Elevage } from './useElevage';

function Page({ elevage }: { elevage: Elevage }) {
  const { segments, params } = useRoute();
  const section = segments[0] ?? 'accueil';
  const a = segments[1];
  switch (section) {
    case 'saisie':
      return <Saisie elevage={elevage} type={a} lotInitial={params.get('lot')} />;
    case 'cheptel':
      if (a === 'nouveau') return <NouveauLot elevage={elevage} />;
      return a ? <FicheLot elevage={elevage} lotId={a} /> : <ListeCheptel elevage={elevage} />;
    case 'couveuse':
      if (a === 'nouvelle') return <NouvelleIncubation elevage={elevage} />;
      if (a === 'appareil') return <PageAppareil elevage={elevage} id={segments[2]} />;
      return a ? <FicheIncubation elevage={elevage} id={a} /> : <PageCouveuse elevage={elevage} />;
    case 'alertes':
      return <Alertes elevage={elevage} />;
    case 'reglages':
      return <Reglages elevage={elevage} />;
    default:
      return <Accueil elevage={elevage} />;
  }
}

export function App() {
  const elevage = useElevage();
  const [stockageBloque, setStockageBloque] = useState(false);
  useEffect(() => {
    db.open().catch(() => setStockageBloque(true));
  }, []);
  if (stockageBloque) {
    return (
      <main className="demarrage">
        <h1>Stockage indisponible</h1>
        <p>Ce navigateur empêche l’application d’enregistrer vos données sur l’appareil. Ouvrez-la dans une fenêtre normale (pas en navigation privée), ou autorisez le stockage du site dans les réglages du navigateur.</p>
      </main>
    );
  }
  if (!elevage) return <p className="chargement">Chargement…</p>;
  if (!elevage.reglages.demarrageFait && elevage.donnees.lots.length === 0) {
    return <FournisseurNotif><Demarrage /></FournisseurNotif>;
  }
  const nbAlertes = elevage.alertes.filter((a) => !a.priseEnCharge).length;
  return (
    <FournisseurNotif>
      <header>
        <h1>Digitalab</h1>
        <small>{elevage.reglages.nomElevage || 'Mon élevage'}</small>
      </header>
      <main>
        <Page elevage={elevage} />
      </main>
      <Navigation nbAlertes={nbAlertes} />
    </FournisseurNotif>
  );
}
