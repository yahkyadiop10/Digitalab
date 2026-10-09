import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { LIBELLES_PROFILS, normaliserIdentifiant, problemeIdentifiant, tablesEcrivables } from '@digitalab/core';
import { CodesSecours, FormNouveauMotDePasse, SaisieMotDePasse, problemeNouveauMotDePasse } from '../components/Comptes';
import { Champ, Retour, useNotifier, useConfirmer } from '../components/ui';
import { db, type Connexion } from '../db';
import { aller } from '../route';
import { marquerActivite } from '../session';
import { ErreurAppareilAutre, ErreurReseau, ErreurServeur, MODE_APERCU, URL_SERVEUR_DEFAUT, synchro, type EtatInstallation, type OrganisationServeur, type ResultatSync, type SessionServeur } from '../sync';

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
          <span>Dans cet aperçu, le serveur est simulé : vous pouvez créer un compte, ajouter des utilisateurs et choisir leurs droits, mais rien n’est envoyé ni gardé après un rechargement.</span>
        </div>
      )}
      {connexion === undefined ? <p className="chargement">Chargement…</p> : connexion ? <Connecte connexion={connexion} /> : <FormConnexion />}
    </>
  );
}

type Etape = 'connexion' | 'installation' | 'secours' | 'changement' | 'codes' | 'choix';

/**
 * Connexion par identifiant et mot de passe. Au tout premier lancement du serveur, la même page propose de créer l'administrateur.
 * `apres` s'exécute une fois l'appareil relié.
 */
export function FormConnexion({ apres }: { apres?: () => void } = {}) {
  const notifier = useNotifier();
  const [autre, setAutre] = useState<{ message: string; nonEnvoyes: number; session: { jeton: string; identifiant: string }; org: OrganisationServeur } | null>(null);
  const [url, setUrl] = useState(URL_SERVEUR_DEFAUT);
  const [etape, setEtape] = useState<Etape>('connexion');
  const [installation, setInstallation] = useState<EtatInstallation | null>(null);
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [session, setSession] = useState<(SessionServeur & { codesSecours?: string[] }) | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [avance, setAvance] = useState(!URL_SERVEUR_DEFAUT);

  // À la reconnexion, l'adresse du serveur déjà utilisée sur cet appareil est reprise.
  useEffect(() => {
    if (URL_SERVEUR_DEFAUT) return;
    void db.appareil.get('proprietaire').then((l) => {
      const memorisee = (l?.valeur as { url?: string } | undefined)?.url;
      if (memorisee) { setUrl((courante) => courante || memorisee); setAvance(false); }
    });
  }, []);

  // Le serveur n'a pas encore d'administrateur ? On propose de le créer. Vérifié dès que l'adresse est connue ; pendant la frappe, on attend une pause.
  const dejaVerifie = useRef(false);
  useEffect(() => {
    if (!/^https?:\/\/\S+/.test(url.trim())) return;
    let actuel = true;
    const verifier = () => {
      synchro.etatInstallation(url.trim()).then((e) => {
        if (!actuel) return;
        setInstallation(e);
        setEtape((courante) => (e.aInitialiser && courante === 'connexion' ? 'installation' : !e.aInitialiser && courante === 'installation' ? 'connexion' : courante));
      }).catch(() => { /* serveur injoignable : l'erreur s'affichera à la connexion */ });
    };
    if (!dejaVerifie.current) {
      dejaVerifie.current = true;
      verifier();
      return () => { actuel = false; };
    }
    const t = setTimeout(verifier, 400);
    return () => { actuel = false; clearTimeout(t); };
  }, [url]);

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

  const lier = async (s: { jeton: string; identifiant: string }, org: OrganisationServeur, effacer = false) => {
    try {
      await synchro.lier(url.trim(), s.jeton, s.identifiant, org, { effacer });
    } catch (e) {
      // L'appareil contenait les données de quelqu'un d'autre : on demande avant d'effacer.
      if (e instanceof ErreurAppareilAutre) return setAutre({ message: e.message, nonEnvoyes: e.nonEnvoyes, session: s, org });
      throw e;
    }
    setAutre(null);
    marquerActivite();
    notifier('Appareil relié ✓');
    if (apres) apres();
    else aller('accueil');
    void synchro.synchroniser();
  };

  /** Dernière étape de toute connexion : relier l'appareil (ou choisir l'élevage s'il y en a plusieurs). */
  const finir = async (s: SessionServeur) => {
    if (s.organisations.length === 1) return lier(s, s.organisations[0]!);
    setSession(s);
    setEtape('choix');
  };

  const seConnecter = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return setErreur('Indiquez l’adresse du serveur.');
    void executer(async () => {
      const s = await synchro.seConnecter(url.trim(), identifiant, motDePasse);
      setInfo(null);
      // Mot de passe provisoire donné par l'administrateur : il faut d'abord en choisir un à soi.
      if (s.doitChanger) {
        setSession(s);
        return setEtape('changement');
      }
      await finir(s);
    });
  };

  if (autre) {
    return (
      <div className="carte">
        <h3>{autre.message}</h3>
        <p>Pour continuer, ces données doivent être effacées de cet appareil. Ce qui a été envoyé au serveur y reste.</p>
        {autre.nonEnvoyes > 0 && <p className="erreur">Attention : {autre.nonEnvoyes} saisie{autre.nonEnvoyes > 1 ? 's' : ''} faite{autre.nonEnvoyes > 1 ? 's' : ''} sur cet appareil n’a{autre.nonEnvoyes > 1 ? 'ont' : ''} jamais été envoyée{autre.nonEnvoyes > 1 ? 's' : ''} et sera perdue. Reconnectez d’abord la personne concernée pour les envoyer.</p>}
        <button className="bouton" disabled={occupe} onClick={() => void executer(() => lier(autre.session, autre.org, true))}>Effacer cet appareil et continuer</button>
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
          <button key={o.id} className="bouton alt" disabled={occupe} onClick={() => void executer(() => lier(session, o))}>
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
        introduction="Le mot de passe provisoire donné par votre administrateur ne sert qu’une fois. Choisissez maintenant un mot de passe que vous seul connaissez."
        identifiant={session.identifiant}
        ancien={motDePasse}
        bouton="Enregistrer et continuer"
        onValider={async (ancien, nouveau) => {
          try {
            await synchro.choisirMotDePasse(url.trim(), session.jeton, ancien, nouveau);
          } catch (e) {
            throw new Error(messageErreur(e));
          }
          setMotDePasse('');
          await finir({ ...session, doitChanger: false });
        }}
        annuler={() => { setEtape('connexion'); setMotDePasse(''); setSession(null); }}
      />
    );
  }

  if (etape === 'codes' && session?.codesSecours) {
    return (
      <>
        <CodesSecours codes={session.codesSecours} bouton="Entrer dans l’application" onFait={() => void executer(async () => { await finir(session); })} />
        {erreur && <p className="erreur" role="alert">{erreur}</p>}
      </>
    );
  }

  const champUrl = avance ? (
    <Champ libelle="Adresse du serveur" aide="Donnée par la personne qui installe votre serveur.">
      <input type="url" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} required />
    </Champ>
  ) : (
    <button type="button" className="lien" onClick={() => setAvance(true)}>Options avancées</button>
  );

  if (etape === 'installation') {
    return (
      <Installation
        urlChamp={champUrl} url={url.trim()} cleRequise={installation?.cleRequise ?? false}
        onCree={(s) => { setSession(s); setEtape('codes'); }}
        dejaInstalle={() => { setInstallation({ aInitialiser: false, cleRequise: false }); setEtape('connexion'); }}
        dejaUnCompte={() => setEtape('connexion')}
      />
    );
  }

  if (etape === 'secours') {
    return (
      <Secours
        urlChamp={champUrl} url={url.trim()} identifiantInitial={identifiant}
        fait={(id) => { setIdentifiant(id); setMotDePasse(''); setInfo('Votre mot de passe est changé. Connectez-vous avec le nouveau.'); setEtape('connexion'); }}
        retour={() => setEtape('connexion')}
      />
    );
  }

  return (
    <>
      {!apres && (
        <div className="carte muet">
          Sans compte, tout fonctionne déjà sur cet appareil. Avec un compte, vos données sont aussi gardées sur le serveur et partagées avec vos aides et votre vétérinaire, sur leurs propres téléphones. Vous pouvez continuer à saisir sans réseau : tout est envoyé dès que la connexion revient.
        </div>
      )}
      <form className="carte" onSubmit={seConnecter}>
        {info && <p role="status">{info}</p>}
        <Champ libelle="Identifiant" aide="Donné par votre administrateur, par exemple « ndiaye.moussa ».">
          <input autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} required />
        </Champ>
        <Champ libelle="Mot de passe"><SaisieMotDePasse valeur={motDePasse} onChange={setMotDePasse} /></Champ>
        {champUrl}
        {erreur && <p className="erreur" role="alert">{erreur}</p>}
        <button className="bouton" disabled={occupe || !identifiant.trim() || !motDePasse}>{occupe ? 'Connexion…' : 'Se connecter'}</button>
        <details className="oubli-mdp">
          <summary className="lien">J’ai oublié mon mot de passe</summary>
          <p><b>Vous travaillez pour un élevage :</b> demandez à votre administrateur de vous donner un nouveau mot de passe provisoire. Il ne peut pas voir votre mot de passe, mais il peut en créer un nouveau.</p>
          <p><b>Vous êtes l’administrateur (propriétaire) :</b> utilisez un des codes de secours que vous avez notés à l’installation.</p>
          <button type="button" className="bouton alt" onClick={() => { setErreur(null); setEtape('secours'); }}>Utiliser un code de secours</button>
        </details>
        {installation && !installation.aInitialiser ? null : <button type="button" className="lien" onClick={() => setEtape('installation')}>Première installation : créer l’administrateur</button>}
      </form>
    </>
  );
}

function Installation({ urlChamp, url, cleRequise, onCree, dejaInstalle, dejaUnCompte }: {
  urlChamp: React.ReactNode; url: string; cleRequise: boolean;
  onCree: (s: SessionServeur & { codesSecours: string[] }) => void; dejaInstalle: () => void; dejaUnCompte: () => void;
}) {
  const [cle, setCle] = useState('');
  const [nomElevage, setNomElevage] = useState('');
  const [nom, setNom] = useState('');
  const [identifiant, setIdentifiant] = useState('admin');
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    const id = normaliserIdentifiant(identifiant);
    const probleme = problemeIdentifiant(id) ?? problemeNouveauMotDePasse(motDePasse, confirmation, id);
    if (probleme) return setErreur(probleme);
    if (!url) return setErreur('Indiquez l’adresse du serveur.');
    setErreur(null);
    setOccupe(true);
    try {
      onCree(await synchro.installer(url, { ...(cle.trim() ? { cle: cle.trim() } : {}), identifiant: id, motDePasse, nom: nom.trim(), nomElevage: nomElevage.trim() }));
    } catch (err) {
      if (err instanceof ErreurServeur && err.statut === 409 && /déjà installée/.test(err.message)) return dejaInstalle();
      setErreur(messageErreur(err));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <form className="carte" onSubmit={soumettre}>
      <h3>Créer l’administrateur</h3>
      <p>
        C’est le premier lancement : aucun compte n’existe encore. Le compte que vous créez ici est celui du <b>propriétaire</b> : il peut tout faire et ajoute ensuite les autres personnes.
        Il n’y a aucun mot de passe par défaut : c’est vous qui choisissez le vôtre.
      </p>
      {cleRequise && (
        <Champ libelle="Clé d’installation" aide="Elle s’affiche dans la fenêtre du serveur au démarrage. Elle empêche qu’une autre personne du réseau crée le compte à votre place.">
          <input autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={cle} onChange={(e) => setCle(e.target.value)} required />
        </Champ>
      )}
      <Champ libelle="Nom de l’élevage"><input value={nomElevage} onChange={(e) => setNomElevage(e.target.value)} placeholder="Ferme Sow" /></Champ>
      <Champ libelle="Votre nom"><input autoComplete="name" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Aminata Sow" /></Champ>
      <Champ libelle="Votre identifiant" aide="Sans espace ni accent. Vous pouvez garder « admin » ou choisir le vôtre.">
        <input autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} required />
      </Champ>
      <Champ libelle="Mot de passe" aide="8 caractères au moins. Choisissez-en un difficile à deviner et ne le partagez avec personne.">
        <SaisieMotDePasse valeur={motDePasse} onChange={setMotDePasse} nouveau />
      </Champ>
      <Champ libelle="Confirmez le mot de passe"><SaisieMotDePasse valeur={confirmation} onChange={setConfirmation} nouveau /></Champ>
      {urlChamp}
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={occupe || !identifiant.trim() || !motDePasse}>{occupe ? 'Création…' : 'Créer l’administrateur'}</button>
      <button type="button" className="lien" onClick={dejaUnCompte}>J’ai déjà un compte</button>
    </form>
  );
}

/** Le propriétaire a perdu son mot de passe : un code de secours en permet un nouveau. */
function Secours({ urlChamp, url, identifiantInitial, fait, retour }: { urlChamp: React.ReactNode; url: string; identifiantInitial: string; fait: (identifiant: string) => void; retour: () => void }) {
  const [identifiant, setIdentifiant] = useState(identifiantInitial);
  const [code, setCode] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    const id = normaliserIdentifiant(identifiant);
    const probleme = problemeNouveauMotDePasse(nouveau, confirmation, id);
    if (probleme) return setErreur(probleme);
    if (!url) return setErreur('Indiquez l’adresse du serveur.');
    setErreur(null);
    setOccupe(true);
    try {
      await synchro.recupererAcces(url, id, code, nouveau);
      fait(id);
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setOccupe(false);
    }
  };
  return (
    <form className="carte" onSubmit={soumettre}>
      <h3>Retrouver l’accès avec un code de secours</h3>
      <p>Entrez un des codes de secours que vous avez notés à l’installation (par exemple <code>k7mq-x9pt-4tnw</code>), puis choisissez un nouveau mot de passe. Chaque code ne sert qu’une fois.</p>
      <Champ libelle="Identifiant"><input autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} required /></Champ>
      <Champ libelle="Code de secours"><input autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} required /></Champ>
      <Champ libelle="Nouveau mot de passe"><SaisieMotDePasse valeur={nouveau} onChange={setNouveau} nouveau /></Champ>
      <Champ libelle="Confirmez le nouveau mot de passe"><SaisieMotDePasse valeur={confirmation} onChange={setConfirmation} nouveau /></Champ>
      {urlChamp}
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={occupe || !identifiant.trim() || !code.trim() || !nouveau}>{occupe ? 'Vérification…' : 'Choisir ce mot de passe'}</button>
      <button type="button" className="lien" onClick={retour}>Retour à la connexion</button>
    </form>
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
      {connexion.role === 'proprietaire' && <CodesSecoursProprietaire />}
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
        setOuvert(false);
        notifier('Mot de passe changé ✓');
      }}
      annuler={() => setOuvert(false)}
    />
  );
}

/** Le propriétaire peut refaire ses codes de secours (par exemple après en avoir perdu la liste) : les anciens cessent de marcher. */
function CodesSecoursProprietaire() {
  const confirmer = useConfirmer();
  const [restants, setRestants] = useState<number | null>(null);
  const [etape, setEtape] = useState<'repos' | 'mot' | 'codes'>('repos');
  const [motDePasse, setMotDePasse] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    synchro.monCompte().then((c) => setRestants(c.codesSecoursRestants)).catch(() => undefined);
  }, [etape]);

  if (etape === 'codes') return <CodesSecours codes={codes} bouton="Terminé" onFait={() => { setCodes([]); setEtape('repos'); }} />;
  return (
    <div className="carte">
      <h3>Codes de secours</h3>
      <p className="muet">
        Ils vous permettent de retrouver l’accès si vous perdez votre mot de passe.
        {restants !== null && ` Il vous en reste ${restants}.`}
        {restants !== null && restants <= 2 && ' Pensez à en générer de nouveaux.'}
      </p>
      {etape === 'repos' ? (
        <button className="lien" onClick={() => setEtape('mot')}>Générer de nouveaux codes</button>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!await confirmer('Les anciens codes de secours cesseront de fonctionner. Continuer ?')) return;
            try {
              setCodes(await synchro.genererCodesSecours(motDePasse));
              setMotDePasse('');
              setErreur(null);
              setEtape('codes');
            } catch (err) {
              setErreur(messageErreur(err));
            }
          }}
        >
          <Champ libelle="Votre mot de passe actuel"><SaisieMotDePasse valeur={motDePasse} onChange={setMotDePasse} /></Champ>
          {erreur && <p className="erreur" role="alert">{erreur}</p>}
          <button className="bouton alt" disabled={!motDePasse}>Générer de nouveaux codes</button>
          <button type="button" className="lien" onClick={() => { setEtape('repos'); setMotDePasse(''); setErreur(null); }}>Annuler</button>
        </form>
      )}
    </div>
  );
}
