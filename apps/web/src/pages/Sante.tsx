import { useMemo, useState, type FormEvent } from 'react';
import { Si } from '../components/Si';
import {
  CATEGORIES_SYMPTOMES,
  SYMPTOMES,
  bilanRemedes,
  delaisEnCours,
  finEvenement,
  jourLocal,
  maladiePar,
  pistesDiagnostic,
  quarantainesEnCours,
  vaccinsAFaire,
  type CategorieSymptome,
  type EvenementSante,
  type ProtocoleVaccin,
  type ResultatTraitement,
} from '@digitalab/core';
import { Champ, Nombre, Retour, useNotifier, versNombre, useConfirmer } from '../components/ui';
import { ErreurSaisie, nouvelId, repo, type Annulation } from '../repo';
import { aller } from '../route';
import type { Elevage } from '../useElevage';

const dateCourte = (j: string) => j.slice(5).split('-').reverse().join('/');

const AVERTISSEMENT = 'Ces pistes sont des repères généraux, pas un diagnostic. Seul un vétérinaire peut en poser un et prescrire un traitement.';

function lotsActifs(elevage: Elevage) {
  return elevage.donnees.lots.filter((l) => !l.archive && (elevage.effectifParLot.get(l.id) ?? 0) > 0);
}

function useEnvoi() {
  const notifier = useNotifier();
  const [erreur, setErreur] = useState<string | null>(null);
  const envoyer = async (action: () => Promise<Annulation | null | void>, message: string, apres: () => void = () => aller('sante')) => {
    setErreur(null);
    try {
      const a = await action();
      notifier(message, a ? { annuler: () => repo.annuler(a) } : {});
      apres();
    } catch (e) {
      setErreur(e instanceof ErreurSaisie ? e.message : 'Enregistrement impossible. Réessayez.');
    }
  };
  return { erreur, envoyer };
}

/* ---------- Page d'accueil Santé ---------- */

export function PageSante({ elevage }: { elevage: Elevage }) {
  const { donnees, reglages, maintenant, noms } = elevage;
  const auj = jourLocal(maintenant);
  const vaccins = vaccinsAFaire(donnees.lots, donnees.mouvements, donnees.evenementsSante, reglages.protocoles, auj);
  const delais = delaisEnCours(donnees.evenementsSante, auj);
  const quarantaines = quarantainesEnCours(donnees.evenementsSante, auj);
  const aSuivre = donnees.evenementsSante.filter((e) => e.type === 'traitement' && !e.resultat && finEvenement(e) < auj).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <Si elevage={elevage} droit="sante.probleme"><a className="bouton" href="#/sante/probleme">⚠️ Noter un problème de santé</a></Si>
      <div className="rangee">
        <Si elevage={elevage} droit="sante.vaccin"><a className="bouton alt court" href="#/sante/vaccin">💉 Vaccin fait</a></Si>
        <Si elevage={elevage} droit="sante.traitement"><a className="bouton alt court" href="#/sante/traitement">💊 Traitement</a></Si>
        <Si elevage={elevage} droit="quarantaine.voir"><a className="bouton alt court" href="#/quarantaine">🚧 Quarantaine</a></Si>
      </div>

      <h2>Vaccins à faire</h2>
      {vaccins.filter((v) => v.statut !== 'a_renseigner').length === 0 && <div className="carte muet">Aucun vaccin à faire pour l’instant.</div>}
      {vaccins.filter((v) => v.statut !== 'a_renseigner').map((v) => (
        <a key={`${v.lot.id}-${v.protocole.id}`} className="gros" href={`#/sante/vaccin?lot=${v.lot.id}&protocole=${v.protocole.id}`}>
          {v.protocole.nom} : {v.lot.nom}
          <span>
            {v.statut === 'retard' ? `En retard de ${v.retard} jour${v.retard > 1 ? 's' : ''}` : v.statut === 'aujourdhui' ? 'À faire aujourd’hui' : `Prévu le ${dateCourte(v.date)}`} · toucher pour noter la dose
          </span>
        </a>
      ))}
      {vaccins.some((v) => v.statut === 'a_renseigner') && (
        <div className="carte muet">
          {vaccins.filter((v) => v.statut === 'a_renseigner').length} vaccin(s) prévu(s) pour des lots plus anciens : notez ceux déjà faits pour que les rappels soient calculés.
          <div className="actions"><a className="lien" href="#/sante/vaccin">Noter un vaccin déjà fait</a></div>
        </div>
      )}

      {(delais.length > 0 || quarantaines.length > 0) && <h2>En cours</h2>}
      {delais.map((d) => (
        <div key={d.evenement.id} className="carte alerte n-jaune">
          <h3>Œufs et viande à ne pas consommer : {noms.lot(d.evenement.lotId)}</h3>
          <p>{d.evenement.nom} · {d.enCours ? 'traitement en cours, ' : ''}jusqu’au {dateCourte(d.jusqua)} inclus.</p>
        </div>
      ))}
      {quarantaines.map((q) => (
        <div key={q.evenement.id} className="carte alerte n-orange">
          <h3>Quarantaine : {noms.lot(q.evenement.lotId)}</h3>
          <p>Jusqu’au {dateCourte(q.jusqua)} inclus.{q.evenement.note ? ` ${q.evenement.note}` : ''}</p>
        </div>
      ))}

      {aSuivre.length > 0 && (
        <>
          <h2>Quel résultat ?</h2>
          {aSuivre.slice(0, 5).map((t) => <ChoixResultat key={t.id} evenement={t} lot={noms.lot(t.lotId)} />)}
        </>
      )}

      <h2>Outils</h2>
      <a className="gros" href="#/sante/remedes">📒 Remèdes essayés<span>Ce qui a marché ou non dans votre élevage</span></a>
      <a className="gros" href="#/sante/calendrier">📅 Calendrier de vaccination<span>Modifier les vaccins et leurs rappels</span></a>
      <a className="gros" href="#/sante/historique">🗂 Historique de santé<span>Tout ce qui a été noté, lot par lot</span></a>
    </>
  );
}

function ChoixResultat({ evenement, lot }: { evenement: EvenementSante; lot: string }) {
  const notifier = useNotifier();
  const choisir = async (r: ResultatTraitement) => {
    await repo.definirResultat(evenement.id, r);
    notifier('Résultat noté ✓');
  };
  return (
    <div className="carte">
      <h3>{evenement.nom} : {lot}</h3>
      <p className="muet">Traitement du {dateCourte(evenement.date)}. Comment est la situation ?</p>
      <div className="rangee">
        <button className="bouton alt court" onClick={() => choisir('gueri')}>Guéri</button>
        <button className="bouton alt court" onClick={() => choisir('ameliore')}>Mieux</button>
        <button className="bouton alt court" onClick={() => choisir('sans_effet')}>Sans effet</button>
      </div>
    </div>
  );
}

/* ---------- Noter un problème ---------- */

export function FormProbleme({ elevage, lotInitial }: { elevage: Elevage; lotInitial: string | null }) {
  const lots = lotsActifs(elevage);
  const [lotId, setLotId] = useState(lotInitial && lots.some((l) => l.id === lotInitial) ? lotInitial : (lots[0]?.id ?? ''));
  const [choisis, setChoisis] = useState<string[]>([]);
  const [gravite, setGravite] = useState<1 | 2 | 3>(2);
  const [maladie, setMaladie] = useState('');
  const [note, setNote] = useState('');
  const { erreur, envoyer } = useEnvoi();
  const especeCode = lots.find((l) => l.id === lotId)?.especeCode;
  const pistes = useMemo(() => pistesDiagnostic(choisis, especeCode), [choisis, especeCode]);

  if (lots.length === 0) return (<><Retour vers="sante" /><div className="carte">Aucun lot avec des animaux. <a className="lien" href="#/cheptel/nouveau">Créer un lot</a></div></>);

  const basculer = (code: string) => setChoisis((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code]));
  const parCategorie = (Object.keys(CATEGORIES_SYMPTOMES) as CategorieSymptome[]).map((cat) => ({ cat, items: SYMPTOMES.filter((s) => s.categorie === cat) }));

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); void envoyer(() => repo.ajouterObservation({ lotId, symptomes: choisis, gravite, maladie, note }), 'Problème de santé noté ✓', () => aller(pistes.length ? `sante/traitement?lot=${lotId}${maladie ? `&maladie=${maladie}` : ''}` : 'sante')); }}>
      <Retour vers="sante" />
      <h2>Noter un problème de santé</h2>
      <Champ libelle="Lot concerné">
        <select value={lotId} onChange={(e) => setLotId(e.target.value)}>{lots.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}</select>
      </Champ>

      <h3>Que voyez-vous ?</h3>
      {parCategorie.map(({ cat, items }) => (
        <fieldset key={cat}>
          <legend>{CATEGORIES_SYMPTOMES[cat]}</legend>
          {items.map((s) => (
            <label key={s.code} className="case"><input type="checkbox" checked={choisis.includes(s.code)} onChange={() => basculer(s.code)} /> {s.libelle}</label>
          ))}
        </fieldset>
      ))}

      <h3>Gravité</h3>
      <div className="choix" role="group" aria-label="Gravité">
        {([[1, 'Léger'], [2, 'Inquiétant'], [3, 'Grave']] as const).map(([v, l]) => (
          <button key={v} type="button" className={gravite === v ? 'on' : ''} onClick={() => setGravite(v)}>{l}</button>
        ))}
      </div>

      {pistes.length > 0 && (
        <>
          <h3>Pistes à vérifier</h3>
          {pistes.map((p) => (
            <article key={p.maladie.code} className={`carte${p.maladie.declaration ? ' alerte n-rouge' : ''}`}>
              <h3>{p.maladie.nom} <span className="pilule">{p.retrouves.length} signe{p.retrouves.length > 1 ? 's' : ''} sur {Object.keys(p.maladie.symptomes).length}</span></h3>
              <p>{p.maladie.resume}</p>
              <p><b>À faire :</b> {p.maladie.conduite}</p>
              {p.maladie.declaration === 'obligatoire' && <p className="erreur">Maladie à déclaration obligatoire : prévenez les services vétérinaires en cas de doute.</p>}
              {p.maladie.declaration === 'reglementee' && <p className="erreur">Maladie réglementée : informez les services vétérinaires.</p>}
              <label className="case"><input type="radio" name="maladie" checked={maladie === p.maladie.code} onChange={() => setMaladie(p.maladie.code)} /> Je soupçonne cette maladie</label>
            </article>
          ))}
          <p className="muet">{AVERTISSEMENT}</p>
        </>
      )}

      <Champ libelle="Note (facultatif)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={choisis.length === 0 && !note.trim()}>Enregistrer</button>
      {maladie && <p className="muet">Vous avez choisi : {maladiePar(maladie)?.nom}. La suite vous proposera de noter un traitement.</p>}
    </form>
  );
}

/* ---------- Vaccin ---------- */

export function FormVaccin({ elevage, lotInitial, protocoleInitial }: { elevage: Elevage; lotInitial: string | null; protocoleInitial: string | null }) {
  const lots = lotsActifs(elevage);
  const [lotId, setLotId] = useState(lotInitial && lots.some((l) => l.id === lotInitial) ? lotInitial : (lots[0]?.id ?? ''));
  const especeCode = lots.find((l) => l.id === lotId)?.especeCode;
  const proposes = elevage.reglages.protocoles.filter((p) => p.especeCode === especeCode);
  const [protocoleId, setProtocoleId] = useState(protocoleInitial ?? '');
  const [autre, setAutre] = useState('');
  const [numero, setNumero] = useState('');
  const [dose, setDose] = useState('');
  const [date, setDate] = useState(jourLocal(elevage.maintenant));
  const { erreur, envoyer } = useEnvoi();
  const choisi = proposes.find((p) => p.id === protocoleId);
  const nom = choisi ? choisi.nom : autre;

  if (lots.length === 0) return (<><Retour vers="sante" /><div className="carte">Aucun lot avec des animaux.</div></>);

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); void envoyer(() => repo.ajouterVaccin({ lotId, nom, ...(choisi ? { protocoleId: choisi.id } : {}), dose, numeroLotProduit: numero, date }), 'Vaccin noté ✓'); }}>
      <Retour vers="sante" />
      <h2>Vaccin fait</h2>
      <Champ libelle="Lot">
        <select value={lotId} onChange={(e) => { setLotId(e.target.value); setProtocoleId(''); }}>{lots.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}</select>
      </Champ>
      <Champ libelle="Vaccin">
        <select value={protocoleId} onChange={(e) => setProtocoleId(e.target.value)}>
          <option value="">Autre vaccin</option>
          {proposes.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
        </select>
      </Champ>
      {!choisi && <Champ libelle="Nom du vaccin"><input value={autre} onChange={(e) => setAutre(e.target.value)} /></Champ>}
      <Champ libelle="Date"><input type="date" value={date} max={jourLocal(elevage.maintenant)} onChange={(e) => setDate(e.target.value)} /></Champ>
      <Champ libelle="Numéro de lot du flacon (facultatif)" aide="Utile pour retrouver le vaccin en cas de problème."><input value={numero} onChange={(e) => setNumero(e.target.value)} /></Champ>
      <Champ libelle="Dose ou voie (facultatif)" aide="Par exemple : 1 goutte dans l’œil."><input value={dose} onChange={(e) => setDose(e.target.value)} /></Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={!nom.trim()}>Enregistrer</button>
    </form>
  );
}

/* ---------- Traitement ---------- */

export function FormTraitement({ elevage, lotInitial, maladieInitiale }: { elevage: Elevage; lotInitial: string | null; maladieInitiale: string | null }) {
  const lots = lotsActifs(elevage);
  const [lotId, setLotId] = useState(lotInitial && lots.some((l) => l.id === lotInitial) ? lotInitial : (lots[0]?.id ?? ''));
  const [nom, setNom] = useState('');
  const [dose, setDose] = useState('');
  const [voie, setVoie] = useState('eau');
  const [duree, setDuree] = useState('5');
  const [delai, setDelai] = useState('0');
  const [note, setNote] = useState('');
  const { erreur, envoyer } = useEnvoi();
  const connus = [...new Set(elevage.donnees.evenementsSante.filter((e) => e.type === 'traitement' && e.nom).map((e) => e.nom as string))];

  if (lots.length === 0) return (<><Retour vers="sante" /><div className="carte">Aucun lot avec des animaux.</div></>);

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); void envoyer(() => repo.ajouterTraitement({ lotId, nom, dose, voie, dureeJours: versNombre(duree), delaiAttenteJours: versNombre(delai || '0'), ...(maladieInitiale ? { maladie: maladieInitiale } : {}), note }), 'Traitement noté ✓'); }}>
      <Retour vers="sante" />
      <h2>Traitement ou remède</h2>
      {maladieInitiale && <p className="muet">Pour : {maladiePar(maladieInitiale)?.nom}</p>}
      <Champ libelle="Lot">
        <select value={lotId} onChange={(e) => setLotId(e.target.value)}>{lots.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}</select>
      </Champ>
      <Champ libelle="Produit ou remède" aide="Médicament vétérinaire ou remède maison : notez-le dans les deux cas.">
        <input list="produits-connus" value={nom} onChange={(e) => setNom(e.target.value)} />
      </Champ>
      <datalist id="produits-connus">{connus.map((c) => <option key={c} value={c} />)}</datalist>
      <Champ libelle="Dose (facultatif)"><input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="Selon la notice ou le vétérinaire" /></Champ>
      <Champ libelle="Comment ?">
        <select value={voie} onChange={(e) => setVoie(e.target.value)}>
          <option value="eau">Dans l’eau de boisson</option>
          <option value="aliment">Dans l’aliment</option>
          <option value="injection">Injection</option>
          <option value="local">Application locale</option>
          <option value="autre">Autre</option>
        </select>
      </Champ>
      <Champ libelle="Durée du traitement (jours)"><Nombre valeur={duree} onChange={setDuree} min={1} unite="j" /></Champ>
      <Champ libelle="Délai d’attente après le traitement (jours)" aide="Indiqué sur la notice ou par le vétérinaire. Pendant ce délai, œufs et viande ne se consomment ni ne se vendent. Mettez 0 s’il n’y en a pas.">
        <Nombre valeur={delai} onChange={setDelai} min={0} unite="j" />
      </Champ>
      <Champ libelle="Note (facultatif)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={!nom.trim()}>Enregistrer</button>
    </form>
  );
}

/* ---------- Quarantaine ---------- */

export function FormQuarantaine({ elevage, lotInitial }: { elevage: Elevage; lotInitial: string | null }) {
  const lots = lotsActifs(elevage);
  const [lotId, setLotId] = useState(lotInitial && lots.some((l) => l.id === lotInitial) ? lotInitial : (lots[0]?.id ?? ''));
  const [duree, setDuree] = useState('14');
  const [note, setNote] = useState('');
  const { erreur, envoyer } = useEnvoi();
  if (lots.length === 0) return (<><Retour vers="sante" /><div className="carte">Aucun lot avec des animaux.</div></>);
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); void envoyer(() => repo.ajouterQuarantaine({ lotId, dureeJours: versNombre(duree), note }), 'Quarantaine notée ✓'); }}>
      <Retour vers="sante" />
      <h2>Quarantaine</h2>
      <p className="muet">Gardez le lot à l’écart des autres, avec son propre matériel, le temps de l’observer.</p>
      <Champ libelle="Lot">
        <select value={lotId} onChange={(e) => setLotId(e.target.value)}>{lots.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}</select>
      </Champ>
      <Champ libelle="Durée (jours)"><Nombre valeur={duree} onChange={setDuree} min={1} unite="j" /></Champ>
      <Champ libelle="Motif (facultatif)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nouvel arrivage, suspicion de maladie…" /></Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton">Enregistrer</button>
    </form>
  );
}

/* ---------- Remèdes essayés ---------- */

export function PageRemedes({ elevage }: { elevage: Elevage }) {
  const bilan = bilanRemedes(elevage.donnees.evenementsSante);
  return (
    <>
      <Retour vers="sante" />
      <h2>Remèdes essayés</h2>
      <p className="muet">Ce que vous avez déjà utilisé, et ce que vous en avez retenu. Cela ne remplace pas l’avis d’un vétérinaire.</p>
      {bilan.length === 0 && <div className="carte muet">Aucun traitement noté pour l’instant.</div>}
      {bilan.map((b) => (
        <article key={b.nom} className="carte">
          <h3>{b.nom}</h3>
          <div className="ligne"><span>Essais</span><b>{b.essais}</b></div>
          <div className="ligne"><span>Guéri</span><b>{b.gueri}</b></div>
          <div className="ligne"><span>Amélioré</span><b>{b.ameliore}</b></div>
          <div className="ligne"><span>Sans effet</span><b>{b.sansEffet}</b></div>
          {b.sansResultat > 0 && <div className="ligne"><span>Résultat non noté</span><b>{b.sansResultat}</b></div>}
        </article>
      ))}
    </>
  );
}

/* ---------- Calendrier de vaccination ---------- */

export function PageCalendrier({ elevage }: { elevage: Elevage }) {
  const { reglages } = elevage;
  const notifier = useNotifier();
  const [edition, setEdition] = useState<string | 'nouveau' | null>(null);
  const enregistrer = async (liste: ProtocoleVaccin[]) => { await repo.enregistrerProtocoles(liste); notifier('Calendrier enregistré ✓'); setEdition(null); };

  return (
    <>
      <Retour vers="sante" />
      <h2>Calendrier de vaccination</h2>
      <p className="muet">Exemple de départ à faire valider par un vétérinaire. Au Sénégal, la vaccination des volailles est présentée comme obligatoire par les sources consultées ; adaptez ce calendrier à votre région et à vos races.</p>
      {reglages.protocoles.length === 0 && <div className="carte muet">Aucun vaccin dans le calendrier.</div>}
      {reglages.protocoles.map((p) =>
        edition === p.id ? (
          <FormProtocole key={p.id} initial={p} especes={reglages.especes} onSave={(np) => enregistrer(reglages.protocoles.map((x) => (x.id === p.id ? np : x)))} onCancel={() => setEdition(null)} onDelete={() => enregistrer(reglages.protocoles.filter((x) => x.id !== p.id))} />
        ) : (
          <div key={p.id} className="carte ligne">
            <span>{p.nom} · {reglages.especes[p.especeCode]?.nom ?? p.especeCode} · à {p.ageJours} jours{p.repeterTousLesJours ? `, rappel tous les ${p.repeterTousLesJours} jours` : ''}</span>
            <button className="lien" onClick={() => setEdition(p.id)}>Modifier</button>
          </div>
        ),
      )}
      {edition === 'nouveau' ? (
        <FormProtocole especes={reglages.especes} onSave={(np) => enregistrer([...reglages.protocoles, np])} onCancel={() => setEdition(null)} />
      ) : (
        <button className="bouton alt" onClick={() => setEdition('nouveau')}>+ Ajouter un vaccin</button>
      )}
    </>
  );
}

function FormProtocole({ initial, especes, onSave, onCancel, onDelete }: { initial?: ProtocoleVaccin; especes: Record<string, { code: string; nom: string }>; onSave: (p: ProtocoleVaccin) => void; onCancel: () => void; onDelete?: () => void }) {
  const [nom, setNom] = useState(initial?.nom ?? '');
  const [especeCode, setEspeceCode] = useState(initial?.especeCode ?? 'poule');
  const [age, setAge] = useState(String(initial?.ageJours ?? 7));
  const [repete, setRepete] = useState(initial?.repeterTousLesJours ? String(initial.repeterTousLesJours) : '');
  const valide = nom.trim() && Number.isInteger(versNombre(age)) && versNombre(age) >= 0;
  return (
    <div className="carte">
      <Champ libelle="Nom du vaccin"><input value={nom} onChange={(e) => setNom(e.target.value)} /></Champ>
      <Champ libelle="Espèce">
        <select value={especeCode} onChange={(e) => setEspeceCode(e.target.value)}>{Object.values(especes).map((s) => <option key={s.code} value={s.code}>{s.nom}</option>)}</select>
      </Champ>
      <Champ libelle="Âge à la première dose (jours)"><Nombre valeur={age} onChange={setAge} unite="j" /></Champ>
      <Champ libelle="Rappel tous les (jours, facultatif)"><Nombre valeur={repete} onChange={setRepete} pas={30} unite="j" /></Champ>
      <div className="rangee">
        <button className="bouton court" disabled={!valide} onClick={() => onSave({ id: initial?.id ?? nouvelId(), nom: nom.trim(), especeCode, ageJours: versNombre(age), repeterTousLesJours: repete && versNombre(repete) > 0 ? versNombre(repete) : null })}>Enregistrer</button>
        <button className="bouton alt court" onClick={onCancel}>Fermer</button>
        {onDelete && <button className="lien danger" onClick={onDelete}>Supprimer</button>}
      </div>
    </div>
  );
}

/* ---------- Historique ---------- */

const ICONES = { observation: '⚠️', vaccin: '💉', traitement: '💊', quarantaine: '🚧' } as const;

function libelleEvenement(e: EvenementSante): string {
  if (e.type === 'vaccin') return `Vaccin : ${e.nom}${e.numeroLotProduit ? ` (flacon ${e.numeroLotProduit})` : ''}`;
  if (e.type === 'traitement') return `Traitement : ${e.nom}${e.dureeJours ? `, ${e.dureeJours} j` : ''}${e.delaiAttenteJours ? `, délai d’attente ${e.delaiAttenteJours} j` : ''}${e.resultat ? ` · ${{ gueri: 'guéri', ameliore: 'amélioré', sans_effet: 'sans effet' }[e.resultat]}` : ''}`;
  if (e.type === 'quarantaine') return `Quarantaine de ${e.dureeJours} j${e.note ? ` (${e.note})` : ''}`;
  const s = (e.symptomes ?? []).map((c) => SYMPTOMES.find((x) => x.code === c)?.libelle.toLowerCase() ?? c).join(', ');
  return `Observation${e.gravite ? ` (${['', 'léger', 'inquiétant', 'grave'][e.gravite]})` : ''} : ${s || e.note || ''}${e.maladie ? ` · soupçon : ${maladiePar(e.maladie)?.nom}` : ''}`;
}

export function PageHistorique({ elevage }: { elevage: Elevage }) {
  const confirmer = useConfirmer();
  const { donnees, noms } = elevage;
  const evenements = [...donnees.evenementsSante].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <Retour vers="sante" />
      <h2>Historique de santé</h2>
      {evenements.length === 0 && <div className="carte muet">Rien de noté pour l’instant.</div>}
      {evenements.length > 0 && (
        <div className="carte">
          {evenements.map((e) => (
            <div key={e.id} className="ligne">
              <span>{ICONES[e.type]} {dateCourte(e.date)} · {noms.lot(e.lotId)} · {libelleEvenement(e)}</span>
              <button className="lien" onClick={async () => { if (await confirmer('Annuler cette ligne ? Elle reste conservée dans l’historique interne.')) void repo.annuler({ table: 'evenementsSante', id: e.id }); }}>Annuler</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export { libelleEvenement };
