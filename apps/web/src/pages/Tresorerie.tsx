import { useState, type FormEvent } from 'react';
import {
  LIBELLES_MODES, LIBELLES_TYPES_COMPTE, MODES_PAIEMENT, aDroit, ecartsAExpliquer, jourLocal, liquiditeTotale, mouvementsCompte, reglementsSansCompte, soldesComptes,
  type EntreeTresorerie, type ModePaiement, type TypeCompte,
} from '@digitalab/core';
import { Si } from '../components/Si';
import { Champ, Nombre, Retour, useConfirmer, useNotifier, versNombre } from '../components/ui';
import { dateCourte, formatMontant, signe } from '../format';
import { ErreurSaisie, repo } from '../repo';
import { aller } from '../route';
import type { Elevage } from '../useElevage';

const ICONES: Record<TypeCompte, string> = { caisse: '💵', mobile_money: '📱', banque: '🏦', autre: '👛' };

export const donneesTresorerie = (e: Elevage): EntreeTresorerie => ({
  comptes: e.comptes, operations: e.operations, paiements: e.paiements, entreesStock: e.donnees.entreesStock, transferts: e.transferts, pointages: e.pointages,
});

const nomsDesComptes = (e: Elevage) => (id: string) => e.comptes.find((c) => c.id === id)?.nom ?? 'Compte supprimé';
const montantSigne = (n: number) => `${signe(n) || '+'} ${formatMontant(n)}`;
/** Un solde ne porte un signe que lorsqu'il est négatif. */
const soldeTexte = (n: number) => `${n < 0 ? '− ' : ''}${formatMontant(n)}`;

/** Résumé de la trésorerie pour le tableau de bord et la page Finances. */
export function ResumeTresorerie({ elevage }: { elevage: Elevage }) {
  const d = donneesTresorerie(elevage);
  const soldes = soldesComptes(d, nomsDesComptes(elevage));
  const ecarts = ecartsAExpliquer(elevage.pointages);
  if (soldes.length === 0) {
    return (
      <div className="carte">
        <h3>Trésorerie</h3>
        <p className="muet">Suivez en temps réel ce qu’il y a dans la caisse, sur Wave, Orange Money et en banque.</p>
        <a className="bouton alt court" href="#/finances/tresorerie">Mettre en place mes comptes</a>
      </div>
    );
  }
  return (
    <a className="carte tresorerie-resume" href="#/finances/tresorerie" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="ligne"><span><b>Liquidités</b><br /><small className="muet">tous les comptes ensemble</small></span><b className="solde-grand">{formatMontant(liquiditeTotale(soldes))}</b></div>
      {soldes.map((s) => <div key={s.compte.id} className="ligne"><span>{ICONES[s.compte.type]} {s.compte.nom}</span><b className={`montant${s.solde < 0 ? ' negatif' : ''}`}>{soldeTexte(s.solde)}</b></div>)}
      {ecarts.length > 0 && <p className="erreur">{ecarts.length} écart{ecarts.length > 1 ? 's' : ''} de trésorerie à expliquer</p>}
    </a>
  );
}

export function PageTresorerie({ elevage }: { elevage: Elevage }) {
  const notifier = useNotifier();
  const d = donneesTresorerie(elevage);
  const nom = nomsDesComptes(elevage);
  const soldes = soldesComptes(d, nom);
  const ecarts = ecartsAExpliquer(elevage.pointages);
  const sansCompte = reglementsSansCompte(d);
  const dernier = (id: string) => elevage.pointages.filter((p) => p.compteId === id).sort((a, b) => b.date.localeCompare(a.date) || b.misAJour - a.misAJour)[0];

  return (
    <>
      <Retour vers="finances" libelle="Finances" />
      <h2>Trésorerie</h2>
      {soldes.length === 0 ? (
        <div className="carte">
          <p>Ici, vous voyez ce qu’il y a dans la caisse et sur chaque compte (Wave, Orange Money, banque), vous déplacez l’argent d’un compte à l’autre et vous repérez les écarts.</p>
          <p className="muet">Les soldes se calculent à partir de vos encaissements et paiements : chaque règlement enregistré par un moyen de paiement (espèces, Wave…) entre ou sort du compte correspondant.</p>
          <Si elevage={elevage} droit="tresorerie.gerer">
            <button className="bouton" onClick={async () => { await repo.creerComptesParDefaut(); notifier('Comptes créés : réglez maintenant le solde de départ de chacun'); }}>Créer la caisse, Wave, Orange Money et la banque</button>
            <a className="bouton alt" href="#/finances/tresorerie/nouveau">Créer un compte à ma façon</a>
          </Si>
        </div>
      ) : (
        <>
          <div className="carte total-liquidite">
            <span className="muet">Liquidités, tous comptes ensemble</span>
            <b className="solde-grand">{formatMontant(liquiditeTotale(soldes))}</b>
            <small className="muet">mis à jour à chaque saisie, sur tous vos appareils dès qu’ils sont connectés</small>
          </div>
          {ecarts.length > 0 && (
            <div className="bandeau n-orange" role="status">
              <strong>{ecarts.length} écart{ecarts.length > 1 ? 's' : ''} à expliquer</strong>
              <span>{ecarts.map((p) => `${nom(p.compteId)} : ${montantSigne(p.ecart)}`).join(' · ')}</span>
            </div>
          )}
          {soldes.map((s) => {
            const p = dernier(s.compte.id);
            return (
              <a key={s.compte.id} className="carte compte" href={`#/finances/tresorerie/compte/${s.compte.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="compte-tete">
                  <b>{ICONES[s.compte.type]} {s.compte.nom}</b>
                  <small className="muet">{LIBELLES_TYPES_COMPTE[s.compte.type]}{s.compte.modes.length ? ` · ${s.compte.modes.map((m) => LIBELLES_MODES[m]).join(', ')}` : ''}</small>
                </div>
                <b className={`solde-grand${s.solde < 0 ? ' negatif' : ''}`}>{soldeTexte(s.solde)}</b>
                <small className="muet">
                  + {formatMontant(s.entrees)} · − {formatMontant(s.sorties)} depuis le {dateCourte(s.compte.dateInitiale)}
                  {p ? ` · compté le ${dateCourte(p.date)}${p.ecart === 0 ? ' : aucun écart' : p.regularise ? ' : écart expliqué' : ` : écart ${montantSigne(p.ecart)} à expliquer`}` : ' · jamais compté'}
                </small>
              </a>
            );
          })}
          {sansCompte.nombre > 0 && (
            <div className="carte muet">
              {sansCompte.nombre} règlement{sansCompte.nombre > 1 ? 's' : ''} ({formatMontant(sansCompte.montant)}) {sansCompte.nombre > 1 ? 'ont été faits' : 'a été fait'} par un moyen de paiement qu’aucun compte ne suit : cet argent n’apparaît dans aucun solde.
              <Si elevage={elevage} droit="tresorerie.gerer"> <a className="lien" href="#/finances/tresorerie">Ajustez les comptes</a></Si>
            </div>
          )}
          <div className="rangee">
            <Si elevage={elevage} droit="tresorerie.transferer">{soldes.length > 1 && <a className="bouton court" href="#/finances/tresorerie/transfert">↔ Transférer</a>}</Si>
            <Si elevage={elevage} droit="tresorerie.pointer"><a className="bouton alt court" href="#/finances/tresorerie/pointage">🧮 Compter un compte</a></Si>
            <Si elevage={elevage} droit="tresorerie.gerer"><a className="bouton alt court" href="#/finances/tresorerie/nouveau">+ Ajouter un compte</a></Si>
          </div>
          <p className="muet">Les soldes sont ceux de vos saisies : ils ne sont pas lus directement chez Wave, Orange Money ou la banque. Comparez-les régulièrement avec ce que ces services affichent, avec « Compter un compte ».</p>
        </>
      )}
    </>
  );
}

export function PageCompte({ elevage, id }: { elevage: Elevage; id: string }) {
  const confirmer = useConfirmer();
  const notifier = useNotifier();
  const d = donneesTresorerie(elevage);
  const nom = nomsDesComptes(elevage);
  const s = soldesComptes(d, nom).find((x) => x.compte.id === id);
  const [explication, setExplication] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  if (!s) return <><Retour vers="finances/tresorerie" /><div className="carte muet">Ce compte n’existe plus.</div></>;
  const { compte } = s;
  const mouvements = mouvementsCompte(compte, d, nom);
  let courant = compte.soldeInitial;
  const avecSolde = mouvements.map((m) => ({ ...m, apres: (courant += m.montant) })).reverse();
  const pointages = elevage.pointages.filter((p) => p.compteId === id).sort((a, b) => b.date.localeCompare(a.date) || b.misAJour - a.misAJour);
  const droits = elevage.moi.droits;

  return (
    <>
      <Retour vers="finances/tresorerie" libelle="Trésorerie" />
      <h2>{ICONES[compte.type]} {compte.nom}</h2>
      <div className="carte total-liquidite">
        <span className="muet">Solde</span>
        <b className={`solde-grand${s.solde < 0 ? ' negatif' : ''}`}>{soldeTexte(s.solde)}</b>
        <small className="muet">Départ : {formatMontant(compte.soldeInitial)} le {dateCourte(compte.dateInitiale)}</small>
      </div>
      <div className="rangee">
        <Si elevage={elevage} droit="tresorerie.pointer"><a className="bouton court" href={`#/finances/tresorerie/pointage?compte=${id}`}>🧮 Compter</a></Si>
        <Si elevage={elevage} droit="tresorerie.transferer"><a className="bouton alt court" href={`#/finances/tresorerie/transfert?de=${id}`}>↔ Transférer</a></Si>
        <Si elevage={elevage} droit="tresorerie.gerer"><a className="bouton alt court" href={`#/finances/tresorerie/modifier/${id}`}>Modifier</a></Si>
      </div>

      {pointages.length > 0 && (
        <>
          <h2>Comptages</h2>
          {erreur && <p className="erreur" role="alert">{erreur}</p>}
          {pointages.map((p) => (
            <div key={p.id} className="carte">
              <div className="ligne"><span>{dateCourte(p.date)} · compté {formatMontant(p.soldeReel)}<br /><small className="muet">annoncé {formatMontant(p.soldeTheorique)}</small></span>
                <b className={`montant${p.ecart < 0 ? ' negatif' : ''}`}>{p.ecart === 0 ? 'aucun écart' : `écart ${montantSigne(p.ecart)}`}</b></div>
              {p.note && <p className="muet">{p.note}</p>}
              {p.ecart !== 0 && !p.regularise && (
                <>
                  <p className="erreur">À expliquer : le solde ci-dessus ne tient pas compte de cet écart.</p>
                  {aDroit(droits, 'tresorerie.pointer') && (
                    <>
                      <Champ libelle="Explication"><input value={explication[p.id] ?? ''} onChange={(e) => setExplication({ ...explication, [p.id]: e.target.value })} placeholder="Erreur de rendu, frais oublié…" /></Champ>
                      <button className="bouton alt court" onClick={async () => { try { await repo.regulariserPointage(p.id, explication[p.id] ?? ''); setErreur(null); notifier('Écart corrigé dans le solde ✓'); } catch (e) { setErreur(e instanceof ErreurSaisie ? e.message : 'Impossible.'); } }}>Corriger le solde de cet écart</button>
                    </>
                  )}
                </>
              )}
              {p.regularise && p.ecart !== 0 && <p className="muet">Écart expliqué et corrigé dans le solde.</p>}
              {aDroit(droits, 'tresorerie.pointer') && <button className="lien danger" onClick={async () => { if (await confirmer('Annuler ce comptage ?')) await repo.annuler({ table: 'pointages', id: p.id }); }}>Annuler ce comptage</button>}
            </div>
          ))}
        </>
      )}

      <h2>Mouvements</h2>
      {avecSolde.length === 0 && <div className="carte muet">Aucun mouvement depuis le {dateCourte(compte.dateInitiale)}.</div>}
      {avecSolde.length > 0 && (
        <div className="carte">
          {avecSolde.map((m) => (
            <div key={m.cle} className="ligne">
              <span>
                {dateCourte(m.date)} · {m.reference?.type === 'operation' ? <a className="lien" href={`#/finances/op/${m.reference.id}`}>{m.libelle}</a> : m.libelle}
                <br /><small className="muet">solde après : {formatMontant(m.apres)}</small>
                {m.reference?.type === 'transfert' && m.nature !== 'frais' && aDroit(droits, 'tresorerie.transferer') && (
                  <><br /><button className="lien" onClick={async () => { if (await confirmer('Annuler ce transfert ? Les deux comptes retrouveront leur solde d’avant.')) await repo.annuler({ table: 'transferts', id: m.reference!.id }); }}>Annuler ce transfert</button></>
                )}
              </span>
              <b className={`montant${m.montant < 0 ? '' : ' gain'}`}>{montantSigne(m.montant)}</b>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function FormCompte({ elevage, id }: { elevage: Elevage; id?: string }) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const existant = id ? elevage.comptes.find((c) => c.id === id) : undefined;
  const auj = jourLocal(elevage.maintenant);
  const [nom, setNom] = useState(existant?.nom ?? '');
  const [type, setType] = useState<TypeCompte>(existant?.type ?? 'mobile_money');
  const [solde, setSolde] = useState(existant ? String(existant.soldeInitial) : '');
  const [dateInitiale, setDateInitiale] = useState(existant?.dateInitiale ?? auj);
  const [modes, setModes] = useState<ModePaiement[]>(existant?.modes ?? []);
  const [erreur, setErreur] = useState<string | null>(null);
  if (id && !existant) return <><Retour vers="finances/tresorerie" /><div className="carte muet">Ce compte n’existe plus.</div></>;
  const pris = (m: ModePaiement) => elevage.comptes.find((c) => c.id !== id && c.modes.includes(m));

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await repo.enregistrerCompte({ ...(id ? { id } : {}), nom, type, soldeInitial: solde.trim() === '' ? 0 : Math.round(versNombre(solde)), dateInitiale, modes });
      notifier('Compte enregistré ✓');
      aller(id ? `finances/tresorerie/compte/${id}` : 'finances/tresorerie');
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Enregistrement impossible.');
    }
  };

  return (
    <form onSubmit={soumettre}>
      <Retour vers={id ? `finances/tresorerie/compte/${id}` : 'finances/tresorerie'} />
      <h2>{id ? 'Modifier le compte' : 'Nouveau compte'}</h2>
      <Champ libelle="Nom"><input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Wave, Banque BOA, Caisse du poulailler…" /></Champ>
      <Champ libelle="Type">
        <select value={type} onChange={(e) => setType(e.target.value as TypeCompte)}>{(Object.keys(LIBELLES_TYPES_COMPTE) as TypeCompte[]).map((t) => <option key={t} value={t}>{LIBELLES_TYPES_COMPTE[t]}</option>)}</select>
      </Champ>
      <Champ libelle="Solde de départ (FCFA)" aide="Ce qu’il y avait sur ce compte à la date ci-dessous. Seuls les mouvements à partir de cette date comptent ensuite.">
        <input inputMode="numeric" value={solde} onChange={(e) => setSolde(e.target.value)} placeholder="0" />
      </Champ>
      <Champ libelle="Date de ce solde"><input type="date" value={dateInitiale} max={auj} onChange={(e) => setDateInitiale(e.target.value)} /></Champ>
      <fieldset className="carte">
        <legend>Moyens de paiement suivis par ce compte</legend>
        <p className="muet">Chaque encaissement ou paiement fait avec ces moyens entre ou sort de ce compte.</p>
        {MODES_PAIEMENT.map((m) => {
          const autre = pris(m);
          return (
            <label key={m} className="case">
              <input type="checkbox" checked={modes.includes(m)} disabled={!!autre} onChange={(e) => setModes(e.target.checked ? [...modes, m] : modes.filter((x) => x !== m))} />
              {LIBELLES_MODES[m]}{autre ? ` (déjà suivi par ${autre.nom})` : ''}
            </label>
          );
        })}
      </fieldset>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton">Enregistrer</button>
      {id && (
        <button type="button" className="lien danger" onClick={async () => { if (await confirmer('Retirer ce compte ? Ses règlements ne seront plus suivis nulle part.')) { try { await repo.supprimerCompte(id); aller('finances/tresorerie'); } catch (err) { setErreur(err instanceof ErreurSaisie ? err.message : 'Impossible.'); } } }}>Retirer ce compte</button>
      )}
    </form>
  );
}

export function FormTransfert({ elevage, deInitial }: { elevage: Elevage; deInitial: string | null }) {
  const notifier = useNotifier();
  const auj = jourLocal(elevage.maintenant);
  const soldes = soldesComptes(donneesTresorerie(elevage), nomsDesComptes(elevage));
  const [deId, setDeId] = useState(deInitial && soldes.some((s) => s.compte.id === deInitial) ? deInitial : soldes[0]?.compte.id ?? '');
  const [versId, setVersId] = useState(soldes.find((s) => s.compte.id !== (deInitial ?? soldes[0]?.compte.id))?.compte.id ?? '');
  const [montant, setMontant] = useState('');
  const [frais, setFrais] = useState('');
  const [date, setDate] = useState(auj);
  const [note, setNote] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const de = soldes.find((s) => s.compte.id === deId);
  const vers = soldes.find((s) => s.compte.id === versId);
  const m = versNombre(montant) || 0;
  const f = versNombre(frais) || 0;

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const a = await repo.creerTransfert({ deId, versId, montant: m, frais: f, date, note });
      notifier('Transfert enregistré ✓', { annuler: () => repo.annuler(a) });
      aller('finances/tresorerie');
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Enregistrement impossible.');
    }
  };

  return (
    <form onSubmit={soumettre}>
      <Retour vers="finances/tresorerie" libelle="Trésorerie" />
      <h2>Transférer de l’argent</h2>
      <Champ libelle="Depuis le compte">
        <select value={deId} onChange={(e) => setDeId(e.target.value)}>{soldes.map((s) => <option key={s.compte.id} value={s.compte.id}>{s.compte.nom} ({formatMontant(s.solde)})</option>)}</select>
      </Champ>
      <Champ libelle="Vers le compte">
        <select value={versId} onChange={(e) => setVersId(e.target.value)}>{soldes.filter((s) => s.compte.id !== deId).map((s) => <option key={s.compte.id} value={s.compte.id}>{s.compte.nom} ({formatMontant(s.solde)})</option>)}</select>
      </Champ>
      <Champ libelle="Montant (FCFA)"><Nombre valeur={montant} onChange={setMontant} min={0} pas={5000} unite="FCFA" /></Champ>
      <Champ libelle="Frais retenus (FCFA, facultatif)" aide="Commission de retrait ou de transfert : elle sort du compte de départ et compte comme une dépense."><Nombre valeur={frais} onChange={setFrais} min={0} pas={100} unite="FCFA" /></Champ>
      <Champ libelle="Date"><input type="date" value={date} max={auj} onChange={(e) => setDate(e.target.value)} /></Champ>
      <Champ libelle="Remarque (facultatif)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Retrait pour payer les salaires…" /></Champ>
      {de && vers && m > 0 && (
        <div className="carte apercu-transfert">
          <div className="ligne"><span>{de.compte.nom} après</span><b className={`montant${de.solde - m - f < 0 ? ' negatif' : ''}`}>{formatMontant(de.solde - m - f)}</b></div>
          <div className="ligne"><span>{vers.compte.nom} après</span><b className="montant">{formatMontant(vers.solde + m)}</b></div>
          {de.solde - m - f < 0 && <p className="erreur">Le compte de départ n’a pas assez : vérifiez le montant, ou les règlements pas encore saisis.</p>}
        </div>
      )}
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={!m || !deId || !versId}>Transférer</button>
    </form>
  );
}

export function FormPointage({ elevage, compteInitial }: { elevage: Elevage; compteInitial: string | null }) {
  const notifier = useNotifier();
  const soldes = soldesComptes(donneesTresorerie(elevage), nomsDesComptes(elevage));
  const [compteId, setCompteId] = useState(compteInitial && soldes.some((s) => s.compte.id === compteInitial) ? compteInitial : soldes[0]?.compte.id ?? '');
  const [reel, setReel] = useState('');
  const [regulariser, setRegulariser] = useState(false);
  const [note, setNote] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const s = soldes.find((x) => x.compte.id === compteId);
  const saisi = reel.trim() !== '';
  const ecart = saisi && s ? Math.round(versNombre(reel)) - s.solde : 0;

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await repo.pointer({ compteId, soldeReel: Math.round(versNombre(reel)), regulariser, note });
      notifier(r.ecart === 0 ? 'Comptage enregistré : aucun écart ✓' : regulariser ? 'Écart corrigé dans le solde ✓' : 'Écart noté : à expliquer', { annuler: () => repo.annuler(r) });
      aller(`finances/tresorerie/compte/${compteId}`);
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Enregistrement impossible.');
    }
  };

  return (
    <form onSubmit={soumettre}>
      <Retour vers="finances/tresorerie" libelle="Trésorerie" />
      <h2>Compter un compte</h2>
      <p className="muet">Comptez l’argent de la caisse, ou lisez le solde dans l’application Wave, Orange Money ou de la banque, puis entrez-le ici.</p>
      <Champ libelle="Compte">
        <select value={compteId} onChange={(e) => setCompteId(e.target.value)}>{soldes.map((x) => <option key={x.compte.id} value={x.compte.id}>{x.compte.nom}</option>)}</select>
      </Champ>
      {s && <div className="ligne"><span>Solde annoncé par vos saisies</span><b className="montant">{formatMontant(s.solde)}</b></div>}
      <Champ libelle="Solde réellement constaté (FCFA)"><input inputMode="numeric" value={reel} onChange={(e) => setReel(e.target.value)} placeholder="0" /></Champ>
      {saisi && s && (
        <div className={`bandeau n-${ecart === 0 ? 'vert' : 'orange'}`} role="status">
          <strong>{ecart === 0 ? 'Aucun écart ✓' : `Écart : ${montantSigne(ecart)}`}</strong>
          {ecart !== 0 && <span>{ecart < 0 ? 'Il manque de l’argent par rapport à vos saisies.' : 'Il y a plus d’argent que vos saisies ne l’annoncent.'}</span>}
        </div>
      )}
      {saisi && ecart !== 0 && (
        <fieldset className="carte">
          <legend>Que faire de cet écart ?</legend>
          <label className="case"><input type="radio" name="regul" checked={!regulariser} onChange={() => setRegulariser(false)} /> Je ne sais pas encore : le garder « à expliquer »</label>
          <label className="case"><input type="radio" name="regul" checked={regulariser} onChange={() => setRegulariser(true)} /> J’ai l’explication : corriger le solde</label>
          <Champ libelle={regulariser ? 'Explication (obligatoire)' : 'Remarque (facultatif)'}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Erreur de rendu de monnaie, frais oublié…" /></Champ>
        </fieldset>
      )}
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={!saisi || !compteId}>Enregistrer le comptage</button>
    </form>
  );
}
