import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Code à 6 chiffres. */
export const genererCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Jeton de session aléatoire, à renvoyer une seule fois à l'appareil. */
export const genererJeton = (): string => randomBytes(32).toString('base64url');

export const empreinteJeton = (jeton: string): string => createHash('sha256').update(jeton).digest('hex');

export const empreinteCode = (secret: string, telephone: string, code: string): string => createHmac('sha256', secret).update(`${telephone}:${code}`).digest('hex');

export function egaux(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
