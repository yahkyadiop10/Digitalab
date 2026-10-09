import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

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

/* ---------- Mots de passe provisoires et codes de secours ---------- */

// Sans 0/o, 1/l/i, 5/s, 2/z, 8/b : on les dicte au téléphone ou on les recopie à la main.
const ALPHABET_LISIBLE = 'acdefghjkmnpqrtuvwxy34679';

/** Trois groupes de quatre caractères (60 bits), par exemple « k7mq-x9pt-4tnw ». */
export function genererMotDePasseProvisoire(): string {
  const groupe = () => Array.from({ length: 4 }, () => ALPHABET_LISIBLE[randomInt(ALPHABET_LISIBLE.length)]).join('');
  return `${groupe()}-${groupe()}-${groupe()}`;
}

export const genererCodeSecours = genererMotDePasseProvisoire;

/** Un code de secours se recopie : on ignore majuscules, espaces et tirets. */
export const normaliserCodeSecours = (code: string): string => code.toLowerCase().replace(/[\s-]/g, '');

export const empreinteCodeSecours = (secret: string, code: string): string => createHmac('sha256', secret).update(`secours:${normaliserCodeSecours(code)}`).digest('hex');

/** Clé d'installation affichée dans la console du serveur : on ignore casse, espaces et tirets. */
export const normaliserCle = normaliserCodeSecours;
