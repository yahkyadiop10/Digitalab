import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import {
  DESCRIPTIONS_PROFILS, LIBELLES_PROFILS, MODULES, PROFILS_ASSIGNABLES, basculerModule, droitsDuProfil, etatModule, nettoyerDroits, normaliserTelephone,
  type RoleMembre,
} from '@digitalab/core';
import { Champ, Retour, useNotifier } from '../components/ui';
import { ErreurReseau, ErreurServeur, synchro, type Membre } from '../sync';
import { aller } from '../route';
import { peut } from '../droits';
import { useConnexion } from './Compte';
import type { Elevage } from '../useElevage';

function messageErreur(e: unknown): string {
  if (e instanceof ErreurReseau) return 'Pas de connexion au serveur. Cette page demande d’être en ligne.';
  if (e instanceof ErreurServeur) return e.message;
  return 'Une erreur est survenue. Réessayez.';
}

/** Profil dont les droits sont exactement ceux cochés ; sinon « personnalisé ». */
export function profilCorrespondant(droits: readonly string[]): RoleMembre {
  const choisis = [...nettoyerDroits(droits)].sort().join(',');
  return PROFILS_ASSIGNABLES.find((p) => p !== 'personnalise' && [...droitsDuProfil(p)].sort().join(',') === choisis) ?? 'personnalise';
}

function Acces({ elevage, enfant }: { elevage: Elevage; enfant: ReactElement }) {
  const connexion = useConnexion();
  if (connexion === undefined) return <p className="chargement">Chargement…</p>;
  if (!connexion) {
    return (
      <>
        <Retour vers="reglages" libelle="Réglages" />
        <div className="carte">
          <p>Pour ajouter des utilisateurs, reliez d’abord cet appareil à un compte : c’est ce qui permet à chacun de se connecter depuis son propre téléphone.</p>
          <a className="bouton" href="#/compte">Créer ou relier un compte</a>
        </div>
      </>
    );
  }
  if (!peut(elevage, 'admin.utilisateurs')) {
    return (
      <>
        <Retour vers="reglages" libelle="Réglages" />
        <div className="carte muet">Votre profil ne permet pas de gérer les utilisateurs. Demandez à l’administrateur de l’élevage.</div>
      </>
    );
  }
  return enfant;
}

export function PageUtilisateurs({ elevage }: { elevage: Elevage }) {
  return <Acces elevage={elevage} enfant={<Liste />} />;
}

function Liste() {
  const [membres, setMembres] = useState<Membre[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    synchro.membres().then(setMembres).catch((e) => setErreur(messageErreur(e)));
  }, []);
  return (
    <>
      <Retour vers="reglages" libelle="Réglages" />
      <h2>Gestion des utilisateurs</h2>
      <p className="muet">Chaque personne a son propre téléphone et ne voit que ce que vous lui accordez.</p>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      {membres === null && !erreur && <p className="muet">Chargement…</p>}
      {membres?.map((m) => (
        <a key={m.telephone} className="carte ligne" href={m.role === 'proprietaire' ? undefined : `#/utilisateurs/${encodeURIComponent(m.telephone)}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <span>
            <b>{m.nom ?? m.telephone}</b>{m.fonction ? ` · ${m.fonction}` : ''}
            <br />
            <small className="muet">
              {m.nom ? `${m.telephone} · ` : ''}{LIBELLES_PROFILS[m.role]}
              {m.role !== 'proprietaire' ? ` · ${m.droits.length} fonction${m.droits.length > 1 ? 's' : ''}` : ''}
              {m.zones.length > 0 ? ` · ${m.zones.length} bâtiment${m.zones.length > 1 ? 's' : ''}` : ''}
              {!m.actif ? (m.invitationEnCours ? ' · code donné, pas encore connecté' : ' · pas encore connecté') : ''}
            </small>
          </span>
          {m.role !== 'proprietaire' && <b aria-hidden="true">›</b>}
        </a>
      ))}
      <a className="bouton" href="#/utilisateurs/nouveau">+ Ajouter un utilisateur</a>
    </>
  );
}

export function FormUtilisateur({ elevage, telephone }: { elevage: Elevage; telephone?: string }) {
  return <Acces elevage={elevage} enfant={<Formulaire elevage={elevage} {...(telephone ? { telephone } : {})} />} />;
}

function Formulaire({ elevage, telephone: telephoneInitial }: { elevage: Elevage; telephone?: string }) {
  const notifier = useNotifier();
  const [existant, setExistant] = useState<Membre | null | undefined>(telephoneInitial ? undefined : null);
  const [nom, setNom] = useState('');
  const [fonction, setFonction] = useState('');
  const [telephone, setTelephone] = useState(telephoneInitial ?? '');
  const [droits, setDroits] = useState<string[]>([]);
  const [profil, setProfil] = useState<RoleMembre>('soigneur');
  const [toute, setToute] = useState(true);
  const [zones, setZones] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [code, setCode] = useState<{ telephone: string; code: string } | null>(null);
  const proprietaire = elevage.moi.role === 'proprietaire';

  // Nouvelle personne : on part du profil « soigneur ». Personne existante : on charge sa fiche.
  useEffect(() => {
    if (!telephoneInitial) {
      setDroits(droitsDuProfil('soigneur'));
      return;
    }
    synchro.membres().then((liste) => {
      const m = liste.find((x) => x.telephone === telephoneInitial);
      setExistant(m ?? null);
      if (m) {
        setNom(m.nom ?? '');
        setFonction(m.fonction ?? '');
        setDroits(m.droits);
        setProfil(profilCorrespondant(m.droits));
        setToute(m.zones.length === 0);
        setZones(m.zones);
      }
    }).catch((e) => setErreur(messageErreur(e)));
  }, [telephoneInitial]);

  if (existant === null && telephoneInitial) return <><Retour vers="utilisateurs" /><div className="carte muet">Cette personne ne fait plus partie de l’élevage.</div></>;
  if (existant === undefined) return <p className="chargement">Chargement…</p>;

  const choisirProfil = (p: RoleMembre) => {
    setProfil(p);
    if (p !== 'personnalise') setDroits(droitsDuProfil(p));
  };
  const cocher = (code: string, actif: boolean) => {
    const suite = actif ? [...droits, code] : droits.filter((c) => c !== code);
    setDroits(suite);
    setProfil(profilCorrespondant(suite));
  };
  const cocherModule = (module: string, actif: boolean) => {
    const suite = basculerModule(droits, module, actif).filter((c) => proprietaire || c !== 'admin.utilisateurs');
    setDroits(suite);
    setProfil(profilCorrespondant(suite));
  };

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(null);
    const tel = normaliserTelephone(telephone);
    if (!tel) return setErreur('Numéro de téléphone invalide. Exemple : 77 123 45 67.');
    if (droits.length === 0) return setErreur('Cochez au moins une fonction, ou choisissez un profil.');
    if (!toute && zones.length === 0) return setErreur('Choisissez au moins un bâtiment, ou cochez « Toute la ferme ».');
    setOccupe(true);
    try {
      const r = await synchro.enregistrerMembre({ telephone: tel, nom, fonction, role: profilCorrespondant(droits), droits, zones: toute ? [] : zones, ...(existant ? {} : { nouveauCode: true }) });
      notifier('Enregistré ✓');
      if (r.codeInvitation) setCode({ telephone: tel, code: r.codeInvitation });
      else aller('utilisateurs');
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setOccupe(false);
    }
  };

  const nouveauCode = async () => {
    try {
      const r = await synchro.enregistrerMembre({ telephone: existant!.telephone, nouveauCode: true });
      if (r.codeInvitation) setCode({ telephone: existant!.telephone, code: r.codeInvitation });
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  if (code) {
    const message = `Bonjour${nom ? ` ${nom}` : ''}, je vous ai ajouté(e) à l’élevage ${elevage.reglages.nomElevage || ''} sur l’application. Votre code de connexion : ${code.code} (valable 7 jours, à usage unique). Ouvrez l’application, allez dans Réglages puis « Compte », entrez votre numéro, appuyez sur « J’ai déjà un code » et saisissez ce code.`;
    return (
      <>
        <Retour vers="utilisateurs" libelle="Utilisateurs" />
        <div className="carte">
          <h2>Code de connexion</h2>
          <p className="gros-code" aria-label={`Code ${code.code.split('').join(' ')}`}>{code.code}</p>
          <p>Donnez ce code à la personne (<b>{code.telephone}</b>). Il est valable 7 jours et ne sert qu’une fois. Pour des raisons de sécurité, il ne sera plus affichable ensuite : vous pourrez en générer un autre.</p>
          <a className="bouton alt" href={`https://wa.me/${code.telephone.slice(1)}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">Envoyer par WhatsApp</a>
          <a className="bouton" href="#/utilisateurs">Terminé</a>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={soumettre}>
      <Retour vers="utilisateurs" libelle="Utilisateurs" />
      <h2>{existant ? (existant.nom ?? existant.telephone) : 'Ajouter un utilisateur'}</h2>
      <Champ libelle="Nom de la personne"><input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Moussa Ndiaye" /></Champ>
      <Champ libelle="Fonction dans la ferme" aide="Libre : « Responsable bâtiment A », « Caissier », « Gardien »…"><input value={fonction} onChange={(e) => setFonction(e.target.value)} /></Champ>
      <Champ libelle="Téléphone" aide={existant ? undefined : 'Elle se connectera avec ce numéro.'}>
        <input type="tel" inputMode="tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} disabled={!!existant} />
      </Champ>

      <h3>Ce que cette personne peut faire</h3>
      <Champ libelle="Profil de départ" aide={`${DESCRIPTIONS_PROFILS[profil]} Choisir un profil remplace les cases cochées ; vous pouvez ensuite les ajuster.`}>
        <select value={profil} onChange={(e) => choisirProfil(e.target.value as RoleMembre)}>
          {PROFILS_ASSIGNABLES.map((p) => <option key={p} value={p}>{LIBELLES_PROFILS[p]}</option>)}
        </select>
      </Champ>
      {MODULES.map((m) => (
        <ModuleDroits
          key={m.code}
          module={m}
          droits={droits}
          verrouilles={proprietaire ? [] : ['admin.utilisateurs']}
          onCocher={cocher}
          onModule={cocherModule}
        />
      ))}

      <h3>Où cette personne intervient</h3>
      <div className="carte">
        <label className="case"><input type="checkbox" checked={toute} onChange={(e) => setToute(e.target.checked)} /> Toute la ferme</label>
        {!toute && (
          <>
            <p className="muet">Cette personne ne verra que les animaux et la production de ces bâtiments et cages.</p>
            {elevage.donnees.logements.length === 0 && <p className="muet">Aucun bâtiment n’est encore créé (Réglages › Mes locaux).</p>}
            {elevage.donnees.logements.map((l) => (
              <label key={l.id} className="case">
                <input type="checkbox" checked={zones.includes(l.id)} onChange={(e) => setZones(e.target.checked ? [...zones, l.id] : zones.filter((z) => z !== l.id))} /> {l.nom}
              </label>
            ))}
          </>
        )}
      </div>

      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={occupe || !telephone.trim()}>{occupe ? 'Enregistrement…' : existant ? 'Enregistrer' : 'Ajouter et obtenir le code'}</button>
      {existant && (
        <div className="carte">
          <button type="button" className="lien" onClick={() => void nouveauCode()}>Donner un nouveau code de connexion</button>
          <button type="button" className="lien" onClick={async () => { if (window.confirm('Déconnecter tous les appareils de cette personne ?')) { try { await synchro.deconnecterAppareils(existant.telephone); notifier('Appareils déconnectés'); } catch (err) { setErreur(messageErreur(err)); } } }}>Déconnecter ses appareils</button>
          <button type="button" className="lien danger" onClick={async () => { if (window.confirm('Retirer cette personne de l’élevage ?')) { try { await synchro.retirer(existant.telephone); aller('utilisateurs'); } catch (err) { setErreur(messageErreur(err)); } } }}>Retirer de l’élevage</button>
        </div>
      )}
    </form>
  );
}

function ModuleDroits({ module, droits, verrouilles, onCocher, onModule }: {
  module: (typeof MODULES)[number];
  droits: string[];
  verrouilles: string[];
  onCocher: (code: string, actif: boolean) => void;
  onModule: (module: string, actif: boolean) => void;
}) {
  const etat = etatModule(droits, module.code);
  const case_ = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (case_.current) case_.current.indeterminate = etat === 'partiel';
  }, [etat]);
  const coches = module.fonctions.filter((f) => droits.includes(f.code)).length;
  return (
    <details className="carte module-droits" open={etat !== 'aucun'}>
      <summary>
        <label className="case" onClick={(e) => e.stopPropagation()}>
          <input ref={case_} type="checkbox" checked={etat === 'tout'} onChange={(e) => onModule(module.code, e.target.checked)} aria-label={`Tout cocher : ${module.libelle}`} />
          <span>{module.libelle}</span>
        </label>
        <small className="muet">{coches} / {module.fonctions.length}</small>
      </summary>
      {module.fonctions.map((f) => (
        <label key={f.code} className="case">
          <input type="checkbox" checked={droits.includes(f.code)} disabled={verrouilles.includes(f.code)} onChange={(e) => onCocher(f.code, e.target.checked)} /> {f.libelle}
        </label>
      ))}
    </details>
  );
}

