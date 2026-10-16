import { describe, expect, it } from 'vitest';
import { ESSAIS_MAX, POLITIQUE_SESSION_DEFAUT, attenteApresEchecs, etatSession, normaliserPolitique } from './securite';

const MIN = 60_000;
const p = POLITIQUE_SESSION_DEFAUT;

describe('état de la session selon l’inactivité', () => {
  it('par défaut : le mot de passe est redemandé après 10 minutes, quel que soit le temps écoulé ensuite', () => {
    expect(p).toEqual({ verrouillageMin: 10 });
    expect(etatSession(0, 0, p)).toBe('actif');
    expect(etatSession(0, 9 * MIN + 59_000, p)).toBe('actif');
    expect(etatSession(0, 10 * MIN, p)).toBe('verrouille');
    expect(etatSession(0, 5 * 3600 * 1000, p)).toBe('verrouille');
  });
  it('une horloge qui recule ne verrouille pas', () => {
    expect(etatSession(1000, 0, p)).toBe('actif');
  });
});

describe('délai choisi par l’administrateur', () => {
  it('garde une valeur raisonnable, et ignore l’ancien délai de déconnexion', () => {
    expect(normaliserPolitique(undefined)).toEqual(p);
    expect(normaliserPolitique({ verrouillageMin: 0 })).toEqual({ verrouillageMin: 1 });
    expect(normaliserPolitique({ verrouillageMin: 9999 })).toEqual({ verrouillageMin: 240 });
    expect(normaliserPolitique({ verrouillageMin: Number.NaN })).toEqual(p);
    expect(normaliserPolitique({ verrouillageMin: 15, deconnexionMin: 30 } as never)).toEqual({ verrouillageMin: 15 });
  });
});

describe('essais ratés', () => {
  it('impose une attente croissante après des échecs répétés', () => {
    expect([0, 1, 4].map(attenteApresEchecs)).toEqual([0, 0, 0]);
    expect([5, 6, 7].map(attenteApresEchecs)).toEqual([30, 60, 120]);
    expect(attenteApresEchecs(ESSAIS_MAX)).toBeLessThanOrEqual(900);
  });
});
