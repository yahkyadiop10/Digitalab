import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { LIBELLES_PROFILS, tablesEcrivables } from '@digitalab/core';
import { FormNouveauMotDePasse, SaisieMotDePasse } from '../components/Comptes';
import { securite } from '../securite';
import { Champ, Retour, useNotifier, useConfirmer } from '../components/ui';
import { db, type Connexion } from '../db';
import { aller } from '../route';
import { marquerActivite } from '../session';
import { ErreurAppareilAutre, ErreurReseau, ErreurServeur, MODE_APERCU, URL_SERVEUR_DEFAUT, synchro, type OrganisationServeur, type ResultatSync, type SessionServeur } from '../sync';

export const useConnexion = (): Connexion | undefined | null => useLiveQuery(async () => (await db.connexion.get('serveur')) ?? null, []);

function messageErreur(e: unknown): string {
  if (e instanceof ErreurReseau) return 'Pas de connexion au serveur. Vérifiez votre réseau et l’adresse du serveur.';
  if (e instanceof ErreurServeur) return e.message;
  return 'Une erreur est survenue. Réessayez.';
}

export function depuisQuand(instant: number | undefined, maintenant = Date.now()): string {
  if (!instant) return 'jamais';
  const min = Math.floor((maintenant - instant) / 60_000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

export function resumeSync(r: ResultatSync): string {
  switch (r.etat) {
    case 'ok':
      return `${r.envoyes + r.recus === 0 ? 'Tout est à jour ✓' : `Synchronisé ✓ (${r.envoyes} envoyé${r.envoyes > 1 ? 's' : ''}, ${r.recus} reçu${r.recus > 1 ? 's' : ''})`}${r.refuses > 0 ? ` · ${r.refuses} saisie${r.refuses > 1 ? 's' : ''} refusée${r.refuses > 1 ? 's' : ''} : vos droits ne le permettent pas.` : ''}`;
    case 'hors_ligne':
      return 'Pas de réseau : vos saisies restent sur l’appareil et partiront plus tard.';
    case 'non_connecte':
      return 'Aucun compte relié.';
    case 'refuse':
      return r.message;
  }
}

export function PageCompte() {
  const connexion = useConnexion();
  return (
    <>
      <Retour vers="reglages" libelle="Réglages" />
      <h2>Compte et synchronisation</h2>
      {MODE_APERCU && (
        <div className="bandeau n-jaune" role="note">
          <strong>Démonstration</strong>
          <span>Dans cet aperçu, le serveur est simulé : vous pouvez vous connecter, ajouter des utilisateurs et choisir leurs droits, mais rien n’est envoyé ni gardé après un rechargement.</span>
        </div>
      )}
      {connexion === undefined ? <p className="chargement">Chargement…</p> : connexion ? <Connecte connexion={connexion} /> : <FormConnexion />}
    </>
  );
}

type Etape = 'connexion' | 'changement' | 'choix';

/**
 * Connexion par identifiant et mot de passe, donnés par l'administrateur. Ouverte par le lien de connexion, l'application connaît déjà
 * l'adresse du serveur : il n'y a que ces deux cases à remplir. `apres` s'exécute une fois l'appareil relié.
 */
export function FormConnexion({ apres }: { apres?: () => void } = {}) {
  const notifier = useNotifier();
  const [autre, setAutre] = useState<{ message: string; nonEnvoyes: number; session: { jeton: string; identifiant: string }; org: OrganisationServeur; motDePasse: string } | null>(null);
  const [url, setUrl] = useState(URL_SERVEUR_DEFAUT);
  // Tant qu'on ne sait pas si l'application vient du serveur, on n'affiche pas la case de l'adresse.
  const [adresseConnue, setAdresseConnue] = useState<boolean | null>(URL_SERVEUR_DEFAUT ? true : null);
  const [etape, setEtape] = useState<Etape>('connexion');
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [session, setSession] = useState<SessionServeur | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    if (URL_SERVEUR_DEFAUT) return;
    let actuel = true;
    void (async () => {
      // 1. Ouverte par le lien : l'adresse est celle de la page. 2. Sinon, l'adresse déjà utilisée sur cet appareil.
      const duLien = await synchro.detecterServeur();
      const memorisee = ((await db.appareil.get('proprietaire'))?.valeur as { url?: string } | undefined)?.url;
      const trouvee = duLien ?? memorisee ?? '';
      if (!actuel) return;
      setUrl((courante) => courante || trouvee);
      setAdresseConnue(Boolean(trouvee));
    })();
    return () => { actuel = false; };
  }, []);

  const executer = async (travail: () => Promise<void>) => {
    setErreur(null);
    setOccupe(true);
    try {
      await travail();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setOccupe(false);
    }
  };

  const lier = async (s: { jeton: string; identifiant: string }, org: OrganisationServeur, secret: string, effacer = false) => {
    try {
      await synchro.lier(url.trim(), s.jeton, s.identifiant, org, { effacer });
    } catch (e) {
      // L'appareil contenait les données de quelqu'un d'autre : on demande avant d'effacer.
      if (e instanceof ErreurAppareilAutre) return setAutre({ message: e.message, nonEnvoyes: e.nonEnvoyes, session: s, org, motDePasse: secret });
      throw e;
    }
    // L'appareil retient l'empreinte du mot de passe : il pourra le redemander après un moment d'inactivité, même sans réseau.
    await securite.definirSecret(secret);
    setAutre(null);
    setMotDePasse('');
    marquerActivite();
    notifier('Connecté ✓');
    if (apres) apres();
    else aller('accueil');
    void synchro.synchroniser();
  };

  /** Dernière étape de toute connexion : relier l'appareil (ou choisir l'élevage s'il y en a plusieurs). */
  const finir = async (s: SessionServeur, secret: string) => {
    if (s.organisations.length === 1) return lier(s, s.organisations[0]!, secret);
    setSession(s);
    setMotDePasse(secret);
    setEtape('choix');
  };

  const seConnecter = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return setErreur('Ouvrez l’application avec le lien de connexion donné par votre administrateur.');
    void executer(async () => {
      const s = await synchro.seConnecter(url.trim(), identifiant, motDePasse);
      // Mot de passe provisoire donné par l'administrateur : il faut d'abord en choisir un à soi.
      if (s.doitChanger) {
        setSession(s);
        return setEtape('changement');
      }
      await finir(s, motDePasse);
    });
  };

  if (autre) {
    return (
      <div className="carte">
        <h3>{autre.message}</h3>
        <p>Pour continuer, ces données doivent être effacées de cet appareil. Ce qui a été envoyé au serveur y reste.</p>
        {autre.nonEnvoyes > 0 && <p className="erreur">Attention : {autre.nonEnvoyes} saisie{autre.nonEnvoyes > 1 ? 's' : ''} faite{autre.nonEnvoyes > 1 ? 's' : ''} sur cet appareil n’a{autre.nonEnvoyes > 1 ? 'ont' : ''} jamais été envoyée{autre.nonEnvoyes > 1 ? 's' : ''} et sera perdue. Reconnectez d’abord la personne concernée pour les envoyer.</p>}
        <button className="bouton" disabled={occupe} onClick={() => void executer(() => lier(autre.session, autre.org, autre.motDePasse, true))}>Effacer cet appareil et continuer</button>
        <button className="lien" onClick={() => setAutre(null)}>Annuler</button>
        {erreur && <p className="erreur" role="alert">{erreur}</p>}
      </div>
    );
  }

  if (etape === 'choix' && session) {
    return (
      <div className="carte">
        <p>Vous avez accès à plusieurs élevages. Lequel utiliser sur cet appareil ?</p>
        {session.organisations.map((o) => (
          <button key={o.id} className="bouton alt" disabled={occupe} onClick={() => void executer(() => lier(session, o, motDePasse))}>
            {o.nom} · {o.fonction ? `${o.fonction} · ` : ''}{LIBELLES_PROFILS[o.role]}
          </button>
        ))}
        {erreur && <p className="erreur" role="alert">{erreur}</p>}
      </div>
    );
  }

  if (etape === 'changement' && session) {
    return (
      <FormNouveauMotDePasse
        titre="Choisissez votre mot de passe"
        introduction="C’est votre première connexion. Choisissez maintenant votre propre mot de passe : vous serez le seul à le connaître, même l’administrateur ne le verra pas."
        identifiant={session.identifiant}
        ancien={motDePasse}
        bouton="Enregistrer et continuer"
        onValider={async (ancien, nouveau) => {
          try {
            await synchro.choisirMotDePasse(url.trim(), session.jeton, ancien, nouveau);
          } catch (e) {
            throw new Error(messageErreur(e));
          }
          await finir({ ...session, doitChanger: false }, nouveau);
        }}
        annuler={() => { setEtape('connexion'); setMotDePasse(''); setSession(null); }}
      />
    );
  }

  return (
    <>
      {MODE_APERCU && (
        <div className="carte muet">Démonstration : identifiant <b>admin</b>, mot de passe provisoire <b>123456</b>. L’application vous demandera ensuite de choisir votre propre mot de passe.</div>
      )}
      <form className="carte" onSubmit={seConnecter}>
        <Champ libelle="Identifiant" aide="Donné par votre administrateur, par exemple « ndiaye.moussa ».">
          <input autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} required />
        </Champ>
        <Champ libelle="Mot de passe"><SaisieMotDePasse valeur={motDePasse} onChange={setMotDePasse} /></Champ>
        {adresseConnue === false && (
          <Champ libelle="Adresse du serveur" aide="Le plus simple : ouvrez l’application avec le lien de connexion donné par votre administrateur. Sinon, recopiez ce lien ici.">
            <input type="url" inputMode="url" placeholder="http://…" value={url} onChange={(e) => setUrl(e.target.value)} required />
          </Champ>
        )}
        {erreur && <p className="erreur" role="alert">{erreur}</p>}
        <button className="bouton" disabled={occupe || !identifiant.trim() || !motDePasse}>{occupe ? 'Connexion…' : 'Se connecter'}</button>
        <details className="oubli-mdp">
          <summary className="lien">J’ai oublié mon mot de passe</summary>
          <p>Demandez à votre administrateur de vous donner un nouveau mot de passe provisoire. Il ne peut pas voir votre mot de passe, mais il peut en créer un nouveau.</p>
          <p>Vous êtes le propriétaire ? La personne qui a installé l’application peut vous en redonner un depuis l’ordinateur du serveur.</p>
        </details>
      </form>
    </>
  );
}

function Connecte({ connexion }: { connexion: Connexion }) {
  const confirmer = useConfirmer();
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => synchro.abonner((e) => setEnCours(e.enCours)), []);
  const peutAdministrer = connexion.droits.includes('admin.utilisateurs');
  const peutEcrire = tablesEcrivables(connexion.droits).length > 0;

  const lancer = async () => {
    setMessage(null);
    setMessage(resumeSync(await synchro.synchroniser()));
  };

  const quitter = async () => {
    if (!await confirmer('Se déconnecter ? Vos données restent sur cet appareil, mais il faudra vous reconnecter avec votre mot de passe pour les rouvrir.')) return;
    await synchro.deconnecter();
  };

  return (
    <>
      <div className="carte">
        <div className="ligne"><span>Élevage</span><b>{connexion.organisationNom}</b></div>
        <div className="ligne"><span>Votre profil</span><b>{connexion.fonction ? `${connexion.fonction} · ` : ''}{LIBELLES_PROFILS[connexion.role]}</b></div>
        {connexion.zones.length > 0 && <div className="ligne"><span>Vos bâtiments</span><b>{connexion.zones.length} réservé{connexion.zones.length > 1 ? 's' : ''}</b></div>}
        <div className="ligne"><span>Votre identifiant</span><b>{connexion.identifiant}</b></div>
        <div className="ligne"><span>Dernière synchronisation</span><b>{depuisQuand(connexion.derniereSync)}</b></div>
        {connexion.erreur && <p className="erreur" role="alert">{connexion.erreur}</p>}
        {!peutEcrire && <p className="muet">Votre profil permet de consulter l’élevage, pas de le modifier : ce que vous saisissez ici n’est pas envoyé.</p>}
        <button className="bouton" onClick={() => void lancer()} disabled={enCours}>{enCours ? 'Synchronisation…' : 'Synchroniser maintenant'}</button>
        {message && <p role="status">{message}</p>}
      </div>
      <MesCoordonnees />
      {peutAdministrer && (
        <a className="carte ligne" href="#/utilisateurs" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span>Gestion des utilisateurs<br /><small className="muet">Ajouter des personnes, choisir ce que chacune voit et fait</small></span>
          <b aria-hidden="true">›</b>
        </a>
      )}
      <ChangerMotDePasse identifiant={connexion.identifiant} />
      <div className="carte">
        <button className="lien danger" onClick={() => void quitter()}>Se déconnecter de cet appareil</button>
      </div>
    </>
  );
}

/** Le nom qui apparaît dans le journal d'activité et la liste des utilisateurs, et le téléphone de contact (facultatif : il ne sert plus à se connecter). */
function MesCoordonnees() {
  const notifier = useNotifier();
  const [nom, setNom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    synchro.monCompte().then((c) => { setNom(c.nom ?? ''); setTelephone(c.telephone ?? ''); setCharge(true); }).catch(() => setCharge(true));
  }, []);
  if (!charge) return null;
  return (
    <div className="carte">
      <Champ libelle="Votre nom" aide="Il apparaît dans le journal d’activité à côté de ce que vous faites.">
        <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Aminata Sow" />
      </Champ>
      <Champ libelle="Votre téléphone (facultatif)" aide="Pour qu’on puisse vous joindre. Il ne sert pas à vous connecter.">
        <input type="tel" inputMode="tel" autoComplete="tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} placeholder="77 123 45 67" />
      </Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton alt court" onClick={async () => { try { await synchro.definirMesCoordonnees({ nom, telephone }); setErreur(null); notifier('Enregistré ✓'); } catch (e) { setErreur(messageErreur(e)); } }}>Enregistrer</button>
    </div>
  );
}

function ChangerMotDePasse({ identifiant }: { identifiant: string }) {
  const notifier = useNotifier();
  const [ouvert, setOuvert] = useState(false);
  if (!ouvert) {
    return <div className="carte"><button className="lien" onClick={() => setOuvert(true)}>Changer mon mot de passe</button></div>;
  }
  return (
    <FormNouveauMotDePasse
      titre="Changer mon mot de passe"
      introduction="Vos autres appareils seront déconnectés : vous devrez y saisir le nouveau mot de passe."
      identifiant={identifiant}
      ancienDemande
      bouton="Changer mon mot de passe"
      onValider={async (ancien, nouveau) => {
        try {
          await synchro.changerMonMotDePasse(ancien, nouveau);
        } catch (e) {
          throw new Error(messageErreur(e));
        }
        await securite.definirSecret(nouveau);
        setOuvert(false);
        notifier('Mot de passe changé ✓');
      }}
      annuler={() => setOuvert(false)}
    />
  );
}
