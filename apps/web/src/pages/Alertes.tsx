import { Badge, CarteAlerte } from '../components/ui';
import { NIVEAUX } from '../i18n/fr';
import type { Elevage } from '../useElevage';

export function Alertes({ elevage }: { elevage: Elevage }) {
  const { alertes, noms } = elevage;
  const aTraiter = alertes.filter((a) => !a.priseEnCharge);
  const prises = alertes.filter((a) => a.priseEnCharge);
  return (
    <>
      <h2>À traiter</h2>
      {aTraiter.length === 0 ? <div className="carte muet">Aucune alerte. Tout va bien.</div> : aTraiter.map(({ alerte }) => <CarteAlerte key={alerte.cle} alerte={alerte} noms={noms} />)}
      {prises.length > 0 && (
        <>
          <h2>Prises en charge</h2>
          {prises.map(({ alerte }) => <CarteAlerte key={alerte.cle} alerte={alerte} noms={noms} priseEnCharge />)}
        </>
      )}
      <h2>Légende</h2>
      <div className="carte legende">
        {(['vert', 'jaune', 'orange', 'rouge'] as const).map((n) => (
          <div key={n} className="ligne"><Badge niveau={n} /><span>{{ vert: 'Rien à faire', jaune: 'À garder à l’œil', orange: 'À traiter aujourd’hui', rouge: 'À traiter tout de suite' }[n]}</span></div>
        ))}
        <p className="muet">Les seuils sont des valeurs de départ, à valider avec un vétérinaire. Vous pouvez les régler dans Réglages. « {NIVEAUX.vert} » s’affiche quand aucune alerte n’est à traiter.</p>
      </div>
    </>
  );
}
