import { useState, type FormEvent } from 'react';
import { LIBELLES_CATEGORIES, LIBELLES_MODES, MODES_PAIEMENT, jourLocal, normaliserTelephone, reglement, totalLignes, type ModePaiement, type OperationFinanciere, type Paiement } from '@digitalab/core';
import { Champ, Nombre, Retour, useNotifier, versNombre } from '../components/ui';
import { dateCourte, formatMontant } from '../format';
import { ErreurSaisie, repo } from '../repo';
import { aller } from '../route';
import type { Elevage } from '../useElevage';

const dateLongue = (j: string) => j.split('-').reverse().join('/');

/** Lien WhatsApp avec un message prêt à envoyer ; sans numéro connu, WhatsApp laisse choisir le contact. */
export function lienWhatsApp(telephone: string | undefined, message: string): string {
  const tel = telephone ? normaliserTelephone(telephone) : null;
  return `https://wa.me/${tel ? tel.slice(1) : ''}?text=${encodeURIComponent(message)}`;
}

function trouver(elevage: Elevage, id: string): { op: OperationFinanciere; paiements: Paiement[]; telephone?: string } | null {
  const op = elevage.operations.find((o) => o.id === id);
  if (!op) return null;
  const paiements = elevage.paiements.filter((p) => p.operationId === id).sort((a, b) => a.date.localeCompare(b.date));
  const telephone = elevage.tiers.find((t) => t.id === op.tiersId)?.telephone;
  return { op, paiements, ...(telephone ? { telephone } : {}) };
}

function Introuvable({ vers }: { vers: string }) {
  return (
    <>
      <Retour vers={vers} />
      <div className="carte muet">Cette ligne n’existe plus (elle a peut-être été annulée).</div>
    </>
  );
}

export function PageOperation({ elevage, id }: { elevage: Elevage; id: string }) {
  const notifier = useNotifier();
  const trouve = trouver(elevage, id);
  const [montant, setMontant] = useState('');
  const [mode, setMode] = useState<ModePaiement>('especes');
  const [date, setDate] = useState(jourLocal(elevage.maintenant));
  const [erreur, setErreur] = useState<string | null>(null);
  if (!trouve) return <Introuvable vers="finances" />;
  const { op, paiements, telephone } = trouve;
  const { regle, reste } = reglement(op, paiements);
  const recette = op.sens === 'recette';
  const ancienReglement = paiements.length === 0 && op.paye;

  const enregistrer = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const a = await repo.ajouterPaiement(op.id, versNombre(montant || String(reste)), mode, date);
      notifier(recette ? 'Encaissement noté ✓' : 'Paiement noté ✓', { annuler: () => repo.annuler(a) });
      setMontant('');
      setErreur(null);
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Enregistrement impossible.');
    }
  };

  const relance = `Bonjour${op.tiers ? ` ${op.tiers}` : ''}, je vous rappelle ${op.numero ? `la facture ${op.numero}` : 'notre vente'} du ${dateLongue(op.date)} : il reste ${formatMontant(reste)} à régler. Merci !`;

  return (
    <>
      <Retour vers="finances" />
      <h2>{recette ? (op.numero ? `Facture ${op.numero}` : 'Recette') : op.numero ? `Dépense · réf. ${op.numero}` : 'Dépense'}</h2>

      <div className="carte">
        <div className="ligne"><span>Date</span><b>{dateLongue(op.date)}</b></div>
        <div className="ligne"><span>Catégorie</span><b>{LIBELLES_CATEGORIES[op.categorie] ?? op.categorie}</b></div>
        {op.tiers && <div className="ligne"><span>{recette ? 'Client' : 'Fournisseur'}</span><b>{op.tiers}{telephone ? ` · ${telephone}` : ''}</b></div>}
        {op.lotId && <div className="ligne"><span>Lot</span><b>{elevage.noms.lot(op.lotId)}</b></div>}
        {op.echeance && <div className="ligne"><span>À régler avant le</span><b>{dateLongue(op.echeance)}</b></div>}
        {op.note && <p className="muet">{op.note}</p>}
      </div>

      {op.lignes && op.lignes.length > 0 && (
        <div className="carte">
          {op.lignes.map((l, i) => (
            <div key={i} className="ligne"><span>{l.libelle}<br /><small className="muet">{String(l.quantite).replace('.', ',')} × {formatMontant(l.prixUnitaire)}</small></span><b className="montant">{formatMontant(Math.round(l.quantite * l.prixUnitaire))}</b></div>
          ))}
          {op.remise ? <div className="ligne"><span>Remise</span><b>− {formatMontant(op.remise)}</b></div> : null}
          <div className="ligne"><span><b>Total</b></span><b className="montant">{formatMontant(totalLignes(op.lignes, op.remise ?? 0))}</b></div>
        </div>
      )}

      <h2>{recette ? 'Encaissements' : 'Paiements'}</h2>
      <div className="carte">
        <div className="ligne"><span>Total</span><b className="montant">{formatMontant(op.montant)}</b></div>
        {paiements.map((p) => (
          <div key={p.id} className="ligne">
            <span>{dateCourte(p.date)} · {LIBELLES_MODES[p.mode]}</span>
            <b className="montant">{formatMontant(p.montant)}</b>
            <button className="lien" onClick={() => { if (window.confirm('Annuler ce règlement ?')) void repo.annuler({ table: 'paiements', id: p.id }); }}>Annuler</button>
          </div>
        ))}
        {ancienReglement && <p className="muet">Réglé en totalité (saisie sans détail du moyen de paiement).</p>}
        <div className="ligne"><span>{recette ? 'Déjà encaissé' : 'Déjà payé'}</span><b className="montant">{formatMontant(regle)}</b></div>
        <div className="ligne"><span><b>Reste</b></span><b className={reste > 0 ? 'montant' : 'montant gain'}>{reste > 0 ? formatMontant(reste) : 'Soldé ✓'}</b></div>
      </div>

      {reste > 0 && (
        <form className="carte" onSubmit={enregistrer}>
          <p><b>{recette ? 'Noter un encaissement' : 'Noter un paiement'}</b></p>
          <Champ libelle="Montant (FCFA)" aide={`Laissez vide pour le solde : ${formatMontant(reste)}.`}><Nombre valeur={montant} onChange={setMontant} min={0} pas={500} unite="FCFA" /></Champ>
          <Champ libelle="Moyen de paiement">
            <select value={mode} onChange={(e) => setMode(e.target.value as ModePaiement)}>{MODES_PAIEMENT.map((m) => <option key={m} value={m}>{LIBELLES_MODES[m]}</option>)}</select>
          </Champ>
          <Champ libelle="Date"><input type="date" value={date} max={jourLocal(elevage.maintenant)} min={op.date} onChange={(e) => setDate(e.target.value)} /></Champ>
          {erreur && <p className="erreur" role="alert">{erreur}</p>}
          <button className="bouton">Enregistrer</button>
        </form>
      )}

      <div className="carte">
        {(recette || (op.lignes && op.lignes.length > 0)) && <a className="bouton alt" href={`#/finances/op/${op.id}/facture`}>{recette ? 'Voir et imprimer la facture' : 'Voir le récapitulatif'}</a>}
        {recette && reste > 0 && <a className="bouton alt" href={lienWhatsApp(telephone, relance)} target="_blank" rel="noopener noreferrer">Relancer par WhatsApp</a>}
        <button
          className="lien danger"
          onClick={async () => {
            if (!window.confirm('Annuler cette opération et ses règlements ? Elle ne comptera plus dans vos chiffres.')) return;
            await repo.annuler({ table: 'operations', id: op.id });
            notifier('Opération annulée', { annuler: () => repo.restaurerOperation(op.id) });
            aller('finances');
          }}
        >
          Annuler cette opération
        </button>
      </div>
    </>
  );
}

/** Facture à imprimer ou à enregistrer en PDF depuis le navigateur. */
export function PageFacture({ elevage, id }: { elevage: Elevage; id: string }) {
  const trouve = trouver(elevage, id);
  if (!trouve) return <Introuvable vers="finances" />;
  const { op, paiements, telephone } = trouve;
  const { regle, reste } = reglement(op, paiements);
  const { nomElevage, identite } = elevage.reglages;
  const recette = op.sens === 'recette';
  const lignes = op.lignes && op.lignes.length > 0 ? op.lignes : [{ libelle: LIBELLES_CATEGORIES[op.categorie] ?? op.categorie, quantite: 1, prixUnitaire: op.montant }];
  const resume = `${recette ? 'Facture' : 'Dépense'} ${op.numero ?? ''} – ${nomElevage || 'Mon élevage'} – total ${formatMontant(op.montant)}${reste > 0 ? `, reste ${formatMontant(reste)}` : ', soldée'}.`.replace('  ', ' ');

  return (
    <>
      <div className="sans-impression">
        <Retour vers={`finances/op/${op.id}`} />
        <button className="bouton" onClick={() => window.print()}>Imprimer ou enregistrer en PDF</button>
        {recette && <a className="bouton alt" href={lienWhatsApp(telephone, resume)} target="_blank" rel="noopener noreferrer">Envoyer le résumé par WhatsApp</a>}
      </div>
      <article className="document">
        <header className="doc-entete">
          <div>
            <h1>{nomElevage || 'Mon élevage'}</h1>
            {identite.adresse && <p>{identite.adresse}</p>}
            {identite.telephone && <p>Tél. {identite.telephone}</p>}
            {identite.ninea && <p>NINEA / RC : {identite.ninea}</p>}
          </div>
          <div className="doc-titre">
            <h2>{recette ? 'FACTURE' : 'DÉPENSE'}</h2>
            {op.numero && <p><b>N° {op.numero}</b></p>}
            <p>Date : {dateLongue(op.date)}</p>
            {op.echeance && reste > 0 && <p>À régler avant le {dateLongue(op.echeance)}</p>}
          </div>
        </header>
        {op.tiers && <p className="doc-client"><b>{recette ? 'Client' : 'Fournisseur'} :</b> {op.tiers}{telephone ? ` · ${telephone}` : ''}</p>}
        <table>
          <thead><tr><th>Désignation</th><th>Qté</th><th>Prix unitaire</th><th>Montant</th></tr></thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i}><td>{l.libelle}</td><td>{String(l.quantite).replace('.', ',')}</td><td>{formatMontant(l.prixUnitaire)}</td><td>{formatMontant(Math.round(l.quantite * l.prixUnitaire))}</td></tr>
            ))}
          </tbody>
          <tfoot>
            {op.remise ? <tr><td colSpan={3}>Remise</td><td>− {formatMontant(op.remise)}</td></tr> : null}
            <tr><td colSpan={3}><b>Total</b></td><td><b className="montant">{formatMontant(op.montant)}</b></td></tr>
            {paiements.map((p) => <tr key={p.id}><td colSpan={3}>Réglé le {dateLongue(p.date)} ({LIBELLES_MODES[p.mode]})</td><td>{formatMontant(p.montant)}</td></tr>)}
            {paiements.length === 0 && regle > 0 && <tr><td colSpan={3}>Réglé</td><td>{formatMontant(regle)}</td></tr>}
            <tr><td colSpan={3}><b>{reste > 0 ? 'Reste à payer' : 'Facture soldée'}</b></td><td><b className="montant">{formatMontant(reste)}</b></td></tr>
          </tfoot>
        </table>
        {op.note && <p>{op.note}</p>}
        <p className="doc-pied">Document de gestion établi avec Digitalab. Il ne remplace pas une facture normalisée lorsque celle-ci est exigée.</p>
      </article>
    </>
  );
}
