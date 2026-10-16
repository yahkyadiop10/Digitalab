import { useEffect, useState } from 'react';

export interface Route {
  segments: string[];
  params: URLSearchParams;
}

function analyser(brut: string): Route {
  const [chemin = '', requete = ''] = brut.replace(/^#?\/?/, '').split('?');
  return { segments: chemin.split('/').filter(Boolean), params: new URLSearchParams(requete) };
}

// L'état de navigation vit en mémoire ; l'adresse (#/…) n'est qu'un reflet.
// Ainsi l'application reste utilisable dans un visualiseur qui limite l'accès à l'adresse.
let courant = analyser(typeof window === 'undefined' ? '' : window.location.hash);
const abonnes = new Set<(r: Route) => void>();

function changer(brut: string, ecrireAdresse: boolean) {
  courant = analyser(brut);
  if (ecrireAdresse) {
    try {
      window.history.replaceState(null, '', `#/${brut.replace(/^#?\/?/, '')}`);
    } catch {
      /* adresse protégée : sans importance */
    }
  }
  abonnes.forEach((f) => f(courant));
  window.scrollTo(0, 0);
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => changer(window.location.hash, false));
  // Les liens internes (href="#/…") passent par le même chemin.
  document.addEventListener('click', (e) => {
    const lien = (e.target as Element | null)?.closest?.('a[href^="#/"]');
    if (!lien || e.defaultPrevented || (e as MouseEvent).button !== 0 || (e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey) return;
    e.preventDefault();
    changer(lien.getAttribute('href') ?? '', true);
  });
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(courant);
  useEffect(() => {
    abonnes.add(setRoute);
    setRoute(courant);
    return () => {
      abonnes.delete(setRoute);
    };
  }, []);
  return route;
}

export const aller = (chemin: string) => changer(chemin, true);
