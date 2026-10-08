import { useEffect, useState } from 'react';
import { Navigation, FournisseurNotif, OutilsEntete } from './components/ui';
import { db } from './db';
import { Accueil } from './pages/Accueil';
import { Alertes } from './pages/Alertes';
import { FicheLot, ListeCheptel, NouveauLot } from './pages/Cheptel';
import { FicheIncubation, NouvelleIncubation, PageAppareil, PageCouveuse } from './pages/Couveuse';
import { Demarrage } from './pages/Demarrage';
import { FicheQuarantaine, FormArrivee, PageQuarantaine } from './pages/Quarantaine';
import { FormOperation, PageFinances } from './pages/Finances';
import { PageFichePublique, PartageFiche } from './pages/FicheSuivi';
import { FormProbleme, FormQuarantaine, FormTraitement, FormVaccin, PageCalendrier, PageHistorique, PageRemedes, PageSante } from './pages/Sante';
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
      if (a && segments[2] === 'fiche') return <PartageFiche elevage={elevage} lotId={a} />;
      return a ? <FicheLot elevage={elevage} lotId={a} /> : <ListeCheptel elevage={elevage} />;
    case 'couveuse':
      if (a === 'nouvelle') return <NouvelleIncubation elevage={elevage} />;
      if (a === 'appareil') return <PageAppareil elevage={elevage} id={segments[2]} />;
      return a ? <FicheIncubation elevage={elevage} id={a} /> : <PageCouveuse elevage={elevage} />;
    case 'sante':
      if (a === 'probleme') return <FormProbleme elevage={elevage} lotInitial={params.get('lot')} />;
      if (a === 'vaccin') return <FormVaccin elevage={elevage} lotInitial={params.get('lot')} protocoleInitial={params.get('protocole')} />;
      if (a === 'traitement') return <FormTraitement elevage={elevage} lotInitial={params.get('lot')} maladieInitiale={params.get('maladie')} />;
      if (a === 'quarantaine') return <FormQuarantaine elevage={elevage} lotInitial={params.get('lot')} />;
      if (a === 'remedes') return <PageRemedes elevage={elevage} />;
      if (a === 'calendrier') return <PageCalendrier elevage={elevage} />;
      if (a === 'historique') return <PageHistorique elevage={elevage} />;
      return <PageSante elevage={elevage} />;
    case 'quarantaine':
      if (a === 'arrivee') return <FormArrivee elevage={elevage} />;
      return a ? <FicheQuarantaine elevage={elevage} id={a} /> : <PageQuarantaine elevage={elevage} />;
    case 'finances':
      if (a === 'depense' || a === 'recette') return <FormOperation elevage={elevage} sens={a} lotInitial={params.get('lot')} />;
      return <PageFinances elevage={elevage} />;
    case 'alertes':
      return <Alertes elevage={elevage} />;
    case 'reglages':
      return <Reglages elevage={elevage} />;
    default:
      return <Accueil elevage={elevage} />;
  }
}

/** Une fiche partagée s'ouvre sans toucher aux données de l'éleveur. */
function Racine() {
  const { segments } = useRoute();
  if (segments[0] === 'fiche' && segments[1]) return <PageFichePublique jeton={segments[1]} />;
  return <Application />;
}

export const App = Racine;

function Application() {
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
        <OutilsEntete nbAlertes={nbAlertes} />
      </header>
      <main>
        <Page elevage={elevage} />
      </main>
      <Navigation />
    </FournisseurNotif>
  );
}
