/** Délai de sécurité de la session, en minutes d'inactivité. Réglé par l'administrateur, partagé entre les appareils. */
export interface PolitiqueSession {
  /** Après ce délai sans toucher l'application, elle redemande le mot de passe (vérifiable même sans réseau). */
  verrouillageMin: number;
}

export const POLITIQUE_SESSION_DEFAUT: PolitiqueSession = { verrouillageMin: 10 };

/** Valeur raisonnable : de 1 minute à 4 heures. */
export function normaliserPolitique(brut: Partial<PolitiqueSession> | null | undefined): PolitiqueSession {
  const v = brut?.verrouillageMin;
  const entier = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : POLITIQUE_SESSION_DEFAUT.verrouillageMin;
  return { verrouillageMin: Math.min(240, Math.max(1, entier)) };
}

export type EtatSession = 'actif' | 'verrouille';

/** Où en est la session d'après le dernier instant d'activité. Le temps compte même quand l'application est fermée ou le téléphone éteint. */
export function etatSession(derniereActiviteMs: number, maintenantMs: number, politique: PolitiqueSession): EtatSession {
  const inactifMin = Math.max(0, maintenantMs - derniereActiviteMs) / 60_000;
  return inactifMin >= politique.verrouillageMin ? 'verrouille' : 'actif';
}

/** Nombre d'essais ratés avant lequel on force une vraie reconnexion. */
export const ESSAIS_MAX = 10;

/** Attente (secondes) imposée après le `echecs`-ième essai raté d'affilée : les premiers sont libres, puis le délai double. */
export function attenteApresEchecs(echecs: number): number {
  if (echecs < 5) return 0;
  return Math.min(900, 30 * 2 ** (echecs - 5));
}
