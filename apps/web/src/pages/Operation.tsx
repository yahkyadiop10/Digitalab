import { useState, type FormEvent } from 'react';
import { LIBELLES_CATEGORIES, LIBELLES_MODES, MODES_PAIEMENT, aDroit, jourLocal, normaliserTelephone, peutValiderDepense, reglement, totalLignes, type ModePaiement, type OperationFinanciere, type Paiement } from '@digitalab/core';
import { Champ, Nombre, Retour, useNotifier, versNombre } from '../components/ui';
import { dateCourte, formatMontant } from '../format';
import { profilDe } from '../droits';
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

/** En-tête des documents imprimés : logo, nom et coordonnées de l'élevage. */
export function EnteteElevage({ profil }: { profil: ReturnType<typeof profilDe> }) {
  return (
    <div>
      {profil.logo && <img className="logo-elevage" src={profil.logo} alt="" />}
      <h1>{profil.nom}</h1>
      {profil.adresse && <p>{profil.adresse}</p>}
      {profil.telephone && <p>Tél. {profil.telephone}</p>}
      {profil.ninea && <p>NINEA / RC : {profil.ninea}</p>}
    </div>
  );
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
  const droits = elevage.moi.droits;
  const peutAnnulerOp = recette ? aDroit(droits, 'finances.annuler_vente') : aDroit(droits, 'finances.annuler_depense');
  const peutValiderOp = !recette && (op.employeId ? aDroit(droits, 'salaires.payer') : peutValiderDepense(droits, op.categorie));
  const peutValiderPaiement = !recette && (aDroit(droits, 'finances.valider_paiement') || aDroit(droits, 'salaires.payer'));
  const peutRegler = recette ? aDroit(droits, 'finances.encaisser') : aDroit(droits, 'finances.payer') || aDroit(droits, 'salaires.payer');

  const enregistrer = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const a = await repo.ajouterPaiement(op.id, versNombre(montant || String(reste)), mode, date, !recette && !peutValiderPaiement);
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

      {op.statut === 'a_valider' && (
        <div className="bandeau n-jaune" role="status">
          <strong>À valider</strong>
          <span>Cette dépense ne compte pas encore dans vos chiffres.</span>
          {peutValiderOp && (
            <span className="rangee">
              <button className="bouton court" onClick={async () => { await repo.valider({ table: 'operations', id: op.id }); notifier('Dépense validée ✓'); }}>Valider</button>
              <button className="bouton alt court" onClick={async () => { if (window.confirm('Refuser cette dépense ? Elle sera annulée.')) { await repo.annuler({ table: 'operations', id: op.id }); aller('finances'); } }}>Refuser</button>
            </span>
          )}
        </div>
      )}
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
            <span>
              {dateCourte(p.date)} · {LIBELLES_MODES[p.mode]}
              {p.statut === 'a_valider' && <><br /><small className="erreur">à valider, ne compte pas encore</small></>}
              <br /><a className="lien" href={`#/finances/recu/${p.id}`}>Reçu</a>
              {p.statut === 'a_valider' && peutValiderPaiement && <> · <button className="lien" onClick={async () => { await repo.valider({ table: 'paiements', id: p.id }); notifier('Paiement validé ✓'); }}>Valider</button></>}
            </span>
            <b className="montant">{formatMontant(p.montant)}</b>
            {peutAnnulerOp && <button className="lien" onClick={() => { if (window.confirm('Annuler ce règlement ?')) void repo.annuler({ table: 'paiements', id: p.id }); }}>Annuler</button>}
          </div>
        ))}
        {ancienReglement && <p className="muet">Réglé en totalité (saisie sans détail du moyen de paiement).</p>}
        <div className="ligne"><span>{recette ? 'Déjà encaissé' : 'Déjà payé'}</span><b className="montant">{formatMontant(regle)}</b></div>
        <div className="ligne"><span><b>Reste</b></span><b className={reste > 0 ? 'montant' : 'montant gain'}>{reste > 0 ? formatMontant(reste) : 'Soldé ✓'}</b></div>
      </div>

      {reste > 0 && peutRegler && op.statut !== 'a_valider' && (
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
        {peutAnnulerOp && <button
          className="lien danger"
          onClick={async () => {
            if (!window.confirm('Annuler cette opération et ses règlements ? Elle ne comptera plus dans vos chiffres.')) return;
            await repo.annuler({ table: 'operations', id: op.id });
            notifier('Opération annulée', { annuler: () => repo.restaurerOperation(op.id) });
            aller('finances');
          }}
        >
          Annuler cette opération
        </button>}
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
  const profil = profilDe(elevage);
  const recette = op.sens === 'recette';
  const lignes = op.lignes && op.lignes.length > 0 ? op.lignes : [{ libelle: LIBELLES_CATEGORIES[op.categorie] ?? op.categorie, quantite: 1, prixUnitaire: op.montant }];
  const resume = `${recette ? 'Facture' : 'Dépense'} ${op.numero ?? ''} – ${profil.nom} – total ${formatMontant(op.montant)}${reste > 0 ? `, reste ${formatMontant(reste)}` : ', soldée'}.`.replace('  ', ' ');

  return (
    <>
      <div className="sans-impression">
        <Retour vers={`finances/op/${op.id}`} />
        <button className="bouton" onClick={() => window.print()}>Imprimer ou enregistrer en PDF</button>
        {recette && <a className="bouton alt" href={lienWhatsApp(telephone, resume)} target="_blank" rel="noopener noreferrer">Envoyer le résumé par WhatsApp</a>}
      </div>
      <article className="document">
        <header className="doc-entete">
          <EnteteElevage profil={profil} />
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

/** Reçu d'un encaissement ou d'un paiement, à imprimer ou à enregistrer en PDF. */
export function PageRecu({ elevage, id }: { elevage: Elevage; id: string }) {
  const paiement = elevage.paiements.find((p) => p.id === id);
  const op = paiement ? elevage.operations.find((o) => o.id === paiement.operationId) : undefined;
  if (!paiement || !op) return <Introuvable vers="finances" />;
  const profil = profilDe(elevage);
  const recette = op.sens === 'recette';
  const telephone = elevage.tiers.find((t) => t.id === op.tiersId)?.telephone;
  const tous = elevage.paiements.filter((p) => p.operationId === op.id && p.statut !== 'a_valider').sort((a, b) => a.date.localeCompare(b.date));
  const { reste } = reglement(op, elevage.paiements.filter((p) => p.operationId === op.id));
  const resume = `Reçu de ${formatMontant(paiement.montant)} (${LIBELLES_MODES[paiement.mode]}) du ${dateLongue(paiement.date)} – ${profil.nom}${reste > 0 ? `. Reste ${formatMontant(reste)}.` : '. Soldé.'}`;
  return (
    <>
      <div className="sans-impression">
        <Retour vers={`finances/op/${op.id}`} />
        <button className="bouton" onClick={() => window.print()}>Imprimer ou enregistrer en PDF</button>
        {recette && <a className="bouton alt" href={lienWhatsApp(telephone, resume)} target="_blank" rel="noopener noreferrer">Envoyer par WhatsApp</a>}
      </div>
      <article className="document">
        <header className="doc-entete">
          <EnteteElevage profil={profil} />
          <div className="doc-titre">
            <h2>{recette ? 'REÇU' : 'REÇU DE PAIEMENT'}</h2>
            <p>Date : {dateLongue(paiement.date)}</p>
            {op.numero && <p>{recette ? 'Facture' : 'Réf.'} {op.numero}</p>}
          </div>
        </header>
        {op.tiers && <p className="doc-client"><b>{recette ? 'Reçu de' : 'Payé à'} :</b> {op.tiers}</p>}
        <table>
          <tbody>
            <tr><td>Montant {recette ? 'reçu' : 'payé'}</td><td><b>{formatMontant(paiement.montant)}</b></td></tr>
            <tr><td>Moyen de paiement</td><td>{LIBELLES_MODES[paiement.mode]}</td></tr>
            <tr><td>{LIBELLES_CATEGORIES[op.categorie] ?? op.categorie}</td><td>Total {formatMontant(op.montant)}</td></tr>
            <tr><td>Déjà {recette ? 'encaissé' : 'payé'} (avec ce règlement)</td><td>{formatMontant(tous.filter((p) => p.date <= paiement.date).reduce((a, p) => a + p.montant, 0))}</td></tr>
            <tr><td><b>{reste > 0 ? 'Reste à régler' : 'Solde'}</b></td><td><b>{reste > 0 ? formatMontant(reste) : 'Soldé ✓'}</b></td></tr>
          </tbody>
        </table>
        <div className="signatures"><span>Signature de celui qui {recette ? 'reçoit' : 'paie'}</span><span>Signature de l’autre partie</span></div>
        <p className="doc-pied">Reçu établi avec Digitalab.</p>
      </article>
    </>
  );
}
