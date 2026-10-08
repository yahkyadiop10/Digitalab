import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { stockAlimentKg } from '@digitalab/core';
import { Champ, Nombre, Retour, useNotifier, versNombre } from '../components/ui';
import { CAUSES_DECES } from '../i18n/fr';
import { ErreurSaisie, repo, type Annulation } from '../repo';
import { peut, TUILES_SAISIE } from '../droits';
import { aller } from '../route';
import type { Elevage } from '../useElevage';

type Type = 'ponte' | 'aliment' | 'deces' | 'sortie' | 'stock';

const MENU: { type: Type; icone: string; titre: string; aide: string }[] = [
  { type: 'ponte', icone: '🥚', titre: 'Ponte du jour', aide: 'Nombre d’œufs ramassés' },
  { type: 'aliment', icone: '🌾', titre: 'Aliment distribué', aide: 'Quantité en kg' },
  { type: 'deces', icone: '⚠️', titre: 'Décès', aide: 'Nombre et cause' },
  { type: 'sortie', icone: '🤝', titre: 'Vente ou réforme', aide: 'Animaux qui quittent l’élevage' },
  { type: 'stock', icone: '📦', titre: 'Stock d’aliment', aide: 'Achat ou comptage' },
];

export function Saisie({ elevage, type, lotInitial }: { elevage: Elevage; type?: string | undefined; lotInitial?: string | null }) {
  if (!type) {
    return (
      <>
        <h2>Que voulez-vous noter ?</h2>
        {MENU.map((m) => (
          <Tuile key={m.type} elevage={elevage} href={`saisie/${m.type}`}>{m.icone} {m.titre}<span>{m.aide}</span></Tuile>
        ))}
        <Tuile elevage={elevage} href="finances/depense">💸 Dépense<span>Aliment, soins, matériel…</span></Tuile>
        <Tuile elevage={elevage} href="finances/recette">💰 Recette<span>Vente d’œufs, de poussins, d’animaux</span></Tuile>
        <Tuile elevage={elevage} href="sante/probleme">🩺 Problème de santé<span>Symptômes, pistes à vérifier</span></Tuile>
        <Tuile elevage={elevage} href="sante/vaccin">💉 Vaccin fait<span>Date, vaccin, numéro de flacon</span></Tuile>
        <Tuile elevage={elevage} href="couveuse/nouvelle">🥚 Mise en incubation<span>Mettre des œufs dans la couveuse</span></Tuile>
        <Tuile elevage={elevage} href="quarantaine/arrivee">🚧 Nouvelle arrivée<span>Animaux achetés, mis en quarantaine</span></Tuile>
        <Tuile elevage={elevage} href="cheptel/nouveau">🐔 Nouveau lot<span>Arrivée ou création d’un groupe d’animaux</span></Tuile>
      </>
    );
  }
  if (type === 'stock') return <FormStock elevage={elevage} />;
  if (type === 'ponte' || type === 'aliment' || type === 'deces' || type === 'sortie') return <FormLot elevage={elevage} type={type} lotInitial={lotInitial ?? null} />;
  return <Retour vers="saisie" />;
}

/** Entrée du menu de saisie, montrée seulement si la personne a le droit correspondant. */
function Tuile({ elevage, href, children }: { elevage: Elevage; href: string; children: ReactNode }) {
  const droit = TUILES_SAISIE.find((t) => t.href === href)?.droit;
  if (droit && !peut(elevage, droit)) return null;
  return <a className="gros" href={`#/${href}`}>{children}</a>;
}

function useEnvoi() {
  const notifier = useNotifier();
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const envoyer = async (action: () => Promise<Annulation | null>, message: string) => {
    setOccupe(true);
    setErreur(null);
    try {
      const a = await action();
      notifier(message, a ? { annuler: () => repo.annuler(a) } : {});
      aller('accueil');
    } catch (e) {
      setErreur(e instanceof ErreurSaisie ? e.message : 'Enregistrement impossible. Réessayez.');
    } finally {
      setOccupe(false);
    }
  };
  return { occupe, erreur, envoyer };
}

const TITRES: Record<string, string> = { ponte: 'Ponte du jour', aliment: 'Aliment distribué', deces: 'Décès', sortie: 'Vente ou réforme' };

function FormLot({ elevage, type, lotInitial }: { elevage: Elevage; type: 'ponte' | 'aliment' | 'deces' | 'sortie'; lotInitial: string | null }) {
  const { donnees, effectifParLot, reglages } = elevage;
  const lots = useMemo(
    () => donnees.lots.filter((l) => !l.archive && (effectifParLot.get(l.id) ?? 0) > 0 && (type !== 'ponte' || reglages.especes[l.especeCode]?.pondeuse)),
    [donnees.lots, effectifParLot, reglages.especes, type],
  );
  const [lotId, setLotId] = useState(() => (lotInitial && lots.some((l) => l.id === lotInitial) ? lotInitial : (lots[0]?.id ?? '')));
  const [n, setN] = useState('');
  const [casses, setCasses] = useState('');
  const [cause, setCause] = useState<string>(CAUSES_DECES[0]);
  const [sortie, setSortie] = useState<'vente' | 'reforme'>('vente');
  const { occupe, erreur, envoyer } = useEnvoi();

  if (lots.length === 0) {
    return (
      <>
        <Retour vers="saisie" />
        <div className="carte">Aucun lot disponible pour cette saisie. <a className="lien" href="#/cheptel/nouveau">Créer un lot</a></div>
      </>
    );
  }

  const valeur = versNombre(n);
  const soumettre = (e: FormEvent) => {
    e.preventDefault();
    if (type === 'ponte') return envoyer(() => repo.ajouterPonte({ lotId, nombre: valeur, casses: casses ? versNombre(casses) : 0 }), 'Ponte enregistrée ✓');
    if (type === 'aliment') return envoyer(() => repo.ajouterDistribution({ lotId, quantiteKg: valeur }), 'Aliment enregistré ✓');
    if (type === 'deces') return envoyer(() => repo.ajouterDeces({ lotId, nombre: valeur, cause }), 'Décès enregistré');
    return envoyer(() => repo.enregistrerSortie({ lotId, type: sortie, nombre: valeur }), sortie === 'vente' ? 'Vente enregistrée ✓' : 'Réforme enregistrée ✓');
  };

  return (
    <form onSubmit={soumettre}>
      <Retour vers="saisie" />
      <h2>{TITRES[type]}</h2>
      <Champ libelle="Lot">
        <select value={lotId} onChange={(e) => setLotId(e.target.value)}>
          {lots.map((l) => <option key={l.id} value={l.id}>{l.nom} ({effectifParLot.get(l.id)})</option>)}
        </select>
      </Champ>
      <Champ libelle={type === 'ponte' ? 'Nombre d’œufs' : type === 'aliment' ? 'Quantité' : 'Nombre d’animaux'}>
        <Nombre valeur={n} onChange={setN} min={type === 'ponte' ? 0 : 1} pas={type === 'aliment' ? 0.5 : 1} unite={type === 'aliment' ? 'kg' : undefined} />
      </Champ>
      {type === 'ponte' && (
        <Champ libelle="dont cassés ou fêlés (facultatif)">
          <Nombre valeur={casses} onChange={setCasses} />
        </Champ>
      )}
      {type === 'deces' && (
        <Champ libelle="Cause probable">
          <select value={cause} onChange={(e) => setCause(e.target.value)}>
            {CAUSES_DECES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Champ>
      )}
      {type === 'sortie' && (
        <Champ libelle="Motif">
          <select value={sortie} onChange={(e) => setSortie(e.target.value as 'vente' | 'reforme')}>
            <option value="vente">Vente ou don</option>
            <option value="reforme">Réforme (abattage, fin de carrière)</option>
          </select>
        </Champ>
      )}
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={occupe || !n}>Enregistrer</button>
    </form>
  );
}

function FormStock({ elevage }: { elevage: Elevage }) {
  const stock = stockAlimentKg(elevage.donnees);
  const suivi = elevage.donnees.entreesStock.length > 0;
  const [mode, setMode] = useState<'achat' | 'comptage'>('achat');
  const [kg, setKg] = useState('');
  const [prix, setPrix] = useState('');
  const { occupe, erreur, envoyer } = useEnvoi();
  const soumettre = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'achat') return envoyer(() => repo.ajouterAchatAliment({ quantiteKg: versNombre(kg), prixTotal: prix ? versNombre(prix) : null }), 'Achat enregistré ✓');
    return envoyer(() => repo.corrigerStock(stock, versNombre(kg)), 'Stock mis à jour ✓');
  };
  return (
    <form onSubmit={soumettre}>
      <Retour vers="saisie" />
      <h2>Stock d’aliment</h2>
      <p className="muet">{suivi ? `Stock actuel : ${String(stock).replace('.', ',')} kg.` : 'Le stock n’est pas encore suivi. Enregistrez votre stock de départ pour activer les alertes.'}</p>
      <div className="choix" role="group" aria-label="Type de saisie">
        <button type="button" className={mode === 'achat' ? 'on' : ''} onClick={() => setMode('achat')}>{suivi ? 'Achat' : 'Stock de départ'}</button>
        {suivi && <button type="button" className={mode === 'comptage' ? 'on' : ''} onClick={() => setMode('comptage')}>Comptage</button>}
      </div>
      <Champ libelle={mode === 'achat' ? 'Quantité (kg)' : 'Stock compté (kg)'}>
        <Nombre valeur={kg} onChange={setKg} pas={5} unite="kg" />
      </Champ>
      {mode === 'achat' && (
        <Champ libelle="Prix total payé en FCFA (facultatif)">
          <Nombre valeur={prix} onChange={setPrix} pas={500} unite="FCFA" />
        </Champ>
      )}
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton" disabled={occupe || !kg}>Enregistrer</button>
    </form>
  );
}
