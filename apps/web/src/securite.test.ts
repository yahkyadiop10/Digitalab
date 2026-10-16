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
// Sel fixe : avec une empreinte tronquée, un mauvais mot de passe pourrait sinon, très rarement, tomber juste.
const nouvelle = () => creerSecurite(base, () => horloge, () => '0123456789abcdef0123456789abcdef');

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('SHA-256 de secours', () => {
  it('donne les mêmes empreintes que la référence', () => {
    expect(hex(sha256(new TextEncoder().encode('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const long = 'a'.repeat(1000);
    expect(hex(sha256(new TextEncoder().encode(long)))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
});

describe('mot de passe retenu par l’appareil (pour le redemander sans réseau)', () => {
  it('ne garde jamais le mot de passe, seulement une empreinte', async () => {
    const s = nouvelle();
    expect(await s.aUnSecret()).toBe(false);
    await s.definirSecret('poule7');
    const ligne = JSON.stringify(await base.appareil.get('verrou'));
    expect(ligne).not.toContain('poule7');
    // Seulement 16 bits de l'empreinte : impossible d'en retrouver le mot de passe.
    expect((await base.appareil.get('verrou'))?.valeur).toMatchObject({ version: 2, empreinte: expect.stringMatching(/^[0-9a-f]{4}$/) });
    expect(await s.aUnSecret()).toBe(true);
  });

  it('n’accepte plus l’ancien code à chiffres d’avant la mise à jour : le serveur vérifiera le mot de passe', async () => {
    await base.appareil.put({ cle: 'verrou', valeur: { sel: '00', empreinte: 'a'.repeat(64), algo: 'pbkdf2', echecs: 0 } });
    expect(await nouvelle().verifier('2580')).toEqual({ ok: false });
  });

  it('après dix échecs, plus rien ne s’ouvre sur l’appareil, même le bon mot de passe après une longue attente', async () => {
    const s = nouvelle();
    await s.definirSecret('poule7');
    for (let i = 0; i < 10; i++) {
      await s.verifier(`faux-${i}`);
      horloge += 3_600_000;
    }
    horloge += 86_400_000;
    expect(await s.verifier('poule7')).toEqual({ ok: false, reconnexionRequise: true });
  });

  it('accepte le bon mot de passe et refuse un mauvais', async () => {
    const s = nouvelle();
    await s.definirSecret('poule7');
    expect((await s.verifier('poule7')).ok).toBe(true);
    expect(await s.verifier('poule8')).toMatchObject({ ok: false, restants: 9 });
  });

  it('sans empreinte, ne valide rien sur l’appareil (le serveur tranchera)', async () => {
    expect(await nouvelle().verifier('poule7')).toEqual({ ok: false });
  });

  it('un nouveau mot de passe remplace l’ancien', async () => {
    const s = nouvelle();
    await s.definirSecret('poule7');
    await s.definirSecret('canard9');
    expect((await s.verifier('canard9')).ok).toBe(true);
    expect((await s.verifier('poule7')).ok).toBe(false);
    await expect(s.definirSecret('')).rejects.toBeInstanceOf(ErreurCode);
  });

  it('impose une attente après cinq échecs, qui s’allonge, puis une vraie reconnexion après dix', async () => {
    const s = nouvelle();
    await s.definirSecret('poule7');
    for (let i = 0; i < 4; i++) expect(await s.verifier('faux')).toMatchObject({ ok: false });
    expect(await s.verifier('faux')).toMatchObject({ ok: false, attenteSecondes: 30 });
    // Pendant l'attente, même le bon mot de passe est refusé.
    expect(await s.verifier('poule7')).toMatchObject({ ok: false, attenteSecondes: expect.any(Number) });
    horloge += 31_000;
    expect(await s.verifier('faux')).toMatchObject({ ok: false, attenteSecondes: 60 });
    horloge += 61_000;
    for (let i = 0; i < 3; i++) {
      await s.verifier('faux');
      horloge += 900_000;
    }
    expect(await s.verifier('faux')).toMatchObject({ ok: false, reconnexionRequise: true });
  });

  it('un bon mot de passe remet les échecs à zéro, et l’empreinte peut être oubliée', async () => {
    const s = nouvelle();
    await s.definirSecret('poule7');
    await s.verifier('faux1');
    await s.verifier('faux2');
    expect((await s.verifier('poule7')).ok).toBe(true);
    expect(await s.verifier('faux1')).toMatchObject({ restants: 9 });
    await s.oublierSecret();
    expect(await s.aUnSecret()).toBe(false);
  });
});
