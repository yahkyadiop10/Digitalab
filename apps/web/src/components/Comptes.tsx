import { useState, type FormEvent } from 'react';
import { problemeMotDePasse } from '@digitalab/core';
import { Champ, useNotifier } from './ui';
import type { CompteProvisoire } from '../sync';

/** Saisie d'un mot de passe avec un bouton « Afficher » : sur un téléphone, on se trompe vite sans voir ce que l'on tape. */
export function SaisieMotDePasse({ valeur, onChange, nouveau = false, id, requis = true }: { valeur: string; onChange: (v: string) => void; nouveau?: boolean; id?: string; requis?: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="mdp">
      <input
        {...(id ? { id } : {})}
        type={visible ? 'text' : 'password'}
        autoComplete={nouveau ? 'new-password' : 'current-password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        required={requis}
      />
      <button type="button" className="lien" onClick={() => setVisible(!visible)} aria-pressed={visible}>{visible ? 'Masquer' : 'Afficher'}</button>
    </span>
  );
}

/** Vérifie le nouveau mot de passe et sa confirmation avant d'appeler le serveur (qui refait les mêmes vérifications). */
export function problemeNouveauMotDePasse(nouveau: string, confirmation: string, identifiant: string): string | null {
  return problemeMotDePasse(nouveau, identifiant) ?? (nouveau !== confirmation ? 'Les deux mots de passe ne sont pas identiques.' : null);
}

/** Choisir un nouveau mot de passe (après un mot de passe provisoire, ou pour le changer). */
export function FormNouveauMotDePasse({ titre, introduction, identifiant, ancienDemande, ancien, bouton, onValider, annuler }: {
  titre?: string;
  introduction?: string;
  identifiant: string;
  /** Demande aussi le mot de passe actuel (changement volontaire). Sinon `ancien` est déjà connu (premier passage). */
  ancienDemande?: boolean;
  ancien?: string;
  bouton: string;
  onValider: (ancien: string, nouveau: string) => Promise<void>;
  annuler?: () => void;
}) {
  const [actuel, setActuel] = useState(ancien ?? '');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    const probleme = problemeNouveauMotDePasse(nouveau, confirmation, identifiant);
    if (probleme) return setErreur(probleme);
    if (nouveau === actuel) return setErreur('Choisissez un mot de passe différent de l’actuel.');
    setErreur(null);
    setOccupe(true);
    try {
      await onValider(actuel, nouveau);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Une erreur est survenue. Réessayez.');
    } finally {
      setOccupe(false);
    }
  };
  return (
    <form className="carte" onSubmit={soumettre}>
      {titre && <h3>{titre}</h3>}
      {introduction && <p>{introduction}</p>}
      {ancienDemande && <Champ libelle="Mot de passe actuel"><SaisieMotDePasse valeur={actuel} onChange={setActuel} /></Champ>}
      <Champ libelle="Nouveau mot de passe" aide="6 caractères au moins. Par exemple un mot facile à retenir pour vous, avec des chiffres.">
        <SaisieMotDePasse valeur={nouveau} onChange={setNouveau} nouveau />
      </Champ>
      <Champ libelle="Confirmez le nouveau mot de passe"><SaisieMotDePasse valeur={confirmation} onChange={setConfirmation} nouveau /></Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={occupe || !nouveau || !actuel}>{occupe ? 'Enregistrement…' : bouton}</button>
      {annuler && <button type="button" className="lien" onClick={annuler}>Annuler</button>}
    </form>
  );
}

const copier = async (texte: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(texte);
    return true;
  } catch {
    return false;
  }
};

/** Accès d'une personne, à lui remettre : le lien, son identifiant et son mot de passe provisoire (montré une seule fois). */
export function MotDePasseProvisoire({ compte, telephone, elevage, lien, titre, children }: {
  compte: CompteProvisoire; telephone?: string | null; elevage: string; lien: string; titre: string; children?: React.ReactNode;
}) {
  const notifier = useNotifier();
  const jours = Math.max(1, Math.round((Date.parse(compte.expireLe) - Date.now()) / 86_400_000));
  const acces = `Lien : ${lien}\nIdentifiant : ${compte.identifiant}\nMot de passe provisoire : ${compte.motDePasseProvisoire}`;
  const message = `Bonjour${compte.nom ? ` ${compte.nom}` : ''}, voici votre accès à l’élevage ${elevage} dans l’application AviMaster.\n${acces}\n(valable ${jours} jours). À la première connexion, l’application vous demandera de choisir votre propre mot de passe.`;
  return (
    <div className="carte">
      <h2>{titre}</h2>
      <p>À remettre à <b>{compte.nom ?? compte.identifiant}</b> :</p>
      <div className="ligne"><span>Lien de connexion</span><b className="lien-acces">{lien}</b></div>
      <div className="ligne"><span>Identifiant</span><b>{compte.identifiant}</b></div>
      <p className="muet">Mot de passe provisoire :</p>
      <p className="gros-code" aria-label={`Mot de passe provisoire ${compte.motDePasseProvisoire.split('').join(' ')}`}>{compte.motDePasseProvisoire}</p>
      <p>
        Il est valable {jours} jours et ne sert qu’à la première connexion : la personne choisira alors son propre mot de passe, que vous ne verrez jamais.
        <b> Il ne sera plus affiché.</b> Si elle l’oublie, vous en générerez un nouveau.
      </p>
      <button type="button" className="bouton alt" onClick={async () => notifier((await copier(acces)) ? 'Copié' : 'Copie impossible : recopiez-le à la main')}>Copier le lien, l’identifiant et le mot de passe</button>
      {telephone && <a className="bouton alt" href={`https://wa.me/${telephone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">Envoyer par WhatsApp</a>}
      {children}
    </div>
  );
}
