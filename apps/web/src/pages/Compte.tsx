import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { LIBELLES_PROFILS, normaliserTelephone, tablesEcrivables } from '@digitalab/core';
import { Champ, Retour, useNotifier, useConfirmer } from '../components/ui';
import { db, type Connexion } from '../db';
import { aller } from '../route';
import { marquerActivite } from '../session';
import { ErreurAppareilAutre, ErreurReseau, ErreurServeur, MODE_APERCU, URL_SERVEUR_DEFAUT, synchro, type OrganisationServeur, type ResultatSync } from '../sync';

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

/** Connexion par numéro de téléphone et code. `apres` s'exécute une fois l'appareil relié. */
export function FormConnexion({ apres }: { apres?: () => void } = {}) {
  const notifier = useNotifier();
  const [autre, setAutre] = useState<{ message: string; nonEnvoyes: number; session: { jeton: string; telephone: string }; org: OrganisationServeur } | null>(null);
  const [url, setUrl] = useState(URL_SERVEUR_DEFAUT);
  const [telephone, setTelephone] = useState('');
  const [code, setCode] = useState('');
  const [etape, setEtape] = useState<'telephone' | 'code' | 'choix'>('telephone');
  const [codeDemo, setCodeDemo] = useState<string | null>(null);
  const [session, setSession] = useState<{ jeton: string; telephone: string; organisations: OrganisationServeur[] } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [avance, setAvance] = useState(!URL_SERVEUR_DEFAUT);

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

  const demander = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return setErreur('Indiquez l’adresse du serveur.');
    void executer(async () => {
      const r = await synchro.demanderCode(url.trim(), telephone);
      setTelephone(r.telephone);
      setCodeDemo(r.codeDemo ?? null);
      setEtape('code');
    });
  };

  const lier = async (s: { jeton: string; telephone: string }, org: OrganisationServeur, effacer = false) => {
    try {
      await synchro.lier(url.trim(), s.jeton, s.telephone, org, { effacer });
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

  const valider = (e: FormEvent) => {
    e.preventDefault();
    void executer(async () => {
      const s = await synchro.seConnecter(url.trim(), telephone, code);
      if (s.organisations.length === 1) return lier(s, s.organisations[0]!);
      setSession(s);
      setEtape('choix');
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

  return (
    <>
      {!apres && (
        <div className="carte muet">
          Sans compte, tout fonctionne déjà sur cet appareil. Avec un compte, vos données sont aussi gardées sur le serveur et partagées avec vos aides et votre vétérinaire, sur leurs propres téléphones. Vous pouvez continuer à saisir sans réseau : tout est envoyé dès que la connexion revient.
        </div>
      )}
      {etape === 'telephone' ? (
        <form className="carte" onSubmit={demander}>
          <Champ libelle="Votre numéro de téléphone" aide="Un code à 6 chiffres vous sera envoyé. Pas de mot de passe à retenir.">
            <input type="tel" inputMode="tel" autoComplete="tel" placeholder="77 123 45 67" value={telephone} onChange={(e) => setTelephone(e.target.value)} required />
          </Champ>
          {avance ? (
            <Champ libelle="Adresse du serveur" aide="Donnée par la personne qui installe votre serveur.">
              <input type="url" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} required />
            </Champ>
          ) : (
            <button type="button" className="lien" onClick={() => setAvance(true)}>Options avancées</button>
          )}
          {erreur && <p className="erreur" role="alert">{erreur}</p>}
          <button className="bouton" disabled={occupe || !telephone.trim()}>{occupe ? 'Envoi…' : 'Recevoir un code'}</button>
          <button
            type="button"
            className="lien"
            onClick={() => {
              const tel = normaliserTelephone(telephone);
              if (!tel) return setErreur('Entrez d’abord votre numéro de téléphone.');
              if (!url.trim()) return setErreur('Indiquez l’adresse du serveur.');
              setErreur(null);
              setTelephone(tel);
              setEtape('code');
            }}
          >
            J’ai déjà un code donné par mon administrateur
          </button>
        </form>
      ) : (
        <form className="carte" onSubmit={valider}>
          <p>Entrez le code à 6 chiffres du <b>{telephone}</b> : celui reçu par SMS, ou celui que votre administrateur vous a donné.</p>
          {codeDemo && <p className="muet">Mode démonstration : le code est <b>{codeDemo}</b>.</p>}
          <Champ libelle="Code reçu">
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          </Champ>
          {erreur && <p className="erreur" role="alert">{erreur}</p>}
          <button className="bouton" disabled={occupe || code.length !== 6}>{occupe ? 'Vérification…' : 'Valider'}</button>
          <button type="button" className="lien" onClick={() => { setEtape('telephone'); setCode(''); setErreur(null); }}>Changer de numéro ou redemander un code</button>
        </form>
      )}
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
    if (!await confirmer('Se déconnecter ? Vos données restent sur cet appareil, mais il faudra vous reconnecter avec un code pour les rouvrir.')) return;
    await synchro.deconnecter();
  };

  return (
    <>
      <div className="carte">
        <div className="ligne"><span>Élevage</span><b>{connexion.organisationNom}</b></div>
        <div className="ligne"><span>Votre profil</span><b>{connexion.fonction ? `${connexion.fonction} · ` : ''}{LIBELLES_PROFILS[connexion.role]}</b></div>
        {connexion.zones.length > 0 && <div className="ligne"><span>Vos bâtiments</span><b>{connexion.zones.length} réservé{connexion.zones.length > 1 ? 's' : ''}</b></div>}
        <div className="ligne"><span>Votre numéro</span><b>{connexion.telephone}</b></div>
        <MonNom />
        <div className="ligne"><span>Dernière synchronisation</span><b>{depuisQuand(connexion.derniereSync)}</b></div>
        {connexion.erreur && <p className="erreur" role="alert">{connexion.erreur}</p>}
        {!peutEcrire && <p className="muet">Votre profil permet de consulter l’élevage, pas de le modifier : ce que vous saisissez ici n’est pas envoyé.</p>}
        <button className="bouton" onClick={() => void lancer()} disabled={enCours}>{enCours ? 'Synchronisation…' : 'Synchroniser maintenant'}</button>
        {message && <p role="status">{message}</p>}
      </div>
      {peutAdministrer && (
        <a className="carte ligne" href="#/utilisateurs" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span>Gestion des utilisateurs<br /><small className="muet">Ajouter des personnes, choisir ce que chacune voit et fait</small></span>
          <b aria-hidden="true">›</b>
        </a>
      )}
      <div className="carte">
        <button className="lien danger" onClick={() => void quitter()}>Se déconnecter de cet appareil</button>
      </div>
    </>
  );
}

/** Le nom sous lequel la personne apparaît dans le journal d'activité et la liste des utilisateurs. */
function MonNom() {
  const notifier = useNotifier();
  const [nom, setNom] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <div className="champ-nom">
      <Champ libelle="Votre nom" aide="Il apparaît dans le journal d’activité à côté de ce que vous faites.">
        <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Aminata Sow" />
      </Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton alt court" disabled={!nom.trim()} onClick={async () => { try { await synchro.definirMonNom(nom); setErreur(null); notifier('Nom enregistré ✓'); } catch (e) { setErreur(messageErreur(e)); } }}>Enregistrer mon nom</button>
    </div>
  );
}
