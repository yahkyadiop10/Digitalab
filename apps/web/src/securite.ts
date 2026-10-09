import { useLiveQuery } from 'dexie-react-hooks';
import { ESSAIS_MAX, attenteApresEchecs, problemeDeCode } from '@digitalab/core';
import { db, type BaseElevage } from './db';

/** Code de verrouillage de l'appareil : on ne garde jamais le code, seulement une empreinte salée. */
export interface Verrou {
  sel: string;
  empreinte: string;
  algo: 'pbkdf2' | 'sha256-iteree';
  echecs: number;
  /** Instant (ms) avant lequel on refuse tout essai. */
  bloqueJusqua?: number;
}

/** L'appareil appartient à la dernière personne qui s'y est connectée. */
export interface ProprietaireAppareil {
  organisationId: string;
  telephone: string;
  /** Saisies faites sur cet appareil et jamais envoyées au serveur au moment de la déconnexion. */
  nonEnvoyes: number;
}

export class ErreurCode extends Error {}

/* ---------- Empreinte du code ---------- */

const octets = (texte: string) => new TextEncoder().encode(texte);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const depuisHex = (h: string) => new Uint8Array((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));

// SHA-256 en JavaScript, pour les appareils où le navigateur refuse le chiffrement (page en http sur le réseau local).
const K = Uint32Array.from('428a2f98 71374491 b5c0fbcf e9b5dba5 3956c25b 59f111f1 923f82a4 ab1c5ed5 d807aa98 12835b01 243185be 550c7dc3 72be5d74 80deb1fe 9bdc06a7 c19bf174 e49b69c1 efbe4786 0fc19dc6 240ca1cc 2de92c6f 4a7484aa 5cb0a9dc 76f988da 983e5152 a831c66d b00327c8 bf597fc7 c6e00bf3 d5a79147 06ca6351 14292967 27b70a85 2e1b2138 4d2c6dfc 53380d13 650a7354 766a0abb 81c2c92e 92722c85 a2bfe8a1 a81a664b c24b8b70 c76c51a3 d192e819 d6990624 f40e3585 106aa070 19a4c116 1e376c08 2748774c 34b0bcb5 391c0cb3 4ed8aa4a 5b9cca4f 682e6ff3 748f82ee 78a5636f 84c87814 8cc70208 90befffa a4506ceb bef9a3f7 c67178f2'.split(' ').map((h) => parseInt(h, 16)));
export function sha256(message: Uint8Array): Uint8Array {
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const longueur = Math.ceil((message.length + 9) / 64) * 64;
  const m = new Uint8Array(longueur);
  m.set(message);
  m[message.length] = 0x80;
  new DataView(m.buffer).setUint32(longueur - 4, message.length * 8, false);
  new DataView(m.buffer).setUint32(longueur - 8, Math.floor((message.length * 8) / 2 ** 32), false);
  const w = new Uint32Array(64);
  const rot = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < longueur; o += 64) {
    const v = new DataView(m.buffer, o, 64);
    for (let i = 0; i < 16; i++) w[i] = v.getUint32(i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rot(w[i - 15]!, 7) ^ rot(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rot(w[i - 2]!, 17) ^ rot(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[] as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  h.forEach((x, i) => new DataView(out.buffer).setUint32(i * 4, x, false));
  return out;
}

async function calculer(code: string, sel: string, algo: Verrou['algo']): Promise<string> {
  if (algo === 'pbkdf2') {
    const cle = await crypto.subtle.importKey('raw', octets(code) as BufferSource, 'PBKDF2', false, ['deriveBits']);
    return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: depuisHex(sel) as BufferSource, iterations: 150_000 }, cle, 256)));
  }
  let courant: Uint8Array = octets(`${sel}:${code}`);
  for (let i = 0; i < 20_000; i++) courant = sha256(courant);
  return hex(courant);
}

const algoDisponible = (): Verrou['algo'] => (typeof crypto !== 'undefined' && crypto.subtle ? 'pbkdf2' : 'sha256-iteree');
const selAleatoire = () => hex(crypto.getRandomValues(new Uint8Array(16)));

export type ResultatCode = { ok: true } | { ok: false; restants?: number; attenteSecondes?: number; reconnexionRequise?: boolean };

export function creerSecurite(base: BaseElevage = db, maintenant: () => number = Date.now) {
  const lire = async (): Promise<Verrou | undefined> => (await base.appareil.get('verrou'))?.valeur as Verrou | undefined;
  const ecrire = (v: Verrou) => base.appareil.put({ cle: 'verrou', valeur: v });

  return {
    async aUnCode(): Promise<boolean> {
      return !!(await lire());
    },

    /** Crée ou remplace le code. Pour en changer un existant, l'ancien code est exigé. */
    async definirCode(code: string, ancien?: string): Promise<void> {
      const probleme = problemeDeCode(code);
      if (probleme) throw new ErreurCode(probleme);
      if (await lire()) {
        if (ancien === undefined || !(await this.verifier(ancien)).ok) throw new ErreurCode('L’ancien code n’est pas le bon.');
      }
      const algo = algoDisponible();
      const sel = selAleatoire();
      await ecrire({ sel, algo, empreinte: await calculer(code, sel, algo), echecs: 0 });
    },

    /** Vérifie le code ; après trop d'échecs, l'attente s'allonge puis une vraie reconnexion est exigée. */
    async verifier(code: string): Promise<ResultatCode> {
      const v = await lire();
      if (!v) return { ok: true };
      const t = maintenant();
      if (v.bloqueJusqua && v.bloqueJusqua > t) return { ok: false, attenteSecondes: Math.ceil((v.bloqueJusqua - t) / 1000) };
      if ((await calculer(code, v.sel, v.algo)) === v.empreinte) {
        await ecrire({ ...v, echecs: 0, ...(v.bloqueJusqua ? { bloqueJusqua: undefined } : {}) });
        return { ok: true };
      }
      const echecs = v.echecs + 1;
      if (echecs >= ESSAIS_MAX) return { ok: false, reconnexionRequise: true };
      const attente = attenteApresEchecs(echecs);
      await ecrire({ ...v, echecs, ...(attente > 0 ? { bloqueJusqua: t + attente * 1000 } : {}) });
      return { ok: false, restants: ESSAIS_MAX - echecs, ...(attente > 0 ? { attenteSecondes: attente } : {}) };
    },

    async retirerCode(code: string): Promise<void> {
      if (!(await this.verifier(code)).ok) throw new ErreurCode('Ce n’est pas le bon code.');
      await base.appareil.delete('verrou');
    },

    /** Oublie le code sans le demander (reconnexion complète faite, ou appareil effacé). */
    async oublierCode(): Promise<void> {
      await base.appareil.delete('verrou');
    },
  };
}

export const securite = creerSecurite();

/** État de l'appareil : code défini, compte requis, message de déconnexion automatique. `undefined` tant que ça charge. */
export function useAppareil(): { aCode: boolean; compteRequis: boolean; deconnecteAuto: boolean } | undefined {
  return useLiveQuery(async () => {
    const lignes = new Map((await db.appareil.toArray()).map((l) => [l.cle, l.valeur]));
    return { aCode: lignes.has('verrou'), compteRequis: lignes.get('compteRequis') === true, deconnecteAuto: lignes.get('deconnecteAuto') === true };
  }, []);
}
