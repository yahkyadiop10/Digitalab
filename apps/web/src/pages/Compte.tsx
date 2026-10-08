import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ROLES, type RoleMembre } from '@digitalab/core';
import { Champ, Retour, useNotifier } from '../components/ui';
import { db, type Connexion } from '../db';
import { aller } from '../route';
import { ErreurReseau, ErreurServeur, URL_SERVEUR_DEFAUT, synchro, type Membre, type OrganisationServeur, type ResultatSync } from '../sync';

export const useConnexion = (): Connexion | undefined | null => useLiveQuery(async () => (await db.connexion.get('serveur')) ?? null, []);

const ROLES_INVITABLES: Exclude<RoleMembre, 'proprietaire'>[] = ['soigneur', 'veterinaire', 'lecteur'];
const EXPLICATION_ROLE: Record<RoleMembre, string> = {
  proprietaire: 'Fait tout, invite et retire des personnes.',
  soigneur: 'Saisit et modifie (ponte, aliment, décès, soins…).',
  veterinaire: 'Consulte tout l’élevage, sans rien modifier.',
  lecteur: 'Consulte seulement.',
};

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
      return r.envoyes + r.recus === 0 ? 'Tout est à jour ✓' : `Synchronisé ✓ (${r.envoyes} envoyé${r.envoyes > 1 ? 's' : ''}, ${r.recus} reçu${r.recus > 1 ? 's' : ''})`;
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
      {connexion === undefined ? <p className="chargement">Chargement…</p> : connexion ? <Connecte connexion={connexion} /> : <FormConnexion />}
    </>
  );
}

function FormConnexion() {
  const notifier = useNotifier();
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

  const lier = async (s: { jeton: string; telephone: string }, org: OrganisationServeur) => {
    await synchro.lier(url.trim(), s.jeton, s.telephone, org);
    notifier('Appareil relié ✓');
    aller('accueil');
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

  if (etape === 'choix' && session) {
    return (
      <div className="carte">
        <p>Vous avez accès à plusieurs élevages. Lequel utiliser sur cet appareil ?</p>
        {session.organisations.map((o) => (
          <button key={o.id} className="bouton alt" disabled={occupe} onClick={() => void executer(() => lier(session, o))}>
            {o.nom} · {ROLES[o.role].libelle}
          </button>
        ))}
        {erreur && <p className="erreur" role="alert">{erreur}</p>}
      </div>
    );
  }

  return (
    <>
      <div className="carte muet">
        Sans compte, tout fonctionne déjà sur cet appareil. Avec un compte, vos données sont aussi gardées sur le serveur et partagées avec vos aides et votre vétérinaire, sur leurs propres téléphones. Vous pouvez continuer à saisir sans réseau : tout est envoyé dès que la connexion revient.
      </div>
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
        </form>
      ) : (
        <form className="carte" onSubmit={valider}>
          <p>Un code à 6 chiffres a été envoyé au <b>{telephone}</b>.</p>
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
  const notifier = useNotifier();
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => synchro.abonner((e) => setEnCours(e.enCours)), []);

  const lancer = async () => {
    setMessage(null);
    setMessage(resumeSync(await synchro.synchroniser()));
  };

  const quitter = async () => {
    if (!window.confirm('Se déconnecter de cet appareil ? Vos données restent ici, mais ne seront plus échangées avec le serveur.')) return;
    await synchro.deconnecter();
    notifier('Déconnecté');
  };

  return (
    <>
      <div className="carte">
        <div className="ligne"><span>Élevage</span><b>{connexion.organisationNom}</b></div>
        <div className="ligne"><span>Votre rôle</span><b>{ROLES[connexion.role].libelle}</b></div>
        <div className="ligne"><span>Votre numéro</span><b>{connexion.telephone}</b></div>
        <div className="ligne"><span>Dernière synchronisation</span><b>{depuisQuand(connexion.derniereSync)}</b></div>
        {connexion.erreur && <p className="erreur" role="alert">{connexion.erreur}</p>}
        {!ROLES[connexion.role].ecriture && <p className="muet">Votre rôle permet de consulter l’élevage, pas de le modifier : ce que vous saisissez ici n’est pas envoyé.</p>}
        <button className="bouton" onClick={() => void lancer()} disabled={enCours}>{enCours ? 'Synchronisation…' : 'Synchroniser maintenant'}</button>
        {message && <p role="status">{message}</p>}
      </div>
      {connexion.role === 'proprietaire' && <Equipe />}
      <div className="carte">
        <button className="lien danger" onClick={() => void quitter()}>Se déconnecter de cet appareil</button>
      </div>
    </>
  );
}

function Equipe() {
  const notifier = useNotifier();
  const [membres, setMembres] = useState<Membre[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [telephone, setTelephone] = useState('');
  const [role, setRole] = useState<Exclude<RoleMembre, 'proprietaire'>>('soigneur');

  const charger = async () => {
    try {
      setMembres(await synchro.membres());
      setErreur(null);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };
  useEffect(() => {
    void charger();
  }, []);

  const inviter = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await synchro.inviter(telephone, role);
      setTelephone('');
      notifier('Personne ajoutée ✓');
      await charger();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  const retirer = async (m: Membre) => {
    if (!window.confirm(`Retirer ${m.nom ?? m.telephone} de l’élevage ?`)) return;
    try {
      await synchro.retirer(m.telephone);
      await charger();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  return (
    <>
      <h2>Mon équipe</h2>
      <div className="carte">
        {membres === null && !erreur && <p className="muet">Chargement…</p>}
        {membres?.map((m) => (
          <div key={m.telephone} className="ligne">
            <span>
              {m.nom ?? m.telephone}
              <br />
              <small className="muet">{m.nom ? `${m.telephone} · ` : ''}{ROLES[m.role].libelle}{m.actif ? '' : ' · pas encore connecté'}</small>
            </span>
            {m.role !== 'proprietaire' && <button className="lien danger" onClick={() => void retirer(m)}>Retirer</button>}
          </div>
        ))}
        {erreur && <p className="erreur" role="alert">{erreur}</p>}
      </div>
      <form className="carte" onSubmit={inviter}>
        <p><b>Ajouter une personne</b></p>
        <Champ libelle="Son numéro de téléphone" aide="Elle se connecte avec ce numéro et voit votre élevage.">
          <input type="tel" inputMode="tel" placeholder="77 123 45 67" value={telephone} onChange={(e) => setTelephone(e.target.value)} required />
        </Champ>
        <Champ libelle="Son rôle" aide={EXPLICATION_ROLE[role]}>
          <select value={role} onChange={(e) => setRole(e.target.value as Exclude<RoleMembre, 'proprietaire'>)}>
            {ROLES_INVITABLES.map((r) => <option key={r} value={r}>{ROLES[r].libelle}</option>)}
          </select>
        </Champ>
        <button className="bouton" disabled={!telephone.trim()}>Ajouter</button>
      </form>
    </>
  );
}
