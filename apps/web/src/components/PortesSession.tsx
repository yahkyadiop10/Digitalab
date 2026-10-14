import { useEffect, useState, type FormEvent } from 'react';
import { Embleme, LogoProduit, Pied } from './Marque';
import { SaisieMotDePasse } from './Comptes';
import { Champ, useConfirmer } from './ui';
import { profilDe } from '../droits';
import { securite } from '../securite';
import { marquerActivite } from '../session';
import { ErreurReseau, ErreurServeur, synchro } from '../sync';
import { FormConnexion } from '../pages/Compte';
import { aller } from '../route';
import type { Elevage } from '../useElevage';

function Cadre({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="bandeau-marque"><LogoProduit /></div>
      <main className="porte">{children}<Pied /></main>
    </>
  );
}

/** Page de connexion : affichée quand l'appareil a été relié à un compte puis déconnecté. */
export function PorteConnexion() {
  const confirmer = useConfirmer();
  return (
    <Cadre>
      <h1>Connexion</h1>
      <p className="muet">Entrez votre identifiant et votre mot de passe. Les saisies que vous aviez faites sur cet appareil sont toujours là et seront envoyées après la connexion.</p>
      <FormConnexion apres={() => { marquerActivite(); aller('accueil'); }} />
      <div className="carte">
        <button
          className="lien danger"
          onClick={async () => {
            if (await confirmer('Effacer toutes les données de cet appareil ? Ce qui n’a pas été envoyé au serveur sera perdu. L’appareil repartira comme neuf.')) {
              await synchro.effacerAppareil();
              aller('accueil');
            }
          }}
        >
          Effacer les données de cet appareil
        </button>
      </div>
    </Cadre>
  );
}

/**
 * Application ouverte par le lien de connexion, sur un téléphone encore vide : on arrive directement sur la connexion.
 * Le propriétaire peut aussi essayer l'application seul sur son téléphone, sans compte.
 */
export function ConnexionDuLien() {
  return (
    <Cadre>
      <h1>Connexion</h1>
      <p className="muet">Entrez l’identifiant et le mot de passe donnés par votre administrateur.</p>
      <FormConnexion apres={() => { marquerActivite(); aller('accueil'); }} />
      <div className="carte">
        <a className="lien" href="#/demarrage">Essayer d’abord l’application seul sur ce téléphone, sans compte</a>
      </div>
    </Cadre>
  );
}

/**
 * Après un moment sans utilisation, l'application redemande le mot de passe. Il est vérifié sur l'appareil (même sans réseau) ;
 * s'il a changé entre-temps (sur un autre téléphone, ou donné par l'administrateur), il est vérifié auprès du serveur.
 * L'application n'est même pas affichée derrière.
 */
export function Verrou({ elevage, identifiant, surDeverrouillage }: { elevage: Elevage; identifiant: string; surDeverrouillage: () => void }) {
  const confirmer = useConfirmer();
  const profil = profilDe(elevage);
  const [motDePasse, setMotDePasse] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [attente, setAttente] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const [oubli, setOubli] = useState(false);
  useEffect(() => {
    if (attente <= 0) return;
    const t = setInterval(() => setAttente((a) => Math.max(0, a - 1)), 1000);
    return () => clearInterval(t);
  }, [attente > 0]);

  const reconnexion = async () => {
    await synchro.deconnecter();
    surDeverrouillage();
  };

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    if (!motDePasse || occupe) return;
    setOccupe(true);
    try {
      const r = await securite.verifier(motDePasse);
      if (r.ok) return surDeverrouillage();
      // Trop d'essais sur cet appareil : on se reconnecte, sans plus rien essayer ici ni auprès du serveur.
      if (r.reconnexionRequise) return reconnexion();
      if (r.attenteSecondes && r.restants === undefined) {
        setAttente(r.attenteSecondes);
        return setMessage(`Trop d’essais. Patientez ${r.attenteSecondes} secondes.`);
      }
      // Pas le mot de passe que l'appareil connaît : peut-être a-t-il été changé ailleurs. Le serveur tranche.
      try {
        const verdict = await synchro.renouvelerSession(motDePasse);
        if (verdict === 'ok') {
          await securite.definirSecret(motDePasse);
          return surDeverrouillage();
        }
        setMessage('Votre administrateur vous a donné un nouveau mot de passe provisoire. Reconnectez-vous pour choisir le vôtre.');
        return setOubli(true);
      } catch (err) {
        if (!(err instanceof ErreurReseau) && !(err instanceof ErreurServeur)) throw err;
        if (err instanceof ErreurServeur && err.statut === 429) {
          setMessage(err.message);
          return;
        }
      }
      if (r.attenteSecondes) setAttente(r.attenteSecondes);
      setMessage(r.attenteSecondes ? `Mot de passe incorrect. Patientez ${r.attenteSecondes} secondes.` : `Mot de passe incorrect.${r.restants !== undefined ? ` Il vous reste ${r.restants} essais.` : ''}`);
    } finally {
      setMotDePasse('');
      setOccupe(false);
    }
  };

  return (
    <Cadre>
      <div className="verrou">
        <Embleme profil={profil} />
        <h1>Session verrouillée</h1>
        <p className="muet">{profil.nom}{elevage.moi.fonction ? ` · ${elevage.moi.fonction}` : ''}</p>
        <form className="carte" onSubmit={soumettre}>
          <div className="ligne"><span>Identifiant</span><b>{identifiant}</b></div>
          <Champ libelle="Votre mot de passe"><SaisieMotDePasse valeur={motDePasse} onChange={setMotDePasse} /></Champ>
          {message && <p className="erreur" role="alert">{attente > 0 ? `Trop d’essais. Patientez ${attente} s.` : message}</p>}
          <button className="bouton" disabled={!motDePasse || attente > 0 || occupe}>{occupe ? 'Vérification…' : 'Déverrouiller'}</button>
        </form>
        <button className="lien" onClick={() => setOubli(!oubli)}>J’ai oublié mon mot de passe</button>
        {oubli && (
          <div className="carte">
            <p>Demandez à votre administrateur un nouveau mot de passe provisoire, puis appuyez sur « Me reconnecter ». Vos données restent sur cet appareil.</p>
            <button className="bouton alt" onClick={async () => { if (await confirmer('Se déconnecter pour se reconnecter avec un nouveau mot de passe ?')) await reconnexion(); }}>Me reconnecter</button>
          </div>
        )}
      </div>
    </Cadre>
  );
}
