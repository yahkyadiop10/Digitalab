/** Remplace `virtual:pwa-register` dans la version « aperçu », où aucun service worker n'est installé. */
export const registerSW = (_options?: unknown): (() => Promise<void>) => async () => {};
