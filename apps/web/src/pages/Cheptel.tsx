import { useState, type FormEvent } from 'react';
import { ajouterJours, delaisEnCours, jourLocal, quarantainesEnCours, type Lot } from '@digitalab/core';
import { Champ, Nombre, Retour, useNotifier, versNombre } from '../components/ui';
import { ErreurSaisie, repo, type Annulation } from '../repo';
import { libelleEvenement } from './Sante';
import { aller } from '../route';
import type { Elevage } from '../useElevage';

export function ListeCheptel({ elevage }: { elevage: Elevage }) {
  const { donnees, effectifParLot, reglages, noms } = elevage;
  const actifs = donnees.lots.filter((l) => !l.archive);
  const archives = donnees.lots.filter((l) => l.archive);
  return (
    <>
      <h2>Mes lots</h2>
      {actifs.length === 0 && <div className="carte muet">Aucun lot pour l’instant.</div>}
      {actifs.map((l) => (
        <a key={l.id} className="gros" href={`#/cheptel/${l.id}`}>
          {l.nom}
          <span>
            {effectifParLot.get(l.id) ?? 0} {reglages.especes[l.especeCode]?.nom.toLowerCase() ?? 'animaux'}
            {l.logementId ? ` · ${noms.logement(l.logementId)}` : ' · sans local'}
          </span>
        </a>
      ))}
      <a className="bouton" href="#/cheptel/nouveau">+ Nouveau lot</a>
      <a className="bouton alt" href="#/quarantaine">🚧 Zone de quarantaine{donnees.quarantaines.filter((q) => !q.sortie).length > 0 ? ` (${donnees.quarantaines.filter((q) => !q.sortie).length})` : ''}</a>
      {archives.length > 0 && <p className="muet">{archives.length} lot(s) archivé(s).</p>}
    </>
  );
}

export function NouveauLot({ elevage }: { elevage: Elevage }) {
  const { donnees, reglages } = elevage;
  const notifier = useNotifier();
  const [nom, setNom] = useState('');
  const [especeCode, setEspeceCode] = useState('poule');
  const [race, setRace] = useState('');
  const [naissance, setNaissance] = useState('');
  const [effectif, setEffectif] = useState('');
  const [logementId, setLogementId] = useState(donnees.logements[0]?.id ?? '');
  const [erreur, setErreur] = useState<string | null>(null);

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const id = await repo.creerLot({ nom, especeCode, race, ...(naissance ? { naissance } : {}), logementId: logementId || null, effectif: versNombre(effectif) });
      notifier('Lot créé ✓');
      aller(`cheptel/${id}`);
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Création impossible. Réessayez.');
    }
  };

  return (
    <form onSubmit={soumettre}>
      <Retour vers="cheptel" />
      <h2>Nouveau lot</h2>
      <Champ libelle="Nom du lot" aide="Par exemple : Soie blanche – lot A">
        <input value={nom} onChange={(e) => setNom(e.target.value)} />
      </Champ>
      <Champ libelle="Espèce">
        <select value={especeCode} onChange={(e) => setEspeceCode(e.target.value)}>
          {Object.values(reglages.especes).map((s) => <option key={s.code} value={s.code}>{s.nom}</option>)}
        </select>
      </Champ>
      <Champ libelle="Race ou variété (facultatif)">
        <input value={race} onChange={(e) => setRace(e.target.value)} />
      </Champ>
      <Champ libelle="Nombre d’animaux">
        <Nombre valeur={effectif} onChange={setEffectif} min={1} />
      </Champ>
      <Champ libelle="Date de naissance (facultatif)">
        <input type="date" value={naissance} max={jourLocal(new Date())} onChange={(e) => setNaissance(e.target.value)} />
      </Champ>
      <Champ libelle="Local" aide={donnees.logements.length === 0 ? 'Aucun local : ajoutez-en dans Réglages pour suivre la densité.' : undefined}>
        <select value={logementId} onChange={(e) => setLogementId(e.target.value)}>
          <option value="">Aucun</option>
          {donnees.logements.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}
        </select>
      </Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={!nom || !effectif}>Créer le lot</button>
    </form>
  );
}

type Evenement = { cle: string; date: string; texte: string; annulation: Annulation };

function historique(elevage: Elevage, lot: Lot): Evenement[] {
  const { donnees } = elevage;
  const ev: Evenement[] = [
    ...donnees.mouvements.filter((m) => m.lotId === lot.id).map((m) => ({
      cle: m.id, date: m.date, annulation: { table: 'mouvements', id: m.id } as Annulation,
      texte: `${{ arrivee: 'Arrivée', naissance: 'Naissance', vente: 'Vente', deces: 'Décès', reforme: 'Réforme', correction: 'Comptage' }[m.type]} : ${m.quantite > 0 ? '+' : ''}${m.quantite}${m.cause ? ` (${m.cause})` : ''}`,
    })),
    ...donnees.pontes.filter((p) => p.lotId === lot.id).map((p) => ({ cle: p.id, date: p.date, annulation: { table: 'pontes', id: p.id } as Annulation, texte: `Ponte : ${p.nombre} œuf(s)${p.casses ? `, dont ${p.casses} cassé(s)` : ''}` })),
    ...donnees.distributions.filter((d) => d.lotId === lot.id).map((d) => ({ cle: d.id, date: d.date, annulation: { table: 'distributions', id: d.id } as Annulation, texte: `Aliment : ${String(d.quantiteKg).replace('.', ',')} kg` })),
    ...donnees.evenementsSante.filter((e) => e.lotId === lot.id).map((e) => ({ cle: e.id, date: e.date, annulation: { table: 'evenementsSante', id: e.id } as Annulation, texte: libelleEvenement(e) })),
  ];
  return ev.sort((a, b) => b.date.localeCompare(a.date) || b.cle.localeCompare(a.cle));
}

function Barres({ valeurs }: { valeurs: { jour: string; n: number }[] }) {
  const max = Math.max(1, ...valeurs.map((v) => v.n));
  const l = 14, w = 300, h = 70;
  const pas = w / l;
  return (
    <svg viewBox={`0 0 ${w} ${h + 16}`} role="img" aria-label={`Œufs des ${valeurs.length} derniers jours : ${valeurs.map((v) => v.n).join(', ')}`} className="barres">
      {valeurs.map((v, i) => {
        const hauteur = (v.n / max) * h;
        return <rect key={v.jour} x={i * pas + 2} y={h - hauteur} width={pas - 4} height={Math.max(hauteur, v.n > 0 ? 2 : 0)} rx="2" />;
      })}
      <text x="0" y={h + 13} fontSize="10">{valeurs[0]?.jour.slice(5)}</text>
      <text x={w} y={h + 13} fontSize="10" textAnchor="end">{valeurs.at(-1)?.jour.slice(5)}</text>
    </svg>
  );
}

export function FicheLot({ elevage, lotId }: { elevage: Elevage; lotId: string }) {
  const { donnees, effectifParLot, reglages, noms, maintenant } = elevage;
  const notifier = useNotifier();
  const lot = donnees.lots.find((l) => l.id === lotId);
  const [comptage, setComptage] = useState<string | null>(null);
  if (!lot) return (<><Retour vers="cheptel" /><div className="carte">Lot introuvable.</div></>);

  const effectif = effectifParLot.get(lot.id) ?? 0;
  const espece = reglages.especes[lot.especeCode];
  const auj = jourLocal(maintenant);
  const barres = Array.from({ length: 14 }, (_, i) => {
    const jour = ajouterJours(auj, i - 13);
    return { jour, n: donnees.pontes.filter((p) => p.lotId === lot.id && p.date === jour).reduce((a, p) => a + p.nombre, 0) };
  });
  const evenements = historique(elevage, lot).slice(0, 15);
  const age = lot.naissance ? Math.max(0, Math.round((Date.parse(auj) - Date.parse(lot.naissance)) / 86_400_000)) : null;

  const agir = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      notifier(message);
    } catch (e) {
      notifier(e instanceof ErreurSaisie ? e.message : 'Action impossible.', { erreur: true });
    }
  };

  return (
    <>
      <Retour vers="cheptel" libelle="Mes lots" />
      <article className="carte">
        <h2 style={{ marginTop: 0 }}>{lot.nom}</h2>
        <span className="pilule">{espece?.nom ?? lot.especeCode}{lot.race ? ` · ${lot.race}` : ''}</span>
        {age !== null && <span className="pilule">{age} jours</span>}
        {lot.archive && <span className="pilule">Archivé</span>}
        <div className="ligne"><span>Animaux</span><b>{effectif}</b></div>
        <div className="ligne"><span>Local</span><b>{lot.logementId ? noms.logement(lot.logementId) : 'Aucun'}</b></div>
        {lot.incubationId && <div className="ligne"><span>Issu de l’incubation</span><a className="lien" href={`#/couveuse/${lot.incubationId}`}>{noms.incubation(lot.incubationId)}</a></div>}
      </article>

      {!lot.archive && (
        <div className="rangee">
          {espece?.pondeuse && <a className="bouton court" href={`#/saisie/ponte?lot=${lot.id}`}>🥚 Œufs</a>}
          <a className="bouton court" href={`#/saisie/aliment?lot=${lot.id}`}>🌾 Aliment</a>
          <a className="bouton court" href={`#/saisie/deces?lot=${lot.id}`}>⚠️ Décès</a>
          <a className="bouton court" href={`#/saisie/sortie?lot=${lot.id}`}>🤝 Sortie</a>
        </div>
      )}

      {espece?.pondeuse && (
        <>
          <h2>Œufs, 14 derniers jours</h2>
          <div className="carte"><Barres valeurs={barres} /></div>
        </>
      )}

      {!lot.archive && (
        <>
          <h2>Gérer le lot</h2>
          <div className="carte">
            <Champ libelle="Local">
              <select value={lot.logementId ?? ''} onChange={(e) => agir(() => repo.changerLogement(lot.id, e.target.value || null), 'Local modifié ✓')}>
                <option value="">Aucun</option>
                {donnees.logements.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}
              </select>
            </Champ>
            {comptage === null ? (
              <button className="lien" onClick={() => setComptage(String(effectif))}>J’ai compté les animaux : corriger l’effectif</button>
            ) : (
              <div>
                <Champ libelle="Nombre d’animaux comptés"><Nombre valeur={comptage} onChange={setComptage} /></Champ>
                <button className="bouton" onClick={() => agir(async () => { await repo.corrigerEffectif(lot.id, versNombre(comptage)); setComptage(null); }, 'Effectif corrigé ✓')}>Corriger</button>
              </div>
            )}
            <div className="actions">
              <button className="lien" onClick={() => agir(() => repo.archiverLot(lot.id), 'Lot archivé')}>Archiver ce lot</button>
            </div>
          </div>
        </>
      )}

      <h2>Santé</h2>
      {delaisEnCours(donnees.evenementsSante.filter((e) => e.lotId === lot.id), auj).map((d) => (
        <div key={d.evenement.id} className="carte alerte n-jaune"><h3>Œufs et viande à ne pas consommer</h3><p>{d.evenement.nom} · jusqu’au {d.jusqua.split('-').reverse().join('/')} inclus.</p></div>
      ))}
      {quarantainesEnCours(donnees.evenementsSante.filter((e) => e.lotId === lot.id), auj).map((q) => (
        <div key={q.evenement.id} className="carte alerte n-orange"><h3>En quarantaine</h3><p>Jusqu’au {q.jusqua.split('-').reverse().join('/')} inclus.</p></div>
      ))}
      <div className="rangee">
        <a className="bouton alt court" href={`#/sante/probleme?lot=${lot.id}`}>⚠️ Problème</a>
        <a className="bouton alt court" href={`#/sante/vaccin?lot=${lot.id}`}>💉 Vaccin</a>
        <a className="bouton alt court" href={`#/sante/traitement?lot=${lot.id}`}>💊 Traitement</a>
      </div>
      <a className="bouton" href={`#/cheptel/${lot.id}/fiche`}>Partager la fiche de suivi</a>

      <h2>Historique</h2>
      {evenements.length === 0 ? <div className="carte muet">Rien d’enregistré.</div> : (
        <div className="carte">
          {evenements.map((e) => (
            <div key={e.cle} className="ligne">
              <span>{e.date.slice(5).split('-').reverse().join('/')} · {e.texte}</span>
              <button className="lien" onClick={() => { if (window.confirm('Annuler cette ligne ? Elle restera conservée dans l’historique interne.')) void repo.annuler(e.annulation); }}>Annuler</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
