import { useEffect, useState } from 'react';
import { POLITIQUE_SESSION_DEFAUT, jourLocal } from '@digitalab/core';
import { Embleme, LogoProduit, Pied } from './components/Marque';
import { CreerCode, PorteConnexion, Verrou } from './components/PortesSession';
import { Navigation, FournisseurNotif, OutilsEntete } from './components/ui';
import { db } from './db';
import { Accueil } from './pages/Accueil';
import { Alertes } from './pages/Alertes';
import { FicheLot, ListeCheptel, NouveauLot } from './pages/Cheptel';
import { FicheIncubation, NouvelleIncubation, PageAppareil, PageCouveuse } from './pages/Couveuse';
import { Demarrage } from './pages/Demarrage';
import { FicheQuarantaine, FormArrivee, PageQuarantaine } from './pages/Quarantaine';
import { PageCarnet, FicheTiers } from './pages/Carnet';
import { FormOperation, PageFinances } from './pages/Finances';
import { PageOperation, PageFacture, PageRecu } from './pages/Operation';
import { FormEmploye, FormPaie, PageBulletin, PageSalaires } from './pages/Paie';
import { PageFichePublique, PartageFiche } from './pages/FicheSuivi';
import { FormProbleme, FormQuarantaine, FormTraitement, FormVaccin, PageCalendrier, PageHistorique, PageRemedes, PageSante } from './pages/Sante';
import { PageCompte, useConnexion } from './pages/Compte';
import { PageJournal } from './pages/Journal';
import { FormCompte, FormPointage, FormTransfert, PageCompte as PageCompteTresorerie, PageTresorerie } from './pages/Tresorerie';
import { FormUtilisateur, PageUtilisateurs } from './pages/Utilisateurs';
import { Reglages } from './pages/Reglages';
import { Saisie } from './pages/Saisie';
import { aLeModule, droitsRequis, peutUn, profilDe } from './droits';
import { useRoute } from './route';
import { useAppareil } from './securite';
import { useSession } from './session';
import { synchro } from './sync';
import { useElevage, type Elevage } from './useElevage';

function Refuse() {
  return (
    <div className="carte">
      <h2>Accès non autorisé</h2>
      <p className="muet">Votre profil ne permet pas d’ouvrir cette page. Si c’est une erreur, demandez à l’administrateur de l’élevage de vous accorder cette fonction.</p>
      <a className="bouton" href="#/accueil">Retour à l’accueil</a>
    </div>
  );
}

function Page({ elevage }: { elevage: Elevage }) {
  const { segments, params } = useRoute();
  const requis = droitsRequis(segments);
  if (requis && !peutUn(elevage, requis)) return <Refuse />;
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
      if (a === 'tresorerie') {
        if (segments[2] === 'nouveau') return <FormCompte elevage={elevage} />;
        if (segments[2] === 'modifier' && segments[3]) return <FormCompte elevage={elevage} id={segments[3]} />;
        if (segments[2] === 'transfert') return <FormTransfert elevage={elevage} deInitial={params.get('de')} />;
        if (segments[2] === 'pointage') return <FormPointage elevage={elevage} compteInitial={params.get('compte')} />;
        if (segments[2] === 'compte' && segments[3]) return <PageCompteTresorerie elevage={elevage} id={segments[3]} />;
        return <PageTresorerie elevage={elevage} />;
      }
      if (a === 'recu' && segments[2]) return <PageRecu elevage={elevage} id={segments[2]} />;
      if (a === 'op' && segments[2]) return segments[3] === 'facture' ? <PageFacture elevage={elevage} id={segments[2]} /> : <PageOperation elevage={elevage} id={segments[2]} />;
      if (a === 'carnet') return segments[2] === 'nouveau' ? <FicheTiers elevage={elevage} /> : segments[2] ? <FicheTiers elevage={elevage} id={segments[2]} /> : <PageCarnet elevage={elevage} />;
      if (a === 'salaires') {
        if (segments[2] === 'employe') return <FormEmploye elevage={elevage} {...(segments[3] ? { id: segments[3] } : {})} />;
        if (segments[2] === 'payer' && segments[3]) {
          const nature = params.get('nature');
          return <FormPaie elevage={elevage} employeId={segments[3]} periode={params.get('mois') ?? jourLocal(elevage.maintenant).slice(0, 7)} nature={nature === 'avance' || nature === 'prime' ? nature : 'salaire'} />;
        }
        if (segments[2] === 'bulletin' && segments[3] && segments[4]) return <PageBulletin elevage={elevage} employeId={segments[3]} periode={segments[4]} />;
        return <PageSalaires elevage={elevage} moisInitial={params.get('mois')} />;
      }
      return <PageFinances elevage={elevage} />;
    case 'alertes':
      return <Alertes elevage={elevage} />;
    case 'compte':
      return <PageCompte />;
    case 'journal':
      return <PageJournal elevage={elevage} />;
    case 'utilisateurs':
      return a ? <FormUtilisateur elevage={elevage} {...(a === 'nouveau' ? {} : { identifiant: decodeURIComponent(a) })} /> : <PageUtilisateurs elevage={elevage} />;
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

/** Avant de se déconnecter pour inactivité, on essaie d'envoyer ce qui n'est pas encore parti (sans attendre plus de quelques secondes). */
async function deconnecterPourInactivite() {
  try {
    await Promise.race([synchro.synchroniser(), new Promise((r) => setTimeout(r, 4000))]);
  } catch {
    /* pas de réseau : les saisies restent sur l'appareil et partiront à la prochaine connexion */
  }
  await synchro.deconnecter({ auto: true });
}

function Application() {
  const elevage = useElevage();
  const appareil = useAppareil();
  const [stockageBloque, setStockageBloque] = useState(false);
  const route = useRoute();
  const connexion = useConnexion();
  const relie = Boolean(connexion);
  useEffect(() => (relie ? synchro.demarrerAuto() : undefined), [relie]);
  useEffect(() => {
    db.open().catch(() => setStockageBloque(true));
  }, []);
  // La surveillance de l'inactivité ne tourne que si elle sert : un code existe (verrouillage) ou un compte est relié (déconnexion).
  const session = useSession({
    active: !!elevage && !!appareil && (appareil.aCode || relie),
    politique: elevage?.politique ?? POLITIQUE_SESSION_DEFAUT,
    connecte: relie,
    surDeconnexion: () => void deconnecterPourInactivite(),
  });
  if (stockageBloque) {
    return (
      <main className="demarrage">
        <h1>Stockage indisponible</h1>
        <p>Ce navigateur empêche l’application d’enregistrer vos données sur l’appareil. Ouvrez-la dans une fenêtre normale (pas en navigation privée), ou autorisez le stockage du site dans les réglages du navigateur.</p>
      </main>
    );
  }
  if (!elevage || !appareil) return <p className="chargement">Chargement…</p>;
  // Un appareil relié à un compte ne s'ouvre qu'avec ce compte : après une déconnexion, on retrouve la page de connexion.
  if (appareil.compteRequis && !relie) {
    return <FournisseurNotif><PorteConnexion deconnecteAuto={appareil.deconnecteAuto} nom={elevage.reglages.nomElevage} /></FournisseurNotif>;
  }
  // Une personne connectée choisit un code de verrouillage avant d'aller plus loin.
  if (relie && !appareil.aCode) {
    return <FournisseurNotif><CreerCode onFait={() => session.deverrouiller()} /></FournisseurNotif>;
  }
  if (appareil.aCode && session.etat !== 'actif') {
    return <FournisseurNotif><Verrou elevage={elevage} connecte={relie} surDeverrouillage={session.deverrouiller} /></FournisseurNotif>;
  }
  if (!elevage.reglages.demarrageFait && elevage.donnees.lots.length === 0) {
    if (route.segments[0] === 'compte') return <FournisseurNotif><div className="bandeau-marque"><LogoProduit /></div><main><PageCompte /><Pied /></main></FournisseurNotif>;
    return <FournisseurNotif><Demarrage /></FournisseurNotif>;
  }
  const profil = profilDe(elevage);
  const nbAlertes = elevage.alertes.filter((a) => !a.priseEnCharge).length;
  return (
    <FournisseurNotif>
      <div className="bandeau-marque"><LogoProduit /></div>
      <header className="entete-ferme">
        <Embleme profil={profil} />
        <div className="ferme-nom">
          <h1>{profil.nom}</h1>
          {elevage.moi.fonction && <small>{elevage.moi.fonction}</small>}
        </div>
        <OutilsEntete
          nbAlertes={nbAlertes}
          finances={aLeModule(elevage, 'finances') || aLeModule(elevage, 'salaires') || aLeModule(elevage, 'tresorerie')}
          compte={connexion ? { erreur: Boolean(connexion.erreur) } : null}
          {...(appareil.aCode ? { onVerrouiller: session.verrouiller } : {})}
        />
      </header>
      <main>
        <Page elevage={elevage} />
        <Pied />
      </main>
      <Navigation elevage={elevage} />
    </FournisseurNotif>
  );
}
