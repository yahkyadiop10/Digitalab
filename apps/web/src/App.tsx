import { Navigation, FournisseurNotif } from './components/ui';
import { Accueil } from './pages/Accueil';
import { Alertes } from './pages/Alertes';
import { FicheLot, ListeCheptel, NouveauLot } from './pages/Cheptel';
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
