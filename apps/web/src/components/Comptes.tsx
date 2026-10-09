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
      <Champ libelle="Nouveau mot de passe" aide="8 caractères au moins. Une phrase facile à retenir, avec des chiffres, est ce qu’il y a de mieux.">
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

/** Les codes de secours du propriétaire : montrés une seule fois, à noter sur papier. */
export function CodesSecours({ codes, onFait, bouton = 'Continuer' }: { codes: string[]; onFait: () => void; bouton?: string }) {
  const notifier = useNotifier();
  const [note, setNote] = useState(false);
  return (
    <div className="carte">
      <h3>Vos codes de secours</h3>
      <p>
        Si vous perdez votre mot de passe, un de ces codes vous permettra d’en choisir un nouveau. <b>Notez-les maintenant sur papier</b> et gardez-les en lieu sûr : ils ne seront plus affichés.
        Chaque code ne sert qu’une fois.
      </p>
      <ol className="codes-secours">
        {codes.map((c) => <li key={c}><code>{c}</code></li>)}
      </ol>
      <button type="button" className="bouton alt" onClick={async () => notifier((await copier(codes.join('\n'))) ? 'Codes copiés' : 'Copie impossible : recopiez-les à la main')}>Copier les codes</button>
      <label className="case"><input type="checkbox" checked={note} onChange={(e) => setNote(e.target.checked)} /> J’ai noté mes codes de secours en lieu sûr</label>
      <button className="bouton" disabled={!note} onClick={onFait}>{bouton}</button>
    </div>
  );
}

/** Mot de passe provisoire d'une personne, à lui remettre : il n'est montré qu'une fois. */
export function MotDePasseProvisoire({ compte, telephone, elevage, titre, children }: { compte: CompteProvisoire; telephone?: string | null; elevage: string; titre: string; children?: React.ReactNode }) {
  const notifier = useNotifier();
  const jours = Math.max(1, Math.round((Date.parse(compte.expireLe) - Date.now()) / 86_400_000));
  const message = `Bonjour${compte.nom ? ` ${compte.nom}` : ''}, voici votre accès à l’élevage ${elevage} dans l’application AviMaster. Identifiant : ${compte.identifiant} · Mot de passe provisoire : ${compte.motDePasseProvisoire} (valable ${jours} jours). À la première connexion, l’application vous demandera de choisir votre propre mot de passe.`;
  return (
    <div className="carte">
      <h2>{titre}</h2>
      <div className="ligne"><span>Identifiant</span><b>{compte.identifiant}</b></div>
      <p className="muet">Mot de passe provisoire :</p>
      <p className="gros-mdp" aria-label={`Mot de passe provisoire ${compte.motDePasseProvisoire}`}>{compte.motDePasseProvisoire}</p>
      <p>
        Remettez ces deux informations à <b>{compte.nom ?? compte.identifiant}</b>. Le mot de passe provisoire est valable {jours} jours, ne sert qu’à la première connexion et <b>ne sera plus affiché</b> :
        la personne devra en choisir un autre. Vous ne pourrez jamais voir son mot de passe ; si elle l’oublie, vous en générerez un nouveau.
      </p>
      <button type="button" className="bouton alt" onClick={async () => notifier((await copier(`Identifiant : ${compte.identifiant}\nMot de passe provisoire : ${compte.motDePasseProvisoire}`)) ? 'Copié' : 'Copie impossible : recopiez-le à la main')}>Copier l’identifiant et le mot de passe</button>
      {telephone && <a className="bouton alt" href={`https://wa.me/${telephone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">Envoyer par WhatsApp</a>}
      {children}
    </div>
  );
}
