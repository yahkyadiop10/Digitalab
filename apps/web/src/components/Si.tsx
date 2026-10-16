import type { ReactNode } from 'react';
import { peut, peutUn } from '../droits';
import type { Elevage } from '../useElevage';

/** N'affiche son contenu que si la personne a le droit demandé (`droit`) ou l'un des droits demandés (`un`). */
export function Si({ elevage, droit, un, children }: { elevage: Pick<Elevage, 'moi'>; droit?: string; un?: readonly string[]; children: ReactNode }) {
  const ok = droit ? peut(elevage, droit) : un ? peutUn(elevage, un) : true;
  return ok ? <>{children}</> : null;
}
