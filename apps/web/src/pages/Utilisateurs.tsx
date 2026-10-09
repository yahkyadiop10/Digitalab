import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import {
  DESCRIPTIONS_PROFILS, LIBELLES_PROFILS, MODULES, PROFILS_ASSIGNABLES, basculerModule, droitsDuProfil, etatModule, identifiantDepuisNom, nettoyerDroits, normaliserTelephone,
  type RoleMembre,
} from '@digitalab/core';
import { Champ, Retour, useNotifier, useConfirmer } from '../components/ui';
import { MotDePasseProvisoire } from '../components/Comptes';
import { ErreurReseau, ErreurServeur, synchro, type CompteProvisoire, type Membre } from '../sync';
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

const ETAT_COMPTE: Record<Membre['etat'], string> = {
  actif: '',
  provisoire: ' · mot de passe provisoire pas encore changé',
  expire: ' · mot de passe provisoire expiré : à réinitialiser',
};

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
      <p className="muet">Chaque personne se connecte avec son identifiant et son mot de passe, depuis son propre téléphone, et ne voit que ce que vous lui accordez.</p>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      {membres === null && !erreur && <p className="muet">Chargement…</p>}
      {membres?.map((m) => (
        <a key={m.identifiant} className="carte ligne" href={m.role === 'proprietaire' ? undefined : `#/utilisateurs/${encodeURIComponent(m.identifiant)}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <span>
            <b>{m.nom ?? m.identifiant}</b>{m.fonction ? ` · ${m.fonction}` : ''}
            <br />
            <small className="muet">
              {m.identifiant} · {LIBELLES_PROFILS[m.role]}
              {m.role !== 'proprietaire' ? ` · ${m.droits.length} fonction${m.droits.length > 1 ? 's' : ''}` : ''}
              {m.zones.length > 0 ? ` · ${m.zones.length} bâtiment${m.zones.length > 1 ? 's' : ''}` : ''}
              {ETAT_COMPTE[m.etat]}
            </small>
          </span>
          {m.role !== 'proprietaire' && <b aria-hidden="true">›</b>}
        </a>
      ))}
      <a className="bouton" href="#/utilisateurs/nouveau">+ Ajouter un utilisateur</a>
    </>
  );
}

export function FormUtilisateur({ elevage, identifiant }: { elevage: Elevage; identifiant?: string }) {
  return <Acces elevage={elevage} enfant={<Formulaire elevage={elevage} {...(identifiant ? { identifiant } : {})} />} />;
}

function Formulaire({ elevage, identifiant: identifiantInitial }: { elevage: Elevage; identifiant?: string }) {
  const confirmer = useConfirmer();
  const notifier = useNotifier();
  const [existant, setExistant] = useState<Membre | null | undefined>(identifiantInitial ? undefined : null);
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [fonction, setFonction] = useState('');
  const [telephone, setTelephone] = useState('');
  const [droits, setDroits] = useState<string[]>([]);
  const [profil, setProfil] = useState<RoleMembre>('soigneur');
  const [toute, setToute] = useState(true);
  const [zones, setZones] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [compte, setCompte] = useState<{ compte: CompteProvisoire; telephone: string | null; titre: string } | null>(null);
  const proprietaire = elevage.moi.role === 'proprietaire';

  // Nouvelle personne : on part du profil « soigneur ». Personne existante : on charge sa fiche.
  useEffect(() => {
    if (!identifiantInitial) {
      setDroits(droitsDuProfil('soigneur'));
      return;
    }
    synchro.membres().then((liste) => {
      const m = liste.find((x) => x.identifiant === identifiantInitial);
      setExistant(m ?? null);
      if (m) {
        setNom(m.nom ?? '');
        setFonction(m.fonction ?? '');
        setTelephone(m.telephone ?? '');
        setDroits(m.droits);
        setProfil(profilCorrespondant(m.droits));
        setToute(m.zones.length === 0);
        setZones(m.zones);
      }
    }).catch((e) => setErreur(messageErreur(e)));
  }, [identifiantInitial]);

  if (existant === null && identifiantInitial) return <><Retour vers="utilisateurs" /><div className="carte muet">Cette personne ne fait plus partie de l’élevage.</div></>;
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
    if (telephone.trim() && !normaliserTelephone(telephone)) return setErreur('Numéro de téléphone invalide. Exemple : 77 123 45 67.');
    if (droits.length === 0) return setErreur('Cochez au moins une fonction, ou choisissez un profil.');
    if (!toute && zones.length === 0) return setErreur('Choisissez au moins un bâtiment, ou cochez « Toute la ferme ».');
    const commun = { fonction, telephone, role: profilCorrespondant(droits), droits, zones: toute ? [] : zones };
    setOccupe(true);
    try {
      if (existant) {
        await synchro.modifierMembre(existant.identifiant, { ...commun, nom });
        notifier('Enregistré ✓');
        aller('utilisateurs');
      } else {
        const r = await synchro.ajouterMembre({ ...commun, prenom, nom });
        setCompte({ compte: r, telephone: normaliserTelephone(telephone), titre: 'Compte créé' });
      }
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setOccupe(false);
    }
  };

  const reinitialiser = async () => {
    if (!existant) return;
    if (!await confirmer(`Donner un nouveau mot de passe provisoire à ${existant.nom ?? existant.identifiant} ? Son ancien mot de passe ne fonctionnera plus et ses appareils seront déconnectés.`)) return;
    try {
      const r = await synchro.reinitialiserMotDePasse(existant.identifiant);
      setCompte({ compte: r, telephone: existant.telephone, titre: 'Nouveau mot de passe provisoire' });
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  if (compte) {
    return (
      <>
        <Retour vers="utilisateurs" libelle="Utilisateurs" />
        <MotDePasseProvisoire compte={compte.compte} telephone={compte.telephone} elevage={elevage.reglages.nomElevage || ''} titre={compte.titre}>
          <a className="bouton" href="#/utilisateurs">Terminé</a>
        </MotDePasseProvisoire>
      </>
    );
  }

  return (
    <form onSubmit={soumettre}>
      <Retour vers="utilisateurs" libelle="Utilisateurs" />
      <h2>{existant ? (existant.nom ?? existant.identifiant) : 'Ajouter un utilisateur'}</h2>
      {existant ? (
        <>
          <div className="carte ligne"><span>Identifiant</span><b>{existant.identifiant}</b></div>
          <Champ libelle="Nom de la personne"><input value={nom} onChange={(e) => setNom(e.target.value)} /></Champ>
        </>
      ) : (
        <>
          <Champ libelle="Prénom"><input value={prenom} onChange={(e) => setPrenom(e.target.value)} placeholder="Moussa" required /></Champ>
          <Champ libelle="Nom" aide={`L’identifiant sera créé automatiquement : ${prenom.trim() && nom.trim() ? identifiantDepuisNom(prenom, nom) || '…' : 'nom.prénom'} (un chiffre sera ajouté s’il existe déjà).`}>
            <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ndiaye" required />
          </Champ>
        </>
      )}
      <Champ libelle="Fonction dans la ferme" aide="Libre : « Responsable bâtiment A », « Caissier », « Gardien »…"><input value={fonction} onChange={(e) => setFonction(e.target.value)} /></Champ>
      <Champ libelle="Téléphone (facultatif)" aide="Pour la joindre ou lui envoyer ses accès par WhatsApp. Il ne sert pas à se connecter.">
        <input type="tel" inputMode="tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} />
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
            <p className="muet">Le serveur n’enverra à cette personne que les animaux, la production et les saisies de ces bâtiments et cages, et refusera toute saisie ailleurs.</p>
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
      <button className="bouton" disabled={occupe || (!existant && (!prenom.trim() || !nom.trim()))}>{occupe ? 'Enregistrement…' : existant ? 'Enregistrer' : 'Ajouter et obtenir le mot de passe provisoire'}</button>
      {existant && (
        <div className="carte">
          <p className="muet">
            {existant.etat === 'actif' ? 'Vous ne pouvez pas voir son mot de passe. Si elle l’a oublié, générez-en un nouveau.' : existant.etat === 'expire' ? 'Son mot de passe provisoire a expiré : générez-en un nouveau.' : 'Elle n’a pas encore choisi son mot de passe personnel.'}
          </p>
          <button type="button" className="lien" onClick={() => void reinitialiser()}>Réinitialiser son mot de passe</button>
          <button type="button" className="lien" onClick={async () => { if (await confirmer('Déconnecter tous les appareils de cette personne ?')) { try { await synchro.deconnecterAppareils(existant.identifiant); notifier('Appareils déconnectés'); } catch (err) { setErreur(messageErreur(err)); } } }}>Déconnecter ses appareils</button>
          <button type="button" className="lien danger" onClick={async () => { if (await confirmer('Retirer cette personne de l’élevage ? Son compte sera supprimé.')) { try { await synchro.retirer(existant.identifiant); aller('utilisateurs'); } catch (err) { setErreur(messageErreur(err)); } } }}>Retirer de l’élevage</button>
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

