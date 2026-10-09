import { useState, type FormEvent } from 'react';
import { CATEGORIES_PAIE, LIBELLES_MODES, MODES_PAIEMENT, jourLocal, moisDecale, suiviSalaires, type ModePaiement, type NatureSalaire, type OperationFinanciere } from '@digitalab/core';
import { Si } from '../components/Si';
import { Champ, Nombre, Retour, useNotifier, versNombre, useConfirmer } from '../components/ui';
import { dateCourte, formatMontant } from '../format';
import { ErreurSaisie, repo } from '../repo';
import { profilDe } from '../droits';
import { aller } from '../route';
import { EnteteElevage } from './Operation';
import type { Elevage } from '../useElevage';

const nomMois = (p: string) => new Date(`${p}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const LIBELLE_STATUT = { paye: 'Soldé ✓', partiel: 'Partiellement versé', a_payer: 'À payer' } as const;

export function PageSalaires({ elevage, moisInitial }: { elevage: Elevage; moisInitial: string | null }) {
  const { employes, operations, maintenant } = elevage;
  const moisCourant = jourLocal(maintenant).slice(0, 7);
  const [mois, setMois] = useState(moisInitial && /^\d{4}-\d{2}$/.test(moisInitial) ? moisInitial : moisCourant);
  const suivi = suiviSalaires(employes, operations, mois);
  const masse = suivi.reduce((a, s) => a + s.verse + s.primes, 0);
  const totalDu = suivi.reduce((a, s) => a + s.du, 0);

  return (
    <>
      <Retour vers="finances" libelle="Finances" />
      <h2>Salaires</h2>
      <div className="mois" role="group" aria-label="Choix du mois">
        <button className="lien" onClick={() => setMois(moisDecale(mois, -1))} aria-label="Mois précédent">←</button>
        <b>{nomMois(mois)}</b>
        <button className="lien" onClick={() => setMois(moisDecale(mois, 1))} disabled={mois >= moisCourant} aria-label="Mois suivant">→</button>
      </div>

      {suivi.length === 0 && (
        <div className="carte muet">Aucun employé pour ce mois. Ajoutez vos aides et soigneurs pour suivre leurs salaires, avances et primes.</div>
      )}
      {suivi.length > 0 && (
        <div className="tuiles">
          <div className="tuile"><b className="montant">{formatMontant(masse)}</b><span>versé ce mois-ci</span></div>
          <div className="tuile"><b className="montant">{formatMontant(Math.max(0, totalDu - suivi.reduce((a, s) => a + s.verse, 0)))}</b><span>reste à verser</span></div>
        </div>
      )}
      {suivi.map((s) => (
        <div key={s.employe.id} className="carte">
          <h3>{s.employe.nom}{s.employe.poste ? <span className="muet"> · {s.employe.poste}</span> : null}</h3>
          <div className="ligne"><span>Salaire convenu</span><b className="montant">{formatMontant(s.du)}</b></div>
          <div className="ligne"><span>Déjà versé (salaire et avances)</span><b className="montant">{formatMontant(s.verse)}</b></div>
          {s.primes > 0 && <div className="ligne"><span>Primes</span><b className="montant">{formatMontant(s.primes)}</b></div>}
          <div className="ligne"><span><b>{LIBELLE_STATUT[s.statut]}</b></span><b>{s.reste > 0 ? `reste ${formatMontant(s.reste)}` : ''}</b></div>
          <Si elevage={elevage} droit="salaires.payer">
            <div className="rangee">
              {s.reste > 0 && <a className="bouton court" href={`#/finances/salaires/payer/${s.employe.id}?mois=${mois}&nature=salaire`}>Payer le salaire</a>}
              <a className="bouton alt court" href={`#/finances/salaires/payer/${s.employe.id}?mois=${mois}&nature=avance`}>Avance</a>
              <a className="bouton alt court" href={`#/finances/salaires/payer/${s.employe.id}?mois=${mois}&nature=prime`}>Prime</a>
            </div>
          </Si>
          <div className="actions">
            <a className="lien" href={`#/finances/salaires/bulletin/${s.employe.id}/${mois}`}>Bulletin du mois</a>
            <Si elevage={elevage} droit="salaires.gerer"><a className="lien" href={`#/finances/salaires/employe/${s.employe.id}`}>Modifier la fiche</a></Si>
          </div>
        </div>
      ))}
      <Si elevage={elevage} droit="salaires.gerer"><a className="bouton alt" href="#/finances/salaires/employe">+ Ajouter un employé</a></Si>
    </>
  );
}

export function FormEmploye({ elevage, id }: { elevage: Elevage; id?: string }) {
  const confirmer = useConfirmer();
  const notifier = useNotifier();
  const existant = id ? elevage.employes.find((e) => e.id === id) : undefined;
  const [nom, setNom] = useState(existant?.nom ?? '');
  const [poste, setPoste] = useState(existant?.poste ?? '');
  const [salaire, setSalaire] = useState(existant ? String(existant.salaire) : '');
  const [telephone, setTelephone] = useState(existant?.telephone ?? '');
  const [debut, setDebut] = useState(existant?.debut ?? '');
  const [fin, setFin] = useState(existant?.fin ?? '');
  const [erreur, setErreur] = useState<string | null>(null);
  if (id && !existant) return <><Retour vers="finances/salaires" /><div className="carte muet">Cet employé n’existe plus.</div></>;

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await repo.enregistrerEmploye({ ...(id ? { id } : {}), nom, poste, salaire: versNombre(salaire), telephone, debut, fin });
      notifier('Employé enregistré ✓');
      aller('finances/salaires');
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Enregistrement impossible.');
    }
  };

  return (
    <form onSubmit={soumettre}>
      <Retour vers="finances/salaires" />
      <h2>{id ? 'Fiche de l’employé' : 'Nouvel employé'}</h2>
      <Champ libelle="Nom"><input value={nom} onChange={(e) => setNom(e.target.value)} /></Champ>
      <Champ libelle="Poste (facultatif)"><input value={poste} onChange={(e) => setPoste(e.target.value)} placeholder="Soigneur, aide, gardien…" /></Champ>
      <Champ libelle="Salaire mensuel (FCFA)"><Nombre valeur={salaire} onChange={setSalaire} min={0} pas={5000} unite="FCFA" /></Champ>
      <Champ libelle="Téléphone (facultatif)"><input type="tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} /></Champ>
      <Champ libelle="Premier mois payé (facultatif)" aide="Format 2026-10. Avant ce mois, il n’apparaît pas dans les salaires."><input value={debut} onChange={(e) => setDebut(e.target.value)} placeholder="2026-10" /></Champ>
      <Champ libelle="Dernier mois payé (facultatif)" aide="À remplir quand la personne quitte l’élevage : elle disparaît des mois suivants, ses paies restent dans les comptes."><input value={fin} onChange={(e) => setFin(e.target.value)} placeholder="2027-03" /></Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton">Enregistrer</button>
      {id && (
        <button type="button" className="lien danger" onClick={async () => { if (await confirmer('Retirer cet employé de la liste ? Ses paies passées restent dans vos comptes.')) { await repo.supprimerEmploye(id); aller('finances/salaires'); } }}>
          Retirer de la liste
        </button>
      )}
    </form>
  );
}

export function FormPaie({ elevage, employeId, periode, nature }: { elevage: Elevage; employeId: string; periode: string; nature: NatureSalaire }) {
  const notifier = useNotifier();
  const employe = elevage.employes.find((e) => e.id === employeId);
  const suivi = suiviSalaires(elevage.employes, elevage.operations, periode).find((s) => s.employe.id === employeId);
  const [montant, setMontant] = useState(nature === 'salaire' && suivi ? String(suivi.reste) : '');
  const [mode, setMode] = useState<ModePaiement>('especes');
  const [date, setDate] = useState(jourLocal(elevage.maintenant));
  const [note, setNote] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  if (!employe) return <><Retour vers="finances/salaires" /><div className="carte muet">Cet employé n’existe plus.</div></>;

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const a = await repo.payerSalaire({ employeId, periode, montant: versNombre(montant), nature, mode, date, note });
      notifier(`${CATEGORIES_PAIE[nature]} noté ✓`, { annuler: () => repo.annuler(a) });
      aller(`finances/salaires?mois=${periode}`);
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Enregistrement impossible.');
    }
  };

  return (
    <form onSubmit={soumettre}>
      <Retour vers={`finances/salaires?mois=${periode}`} />
      <h2>{CATEGORIES_PAIE[nature]} · {employe.nom}</h2>
      <p className="muet">Pour {nomMois(periode)}{suivi ? ` · salaire convenu ${formatMontant(suivi.du)}, déjà versé ${formatMontant(suivi.verse)}` : ''}.</p>
      <Champ libelle="Montant (FCFA)"><Nombre valeur={montant} onChange={setMontant} min={0} pas={5000} unite="FCFA" /></Champ>
      <Champ libelle="Moyen de paiement">
        <select value={mode} onChange={(e) => setMode(e.target.value as ModePaiement)}>{MODES_PAIEMENT.map((m) => <option key={m} value={m}>{LIBELLES_MODES[m]}</option>)}</select>
      </Champ>
      <Champ libelle="Date"><input type="date" value={date} max={jourLocal(elevage.maintenant)} onChange={(e) => setDate(e.target.value)} /></Champ>
      <Champ libelle="Remarque (facultatif)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={!montant}>Enregistrer</button>
    </form>
  );
}

/** Bulletin simplifié du mois, à imprimer ou à enregistrer en PDF. Récapitule ce qui a été versé : ce n'est pas un bulletin de paie légal. */
export function PageBulletin({ elevage, employeId, periode }: { elevage: Elevage; employeId: string; periode: string }) {
  const employe = elevage.employes.find((e) => e.id === employeId);
  if (!employe) return <><Retour vers="finances/salaires" /><div className="carte muet">Cet employé n’existe plus.</div></>;
  const versements = elevage.operations
    .filter((o: OperationFinanciere) => o.employeId === employeId && o.periode === periode)
    .sort((a, b) => a.date.localeCompare(b.date));
  const modes = new Map(elevage.paiements.map((p) => [p.operationId, p.mode]));
  const suivi = suiviSalaires(elevage.employes, elevage.operations, periode).find((s) => s.employe.id === employeId);
  const profil = profilDe(elevage);
  const total = versements.reduce((a, o) => a + o.montant, 0);

  return (
    <>
      <div className="sans-impression">
        <Retour vers={`finances/salaires?mois=${periode}`} />
        <button className="bouton" onClick={() => window.print()}>Imprimer ou enregistrer en PDF</button>
      </div>
      <article className="document">
        <header className="doc-entete">
          <EnteteElevage profil={profil} />
          <div className="doc-titre">
            <h2>RÉCAPITULATIF DE PAIE</h2>
            <p>{nomMois(periode)}</p>
          </div>
        </header>
        <p className="doc-client"><b>Employé :</b> {employe.nom}{employe.poste ? ` · ${employe.poste}` : ''}</p>
        <table>
          <thead><tr><th>Date</th><th>Nature</th><th>Moyen</th><th>Montant</th></tr></thead>
          <tbody>
            {versements.length === 0 && <tr><td colSpan={4}>Aucun versement ce mois-ci.</td></tr>}
            {versements.map((o) => (
              <tr key={o.id}><td>{dateCourte(o.date)}</td><td>{CATEGORIES_PAIE[o.nature ?? 'salaire']}</td><td>{modes.get(o.id) ? LIBELLES_MODES[modes.get(o.id)!] : '–'}</td><td>{formatMontant(o.montant)}</td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>Salaire mensuel convenu</td><td>{formatMontant(employe.salaire)}</td></tr>
            <tr><td colSpan={3}><b>Total versé</b></td><td><b className="montant">{formatMontant(total)}</b></td></tr>
            {suivi && suivi.reste > 0 && <tr><td colSpan={3}>Reste à verser</td><td>{formatMontant(suivi.reste)}</td></tr>}
          </tfoot>
        </table>
        <div className="signatures"><span>Signature de l’employeur</span><span>Signature de l’employé</span></div>
        <p className="doc-pied">Récapitulatif de gestion établi avec AviMaster. Il ne remplace pas un bulletin de paie réglementaire (cotisations sociales, impôts).</p>
      </article>
    </>
  );
}
