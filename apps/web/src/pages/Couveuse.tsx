import { useState, type FormEvent } from 'react';
import { Si } from '../components/Si';
import {
  ajouterJours,
  ecartJours,
  jourLocal,
  occupation,
  oeufsRestants,
  placesLibres,
  placesPourNouvelleMise,
  profilDe,
  prochaineLiberation,
  statsIncubation,
  suivreEtapes,
  type Couveuse,
  type EtapeSuivie,
  type Incubation,
  type TypeCouveuse,
} from '@digitalab/core';
import { Champ, Nombre, Retour, useNotifier, versNombre } from '../components/ui';
import { ErreurSaisie, repo } from '../repo';
import { aller } from '../route';
import type { Elevage } from '../useElevage';

const dateCourte = (j: string) => j.slice(5).split('-').reverse().join('/');
const nb = (x: number) => String(x).replace('.', ',');
const LIBELLE_ETAPE = { mirage: 'Mirage', retournement: 'Arrêt du retournement', transfert: 'Transfert vers l’éclosoir', eclosion: 'Éclosion' } as const;

function quand(e: EtapeSuivie): string {
  if (e.statut === 'fait') return 'fait';
  if (e.statut === 'aujourdhui') return 'aujourd’hui';
  if (e.statut === 'bientot') return e.dans === 1 ? 'demain' : `dans ${e.dans} jours`;
  if (e.statut === 'retard') return `en retard de ${e.retard} j`;
  return dateCourte(e.date);
}

const c0 = (couveuses: Couveuse[], i: Incubation) => couveuses.find((c) => c.id === i.couveuseId);

/* ---------- Liste ---------- */

export function PageCouveuse({ elevage }: { elevage: Elevage }) {
  const { donnees, reglages, maintenant } = elevage;
  const auj = jourLocal(maintenant);
  const enCours = donnees.incubations.filter((i) => !i.eclosion).sort((a, b) => a.miseEnPlace.localeCompare(b.miseEnPlace));
  const terminees = donnees.incubations.filter((i) => i.eclosion).sort((a, b) => (b.eclosion?.jour ?? '').localeCompare(a.eclosion?.jour ?? '')).slice(0, 5);

  if (donnees.couveuses.length === 0) {
    return (
      <>
        <h2>Ma couveuse</h2>
        <p className="muet">Décrivez votre couveuse pour suivre les mises en incubation, le calendrier et les éclosions.</p>
        <FormCouveuse fin={() => undefined} />
      </>
    );
  }

  return (
    <>
      <h2>Mes couveuses</h2>
      {donnees.couveuses.map((c) => {
        const occ = occupation(c, donnees.incubations, donnees.mirages, reglages.especes, auj);
        const libre = prochaineLiberation(c, donnees.incubations, reglages.especes, auj);
        const lignes = Object.entries(c.capacites).map(([code, cap]) => {
          const libres = placesLibres(c, donnees.incubations, donnees.mirages, reglages.especes, code, auj);
          return `${reglages.especes[code]?.nom ?? code} : ${libres ?? '?'} places libres sur ${cap}`;
        });
        return (
          <article key={c.id} className="carte">
            <h3>{c.nom}</h3>
            <span className="pilule">{c.type === 'automatique' ? 'Automatique' : 'Manuelle'}</span>
            <span className="pilule">{c.eclosoirSepare ? 'Éclosoir séparé' : 'Éclosion dans l’appareil'}</span>
            <div className="ligne"><span>Œufs en cours</span><b>{Object.values(occ.parEspece).reduce((a, n) => a + n, 0)}</b></div>
            {lignes.map((l) => <div key={l} className="ligne"><span>{l}</span></div>)}
            {libre && <div className="ligne"><span>Prochaine libération</span><b>{dateCourte(libre)}</b></div>}
            <div className="actions"><a className="lien" href={`#/couveuse/appareil/${c.id}`}>Modifier</a></div>
          </article>
        );
      })}
      <Si elevage={elevage} droit="couveuse.mise"><a className="bouton" href="#/couveuse/nouvelle">+ Mettre des œufs en incubation</a></Si>
      <Si elevage={elevage} droit="couveuse.appareils"><a className="bouton alt" href="#/couveuse/appareil">+ Ajouter une couveuse</a></Si>

      <h2>En cours</h2>
      {enCours.length === 0 && <div className="carte muet">Aucun œuf en incubation.</div>}
      {enCours.map((i) => {
        const profil = profilDe(reglages.especes, i.especeCode);
        const jourJ = ecartJours(i.miseEnPlace, auj);
        const etapes = profil ? suivreEtapes(i, profil, donnees.mirages, auj, c0(donnees.couveuses, i)?.eclosoirSepare ?? false) : [];
        const prochaine = etapes.find((e) => e.statut !== 'fait');
        return (
          <a key={i.id} className="gros" href={`#/couveuse/${i.id}`}>
            {i.nom}
            <span>
              {oeufsRestants(i, donnees.mirages, auj)} œufs · jour {jourJ}{profil ? ` sur ${profil.duree}` : ''}
              {prochaine ? ` · ${LIBELLE_ETAPE[prochaine.type].toLowerCase()}${prochaine.type === 'mirage' ? ` J${prochaine.jourJ}` : ''} : ${quand(prochaine)}` : ''}
            </span>
            {profil && <progress max={profil.duree} value={Math.min(Math.max(jourJ, 0), profil.duree)} aria-label="Avancement de l’incubation" />}
          </a>
        );
      })}

      {terminees.length > 0 && (
        <>
          <h2>Terminées</h2>
          {terminees.map((i) => {
            const s = statsIncubation(i, donnees.mirages);
            return (
              <a key={i.id} className="gros" href={`#/couveuse/${i.id}`}>
                {i.nom}
                <span>{s.nes} nés sur {s.mis} œufs{s.tauxEclosionMis !== null ? ` · éclosion ${nb(s.tauxEclosionMis)} %` : ''}</span>
              </a>
            );
          })}
        </>
      )}
    </>
  );
}

/* ---------- Appareil ---------- */

export function FormCouveuse({ initial, fin }: { initial?: Couveuse; fin: () => void }) {
  const notifier = useNotifier();
  const [nom, setNom] = useState(initial?.nom ?? '');
  const [type, setType] = useState<TypeCouveuse>(initial?.type ?? 'automatique');
  const [capPoule, setCapPoule] = useState(initial?.capacites['poule'] ? String(initial.capacites['poule']) : '');
  const [capCaille, setCapCaille] = useState(initial?.capacites['caille'] ? String(initial.capacites['caille']) : '');
  const [eclosoir, setEclosoir] = useState(initial?.eclosoirSepare ?? false);
  const [erreur, setErreur] = useState<string | null>(null);

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const capacites: Record<string, number> = {};
      if (capPoule) capacites['poule'] = versNombre(capPoule);
      if (capCaille) capacites['caille'] = versNombre(capCaille);
      const donnees = { nom, type, capacites, eclosoirSepare: eclosoir };
      if (initial) await repo.modifierCouveuse(initial.id, donnees);
      else await repo.creerCouveuse(donnees);
      notifier('Couveuse enregistrée ✓');
      fin();
      aller('couveuse');
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Enregistrement impossible.');
    }
  };

  return (
    <form className="carte" onSubmit={soumettre}>
      <Champ libelle="Nom de la couveuse"><input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ma couveuse" /></Champ>
      <Champ libelle="Type">
        <select value={type} onChange={(e) => setType(e.target.value as TypeCouveuse)}>
          <option value="automatique">Automatique (retourne les œufs seule)</option>
          <option value="manuelle">Manuelle (je tourne les œufs)</option>
        </select>
      </Champ>
      <Champ libelle="Capacité en œufs de poule" aide="Laissez vide si vous ne la connaissez pas : la place ne sera pas contrôlée.">
        <Nombre valeur={capPoule} onChange={setCapPoule} pas={10} />
      </Champ>
      <Champ libelle="Capacité en œufs de caille (facultatif)">
        <Nombre valeur={capCaille} onChange={setCapCaille} pas={10} />
      </Champ>
      <label className="case"><input type="checkbox" checked={eclosoir} onChange={(e) => setEclosoir(e.target.checked)} /> J’utilise un éclosoir séparé</label>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={!nom.trim()}>Enregistrer</button>
      {initial && (
        <button type="button" className="lien danger" onClick={async () => {
          try { await repo.supprimerCouveuse(initial.id); notifier('Couveuse supprimée'); fin(); aller('couveuse'); } catch (err) { setErreur(err instanceof ErreurSaisie ? err.message : 'Suppression impossible.'); }
        }}>Supprimer cette couveuse</button>
      )}
    </form>
  );
}

export function PageAppareil({ elevage, id }: { elevage: Elevage; id?: string | undefined }) {
  const c = id ? elevage.donnees.couveuses.find((x) => x.id === id) : undefined;
  return (
    <>
      <Retour vers="couveuse" />
      <h2>{c ? 'Modifier la couveuse' : 'Ajouter une couveuse'}</h2>
      <FormCouveuse {...(c ? { initial: c } : {})} fin={() => undefined} />
    </>
  );
}

/* ---------- Nouvelle mise en incubation ---------- */

export function NouvelleIncubation({ elevage }: { elevage: Elevage }) {
  const { donnees, reglages, maintenant } = elevage;
  const notifier = useNotifier();
  const auj = jourLocal(maintenant);
  const especes = Object.values(reglages.especes).filter((e) => e.incubation);
  const [couveuseId, setCouveuseId] = useState(donnees.couveuses[0]?.id ?? '');
  const [especeCode, setEspeceCode] = useState(especes[0]?.code ?? 'poule');
  const [n, setN] = useState('');
  const [date, setDate] = useState(auj);
  const [nom, setNom] = useState('');
  const [origine, setOrigine] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  if (donnees.couveuses.length === 0) {
    return (<><Retour vers="couveuse" /><div className="carte">Ajoutez d’abord votre couveuse. <a className="lien" href="#/couveuse/appareil">Ajouter une couveuse</a></div></>);
  }

  const couveuse = donnees.couveuses.find((c) => c.id === couveuseId);
  const profil = profilDe(reglages.especes, especeCode);
  const libres = couveuse ? placesPourNouvelleMise(couveuse, donnees.incubations, donnees.mirages, reglages.especes, especeCode, date) : null;
  const nomAuto = `${reglages.especes[especeCode]?.nom ?? 'Œufs'} – ${new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const id = await repo.mettreEnIncubation({ couveuseId, especeCode, nom: nom.trim() || nomAuto, nbOeufs: versNombre(n), miseEnPlace: date, origine });
      notifier('Œufs mis en incubation ✓');
      aller(`couveuse/${id}`);
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Enregistrement impossible.');
    }
  };

  return (
    <form onSubmit={soumettre}>
      <Retour vers="couveuse" />
      <h2>Mettre des œufs en incubation</h2>
      {donnees.couveuses.length > 1 && (
        <Champ libelle="Couveuse">
          <select value={couveuseId} onChange={(e) => setCouveuseId(e.target.value)}>
            {donnees.couveuses.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </Champ>
      )}
      <Champ libelle="Espèce">
        <select value={especeCode} onChange={(e) => setEspeceCode(e.target.value)}>
          {especes.map((s) => <option key={s.code} value={s.code}>{s.nom}</option>)}
        </select>
      </Champ>
      <Champ libelle="Nombre d’œufs" aide={libres !== null ? `Places libres à cette date : ${libres}.` : 'Capacité non renseignée : la place n’est pas contrôlée.'}>
        <Nombre valeur={n} onChange={setN} min={1} pas={5} />
      </Champ>
      <Champ libelle="Date de mise en place">
        <input type="date" value={date} max={auj} onChange={(e) => setDate(e.target.value)} />
      </Champ>
      <Champ libelle="Nom (facultatif)" aide={`Sinon : ${nomAuto}`}>
        <input value={nom} onChange={(e) => setNom(e.target.value)} />
      </Champ>
      <Champ libelle="Provenance des œufs (facultatif)" aide="Par exemple : mes Soie blanche, ou achat chez M. Diop.">
        <input value={origine} onChange={(e) => setOrigine(e.target.value)} />
      </Champ>
      {profil && date && (
        <div className="carte muet">
          Calendrier prévu : mirage{profil.mirages.length > 1 ? 's' : ''} le {profil.mirages.filter((j) => j < profil.duree).map((j) => dateCourte(ajouterJours(date, j))).join(' et le ')}, transfert le {dateCourte(ajouterJours(date, profil.jourTransfert))}, éclosion le {dateCourte(ajouterJours(date, profil.duree))}.
        </div>
      )}
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={!n}>Mettre en incubation</button>
    </form>
  );
}

/* ---------- Fiche d'une mise en incubation ---------- */

export function FicheIncubation({ elevage, id }: { elevage: Elevage; id: string }) {
  const { donnees, reglages, maintenant } = elevage;
  const notifier = useNotifier();
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const inc = donnees.incubations.find((i) => i.id === id);
  if (!inc) return (<><Retour vers="couveuse" /><div className="carte">Mise en incubation introuvable.</div></>);

  const auj = jourLocal(maintenant);
  const profil = profilDe(reglages.especes, inc.especeCode);
  const couveuse = donnees.couveuses.find((c) => c.id === inc.couveuseId);
  const etapes = profil ? suivreEtapes(inc, profil, donnees.mirages, auj, couveuse?.eclosoirSepare ?? false) : [];
  const jourJ = ecartJours(inc.miseEnPlace, auj);
  const restants = oeufsRestants(inc, donnees.mirages, auj);
  const stats = statsIncubation(inc, donnees.mirages);
  const tourAujourdhui = inc.faits.includes(`tour:${auj}`);
  const peutTourner = couveuse?.type === 'manuelle' && !!profil && !inc.eclosion && jourJ >= 1 && jourJ < profil.jourTransfert;

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
      <Retour vers="couveuse" libelle="Couveuse" />
      <article className="carte">
        <h2 style={{ marginTop: 0 }}>{inc.nom}</h2>
        <span className="pilule">{reglages.especes[inc.especeCode]?.nom ?? inc.especeCode}</span>
        <span className="pilule">{couveuse?.nom ?? 'Couveuse'}</span>
        <div className="ligne"><span>Mise en place</span><b>{dateCourte(inc.miseEnPlace)}</b></div>
        <div className="ligne"><span>Œufs mis</span><b>{inc.nbOeufs}</b></div>
        {!inc.eclosion && <div className="ligne"><span>Œufs encore en incubation</span><b>{restants}</b></div>}
        {!inc.eclosion && profil && <div className="ligne"><span>Jour d’incubation</span><b>{Math.max(jourJ, 0)} sur {profil.duree}</b></div>}
        {inc.origine && <div className="ligne"><span>Provenance</span><b>{inc.origine}</b></div>}
      </article>

      {profil && !inc.eclosion && (
        <div className="carte muet">
          Repères de départ : {nb(profil.temperature)} °C, humidité {profil.humidite.avant[0]} à {profil.humidite.avant[1]} % puis {profil.humidite.apres} % à partir du jour {profil.jourTransfert}. Suivez toujours la notice de votre couveuse.
        </div>
      )}

      {peutTourner && (
        <button className={tourAujourdhui ? 'bouton alt' : 'bouton'} onClick={() => agir(() => repo.definirFait(inc.id, `tour:${auj}`, !tourAujourdhui), tourAujourdhui ? 'Retournement retiré' : 'Œufs tournés ✓')}>
          {tourAujourdhui ? '✓ Œufs tournés aujourd’hui (annuler)' : 'Œufs tournés aujourd’hui'}
        </button>
      )}

      <h2>Calendrier</h2>
      <div className="carte">
        {etapes.map((e) => (
          <div key={e.cle}>
            <div className="ligne">
              <span>
                {LIBELLE_ETAPE[e.type]} J{e.jourJ} · {dateCourte(e.date)}
              </span>
              {e.statut === 'fait' ? <span className="badge n-vert">Fait</span> : e.statut === 'retard' ? <span className={`badge n-${e.type === 'retournement' || e.type === 'transfert' ? 'rouge' : 'orange'}`}>{quand(e)}</span> : e.statut === 'aujourdhui' ? <span className="badge n-orange">Aujourd’hui</span> : e.statut === 'bientot' ? <span className="badge n-jaune">{quand(e)}</span> : <span className="pilule">à venir</span>}
            </div>
            {e.statut !== 'fait' && !inc.eclosion && (e.statut === 'aujourdhui' || e.statut === 'retard' || (e.type === 'eclosion' && !!profil && jourJ >= profil.jourTransfert)) && (
              <div className="actions">
                <button className="lien" onClick={() => setOuvert(ouvert === e.cle ? null : e.cle)}>
                  {e.type === 'mirage' ? 'Noter le mirage' : e.type === 'retournement' ? 'Retournement arrêté' : e.type === 'transfert' ? 'Transfert fait' : 'Noter l’éclosion'}
                </button>
              </div>
            )}
            {ouvert === e.cle && e.type === 'mirage' && <FormMirage inc={inc} etape={e.jourJ} fin={() => setOuvert(null)} />}
            {ouvert === e.cle && (e.type === 'retournement' || e.type === 'transfert') && (
              <div className="actions">
                <p className="muet">{e.type === 'retournement' ? `${couveuse?.type === 'automatique' ? 'Coupez le retournement automatique (ou posez les œufs à plat)' : 'Ne tournez plus les œufs'} et passez à l’humidité d’éclosion, selon la notice.` : 'Posez les œufs dans l’éclosoir déjà chauffé, sans les tourner.'}</p>
                <button className="bouton court" onClick={() => agir(() => repo.definirFait(inc.id, e.cle, true), e.type === 'retournement' ? 'Arrêt du retournement noté ✓' : 'Transfert noté ✓', () => setOuvert(null))}>Confirmer</button>
              </div>
            )}
            {ouvert === e.cle && e.type === 'eclosion' && <FormEclosion elevage={elevage} inc={inc} restants={restants} />}
            {e.statut === 'fait' && e.type === 'mirage' && (() => {
              const m = donnees.mirages.find((x) => x.incubationId === inc.id && x.etape === e.jourJ);
              return m ? (
                <div className="ligne muet"><span>{m.clairs} clair(s), {m.morts} mort(s) retiré(s)</span><button className="lien" onClick={() => agir(() => repo.annuler({ table: 'mirages', id: m.id }), 'Mirage annulé')}>Annuler</button></div>
              ) : null;
            })()}
            {e.statut === 'fait' && (e.type === 'retournement' || e.type === 'transfert') && !inc.eclosion && (
              <div className="ligne muet"><span>{e.type === 'retournement' ? 'Arrêt du retournement noté' : 'Transfert noté'}</span><button className="lien" onClick={() => agir(async () => { await repo.definirFait(inc.id, e.cle, false); if (e.cle === 'retournement') await repo.definirFait(inc.id, 'transfert', false); }, 'Annulé')}>Annuler</button></div>
            )}
          </div>
        ))}
        {!profil && <p className="muet">Pas de repères d’incubation pour cette espèce.</p>}
      </div>
      {(stats.fecondes !== null || inc.eclosion) && (
        <>
          <h2>Résultats</h2>
          <div className="carte">
            <div className="ligne"><span>Œufs mis</span><b>{stats.mis}</b></div>
            {stats.fecondes !== null && <div className="ligne"><span>Œufs clairs retirés</span><b>{stats.clairs}</b></div>}
            {stats.fecondes !== null && <div className="ligne"><span>Œufs morts retirés</span><b>{stats.mortsOvo}</b></div>}
            {stats.tauxFertilite !== null && <div className="ligne"><span>Fertilité</span><b>{nb(stats.tauxFertilite)} %</b></div>}
            {inc.eclosion && <div className="ligne"><span>Poussins nés</span><b>{inc.eclosion.nes}</b></div>}
            {inc.eclosion && <div className="ligne"><span>Morts en coquille</span><b>{inc.eclosion.mortsCoquille}</b></div>}
            {stats.tauxEclosionFecondes !== null && <div className="ligne"><span>Éclosion sur œufs fécondés</span><b>{nb(stats.tauxEclosionFecondes)} %</b></div>}
            {stats.tauxEclosionMis !== null && <div className="ligne"><span>Éclosion sur œufs mis</span><b>{nb(stats.tauxEclosionMis)} %</b></div>}
          </div>
        </>
      )}

      {inc.eclosion?.lotId && <a className="bouton" href={`#/cheptel/${inc.eclosion.lotId}`}>Voir le lot de poussins</a>}
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <div className="actions">
        {inc.eclosion ? (
          <button className="lien" onClick={() => agir(() => repo.annulerEclosion(inc.id), 'Éclosion annulée')}>Annuler l’éclosion</button>
        ) : (
          <button className="lien danger" onClick={() => { if (window.confirm('Supprimer cette mise en incubation ?')) void agir(() => repo.supprimerIncubation(inc.id), 'Mise en incubation supprimée', () => aller('couveuse')); }}>Supprimer cette mise en incubation</button>
        )}
      </div>
    </>
  );
}

function FormMirage({ inc, etape, fin }: { inc: Incubation; etape: number; fin: () => void }) {
  const notifier = useNotifier();
  const [clairs, setClairs] = useState('0');
  const [morts, setMorts] = useState('0');
  const [erreur, setErreur] = useState<string | null>(null);
  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const a = await repo.enregistrerMirage({ incubationId: inc.id, etape, clairs: versNombre(clairs), morts: versNombre(morts) });
      notifier('Mirage noté ✓', { annuler: () => repo.annuler(a) });
      fin();
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Enregistrement impossible.');
    }
  };
  return (
    <form onSubmit={soumettre}>
      <Champ libelle="Œufs clairs retirés (non fécondés)"><Nombre valeur={clairs} onChange={setClairs} /></Champ>
      <Champ libelle="Œufs morts retirés (avec anneau de sang ou embryon arrêté)"><Nombre valeur={morts} onChange={setMorts} /></Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton court">Enregistrer le mirage</button>
    </form>
  );
}

function FormEclosion({ elevage, inc, restants }: { elevage: Elevage; inc: Incubation; restants: number }) {
  const notifier = useNotifier();
  const [nes, setNes] = useState('');
  const [morts, setMorts] = useState(String(0));
  const [logementId, setLogementId] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const lotId = await repo.enregistrerEclosion({ incubationId: inc.id, nes: versNombre(nes), mortsCoquille: versNombre(morts || '0'), logementId: logementId || null });
      notifier(lotId ? 'Éclosion notée, lot de poussins créé ✓' : 'Éclosion notée ✓');
      if (lotId) aller(`cheptel/${lotId}`);
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Enregistrement impossible.');
    }
  };
  return (
    <form onSubmit={soumettre}>
      <p className="muet">Il reste {restants} œufs dans cette mise en incubation.</p>
      <Champ libelle="Poussins nés vivants"><Nombre valeur={nes} onChange={setNes} /></Champ>
      <Champ libelle="Morts en coquille ou œufs non éclos (facultatif)"><Nombre valeur={morts} onChange={setMorts} /></Champ>
      <Champ libelle="Où placer les poussins ?">
        <select value={logementId} onChange={(e) => setLogementId(e.target.value)}>
          <option value="">Aucun local pour l’instant</option>
          {elevage.donnees.logements.map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}
        </select>
      </Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={!nes}>Enregistrer l’éclosion</button>
    </form>
  );
}
