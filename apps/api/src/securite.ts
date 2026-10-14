import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/** Jeton de session aléatoire, à renvoyer une seule fois à l'appareil. */
export const genererJeton = (): string => randomBytes(32).toString('base64url');

export const empreinteJeton = (jeton: string): string => createHash('sha256').update(jeton).digest('hex');

export function egaux(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ---------- Mots de passe ---------- */

/** Coût de calcul de scrypt. Valeurs recommandées par l'OWASP : N=2^15, r=8, p=3. Les essais utilisent un coût réduit pour aller vite. */
export interface CoutMotDePasse {
  N: number;
  r: number;
  p: number;
}

export const COUT_MOT_DE_PASSE_DEFAUT: CoutMotDePasse = { N: 32768, r: 8, p: 3 };

const LONGUEUR_EMPREINTE = 32;

function deriver(motDePasse: string, sel: Buffer, cout: CoutMotDePasse): Promise<Buffer> {
  const options: ScryptOptions = { N: cout.N, r: cout.r, p: cout.p, maxmem: 256 * cout.N * cout.r };
  return new Promise((resolve, reject) => scrypt(motDePasse.normalize('NFKC'), sel, LONGUEUR_EMPREINTE, options, (err, cle) => (err ? reject(err) : resolve(cle))));
}

/** `scrypt$N$r$p$sel$empreinte` : les paramètres sont gardés avec l'empreinte, ce qui permet de renforcer le coût plus tard sans casser les anciens mots de passe. */
export async function hacherMotDePasse(motDePasse: string, cout: CoutMotDePasse): Promise<string> {
  const sel = randomBytes(16);
  const cle = await deriver(motDePasse, sel, cout);
  return ['scrypt', cout.N, cout.r, cout.p, sel.toString('base64'), cle.toString('base64')].join('$');
}

export async function verifierMotDePasse(motDePasse: string, empreinte: string): Promise<boolean> {
  const [algo, n, r, p, sel, cle] = empreinte.split('$');
  if (algo !== 'scrypt' || !n || !r || !p || !sel || !cle) return false;
  const attendue = Buffer.from(cle, 'base64');
  const calculee = await deriver(motDePasse, Buffer.from(sel, 'base64'), { N: Number(n), r: Number(r), p: Number(p) });
  return attendue.length === calculee.length && timingSafeEqual(attendue, calculee);
}

/* ---------- Mot de passe provisoire ---------- */

/** Six chiffres, faciles à dicter au téléphone. Ils ne servent qu'à la première connexion, quelques jours au plus, et l'identifiant est bloqué après 5 erreurs. */
export const genererMotDePasseProvisoire = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');
