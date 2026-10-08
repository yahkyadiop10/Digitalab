import { useState, type FormEvent } from 'react';
import { LIBELLES_CATEGORIES, lignesFinance, soldesParTiers } from '@digitalab/core';
import { Champ, Retour, useNotifier } from '../components/ui';
import { dateCourte, formatMontant } from '../format';
import { ErreurSaisie, repo } from '../repo';
import { aller } from '../route';
import type { Elevage } from '../useElevage';

export function PageCarnet({ elevage }: { elevage: Elevage }) {
  const { tiers, operations, paiements, donnees } = elevage;
  const soldes = soldesParTiers(lignesFinance(operations, donnees.entreesStock, paiements));
  const tries = [...tiers].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  return (
    <>
      <Retour vers="finances" libelle="Finances" />
      <h2>Clients et fournisseurs</h2>
      {tries.length === 0 && <div className="carte muet">Votre carnet se remplit tout seul : chaque nom saisi dans une vente ou une dépense y est gardé. Vous pouvez aussi ajouter quelqu’un ici.</div>}
      {tries.map((t) => {
        const s = soldes.get(t.id);
        return (
          <a key={t.id} className="carte ligne" href={`#/finances/carnet/${t.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <span>{t.nom}{t.telephone ? <><br /><small className="muet">{t.telephone}</small></> : null}</span>
            <b>{s && s.aEncaisser > 0 ? `vous doit ${formatMontant(s.aEncaisser)}` : s && s.aPayer > 0 ? `vous lui devez ${formatMontant(s.aPayer)}` : ''}</b>
          </a>
        );
      })}
      <a className="bouton alt" href="#/finances/carnet/nouveau">+ Ajouter</a>
    </>
  );
}

export function FicheTiers({ elevage, id }: { elevage: Elevage; id?: string }) {
  const notifier = useNotifier();
  const existant = id ? elevage.tiers.find((t) => t.id === id) : undefined;
  const [nom, setNom] = useState(existant?.nom ?? '');
  const [telephone, setTelephone] = useState(existant?.telephone ?? '');
  const [note, setNote] = useState(existant?.note ?? '');
  const [erreur, setErreur] = useState<string | null>(null);
  if (id && !existant) return <><Retour vers="finances/carnet" /><div className="carte muet">Cette fiche n’existe plus.</div></>;
  const siennes = id ? elevage.operations.filter((o) => o.tiersId === id).sort((a, b) => b.date.localeCompare(a.date)) : [];

  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await repo.enregistrerTiers({ ...(id ? { id } : {}), nom, telephone, note });
      notifier('Enregistré ✓');
      aller('finances/carnet');
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Enregistrement impossible.');
    }
  };

  return (
    <>
      <form onSubmit={soumettre}>
        <Retour vers="finances/carnet" />
        <h2>{id ? existant?.nom : 'Nouveau client ou fournisseur'}</h2>
        <Champ libelle="Nom"><input value={nom} onChange={(e) => setNom(e.target.value)} /></Champ>
        <Champ libelle="Téléphone (facultatif)"><input type="tel" inputMode="tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} /></Champ>
        <Champ libelle="Remarque (facultatif)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Champ>
        {erreur && <p className="erreur" role="alert">{erreur}</p>}
        <button className="bouton">Enregistrer</button>
        {id && <button type="button" className="lien danger" onClick={async () => { if (window.confirm('Retirer cette fiche du carnet ? Les opérations passées restent dans vos comptes.')) { await repo.supprimerTiers(id); aller('finances/carnet'); } }}>Retirer du carnet</button>}
      </form>
      {siennes.length > 0 && (
        <>
          <h2>Historique</h2>
          <div className="carte">
            {siennes.map((o) => (
              <div key={o.id} className="ligne">
                <a className="lien" href={`#/finances/op/${o.id}`}>{dateCourte(o.date)} · {LIBELLES_CATEGORIES[o.categorie] ?? o.categorie}{o.numero ? ` · ${o.numero}` : ''}</a>
                <b className="montant">{o.sens === 'recette' ? '+' : '−'} {formatMontant(o.montant)}</b>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
