import { useEffect, useMemo, useState } from 'react';
import { phraseJournal, type EntreeJournal } from '@digitalab/core';
import { Retour } from '../components/ui';
import { peut } from '../droits';
import { ErreurReseau, ErreurServeur, synchro } from '../sync';
import { useConnexion } from './Compte';
import type { Elevage } from '../useElevage';

const RUBRIQUES: { cle: string; libelle: string; tables: string[] }[] = [
  { cle: 'tout', libelle: 'Tout', tables: [] },
  { cle: 'saisie', libelle: 'Saisie quotidienne', tables: ['pontes', 'distributions', 'mouvements', 'entreesStock'] },
  { cle: 'cheptel', libelle: 'Cheptel et bâtiments', tables: ['lots', 'logements'] },
  { cle: 'couveuse', libelle: 'Couveuse', tables: ['couveuses', 'incubations', 'mirages'] },
  { cle: 'sante', libelle: 'Santé et quarantaine', tables: ['evenementsSante', 'quarantaines', 'notesQuarantaine'] },
  { cle: 'finances', libelle: 'Finances et salaires', tables: ['operations', 'paiements', 'tiers', 'employes', 'comptes', 'transferts', 'pointages'] },
  { cle: 'utilisateurs', libelle: 'Utilisateurs et droits', tables: ['utilisateurs', 'profil'] },
];

const heure = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const jourLong = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const cleJour = (ms: number) => new Date(ms).toLocaleDateString('sv-SE');
/** Au-delà de ce délai entre l'action et sa réception, on précise que la personne travaillait sans réseau. */
const DELAI_HORS_LIGNE_MS = 15 * 60_000;

function message(e: unknown): string {
  if (e instanceof ErreurReseau) return 'Pas de connexion au serveur. Le journal demande d’être en ligne.';
  if (e instanceof ErreurServeur) return e.message;
  return 'Une erreur est survenue. Réessayez.';
}

export function PageJournal({ elevage }: { elevage: Elevage }) {
  const connexion = useConnexion();
  const [entrees, setEntrees] = useState<EntreeJournal[]>([]);
  const [reste, setReste] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [personne, setPersonne] = useState('');
  const [rubrique, setRubrique] = useState('tout');
  const [connus, setConnus] = useState<Map<string, string>>(new Map());

  const charger = async (suite: boolean) => {
    setOccupe(true);
    setErreur(null);
    try {
      const r = await synchro.journal({ ...(suite && entrees.length ? { avant: entrees.at(-1)!.id } : {}), ...(personne ? { identifiant: personne } : {}) });
      setEntrees(suite ? [...entrees, ...r.entrees] : r.entrees);
      setReste(r.reste);
      if (!personne) setConnus((m) => new Map([...m, ...r.entrees.map((x): [string, string] => [x.identifiant, x.nom ?? x.identifiant])]));
    } catch (e) {
      setErreur(message(e));
    } finally {
      setOccupe(false);
    }
  };

  useEffect(() => {
    if (connexion) void charger(false);
    // On recharge quand on change de personne ou quand la connexion apparaît.
  }, [personne, connexion?.organisationId]);

  const tables = RUBRIQUES.find((r) => r.cle === rubrique)?.tables ?? [];
  const visibles = useMemo(() => (tables.length ? entrees.filter((x) => tables.includes(x.table)) : entrees), [entrees, tables.join()]);
  const parJour = useMemo(() => {
    const groupes: { jour: string; titre: string; lignes: EntreeJournal[] }[] = [];
    for (const x of visibles) {
      const jour = cleJour(x.faitLe);
      const dernier = groupes.at(-1);
      if (dernier?.jour === jour) dernier.lignes.push(x);
      else groupes.push({ jour, titre: jourLong(x.faitLe), lignes: [x] });
    }
    return groupes;
  }, [visibles]);

  if (connexion === undefined) return <p className="chargement">Chargement…</p>;
  if (!peut(elevage, 'admin.journal') || !connexion) {
    return (
      <>
        <Retour vers="reglages" libelle="Réglages" />
        <h2>Journal d’activité</h2>
        <div className="carte muet">
          {connexion ? 'Votre profil ne permet pas de consulter le journal d’activité.' : 'Le journal d’activité note qui a fait quoi : il demande un compte relié à un serveur.'}
        </div>
        {!connexion && <a className="bouton" href="#/compte">Créer ou relier un compte</a>}
      </>
    );
  }

  return (
    <>
      <Retour vers="reglages" libelle="Réglages" />
      <h2>Journal d’activité</h2>
      <p className="muet">Qui a ajouté, modifié, annulé ou validé quoi. Chaque ligne est écrite par le serveur : une personne ne peut pas la modifier.</p>
      <div className="duo">
        <label className="champ">
          <span>Personne</span>
          <select id="filtre-personne" value={personne} onChange={(e) => setPersonne(e.target.value)}>
            <option value="">Tout le monde</option>
            {[...connus].map(([tel, nom]) => <option key={tel} value={tel}>{nom}</option>)}
          </select>
        </label>
        <label className="champ">
          <span>Sujet</span>
          <select id="filtre-sujet" value={rubrique} onChange={(e) => setRubrique(e.target.value)}>
            {RUBRIQUES.map((r) => <option key={r.cle} value={r.cle}>{r.libelle}</option>)}
          </select>
        </label>
      </div>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      {!erreur && !occupe && visibles.length === 0 && <div className="carte muet">Rien à afficher pour le moment.</div>}
      {parJour.map((g) => (
        <section key={g.jour}>
          <h3 className="jour-journal">{g.titre}</h3>
          <div className="carte">
            {g.lignes.map((x) => (
              <div key={x.id} className="ligne ligne-journal">
                <span>
                  <b>{x.nom ?? x.identifiant}</b>{x.fonction ? <small className="muet"> · {x.fonction}</small> : null}
                  <br />
                  {phraseJournal(x)}
                  {Date.parse(x.recuLe) - x.faitLe > DELAI_HORS_LIGNE_MS && <><br /><small className="muet">fait sans réseau, reçu à {heure(Date.parse(x.recuLe))}</small></>}
                </span>
                <small className="muet heure">{heure(x.faitLe)}</small>
              </div>
            ))}
          </div>
        </section>
      ))}
      {reste && <button className="bouton alt" disabled={occupe} onClick={() => void charger(true)}>{occupe ? 'Chargement…' : 'Voir plus ancien'}</button>}
    </>
  );
}
