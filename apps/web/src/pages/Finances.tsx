import { useState, type FormEvent } from 'react';
import {
  CATEGORIES_DEPENSE,
  CATEGORIES_RECETTE,
  LIBELLES_CATEGORIES,
  coutAlimentParOeuf,
  aDroit,
  enAttente,
  enAttenteDeValidation,
  enRetard,
  peutValiderDepense,
  exporterCsv,
  fluxParMode,
  LIBELLES_MODES,
  MODES_PAIEMENT,
  prochainNumeroFacture,
  totalLignes,
  jourLocal,
  lignesFinance,
  moisDecale,
  parCategorie,
  parLot,
  resume,
  type LigneFinance,
  type ModePaiement,
  type SensOperation,
} from '@digitalab/core';
import { Si } from '../components/Si';
import { Champ, Nombre, Retour, useNotifier, versNombre } from '../components/ui';
import { ErreurSaisie, repo, type Annulation } from '../repo';
import { dateCourte, formatMontant, signe } from '../format';
import { aller } from '../route';
import type { Elevage } from '../useElevage';

const nomMois = (p: string) => new Date(`${p}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export function PageFinances({ elevage }: { elevage: Elevage }) {
  const { donnees, operations, paiements, noms, maintenant } = elevage;
  const notifier = useNotifier();
  const auj = jourLocal(maintenant);
  const moisCourant = auj.slice(0, 7);
  const [mois, setMois] = useState(moisCourant);
  const droits = elevage.moi.droits;
  const voitDep = aDroit(droits, 'finances.voir_depenses');
  const voitRec = aDroit(droits, 'finances.voir_recettes');
  const lignes = lignesFinance(operations, donnees.entreesStock, paiements).filter((l) => (l.sens === 'depense' ? voitDep : voitRec));
  const flux = fluxParMode(operations, paiements, mois).filter((x) => (x.encaisse > 0 && voitRec) || (x.paye > 0 && voitDep)).map((x) => ({ ...x, encaisse: voitRec ? x.encaisse : 0, paye: voitDep ? x.paye : 0 }));
  const validation = enAttenteDeValidation(operations, paiements);
  const aValiderOps = validation.operations.filter((o) => (o.employeId ? aDroit(droits, 'salaires.payer') : peutValiderDepense(droits, o.categorie)));
  const aValiderPaiements = validation.paiements.filter((p) => {
    const o = operations.find((x) => x.id === p.operationId);
    return o?.sens === 'depense' && (aDroit(droits, 'finances.valider_paiement') || aDroit(droits, 'salaires.payer'));
  });
  const r = resume(lignes, mois);
  const attente = enAttente(lignes);
  const delMois = lignes.filter((l) => l.date.startsWith(mois));
  const coutOeuf = coutAlimentParOeuf(lignes, donnees.pontes, mois);
  const lots = parLot(lignes);

  const exporter = () => {
    try {
      const blob = new Blob([`﻿${exporterCsv(lignes, (id) => noms.lot(id ?? undefined))}`], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `digitalab-finances-${moisCourant}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      notifier('Fichier téléchargé ✓');
    } catch {
      notifier('Téléchargement impossible ici.', { erreur: true });
    }
  };

  return (
    <>
      <div className="rangee">
        <Si elevage={elevage} droit="finances.saisir_depense"><a className="bouton court" href="#/finances/depense">− Dépense</a></Si>
        <Si elevage={elevage} droit="finances.saisir_facture"><a className="bouton court" href="#/finances/recette">+ Recette</a></Si>
      </div>
      <div className="rangee">
        <Si elevage={elevage} droit="salaires.voir"><a className="bouton alt court" href="#/finances/salaires">👷 Salaires</a></Si>
        <Si elevage={elevage} un={['finances.carnet', 'finances.saisir_facture', 'finances.encaisser']}><a className="bouton alt court" href="#/finances/carnet">📒 Clients et fournisseurs</a></Si>
      </div>

      {(aValiderOps.length > 0 || aValiderPaiements.length > 0) && (
        <>
          <h2>À valider</h2>
          {aValiderOps.map((o) => (
            <div key={o.id} className="carte">
              <h3>Dépense à valider : {formatMontant(o.montant)}</h3>
              <p className="muet">{LIBELLES_CATEGORIES[o.categorie] ?? o.categorie}{o.tiers ? ` · ${o.tiers}` : ''} · du {dateCourte(o.date)}</p>
              <div className="rangee">
                <button className="bouton court" onClick={async () => { await repo.valider({ table: 'operations', id: o.id }); notifier('Dépense validée ✓'); }}>Valider</button>
                <a className="bouton alt court" href={`#/finances/op/${o.id}`}>Voir</a>
              </div>
            </div>
          ))}
          {aValiderPaiements.map((p) => {
            const o = operations.find((x) => x.id === p.operationId)!;
            return (
              <div key={p.id} className="carte">
                <h3>Paiement à valider : {formatMontant(p.montant)}</h3>
                <p className="muet">{LIBELLES_CATEGORIES[o.categorie] ?? o.categorie}{o.tiers ? ` · ${o.tiers}` : ''} · {LIBELLES_MODES[p.mode]} · {dateCourte(p.date)}</p>
                <div className="rangee">
                  <button className="bouton court" onClick={async () => { await repo.valider({ table: 'paiements', id: p.id }); notifier('Paiement validé ✓'); }}>Valider</button>
                  <a className="bouton alt court" href={`#/finances/op/${o.id}`}>Voir</a>
                </div>
              </div>
            );
          })}
        </>
      )}

      {!voitDep && !voitRec && <div className="carte muet">Vous pouvez saisir, mais votre profil ne permet pas de consulter les chiffres.</div>}

      <div className="mois" role="group" aria-label="Choix du mois">
        <button className="lien" onClick={() => setMois(moisDecale(mois, -1))} aria-label="Mois précédent">←</button>
        <b>{nomMois(mois)}</b>
        <button className="lien" onClick={() => setMois(moisDecale(mois, 1))} disabled={mois >= moisCourant} aria-label="Mois suivant">→</button>
      </div>

      {(voitDep || voitRec) && (
        <div className="tuiles">
          {voitRec && <div className="tuile"><b className="montant">{formatMontant(r.recettes)}</b><span>recettes</span></div>}
          {voitDep && <div className="tuile"><b className="montant">{formatMontant(r.depenses)}</b><span>dépenses</span></div>}
        </div>
      )}
      {voitDep && voitRec && (
        <div className={`bandeau n-${r.resultat < 0 ? 'orange' : 'vert'}`}>
          <strong>Résultat du mois : {signe(r.resultat)} {formatMontant(r.resultat)}</strong>
        </div>
      )}
      {voitDep && voitRec && coutOeuf !== null && <p className="muet">Aliment acheté ce mois-ci : environ {coutOeuf} FCFA par œuf produit (estimation).</p>}

      {(attente.aEncaisser.length > 0 || attente.aPayer.length > 0) && (
        <>
          <h2>En attente</h2>
          {attente.aEncaisser.map((l) => <LigneAttente key={l.cle} ligne={l} libelle="À encaisser" retard={enRetard(l, auj)} />)}
          {attente.aPayer.map((l) => <LigneAttente key={l.cle} ligne={l} libelle="À payer" retard={enRetard(l, auj)} />)}
          <p className="muet">On vous doit {formatMontant(attente.totalAEncaisser)} · vous devez {formatMontant(attente.totalAPayer)}.</p>
        </>
      )}

      {flux.length > 0 && (
        <>
          <h2>Par moyen de paiement</h2>
          <div className="carte">
            {flux.map((f) => (
              <div key={f.mode} className="ligne"><span>{LIBELLES_MODES[f.mode]}</span><b className="montant">{f.encaisse > 0 ? `+ ${formatMontant(f.encaisse)}` : ''}{f.encaisse > 0 && f.paye > 0 ? ' · ' : ''}{f.paye > 0 ? `− ${formatMontant(f.paye)}` : ''}</b></div>
            ))}
            <p className="muet">Argent réellement encaissé et payé ce mois-ci, d’après les règlements enregistrés.</p>
          </div>
        </>
      )}

      {r.depenses > 0 && <Repartition titre="Où part l’argent" lignes={parCategorie(lignes, 'depense', mois)} />}
      {r.recettes > 0 && <Repartition titre="D’où vient l’argent" lignes={parCategorie(lignes, 'recette', mois)} />}

      <h2>Mouvements du mois</h2>
      {delMois.length === 0 && <div className="carte muet">Rien de noté ce mois-ci.</div>}
      {delMois.length > 0 && (
        <div className="carte">
          {delMois.map((l) => (
            <div key={l.cle} className="ligne">
              <span>
                {l.automatique ? <>{dateCourte(l.date)} · {LIBELLES_CATEGORIES[l.categorie]}</> : <a className="lien" href={`#/finances/op/${l.cle}`}>{dateCourte(l.date)} · {LIBELLES_CATEGORIES[l.categorie] ?? l.categorie}</a>}
                {l.numero ? ` · ${l.numero}` : ''}{l.lotId ? ` · ${noms.lot(l.lotId)}` : ''}{l.tiers ? ` · ${l.tiers}` : ''}{l.automatique ? ' · achat d’aliment' : ''}
                {l.reste > 0 && <><br /><small className="muet">reste {formatMontant(l.reste)} à {l.sens === 'recette' ? 'encaisser' : 'payer'}</small></>}
              </span>
              <b className={l.sens === 'recette' ? 'montant gain' : 'montant'}>{l.sens === 'recette' ? '+' : '−'} {formatMontant(l.montant)}</b>
              {!l.automatique && aDroit(droits, l.sens === 'recette' ? 'finances.annuler_vente' : 'finances.annuler_depense') && <button className="lien" onClick={() => { if (window.confirm('Annuler cette ligne ?')) void repo.annuler({ table: 'operations', id: l.cle }); }}>Annuler</button>}
            </div>
          ))}
        </div>
      )}

      {voitDep && voitRec && lots.length > 0 && (
        <>
          <h2>Par lot</h2>
          <div className="carte">
            {lots.map((l) => (
              <div key={l.lotId} className="ligne"><span>{noms.lot(l.lotId)}<br /><small className="muet">recettes {formatMontant(l.recettes)} · dépenses {formatMontant(l.depenses)}</small></span><b className="montant">{signe(l.resultat)} {formatMontant(l.resultat)}</b></div>
            ))}
          </div>
        </>
      )}

      <Si elevage={elevage} droit="finances.exporter">
      <h2>Pour votre comptable</h2>
      <div className="carte">
        <p className="muet">Un fichier avec toutes vos dépenses et recettes, lisible dans Excel. Il n’ouvre aucun compte et n’est pas un document comptable officiel.</p>
        <button className="bouton alt" onClick={exporter}>Télécharger le fichier (CSV)</button>
      </div>
      </Si>
    </>
  );
}

function Repartition({ titre, lignes }: { titre: string; lignes: { categorie: string; montant: number }[] }) {
  const max = Math.max(1, ...lignes.map((l) => l.montant));
  return (
    <>
      <h2>{titre}</h2>
      <div className="carte">
        {lignes.map((l) => (
          <div key={l.categorie} className="repart">
            <div className="ligne"><span>{LIBELLES_CATEGORIES[l.categorie] ?? l.categorie}</span><b className="montant">{formatMontant(l.montant)}</b></div>
            <progress max={max} value={l.montant} aria-label={LIBELLES_CATEGORIES[l.categorie]} />
          </div>
        ))}
      </div>
    </>
  );
}

function LigneAttente({ ligne, libelle, retard }: { ligne: LigneFinance; libelle: string; retard: boolean }) {
  return (
    <div className="carte">
      <h3>{libelle} : {formatMontant(ligne.reste)}{retard && <span className="erreur"> · en retard</span>}</h3>
      <p className="muet">
        {LIBELLES_CATEGORIES[ligne.categorie]}{ligne.numero ? ` · ${ligne.numero}` : ''}{ligne.tiers ? ` · ${ligne.tiers}` : ''} · du {dateCourte(ligne.date)}
        {ligne.reste < ligne.montant ? ` · total ${formatMontant(ligne.montant)}` : ''}
        {ligne.echeance ? ` · avant le ${dateCourte(ligne.echeance)}` : ''}
      </p>
      <a className="bouton alt court" href={`#/finances/op/${ligne.cle}`}>{ligne.sens === 'recette' ? 'Enregistrer un encaissement' : 'Enregistrer un paiement'}</a>
    </div>
  );
}

interface LigneSaisie {
  libelle: string;
  quantite: string;
  prix: string;
}
const LIGNE_VIDE: LigneSaisie = { libelle: '', quantite: '1', prix: '' };

type Reglage = 'tout' | 'acompte' | 'rien';

export function FormOperation({ elevage, sens, lotInitial }: { elevage: Elevage; sens: SensOperation; lotInitial: string | null }) {
  const { donnees, operations, tiers: carnet, maintenant } = elevage;
  const notifier = useNotifier();
  const categories = sens === 'depense' ? CATEGORIES_DEPENSE : CATEGORIES_RECETTE;
  const auj = jourLocal(maintenant);
  const [detaille, setDetaille] = useState(false);
  const [montant, setMontant] = useState('');
  const [lignes, setLignes] = useState<LigneSaisie[]>([{ ...LIGNE_VIDE }]);
  const [remise, setRemise] = useState('');
  const [categorie, setCategorie] = useState<string>(categories[0]);
  const [lotId, setLotId] = useState(lotInitial ?? '');
  const [tiers, setTiers] = useState('');
  const [telephone, setTelephone] = useState('');
  const [numero, setNumero] = useState('');
  const [date, setDate] = useState(auj);
  const [reglage, setReglage] = useState<Reglage>('tout');
  const [acompte, setAcompte] = useState('');
  const [mode, setMode] = useState<ModePaiement>('especes');
  const [echeance, setEcheance] = useState('');
  const [note, setNote] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  const lignesNum = lignes.map((l) => ({ libelle: l.libelle, quantite: versNombre(l.quantite), prixUnitaire: versNombre(l.prix) }));
  const utiles = lignesNum.filter((l, i) => l.libelle.trim() || lignes[i]!.prix.trim());
  const total = detaille ? totalLignes(utiles.map((l) => ({ ...l, quantite: l.quantite || 0, prixUnitaire: l.prixUnitaire || 0 })), versNombre(remise) || 0) : versNombre(montant) || 0;
  const connu = carnet.find((t) => t.nom.toLowerCase() === tiers.trim().toLowerCase());
  const numeroAuto = sens === 'recette' && detaille ? prochainNumeroFacture(operations, Number(date.slice(0, 4))) : '';

  const majLigne = (i: number, champ: keyof LigneSaisie, v: string) => setLignes(lignes.map((l, k) => (k === i ? { ...l, [champ]: v } : l)));

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const a: Annulation = await repo.ajouterOperation({
        sens, categorie, date, lotId: lotId || null, tiers, telephoneTiers: telephone, note,
        paye: reglage === 'tout', mode,
        aValider: sens === 'depense' && !peutValiderDepense(elevage.moi.droits, categorie),
        paiementAValider: sens === 'depense' && !aDroit(elevage.moi.droits, 'finances.valider_paiement'),
        ...(reglage === 'acompte' ? { acompte: versNombre(acompte) } : {}),
        ...(reglage !== 'tout' && echeance ? { echeance } : {}),
        ...(numero.trim() ? { numero } : {}),
        ...(detaille ? { lignes: utiles.map((l) => ({ ...l, quantite: l.quantite, prixUnitaire: l.prixUnitaire })), remise: versNombre(remise) || 0 } : { montant: versNombre(montant) }),
      });
      notifier(sens === 'depense' ? (peutValiderDepense(elevage.moi.droits, categorie) ? 'Dépense notée ✓' : 'Dépense notée ✓ : elle attend la validation d’un responsable') : detaille ? 'Facture enregistrée ✓' : 'Recette notée ✓', { annuler: () => repo.annuler(a) });
      aller(detaille && sens === 'recette' ? `finances/op/${a.id}` : 'finances');
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Enregistrement impossible.');
    }
  };

  return (
    <form onSubmit={soumettre}>
      <Retour vers="finances" />
      <h2>{sens === 'depense' ? 'Noter une dépense' : 'Noter une recette'}</h2>

      {detaille ? (
        <fieldset className="carte">
          <legend>{sens === 'recette' ? 'Lignes de la facture' : 'Détail de l’achat'}</legend>
          {lignes.map((l, i) => (
            <div key={i} className="ligne-facture">
              <Champ libelle={`Article ${i + 1}`}><input value={l.libelle} onChange={(e) => majLigne(i, 'libelle', e.target.value)} placeholder={sens === 'recette' ? 'Plateaux d’œufs' : 'Sacs d’aliment ponte'} /></Champ>
              <div className="duo">
                <Champ libelle="Quantité"><input inputMode="decimal" value={l.quantite} onChange={(e) => majLigne(i, 'quantite', e.target.value)} /></Champ>
                <Champ libelle="Prix unitaire (FCFA)"><input inputMode="numeric" value={l.prix} onChange={(e) => majLigne(i, 'prix', e.target.value)} /></Champ>
              </div>
              {lignes.length > 1 && <button type="button" className="lien danger" onClick={() => setLignes(lignes.filter((_, k) => k !== i))}>Retirer cette ligne</button>}
            </div>
          ))}
          <button type="button" className="bouton alt court" onClick={() => setLignes([...lignes, { ...LIGNE_VIDE }])}>+ Ajouter une ligne</button>
          <Champ libelle="Remise (FCFA, facultatif)"><input inputMode="numeric" value={remise} onChange={(e) => setRemise(e.target.value)} /></Champ>
          <p className="total"><span>Total</span> <b className="montant">{formatMontant(total)}</b></p>
          <button type="button" className="lien" onClick={() => setDetaille(false)}>Revenir à un simple montant</button>
        </fieldset>
      ) : (
        <>
          <Champ libelle="Montant (FCFA)"><Nombre valeur={montant} onChange={setMontant} min={0} pas={500} unite="FCFA" /></Champ>
          <button type="button" className="lien" onClick={() => setDetaille(true)}>{sens === 'recette' ? 'Faire une facture détaillée (lignes, remise, numéro)' : 'Détailler l’achat ligne par ligne'}</button>
        </>
      )}

      <Champ libelle={sens === 'depense' ? 'Pour quoi ?' : 'Vente de quoi ?'}>
        <select value={categorie} onChange={(e) => setCategorie(e.target.value)}>{categories.map((c) => <option key={c} value={c}>{LIBELLES_CATEGORIES[c]}</option>)}</select>
      </Champ>
      <Champ libelle="Lot concerné (facultatif)">
        <select value={lotId} onChange={(e) => setLotId(e.target.value)}>
          <option value="">Aucun, pour tout l’élevage</option>
          {donnees.lots.filter((l) => !l.archive).map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}
        </select>
      </Champ>
      <Champ libelle={sens === 'depense' ? 'Fournisseur (facultatif)' : 'Client (facultatif)'}>
        <input list="liste-tiers" value={tiers} onChange={(e) => setTiers(e.target.value)} autoComplete="off" />
      </Champ>
      <datalist id="liste-tiers">{carnet.map((t) => <option key={t.id} value={t.nom} />)}</datalist>
      {tiers.trim() && !connu && (
        <Champ libelle="Son téléphone (facultatif)" aide="Il sera gardé dans votre carnet, pour le joindre ou le relancer par WhatsApp."><input type="tel" inputMode="tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} /></Champ>
      )}
      {(detaille || sens === 'depense') && (
        <Champ libelle={sens === 'recette' ? 'Numéro de facture' : 'Numéro de la facture du fournisseur (facultatif)'} aide={sens === 'recette' ? `Laissez vide pour ${numeroAuto}.` : undefined}>
          <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder={numeroAuto} />
        </Champ>
      )}
      <Champ libelle="Date"><input type="date" value={date} max={auj} onChange={(e) => setDate(e.target.value)} /></Champ>

      <fieldset className="carte">
        <legend>{sens === 'depense' ? 'Paiement' : 'Encaissement'}</legend>
        <label className="case"><input type="radio" name="reglage" checked={reglage === 'tout'} onChange={() => setReglage('tout')} /> {sens === 'depense' ? 'Payé en totalité' : 'Encaissé en totalité'}</label>
        <label className="case"><input type="radio" name="reglage" checked={reglage === 'acompte'} onChange={() => setReglage('acompte')} /> {sens === 'depense' ? 'Une partie payée (acompte)' : 'Un acompte reçu'}</label>
        <label className="case"><input type="radio" name="reglage" checked={reglage === 'rien'} onChange={() => setReglage('rien')} /> {sens === 'depense' ? 'Pas encore payé' : 'Pas encore encaissé'}</label>
        {reglage === 'acompte' && <Champ libelle="Montant de l’acompte (FCFA)"><Nombre valeur={acompte} onChange={setAcompte} min={0} pas={500} unite="FCFA" /></Champ>}
        {reglage !== 'rien' && (
          <Champ libelle="Moyen de paiement">
            <select value={mode} onChange={(e) => setMode(e.target.value as ModePaiement)}>{MODES_PAIEMENT.map((m) => <option key={m} value={m}>{LIBELLES_MODES[m]}</option>)}</select>
          </Champ>
        )}
        {reglage !== 'tout' && <Champ libelle="À régler avant le (facultatif)"><input type="date" value={echeance} min={date} onChange={(e) => setEcheance(e.target.value)} /></Champ>}
      </fieldset>

      <Champ libelle="Remarque (facultatif)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={!(total > 0)}>Enregistrer</button>
    </form>
  );
}
