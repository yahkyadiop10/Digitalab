import { useEffect, useRef, useState, type FormEvent } from 'react';
import { problemeDeCode } from '@digitalab/core';
import { Embleme, LogoProduit, Pied } from './Marque';
import { SaisieCodeChiffres } from './Comptes';
import { Champ, useConfirmer } from './ui';
import { profilDe } from '../droits';
import { ErreurCode, securite } from '../securite';
import { marquerActivite } from '../session';
import { synchro } from '../sync';
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
export function PorteConnexion({ deconnecteAuto, nom }: { deconnecteAuto: boolean; nom: string }) {
  const confirmer = useConfirmer();
  return (
    <Cadre>
      <h1>Connexion</h1>
      {deconnecteAuto && <div className="bandeau n-jaune" role="status"><strong>Vous avez été déconnecté</strong><span>Après un moment sans utiliser l’application, elle se ferme pour protéger {nom ? `les données de ${nom}` : 'vos données'}.</span></div>}
      <p className="muet">Reconnectez-vous avec votre identifiant et votre mot de passe. Les saisies que vous aviez faites sur cet appareil sont toujours là et seront envoyées après la connexion.</p>
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

/** Création du code de verrouillage : obligatoire pour une personne connectée à un compte. */
export function CreerCode({ onFait }: { onFait: () => void }) {
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    const probleme = problemeDeCode(code);
    if (probleme) return setErreur(probleme);
    if (code !== confirmation) return setErreur('Les deux codes ne sont pas identiques.');
    try {
      await securite.definirCode(code);
      marquerActivite();
      onFait();
    } catch (err) {
      setErreur(err instanceof ErreurCode ? err.message : 'Enregistrement impossible.');
    }
  };
  return (
    <Cadre>
      <h1>Choisissez votre code</h1>
      <p className="muet">Dernière étape : ce code de <b>4 à 6 chiffres</b> verrouille l’application sur ce téléphone quand vous ne l’utilisez plus, même sans réseau. Ce n’est <b>pas</b> votre mot de passe : il ne contient que des chiffres, et vous seul le connaissez. Gardez-le pour vous.</p>
      <form className="carte" onSubmit={soumettre}>
        <Champ libelle="Votre code (4 à 6 chiffres)"><SaisieCodeChiffres valeur={code} onChange={setCode} nouveau /></Champ>
        <Champ libelle="Confirmez le code"><SaisieCodeChiffres valeur={confirmation} onChange={setConfirmation} nouveau /></Champ>
        {erreur && <p className="erreur" role="alert">{erreur}</p>}
        <button className="bouton" disabled={code.length < 4}>Enregistrer mon code</button>
      </form>
    </Cadre>
  );
}

/** Écran de verrouillage : il remplace toute l'application, qui n'est même pas affichée derrière. */
export function Verrou({ elevage, connecte, surDeverrouillage }: { elevage: Elevage; connecte: boolean; surDeverrouillage: () => void }) {
  const confirmer = useConfirmer();
  const profil = profilDe(elevage);
  const champ = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [attente, setAttente] = useState(0);
  const [oubli, setOubli] = useState(false);
  useEffect(() => champ.current?.focus(), []);
  useEffect(() => {
    if (attente <= 0) return;
    const t = setInterval(() => setAttente((a) => Math.max(0, a - 1)), 1000);
    return () => clearInterval(t);
  }, [attente > 0]);

  const reconnexion = async () => {
    await synchro.deconnecter();
    await securite.oublierCode();
    surDeverrouillage();
  };

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    const r = await securite.verifier(code);
    setCode('');
    if (r.ok) return surDeverrouillage();
    if (r.reconnexionRequise) {
      if (connecte) return reconnexion();
      return setMessage('Trop d’essais. Patientez quelques minutes.');
    }
    if (r.attenteSecondes) setAttente(r.attenteSecondes);
    setMessage(r.attenteSecondes ? `Trop d’essais. Patientez ${r.attenteSecondes} secondes.` : `Code incorrect. Il vous reste ${r.restants} essais.`);
    champ.current?.focus();
  };

  return (
    <Cadre>
      <div className="verrou">
        <Embleme profil={profil} />
        <h1>Session verrouillée</h1>
        <p className="muet">{profil.nom}{elevage.moi.fonction ? ` · ${elevage.moi.fonction}` : ''}</p>
        <form className="carte" onSubmit={soumettre}>
          <Champ libelle="Votre code"><SaisieCodeChiffres reference={champ} valeur={code} onChange={setCode} desactive={attente > 0} /></Champ>
          {message && <p className="erreur" role="alert">{attente > 0 ? `Trop d’essais. Patientez ${attente} s.` : message}</p>}
          <button className="bouton" disabled={code.length < 4 || attente > 0}>Déverrouiller</button>
        </form>
        <button className="lien" onClick={() => setOubli(!oubli)}>J’ai oublié mon code</button>
        {oubli && (
          <div className="carte">
            {connecte ? (
              <>
                <p>Vous allez être déconnecté, puis vous reconnecter avec votre identifiant et votre mot de passe, puis choisir un nouveau code. Vos données restent sur cet appareil.</p>
                <button className="bouton alt" onClick={async () => { if (await confirmer('Se déconnecter pour choisir un nouveau code ?')) await reconnexion(); }}>Me reconnecter</button>
              </>
            ) : (
              <>
                <p>Sans compte, le code ne peut pas être retrouvé. Vous pouvez effacer les données de cet appareil, puis restaurer votre dernière sauvegarde.</p>
                <button className="bouton alt" onClick={async () => { if (await confirmer('Effacer toutes les données de cet appareil ? Il faudra ensuite restaurer une sauvegarde.')) { await synchro.effacerAppareil(); window.location.reload(); } }}>Effacer cet appareil</button>
              </>
            )}
          </div>
        )}
      </div>
    </Cadre>
  );
}
