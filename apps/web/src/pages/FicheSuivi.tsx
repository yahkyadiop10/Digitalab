import { LogoProduit, Pied } from '../components/Marque';
import { useMemo, useState } from 'react';
import { RUBRIQUES_FICHE, construireFiche, decoderFiche, encoderFiche, jourLocal, type FicheSuivi, type RubriqueFiche } from '@digitalab/core';
import { Retour, useNotifier } from '../components/ui';
import type { Elevage } from '../useElevage';

const dateCourte = (j: string) => j.split('-').reverse().join('/');
const ICONES = { vaccin: '💉', traitement: '💊', observation: '⚠️', quarantaine: '🚧' } as const;

/** Affichage en lecture seule d'une fiche, tel que l'acheteur la voit. */
export function FicheVue({ fiche }: { fiche: FicheSuivi }) {
  return (
    <article className="carte fiche">
      <p className="muet">Fiche de suivi · établie le {dateCourte(fiche.genereLe)}</p>
      <h2 style={{ marginTop: 0 }}>{fiche.nom}</h2>
      <span className="pilule">Informations déclarées par l’éleveur, non vérifiées</span>

      {fiche.identite && (
        <>
          <h3>Identité</h3>
          <div className="ligne"><span>Espèce</span><b>{fiche.identite.espece}</b></div>
          {fiche.identite.race && <div className="ligne"><span>Race</span><b>{fiche.identite.race}</b></div>}
          {fiche.identite.ageJours !== undefined && <div className="ligne"><span>Âge</span><b>{fiche.identite.ageJours} jours</b></div>}
          <div className="ligne"><span>Effectif</span><b>{fiche.identite.effectif}</b></div>
        </>
      )}
      {fiche.origine && (fiche.origine.naissance || fiche.origine.incubation) && (
        <>
          <h3>Origine</h3>
          {fiche.origine.naissance && <div className="ligne"><span>Né le</span><b>{dateCourte(fiche.origine.naissance)}</b></div>}
          {fiche.origine.incubation && <div className="ligne"><span>Issu de l’incubation</span><b>{fiche.origine.incubation}</b></div>}
        </>
      )}
      {fiche.sante && (
        <>
          <h3>Santé</h3>
          {fiche.sante.length === 0 ? <p className="muet">Aucun événement noté.</p> : fiche.sante.map((l, i) => (
            <div key={i} className="ligne"><span>{ICONES[l.type]} {dateCourte(l.date)} · {l.texte}</span></div>
          ))}
        </>
      )}
      {fiche.mortalite && (
        <>
          <h3>Mortalité</h3>
          <div className="ligne"><span>Morts enregistrées</span><b>{fiche.mortalite.deces}</b></div>
          <div className="ligne"><span>Taux</span><b>{String(fiche.mortalite.tauxPct).replace('.', ',')} %</b></div>
        </>
      )}
      {fiche.production && (
        <>
          <h3>Production</h3>
          <div className="ligne"><span>Œufs sur 30 jours</span><b>{fiche.production.oeufs30j}</b></div>
        </>
      )}
    </article>
  );
}

/** Page publique : s'ouvre depuis un lien de fiche, sans compte ni données de l'éleveur. */
export function PageFichePublique({ jeton }: { jeton: string }) {
  const fiche = useMemo(() => decoderFiche(jeton), [jeton]);
  return (
    <main className="public">
      <div className="bandeau-marque"><LogoProduit /></div>
      <header className="public-entete"><h1>Fiche de suivi d’un élevage</h1></header>
      {fiche ? <FicheVue fiche={fiche} /> : <div className="carte"><h2>Lien illisible</h2><p>Ce lien n’est pas une fiche de suivi valide. Demandez au vendeur de vous le renvoyer.</p></div>}
      <Pied />
    </main>
  );
}

/** Choix des rubriques, aperçu acheteur et lien à copier. */
export function PartageFiche({ elevage, lotId }: { elevage: Elevage; lotId: string }) {
  const { donnees, reglages, maintenant } = elevage;
  const notifier = useNotifier();
  const lot = donnees.lots.find((l) => l.id === lotId);
  const [rubriques, setRubriques] = useState<RubriqueFiche[]>(['identite', 'origine', 'sante', 'mortalite']);
  if (!lot) return (<><Retour vers="cheptel" /><div className="carte">Lot introuvable.</div></>);

  const fiche = construireFiche(lot, donnees, reglages.especes, rubriques, jourLocal(maintenant));
  const base = typeof window === 'undefined' ? '' : `${window.location.origin}${window.location.pathname}`;
  const lien = `${base}#/fiche/${encoderFiche(fiche)}`;
  const basculer = (r: RubriqueFiche) => setRubriques((c) => (c.includes(r) ? c.filter((x) => x !== r) : [...c, r]));

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(lien);
      notifier('Lien copié ✓');
    } catch {
      notifier('Copie impossible : sélectionnez le lien et copiez-le à la main.', { erreur: true });
    }
  };

  return (
    <>
      <Retour vers={`cheptel/${lot.id}`} libelle="Fiche du lot" />
      <h2>Partager la fiche de suivi</h2>
      <p className="muet">Vous choisissez ce que l’acheteur verra. Les coûts, les prix et vos notes privées ne sont jamais inclus.</p>
      <fieldset>
        <legend>Rubriques à montrer</legend>
        {(Object.keys(RUBRIQUES_FICHE) as RubriqueFiche[]).map((r) => (
          <label key={r} className="case"><input type="checkbox" checked={rubriques.includes(r)} onChange={() => basculer(r)} /> {RUBRIQUES_FICHE[r]}</label>
        ))}
      </fieldset>

      <h3>Ce que verra l’acheteur</h3>
      <FicheVue fiche={fiche} />

      <h3>Lien à envoyer</h3>
      <div className="carte">
        <p className="muet">Le lien contient la fiche telle qu’elle est aujourd’hui : elle ne change plus après l’envoi. Il fonctionne quand l’application est publiée sur internet.</p>
        <input readOnly value={lien} onFocus={(e) => e.target.select()} aria-label="Lien de la fiche" />
        <button className="bouton" onClick={copier}>Copier le lien</button>
        <p className="muet">Cette version est déclarative : rien ne prouve encore que les informations sont exactes. La signature par un vétérinaire arrivera avec les comptes.</p>
      </div>
    </>
  );
}
