/** Délais de sécurité de la session, en minutes d'inactivité. Réglés par l'administrateur, partagés entre les appareils. */
export interface PolitiqueSession {
  /** Après ce délai sans toucher l'application, l'écran se verrouille (code à saisir, même sans réseau). */
  verrouillageMin: number;
  /** Après ce délai, la personne est déconnectée de son compte et doit se reconnecter. */
  deconnexionMin: number;
}

export const POLITIQUE_SESSION_DEFAUT: PolitiqueSession = { verrouillageMin: 10, deconnexionMin: 30 };

/** Valeurs raisonnables : le verrouillage de 1 minute à 4 heures, la déconnexion d'au moins 1 minute après le verrouillage, 24 heures au plus. */
export function normaliserPolitique(brut: Partial<PolitiqueSession> | null | undefined): PolitiqueSession {
  const entier = (v: unknown, defaut: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : defaut);
  const verrouillageMin = Math.min(240, Math.max(1, entier(brut?.verrouillageMin, POLITIQUE_SESSION_DEFAUT.verrouillageMin)));
  const deconnexionMin = Math.min(1440, Math.max(verrouillageMin + 1, entier(brut?.deconnexionMin, POLITIQUE_SESSION_DEFAUT.deconnexionMin)));
  return { verrouillageMin, deconnexionMin };
}

export type EtatSession = 'actif' | 'verrouille' | 'deconnecte';

/**
 * Où en est la session d'après le dernier instant d'activité. Le temps compte même quand l'application est fermée
 * ou le téléphone éteint : rouvrir l'application après une heure donne « déconnecté ».
 */
export function etatSession(derniereActiviteMs: number, maintenantMs: number, politique: PolitiqueSession): EtatSession {
  const inactifMin = Math.max(0, maintenantMs - derniereActiviteMs) / 60_000;
  if (inactifMin >= politique.deconnexionMin) return 'deconnecte';
  if (inactifMin >= politique.verrouillageMin) return 'verrouille';
  return 'actif';
}

/** Un code d'au moins 4 chiffres, pas évident (0000, 1234, 4321…). Renvoie le problème, ou `null` si le code convient. */
export function problemeDeCode(code: string): string | null {
  if (!/^\d{4,6}$/.test(code)) return 'Le code doit avoir de 4 à 6 chiffres.';
  if (/^(\d)\1+$/.test(code)) return 'Évitez un code où tous les chiffres sont identiques.';
  const chiffres = [...code].map(Number);
  const pas = chiffres.slice(1).map((c, i) => c - chiffres[i]!);
  if (pas.every((p) => p === 1) || pas.every((p) => p === -1)) return 'Évitez une suite de chiffres comme 1234.';
  return null;
}

/** Nombre d'essais ratés avant lequel on force une vraie reconnexion. */
export const ESSAIS_MAX = 10;

/** Attente (secondes) imposée après le `echecs`-ième essai raté d'affilée : les premiers sont libres, puis le délai double. */
export function attenteApresEchecs(echecs: number): number {
  if (echecs < 5) return 0;
  return Math.min(900, 30 * 2 ** (echecs - 5));
}
