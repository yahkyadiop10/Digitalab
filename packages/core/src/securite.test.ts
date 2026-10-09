import { describe, expect, it } from 'vitest';
import { ESSAIS_MAX, POLITIQUE_SESSION_DEFAUT, attenteApresEchecs, etatSession, normaliserPolitique, problemeDeCode } from './securite';

const MIN = 60_000;
const p = POLITIQUE_SESSION_DEFAUT;

describe('état de la session selon l’inactivité', () => {
  it('par défaut : verrouillé à 10 minutes, déconnecté à 30', () => {
    expect(p).toEqual({ verrouillageMin: 10, deconnexionMin: 30 });
    expect(etatSession(0, 0, p)).toBe('actif');
    expect(etatSession(0, 9 * MIN + 59_000, p)).toBe('actif');
    expect(etatSession(0, 10 * MIN, p)).toBe('verrouille');
    expect(etatSession(0, 29 * MIN + 59_000, p)).toBe('verrouille');
    expect(etatSession(0, 30 * MIN, p)).toBe('deconnecte');
    expect(etatSession(0, 5 * 3600 * 1000, p)).toBe('deconnecte');
  });
  it('une horloge qui recule ne verrouille pas', () => {
    expect(etatSession(1000, 0, p)).toBe('actif');
  });
});

describe('délais choisis par l’administrateur', () => {
  it('garde des valeurs raisonnables et une déconnexion toujours après le verrouillage', () => {
    expect(normaliserPolitique(undefined)).toEqual(p);
    expect(normaliserPolitique({ verrouillageMin: 0, deconnexionMin: 0 })).toEqual({ verrouillageMin: 1, deconnexionMin: 2 });
    expect(normaliserPolitique({ verrouillageMin: 60, deconnexionMin: 30 })).toEqual({ verrouillageMin: 60, deconnexionMin: 61 });
    expect(normaliserPolitique({ verrouillageMin: 9999, deconnexionMin: 99999 })).toEqual({ verrouillageMin: 240, deconnexionMin: 1440 });
    expect(normaliserPolitique({ verrouillageMin: Number.NaN })).toEqual(p);
  });
});

describe('code de verrouillage', () => {
  it('accepte 4 à 6 chiffres peu évidents', () => {
    for (const ok of ['2580', '7391', '482916']) expect(problemeDeCode(ok), ok).toBeNull();
  });
  it('refuse trop court, lettres, chiffres identiques et suites', () => {
    for (const mal of ['', '123', '1234567', 'abcd', '12a4', '0000', '1111', '1234', '4321', '56789']) expect(problemeDeCode(mal), mal).not.toBeNull();
  });
  it('impose une attente croissante après des échecs répétés', () => {
    expect([0, 1, 4].map(attenteApresEchecs)).toEqual([0, 0, 0]);
    expect([5, 6, 7].map(attenteApresEchecs)).toEqual([30, 60, 120]);
    expect(attenteApresEchecs(ESSAIS_MAX)).toBeLessThanOrEqual(900);
  });
});
