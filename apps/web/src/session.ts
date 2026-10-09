import { useCallback, useEffect, useRef, useState } from 'react';
import { etatSession, type EtatSession, type PolitiqueSession } from '@digitalab/core';

const CLE = 'avimaster.derniereActivite';
let memoire = Date.now();

/** Dernier instant d'activité, gardé aussi quand l'application est fermée (sinon on garde seulement la mémoire de la page). */
export function derniereActivite(): number {
  try {
    const v = Number(window.localStorage.getItem(CLE));
    if (Number.isFinite(v) && v > 0) return v;
  } catch {
    /* stockage refusé : la mémoire de la page suffit */
  }
  return memoire;
}

export function marquerActivite(instant: number = Date.now()): void {
  memoire = instant;
  try {
    window.localStorage.setItem(CLE, String(instant));
  } catch {
    /* idem */
  }
}

const EVENEMENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;
const PERIODE_VERIFICATION_MS = 5_000;
const PAS_ECRITURE_MS = 2_000;

/**
 * Surveille l'inactivité : verrouille l'écran, puis demande la déconnexion. Seule une action sur une session encore active compte :
 * toucher l'écran de verrouillage ne le déverrouille pas, il faut le code.
 */
export function useSession({ active, politique, connecte, surDeconnexion }: { active: boolean; politique: PolitiqueSession; connecte: boolean; surDeconnexion: () => void }) {
  const [etat, setEtat] = useState<EtatSession>('actif');
  const declenche = useRef(false);
  const surDeconnexionRef = useRef(surDeconnexion);
  surDeconnexionRef.current = surDeconnexion;

  useEffect(() => {
    if (!active) {
      setEtat('actif');
      declenche.current = false;
      return;
    }
    let derniereEcriture = 0;
    const evaluer = () => {
      const e = etatSession(derniereActivite(), Date.now(), politique);
      setEtat(e);
      if (e !== 'deconnecte') declenche.current = false;
      else if (connecte && !declenche.current) {
        declenche.current = true;
        surDeconnexionRef.current();
      }
    };
    const activite = () => {
      const t = Date.now();
      if (t - derniereEcriture < PAS_ECRITURE_MS) return;
      if (etatSession(derniereActivite(), t, politique) !== 'actif') return;
      derniereEcriture = t;
      marquerActivite(t);
    };
    for (const e of EVENEMENTS) window.addEventListener(e, activite, { capture: true, passive: true });
    const intervalle = setInterval(evaluer, PERIODE_VERIFICATION_MS);
    document.addEventListener('visibilitychange', evaluer);
    window.addEventListener('focus', evaluer);
    window.addEventListener('pageshow', evaluer);
    evaluer();
    return () => {
      for (const e of EVENEMENTS) window.removeEventListener(e, activite, { capture: true });
      clearInterval(intervalle);
      document.removeEventListener('visibilitychange', evaluer);
      window.removeEventListener('focus', evaluer);
      window.removeEventListener('pageshow', evaluer);
    };
  }, [active, politique.verrouillageMin, politique.deconnexionMin, connecte]);

  /** Verrouille tout de suite (le temps écoulé compte alors comme si le délai de verrouillage était passé). */
  const verrouiller = useCallback(() => {
    marquerActivite(Date.now() - politique.verrouillageMin * 60_000);
    setEtat('verrouille');
  }, [politique.verrouillageMin]);

  const deverrouiller = useCallback(() => {
    marquerActivite();
    declenche.current = false;
    setEtat('actif');
  }, []);

  return { etat, verrouiller, deverrouiller };
}

/** Verrouille tout de suite, depuis n'importe où : la surveillance prend l'instant en compte aussitôt. */
export function verrouillerMaintenant(politique: PolitiqueSession): void {
  marquerActivite(Date.now() - politique.verrouillageMin * 60_000);
  window.dispatchEvent(new Event('focus'));
}
