import { useState, type FormEvent } from 'react';
import {
  COMPORTEMENTS,
  DUREE_QUARANTAINE_DEFAUT,
  ETAPES_QUARANTAINE,
  bilanQuarantaine,
  derniereNote,
  finQuarantaine,
  jourLocal,
  quarantainesActives,
  suivreQuarantaine,
  type EtatArrivee,
  type EtatNote,
  type Quarantaine,
} from '@digitalab/core';
import { Champ, Nombre, Retour, useNotifier, versNombre } from '../components/ui';
import { ErreurSaisie, repo } from '../repo';
import { aller } from '../route';
import type { Elevage } from '../useElevage';

const dateCourte = (j: string) => j.slice(5).split('-').reverse().join('/');
const nb = (x: number) => String(x).replace('.', ',');
const ETATS_NOTE: Record<EtatNote, string> = { bien: 'Tout va bien', moyen: 'Moyen', inquietant: 'Inquiétant' };
const ETATS_ARRIVEE: Record<EtatArrivee, string> = { bon: 'Bon état', moyen: 'État moyen', mauvais: 'Mauvais état' };

/* ---------- Liste : la zone de quarantaine ---------- */

export function PageQuarantaine({ elevage }: { elevage: Elevage }) {
  const { donnees, reglages, maintenant, effectifParLot } = elevage;
  const auj = jourLocal(maintenant);
  const actives = quarantainesActives(donnees.quarantaines).sort((a, b) => a.arrivee.localeCompare(b.arrivee));
  const terminees = donnees.quarantaines.filter((q) => q.sortie).sort((a, b) => (b.sortie?.jour ?? '').localeCompare(a.sortie?.jour ?? '')).slice(0, 5);

  return (
    <>
      <h2>Zone de quarantaine</h2>
      <p className="muet">Gardez les nouveaux arrivants à l’écart du reste de l’élevage, le temps de les observer avant de les mélanger.</p>
      <a className="bouton" href="#/quarantaine/arrivee">+ Nouvelle arrivée</a>

      <h2>En quarantaine</h2>
      {actives.length === 0 && <div className="carte muet">Aucun animal en quarantaine.</div>}
      {actives.map((q) => {
        const s = suivreQuarantaine(q, auj);
        const note = derniereNote(donnees.notesQuarantaine, q.id);
        return (
          <a key={q.id} className="gros" href={`#/quarantaine/${q.id}`}>
            {q.nom}
            <span>
              {effectifParLot.get(q.lotId) ?? 0} {reglages.especes[q.especeCode]?.nom.toLowerCase() ?? 'animaux'}{q.race ? ` · ${q.race}` : ''} · jour {s.jourJ} sur {q.dureeJours} ·{' '}
              {s.statut === 'a_decider' ? 'durée atteinte : à décider' : s.statut === 'fin_proche' ? 'fin demain' : `fin le ${dateCourte(s.fin)}`}
              {note ? ` · dernière note : ${ETATS_NOTE[note.etat].toLowerCase()}` : ' · aucune note'}
            </span>
            <progress max={q.dureeJours} value={Math.min(s.jourJ, q.dureeJours)} aria-label="Avancement de la quarantaine" />
          </a>
        );
      })}

      <div className="carte muet">
        Un lot déjà présent dans l’élevage tombe malade ? <a className="lien" href="#/sante/quarantaine">Notez sa mise à l’écart</a> dans la partie Santé.
      </div>

      {terminees.length > 0 && (
        <>
          <h2>Terminées</h2>
          {terminees.map((q) => (
            <a key={q.id} className="gros" href={`#/quarantaine/${q.id}`}>
              {q.nom}
              <span>{q.sortie?.decision === 'integre' ? 'Intégrés à l’élevage' : 'Écartés'} le {dateCourte(q.sortie?.jour ?? '')}</span>
            </a>
          ))}
        </>
      )}
    </>
  );
}

/* ---------- Nouvelle arrivée ---------- */

export function FormArrivee({ elevage }: { elevage: Elevage }) {
  const { donnees, reglages, maintenant } = elevage;
  const notifier = useNotifier();
  const auj = jourLocal(maintenant);
  const [espece, setEspece] = useState('poule');
  const [nom, setNom] = useState('');
  const [race, setRace] = useState('');
  const [nombre, setNombre] = useState('');
  const [age, setAge] = useState('');
  const [uniteAge, setUniteAge] = useState<'jours' | 'semaines' | 'mois'>('semaines');
  const [origine, setOrigine] = useState('');
  const [prix, setPrix] = useState('');
  const [arrivee, setArrivee] = useState(auj);
  const [duree, setDuree] = useState(String(DUREE_QUARANTAINE_DEFAUT));
  const [logementId, setLogementId] = useState('');
  const [etat, setEtat] = useState<EtatArrivee>('bon');
  const [alimentation, setAlimentation] = useState('');
  const [note, setNote] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  const nomAuto = `${reglages.especes[espece]?.nom ?? 'Arrivage'} – arrivée du ${new Date(`${arrivee}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
  const jours = (): number | undefined => {
    if (!age.trim()) return undefined;
    const v = versNombre(age);
    return Number.isFinite(v) ? Math.round(v * { jours: 1, semaines: 7, mois: 30 }[uniteAge]) : NaN;
  };

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const ageJours = jours();
      const id = await repo.creerQuarantaine({
        nom: nom.trim() || nomAuto, especeCode: espece, race, nombre: versNombre(nombre), ...(ageJours !== undefined ? { ageJours } : {}),
        origine, arrivee, dureeJours: versNombre(duree), logementId: logementId || null, alimentation, etatArrivee: etat, noteArrivee: note,
        ...(prix ? { prixTotal: versNombre(prix) } : {}),
      });
      notifier('Arrivée enregistrée, quarantaine commencée ✓');
      aller(`quarantaine/${id}`);
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Enregistrement impossible.');
    }
  };

  return (
    <form onSubmit={soumettre}>
      <Retour vers="quarantaine" />
      <h2>Nouvelle arrivée en quarantaine</h2>
      <Champ libelle="Espèce">
        <select value={espece} onChange={(e) => setEspece(e.target.value)}>{Object.values(reglages.especes).map((s) => <option key={s.code} value={s.code}>{s.nom}</option>)}</select>
      </Champ>
      <Champ libelle="Race ou variété (facultatif)"><input value={race} onChange={(e) => setRace(e.target.value)} /></Champ>
      <Champ libelle="Nombre d’animaux"><Nombre valeur={nombre} onChange={setNombre} min={1} /></Champ>
      <Champ libelle="Âge approximatif (facultatif)">
        <Nombre valeur={age} onChange={setAge} />
      </Champ>
      <div className="choix" role="group" aria-label="Unité de l’âge">
        {(['jours', 'semaines', 'mois'] as const).map((u) => <button key={u} type="button" className={uniteAge === u ? 'on' : ''} onClick={() => setUniteAge(u)}>{u}</button>)}
      </div>
      <Champ libelle="Vendeur ou provenance (facultatif)"><input value={origine} onChange={(e) => setOrigine(e.target.value)} placeholder="Nom du vendeur, marché, ferme…" /></Champ>
      <Champ libelle="Prix payé en FCFA (facultatif)" aide="S’il est renseigné, la dépense est notée dans les finances (achat d’animaux)."><Nombre valeur={prix} onChange={setPrix} pas={500} unite="FCFA" /></Champ>
      <Champ libelle="Date d’arrivée"><input type="date" value={arrivee} max={auj} onChange={(e) => setArrivee(e.target.value)} /></Champ>
      <Champ libelle="Durée de la quarantaine (jours)" aide="Valeur de départ à adapter : demandez conseil à un vétérinaire si vous hésitez."><Nombre valeur={duree} onChange={setDuree} min={1} pas={7} unite="j" /></Champ>
      <Champ libelle="Où les placer ?" aide="Par défaut, une zone de quarantaine est créée ou réutilisée.">
        <select value={logementId} onChange={(e) => setLogementId(e.target.value)}>
          <option value="">Zone de quarantaine (automatique)</option>
          {donnees.logements.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}
        </select>
      </Champ>
      <h3>État à l’arrivée</h3>
      <div className="choix" role="group" aria-label="État à l’arrivée">
        {(Object.keys(ETATS_ARRIVEE) as EtatArrivee[]).map((k) => <button key={k} type="button" className={etat === k ? 'on' : ''} onClick={() => setEtat(k)}>{ETATS_ARRIVEE[k]}</button>)}
      </div>
      <Champ libelle="Alimentation donnée (facultatif)"><input value={alimentation} onChange={(e) => setAlimentation(e.target.value)} placeholder="Marque, type, quantité…" /></Champ>
      <Champ libelle="Autres informations (facultatif)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Transport, stress, blessures vues…" /></Champ>
      <Champ libelle="Nom de l’arrivage (facultatif)" aide={`Sinon : ${nomAuto}`}><input value={nom} onChange={(e) => setNom(e.target.value)} /></Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={!nombre}>Commencer la quarantaine</button>
    </form>
  );
}

/* ---------- Fiche d'une quarantaine ---------- */

export function FicheQuarantaine({ elevage, id }: { elevage: Elevage; id: string }) {
  const { donnees, reglages, maintenant, noms, effectifParLot } = elevage;
  const notifier = useNotifier();
  const [panneau, setPanneau] = useState<'note' | 'fin' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const q = donnees.quarantaines.find((x) => x.id === id);
  if (!q) return (<><Retour vers="quarantaine" /><div className="carte">Quarantaine introuvable.</div></>);

  const auj = jourLocal(maintenant);
  const s = suivreQuarantaine(q, auj);
  const bilan = bilanQuarantaine(q, donnees.notesQuarantaine, donnees.mouvements);
  const notes = donnees.notesQuarantaine.filter((n) => n.quarantaineId === q.id).sort((a, b) => b.date.localeCompare(a.date) || b.misAJour - a.misAJour);
  const termine = !!q.sortie;
  const agir = async (action: () => Promise<unknown>, message: string, apres?: () => void) => {
    setErreur(null);
    try {
      await action();
      notifier(message);
      apres?.();
    } catch (e) {
      setErreur(e instanceof ErreurSaisie ? e.message : 'Action impossible.');
    }
  };

  return (
    <>
      <Retour vers="quarantaine" libelle="Zone de quarantaine" />
      <article className="carte">
        <h2 style={{ marginTop: 0 }}>{q.nom}</h2>
        <span className="pilule">{reglages.especes[q.especeCode]?.nom ?? q.especeCode}{q.race ? ` · ${q.race}` : ''}</span>
        {termine ? <span className="pilule">{q.sortie?.decision === 'integre' ? 'Intégrés à l’élevage' : 'Écartés'}</span> : (
          <span className={`badge n-${s.statut === 'a_decider' ? 'orange' : s.statut === 'fin_proche' ? 'jaune' : 'vert'}`}>
            {s.statut === 'a_decider' ? 'À décider' : s.statut === 'fin_proche' ? 'Fin demain' : 'En cours'}
          </span>
        )}
        <div className="ligne"><span>Animaux arrivés</span><b>{q.nombre}</b></div>
        <div className="ligne"><span>Animaux présents</span><b>{effectifParLot.get(q.lotId) ?? 0}</b></div>
        {q.ageJours !== undefined && <div className="ligne"><span>Âge à l’arrivée (environ)</span><b>{q.ageJours >= 14 ? `${Math.round(q.ageJours / 7)} semaines` : `${q.ageJours} jours`}</b></div>}
        {q.origine && <div className="ligne"><span>Provenance</span><b>{q.origine}</b></div>}
        <div className="ligne"><span>Arrivée</span><b>{dateCourte(q.arrivee)}</b></div>
        <div className="ligne"><span>Quarantaine prévue</span><b>{q.dureeJours} jours, jusqu’au {dateCourte(finQuarantaine(q))}</b></div>
        {!termine && <div className="ligne"><span>Aujourd’hui</span><b>jour {s.jourJ} sur {q.dureeJours}</b></div>}
        {!termine && <progress max={q.dureeJours} value={Math.min(s.jourJ, q.dureeJours)} aria-label="Avancement de la quarantaine" />}
        <div className="ligne"><span>Local</span><b>{q.logementId ? noms.logement(q.logementId) : 'Non précisé'}</b></div>
        {q.alimentation && <div className="ligne"><span>Alimentation à l’arrivée</span><b>{q.alimentation}</b></div>}
        {q.etatArrivee && <div className="ligne"><span>État à l’arrivée</span><b>{ETATS_ARRIVEE[q.etatArrivee]}</b></div>}
        {q.noteArrivee && <div className="ligne"><span>Remarques</span><b>{q.noteArrivee}</b></div>}
      </article>

      {!termine && (
        <div className="rangee">
          <button className="bouton court" onClick={() => setPanneau(panneau === 'note' ? null : 'note')}>+ Ajouter une note</button>
          <a className="bouton alt court" href={`#/saisie/aliment?lot=${q.lotId}`}>🌾 Aliment</a>
          <a className="bouton alt court" href={`#/saisie/deces?lot=${q.lotId}`}>⚠️ Décès</a>
          <a className="bouton alt court" href={`#/sante/probleme?lot=${q.lotId}`}>🩺 Santé</a>
        </div>
      )}
      {panneau === 'note' && !termine && <FormNote quarantaine={q} derniereAlimentation={notes.find((n) => n.alimentation)?.alimentation ?? q.alimentation ?? ''} fin={() => setPanneau(null)} />}

      <h2>Contrôles à faire</h2>
      <div className="carte">
        {ETAPES_QUARANTAINE.map((e) => (
          <label key={e.code} className="case">
            <input type="checkbox" checked={q.etapes.includes(e.code)} disabled={termine} onChange={(ev) => void agir(() => repo.definirEtapeQuarantaine(q.id, e.code, ev.target.checked), ev.target.checked ? 'Contrôle noté ✓' : 'Contrôle retiré')} /> {e.libelle}
          </label>
        ))}
        <p className="muet">Les vaccins et traitements se notent dans l’onglet Santé, pour le lot « {noms.lot(q.lotId)} ».</p>
      </div>

      <h2>Bilan</h2>
      <div className="carte">
        <div className="ligne"><span>Morts depuis l’arrivée</span><b>{bilan.morts}</b></div>
        <div className="ligne"><span>Notes du journal</span><b>{bilan.notes}</b></div>
        {bilan.poidsDebutG !== null && bilan.poidsFinG !== null && bilan.poidsDebutG !== bilan.poidsFinG && (
          <div className="ligne"><span>Poids moyen</span><b>{bilan.poidsDebutG} g → {bilan.poidsFinG} g</b></div>
        )}
      </div>

      <h2>Journal d’observation</h2>
      {notes.length === 0 && <div className="carte muet">Aucune note pour l’instant. Notez chaque jour ce que vous voyez.</div>}
      {notes.map((n) => (
        <article key={n.id} className={`carte alerte n-${n.etat === 'inquietant' ? 'orange' : n.etat === 'moyen' ? 'jaune' : 'vert'}`}>
          <h3>{dateCourte(n.date)} · {ETATS_NOTE[n.etat]}</h3>
          {n.comportements.length > 0 && <p>{n.comportements.map((c) => COMPORTEMENTS.find((x) => x.code === c)?.libelle ?? c).join(', ')}.</p>}
          {n.malades !== undefined && n.malades > 0 && <p>{n.malades} animal(aux) semble(nt) malade(s).</p>}
          {n.alimentation && <p>Alimentation : {n.alimentation}</p>}
          {n.poidsMoyenG !== undefined && <p>Poids moyen : {nb(n.poidsMoyenG)} g</p>}
          {n.note && <p>{n.note}</p>}
          <div className="actions"><button className="lien" onClick={() => { if (window.confirm('Annuler cette note ?')) void repo.annuler({ table: 'notesQuarantaine', id: n.id }); }}>Annuler</button></div>
        </article>
      ))}

      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      {!termine ? (
        <>
          <h2>Fin de la quarantaine</h2>
          {panneau === 'fin' ? (
            <FormFin elevage={elevage} quarantaine={q} fin={() => setPanneau(null)} />
          ) : (
            <div className="rangee">
              <button className="bouton court" onClick={() => setPanneau('fin')}>Terminer la quarantaine</button>
              <button className="bouton alt court" onClick={() => void agir(() => repo.prolongerQuarantaine(q.id, 7), 'Quarantaine prolongée de 7 jours ✓')}>Prolonger de 7 jours</button>
            </div>
          )}
        </>
      ) : (
        <div className="carte">
          <p>{q.sortie?.decision === 'integre' ? `Les animaux ont rejoint ${q.sortie.logementId ? noms.logement(q.sortie.logementId) : 'l’élevage'}.` : 'Les animaux sont restés à l’écart.'} Le {dateCourte(q.sortie?.jour ?? '')}.</p>
          {q.sortie?.note && <p className="muet">{q.sortie.note}</p>}
          <a className="bouton alt court" href={`#/cheptel/${q.lotId}`}>Voir le lot</a>
          <button className="lien" onClick={() => void agir(() => repo.rouvrirQuarantaine(q.id), 'Quarantaine rouverte')}>Rouvrir la quarantaine</button>
        </div>
      )}
    </>
  );
}

function FormNote({ quarantaine, derniereAlimentation, fin }: { quarantaine: Quarantaine; derniereAlimentation: string; fin: () => void }) {
  const notifier = useNotifier();
  const [etat, setEtat] = useState<EtatNote>('bien');
  const [choisis, setChoisis] = useState<string[]>([]);
  const [alimentation, setAlimentation] = useState(derniereAlimentation);
  const [poids, setPoids] = useState('');
  const [malades, setMalades] = useState('');
  const [note, setNote] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  const basculer = (code: string) => setChoisis((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code]));
  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const a = await repo.ajouterNoteQuarantaine({
        quarantaineId: quarantaine.id, etat, comportements: choisis, alimentation, note,
        ...(poids ? { poidsMoyenG: versNombre(poids) } : {}),
        ...(malades ? { malades: versNombre(malades) } : {}),
      });
      notifier('Note ajoutée ✓', { annuler: () => repo.annuler(a) });
      fin();
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Enregistrement impossible.');
    }
  };

  return (
    <form className="carte" onSubmit={soumettre}>
      <h3>Note du jour</h3>
      <div className="choix" role="group" aria-label="État général">
        {(Object.keys(ETATS_NOTE) as EtatNote[]).map((k) => <button key={k} type="button" className={etat === k ? 'on' : ''} onClick={() => setEtat(k)}>{ETATS_NOTE[k]}</button>)}
      </div>
      <fieldset>
        <legend>Comportement observé</legend>
        {COMPORTEMENTS.map((c) => <label key={c.code} className="case"><input type="checkbox" checked={choisis.includes(c.code)} onChange={() => basculer(c.code)} /> {c.libelle}</label>)}
      </fieldset>
      <Champ libelle="Alimentation utilisée"><input value={alimentation} onChange={(e) => setAlimentation(e.target.value)} /></Champ>
      <Champ libelle="Poids moyen en grammes (facultatif)"><Nombre valeur={poids} onChange={setPoids} pas={10} unite="g" /></Champ>
      <Champ libelle="Animaux qui semblent malades (facultatif)"><Nombre valeur={malades} onChange={setMalades} /></Champ>
      <Champ libelle="Remarque (facultatif)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <div className="rangee">
        <button className="bouton court">Enregistrer la note</button>
        <button type="button" className="bouton alt court" onClick={fin}>Fermer</button>
      </div>
    </form>
  );
}

function FormFin({ elevage, quarantaine, fin }: { elevage: Elevage; quarantaine: Quarantaine; fin: () => void }) {
  const notifier = useNotifier();
  const locaux = elevage.donnees.logements.filter((l) => l.type !== 'quarantaine');
  const [decision, setDecision] = useState<'integre' | 'ecarte'>('integre');
  const [logementId, setLogementId] = useState(locaux[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await repo.terminerQuarantaine({ id: quarantaine.id, decision, logementId: logementId || null, note });
      notifier(decision === 'integre' ? 'Animaux intégrés à l’élevage ✓' : 'Quarantaine terminée ✓');
      fin();
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Action impossible.');
    }
  };
  return (
    <form className="carte" onSubmit={soumettre}>
      <div className="choix" role="group" aria-label="Décision">
        <button type="button" className={decision === 'integre' ? 'on' : ''} onClick={() => setDecision('integre')}>Intégrer à l’élevage</button>
        <button type="button" className={decision === 'ecarte' ? 'on' : ''} onClick={() => setDecision('ecarte')}>Garder à l’écart</button>
      </div>
      {decision === 'integre' && (
        <Champ libelle="Dans quel local ?">
          <select value={logementId} onChange={(e) => setLogementId(e.target.value)}>
            <option value="">Aucun local</option>
            {locaux.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}
          </select>
        </Champ>
      )}
      {decision === 'ecarte' && <p className="muet">Les animaux restent dans la zone de quarantaine. Notez leur vente ou leur sortie dans Saisie si nécessaire.</p>}
      <Champ libelle="Remarque (facultatif)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <div className="rangee">
        <button className="bouton court">Confirmer</button>
        <button type="button" className="bouton alt court" onClick={fin}>Fermer</button>
      </div>
    </form>
  );
}
