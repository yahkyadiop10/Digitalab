import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { BaseElevage } from './db';
import { ErreurCode, creerSecurite, sha256 } from './securite';

let n = 0;
let base: BaseElevage;
let horloge = 1_000_000;
beforeEach(() => {
  base = new BaseElevage(`securite-${++n}`);
  horloge = 1_000_000;
});
const nouvelle = () => creerSecurite(base, () => horloge);

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('SHA-256 de secours', () => {
  it('donne les mêmes empreintes que la référence', () => {
    expect(hex(sha256(new TextEncoder().encode('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const long = 'a'.repeat(1000);
    expect(hex(sha256(new TextEncoder().encode(long)))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
});

describe('code de verrouillage', () => {
  it('ne garde jamais le code, seulement une empreinte', async () => {
    const s = nouvelle();
    await s.definirCode('2580');
    const ligne = JSON.stringify(await base.appareil.get('verrou'));
    expect(ligne).not.toContain('2580');
    expect(await s.aUnCode()).toBe(true);
  });

  it('accepte le bon code et refuse un mauvais', async () => {
    const s = nouvelle();
    await s.definirCode('2580');
    expect((await s.verifier('2580')).ok).toBe(true);
    expect(await s.verifier('1357')).toMatchObject({ ok: false, restants: 9 });
  });

  it('refuse un code trop simple', async () => {
    await expect(nouvelle().definirCode('1234')).rejects.toBeInstanceOf(ErreurCode);
    await expect(nouvelle().definirCode('12')).rejects.toBeInstanceOf(ErreurCode);
  });

  it('exige l’ancien code pour en changer', async () => {
    const s = nouvelle();
    await s.definirCode('2580');
    await expect(s.definirCode('7391')).rejects.toThrow(/ancien code/);
    await expect(s.definirCode('7391', '0000')).rejects.toThrow(/ancien code/);
    await s.definirCode('7391', '2580');
    expect((await s.verifier('7391')).ok).toBe(true);
    expect((await s.verifier('2580')).ok).toBe(false);
  });

  it('impose une attente après cinq échecs, qui s’allonge, puis une vraie reconnexion après dix', async () => {
    const s = nouvelle();
    await s.definirCode('2580');
    for (let i = 0; i < 4; i++) expect(await s.verifier('0001')).toMatchObject({ ok: false });
    expect(await s.verifier('0001')).toMatchObject({ ok: false, attenteSecondes: 30 });
    // Pendant l'attente, même le bon code est refusé.
    expect(await s.verifier('2580')).toMatchObject({ ok: false, attenteSecondes: expect.any(Number) });
    horloge += 31_000;
    expect(await s.verifier('0001')).toMatchObject({ ok: false, attenteSecondes: 60 });
    horloge += 61_000;
    for (let i = 0; i < 3; i++) {
      await s.verifier('0001');
      horloge += 900_000;
    }
    expect(await s.verifier('0001')).toMatchObject({ ok: false, reconnexionRequise: true });
  });

  it('un bon code remet les échecs à zéro', async () => {
    const s = nouvelle();
    await s.definirCode('2580');
    await s.verifier('0001');
    await s.verifier('0002');
    expect((await s.verifier('2580')).ok).toBe(true);
    expect(await s.verifier('0001')).toMatchObject({ restants: 9 });
  });

  it('peut retirer le code avec le bon code, ou l’oublier', async () => {
    const s = nouvelle();
    await s.definirCode('2580');
    await expect(s.retirerCode('0001')).rejects.toBeInstanceOf(ErreurCode);
    await s.retirerCode('2580');
    expect(await s.aUnCode()).toBe(false);
    await s.definirCode('2580');
    await s.oublierCode();
    expect(await s.aUnCode()).toBe(false);
  });
});
