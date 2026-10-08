import { useState, type FormEvent } from 'react';
import {
  CATEGORIES_DEPENSE,
  CATEGORIES_RECETTE,
  LIBELLES_CATEGORIES,
  coutAlimentParOeuf,
  enAttente,
  exporterCsv,
  jourLocal,
  lignesFinance,
  moisDecale,
  parCategorie,
  parLot,
  resume,
  type LigneFinance,
  type SensOperation,
} from '@digitalab/core';
import { Champ, Nombre, Retour, useNotifier, versNombre } from '../components/ui';
import { ErreurSaisie, repo, type Annulation } from '../repo';
import { dateCourte, formatMontant, signe } from '../format';
import { aller } from '../route';
import type { Elevage } from '../useElevage';

const nomMois = (p: string) => new Date(`${p}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export function PageFinances({ elevage }: { elevage: Elevage }) {
  const { donnees, operations, noms, maintenant } = elevage;
  const notifier = useNotifier();
  const moisCourant = jourLocal(maintenant).slice(0, 7);
  const [mois, setMois] = useState(moisCourant);
  const lignes = lignesFinance(operations, donnees.entreesStock);
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
        <a className="bouton court" href="#/finances/depense">− Dépense</a>
        <a className="bouton court" href="#/finances/recette">+ Recette</a>
      </div>

      <div className="mois" role="group" aria-label="Choix du mois">
        <button className="lien" onClick={() => setMois(moisDecale(mois, -1))} aria-label="Mois précédent">←</button>
        <b>{nomMois(mois)}</b>
        <button className="lien" onClick={() => setMois(moisDecale(mois, 1))} disabled={mois >= moisCourant} aria-label="Mois suivant">→</button>
      </div>

      <div className="tuiles">
        <div className="tuile"><b>{formatMontant(r.recettes)}</b><span>recettes</span></div>
        <div className="tuile"><b>{formatMontant(r.depenses)}</b><span>dépenses</span></div>
      </div>
      <div className={`bandeau n-${r.resultat < 0 ? 'orange' : 'vert'}`}>
        <strong>Résultat du mois : {signe(r.resultat)} {formatMontant(r.resultat)}</strong>
      </div>
      {coutOeuf !== null && <p className="muet">Aliment acheté ce mois-ci : environ {coutOeuf} FCFA par œuf produit (estimation).</p>}

      {(attente.aEncaisser.length > 0 || attente.aPayer.length > 0) && (
        <>
          <h2>En attente</h2>
          {attente.aEncaisser.map((l) => <LigneAttente key={l.cle} ligne={l} libelle="À encaisser" />)}
          {attente.aPayer.map((l) => <LigneAttente key={l.cle} ligne={l} libelle="À payer" />)}
          <p className="muet">On vous doit {formatMontant(attente.totalAEncaisser)} · vous devez {formatMontant(attente.totalAPayer)}.</p>
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
              <span>{dateCourte(l.date)} · {LIBELLES_CATEGORIES[l.categorie] ?? l.categorie}{l.lotId ? ` · ${noms.lot(l.lotId)}` : ''}{l.tiers ? ` · ${l.tiers}` : ''}{l.automatique ? ' · achat d’aliment' : ''}</span>
              <b className={l.sens === 'recette' ? 'gain' : ''}>{l.sens === 'recette' ? '+' : '−'} {formatMontant(l.montant)}</b>
              {!l.automatique && <button className="lien" onClick={() => { if (window.confirm('Annuler cette ligne ?')) void repo.annuler({ table: 'operations', id: l.cle }); }}>Annuler</button>}
            </div>
          ))}
        </div>
      )}

      {lots.length > 0 && (
        <>
          <h2>Par lot</h2>
          <div className="carte">
            {lots.map((l) => (
              <div key={l.lotId} className="ligne"><span>{noms.lot(l.lotId)}<br /><small className="muet">recettes {formatMontant(l.recettes)} · dépenses {formatMontant(l.depenses)}</small></span><b>{signe(l.resultat)} {formatMontant(l.resultat)}</b></div>
            ))}
          </div>
        </>
      )}

      <h2>Pour votre comptable</h2>
      <div className="carte">
        <p className="muet">Un fichier avec toutes vos dépenses et recettes, lisible dans Excel. Il n’ouvre aucun compte et n’est pas un document comptable officiel.</p>
        <button className="bouton alt" onClick={exporter}>Télécharger le fichier (CSV)</button>
      </div>
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
            <div className="ligne"><span>{LIBELLES_CATEGORIES[l.categorie] ?? l.categorie}</span><b>{formatMontant(l.montant)}</b></div>
            <progress max={max} value={l.montant} aria-label={LIBELLES_CATEGORIES[l.categorie]} />
          </div>
        ))}
      </div>
    </>
  );
}

function LigneAttente({ ligne, libelle }: { ligne: LigneFinance; libelle: string }) {
  const notifier = useNotifier();
  return (
    <div className="carte">
      <h3>{libelle} : {formatMontant(ligne.montant)}</h3>
      <p className="muet">{LIBELLES_CATEGORIES[ligne.categorie]}{ligne.tiers ? ` · ${ligne.tiers}` : ''} · du {dateCourte(ligne.date)}</p>
      <button className="bouton alt court" onClick={async () => { await repo.marquerPaye(ligne.cle, true); notifier(ligne.sens === 'recette' ? 'Encaissé ✓' : 'Payé ✓'); }}>
        {ligne.sens === 'recette' ? 'C’est encaissé' : 'C’est payé'}
      </button>
    </div>
  );
}

export function FormOperation({ elevage, sens, lotInitial }: { elevage: Elevage; sens: SensOperation; lotInitial: string | null }) {
  const { donnees, maintenant } = elevage;
  const notifier = useNotifier();
  const categories = sens === 'depense' ? CATEGORIES_DEPENSE : CATEGORIES_RECETTE;
  const [montant, setMontant] = useState('');
  const [categorie, setCategorie] = useState<string>(categories[0]);
  const [lotId, setLotId] = useState(lotInitial ?? '');
  const [tiers, setTiers] = useState('');
  const [aPayerPlusTard, setAPayerPlusTard] = useState(false);
  const [date, setDate] = useState(jourLocal(maintenant));
  const [erreur, setErreur] = useState<string | null>(null);

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const a: Annulation = await repo.ajouterOperation({ sens, categorie, montant: versNombre(montant), date, lotId: lotId || null, tiers, paye: !aPayerPlusTard });
      notifier(sens === 'depense' ? 'Dépense notée ✓' : 'Recette notée ✓', { annuler: () => repo.annuler(a) });
      aller('finances');
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Enregistrement impossible.');
    }
  };

  return (
    <form onSubmit={soumettre}>
      <Retour vers="finances" />
      <h2>{sens === 'depense' ? 'Noter une dépense' : 'Noter une recette'}</h2>
      <Champ libelle="Montant (FCFA)"><Nombre valeur={montant} onChange={setMontant} min={0} pas={500} unite="FCFA" /></Champ>
      <Champ libelle={sens === 'depense' ? 'Pour quoi ?' : 'Vente de quoi ?'}>
        <select value={categorie} onChange={(e) => setCategorie(e.target.value)}>{categories.map((c) => <option key={c} value={c}>{LIBELLES_CATEGORIES[c]}</option>)}</select>
      </Champ>
      <Champ libelle="Lot concerné (facultatif)">
        <select value={lotId} onChange={(e) => setLotId(e.target.value)}>
          <option value="">Aucun, pour tout l’élevage</option>
          {donnees.lots.filter((l) => !l.archive).map((l) => <option key={l.id} value={l.id}>{l.nom}</option>)}
        </select>
      </Champ>
      <Champ libelle={sens === 'depense' ? 'Fournisseur (facultatif)' : 'Client (facultatif)'}><input value={tiers} onChange={(e) => setTiers(e.target.value)} /></Champ>
      <Champ libelle="Date"><input type="date" value={date} max={jourLocal(maintenant)} onChange={(e) => setDate(e.target.value)} /></Champ>
      <label className="case"><input type="checkbox" checked={aPayerPlusTard} onChange={(e) => setAPayerPlusTard(e.target.checked)} /> {sens === 'depense' ? 'Pas encore payé' : 'Pas encore encaissé'}</label>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={!montant}>Enregistrer</button>
    </form>
  );
}
