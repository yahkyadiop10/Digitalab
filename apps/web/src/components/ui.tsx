import { cloneElement, createContext, isValidElement, useCallback, useContext, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { Alerte, Niveau } from '@digitalab/core';
import { NIVEAUX, messageAlerte, type Noms } from '../i18n/fr';
import { repo } from '../repo';
import { useRoute } from '../route';

/* ---------- Notifications avec « Annuler » ---------- */
interface Notif {
  message: string;
  annuler?: () => Promise<void>;
  erreur?: boolean;
}
const ContexteNotif = createContext<(message: string, opts?: { annuler?: () => Promise<void>; erreur?: boolean }) => void>(() => {});
export const useNotifier = () => useContext(ContexteNotif);

export function FournisseurNotif({ children }: { children: ReactNode }) {
  const [notif, setNotif] = useState<Notif | null>(null);
  const minuterie = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notifier = useCallback((message: string, opts: { annuler?: () => Promise<void>; erreur?: boolean } = {}) => {
    clearTimeout(minuterie.current);
    setNotif({ message, ...opts });
    minuterie.current = setTimeout(() => setNotif(null), opts.annuler ? 8000 : 4000);
  }, []);
  return (
    <ContexteNotif.Provider value={notifier}>
      {children}
      {notif && (
        <div className={`toast${notif.erreur ? ' toast-erreur' : ''}`} role="status" aria-live="polite">
          <span>{notif.message}</span>
          {notif.annuler && (
            <button
              onClick={async () => {
                await notif.annuler?.();
                setNotif(null);
              }}
            >
              Annuler
            </button>
          )}
        </div>
      )}
    </ContexteNotif.Provider>
  );
}

/* ---------- Champs ---------- */
/** Libellé relié au champ unique qu'il contient (un `<label>` enveloppant se brancherait sur le premier bouton). */
export function Champ({ libelle, children, aide }: { libelle: string; children: ReactElement<{ id?: string }>; aide?: string }) {
  const id = useId();
  return (
    <div className="champ">
      <label htmlFor={id}>{libelle}</label>
      {isValidElement(children) ? cloneElement(children, { id }) : children}
      {aide && <small>{aide}</small>}
    </div>
  );
}

/** Saisie d'un nombre avec gros boutons − et +. La valeur reste du texte tant que l'utilisateur tape. */
export function Nombre({ valeur, onChange, min = 0, pas = 1, unite, id }: { valeur: string; onChange: (v: string) => void; min?: number; pas?: number; unite?: string; id?: string }) {
  const decimales = pas < 1 ? 1 : 0;
  const bouger = (delta: number) => {
    const actuel = parseFloat(valeur.replace(',', '.'));
    const suivant = Math.max(min, (Number.isFinite(actuel) ? actuel : 0) + delta);
    onChange(String(Number(suivant.toFixed(decimales))));
  };
  return (
    <div className="nombre">
      <button type="button" aria-label="Moins" onClick={() => bouger(-pas)}>−</button>
      <input id={id} type="text" inputMode={pas < 1 ? 'decimal' : 'numeric'} value={valeur} onChange={(e) => onChange(e.target.value)} placeholder="0" />
      <button type="button" aria-label="Plus" onClick={() => bouger(pas)}>+</button>
      {unite && <span className="unite">{unite}</span>}
    </div>
  );
}

export const versNombre = (s: string): number => parseFloat(s.replace(',', '.'));

/* ---------- Alertes ---------- */
export function Badge({ niveau }: { niveau: Niveau | 'vert' }) {
  return <span className={`badge n-${niveau}`}>{NIVEAUX[niveau]}</span>;
}

export function CarteAlerte({ alerte, noms, priseEnCharge, actions = true }: { alerte: Alerte; noms: Noms; priseEnCharge?: boolean; actions?: boolean }) {
  const m = messageAlerte(alerte, noms);
  const demain = () => {
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  };
  return (
    <article className={`carte alerte n-${alerte.niveau}`}>
      <Badge niveau={alerte.niveau} />
      {priseEnCharge && <span className="pilule">Pris en charge</span>}
      <h3>{m.titre}</h3>
      <p>{m.detail}</p>
      {m.conseil && <p className="conseil">{m.conseil}</p>}
      {actions && (
        <div className="actions">
          {priseEnCharge ? (
            <button className="lien" onClick={() => repo.rouvrirAlerte(alerte.cle)}>Remettre à traiter</button>
          ) : (
            <>
              <button className="lien" onClick={() => repo.prendreEnCharge(alerte.cle)}>Pris en charge</button>
              <button className="lien" onClick={() => repo.reporterAlerte(alerte.cle, demain())}>Reporter à demain</button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

/* ---------- Navigation ---------- */
const ONGLETS = [
  { cle: 'accueil', icone: '🏠', libelle: 'Accueil' },
  { cle: 'saisie', icone: '✍️', libelle: 'Saisie' },
  { cle: 'cheptel', icone: '🐔', libelle: 'Cheptel' },
  { cle: 'couveuse', icone: '🥚', libelle: 'Couveuse' },
  { cle: 'alertes', icone: '🔔', libelle: 'Alertes' },
  { cle: 'reglages', icone: '⚙️', libelle: 'Réglages' },
] as const;

export function Navigation({ nbAlertes }: { nbAlertes: number }) {
  const { segments } = useRoute();
  const actif = segments[0] ?? 'accueil';
  return (
    <nav aria-label="Navigation principale">
      {ONGLETS.map((o) => (
        <a key={o.cle} href={`#/${o.cle}`} className={actif === o.cle ? 'actif' : ''} aria-current={actif === o.cle ? 'page' : undefined}>
          <b aria-hidden="true">{o.icone}</b>
          {o.libelle}
          {o.cle === 'alertes' && nbAlertes > 0 && <i className="pastille">{nbAlertes}</i>}
        </a>
      ))}
    </nav>
  );
}

export function Retour({ vers, libelle = 'Retour' }: { vers: string; libelle?: string }) {
  return (
    <p>
      <a className="lien" href={`#/${vers}`}>← {libelle}</a>
    </p>
  );
}
