import { useEffect, useState } from 'react';

export interface Route {
  segments: string[];
  params: URLSearchParams;
}

function lire(): Route {
  const brut = window.location.hash.replace(/^#\/?/, '');
  const [chemin = '', requete = ''] = brut.split('?');
  return { segments: chemin.split('/').filter(Boolean), params: new URLSearchParams(requete) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(lire);
  useEffect(() => {
    const maj = () => {
      setRoute(lire());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', maj);
    return () => window.removeEventListener('hashchange', maj);
  }, []);
  return route;
}

export const aller = (chemin: string) => {
  window.location.hash = `#/${chemin.replace(/^\/+/, '')}`;
};
