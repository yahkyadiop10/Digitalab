import { describe, expect, it } from 'vitest';
import { versEntier, versNombre } from './format';

describe('lecture des nombres saisis', () => {
  it('lit les décimales avec virgule ou point, et les espaces entre milliers', () => {
    expect(versNombre('2,5')).toBe(2.5);
    expect(versNombre('2.5')).toBe(2.5);
    expect(versNombre('1 250')).toBe(1250);
    expect(versNombre('1 250,5')).toBe(1250.5);
    expect(versNombre('1.250.000')).toBe(1250000);
  });
  it('refuse ce qui n’est pas un nombre au lieu d’en garder un morceau', () => {
    expect(versNombre('12 kg')).toBeNaN();
    expect(versNombre('')).toBeNaN();
    expect(versNombre('abc')).toBeNaN();
  });
  it('les montants et les effectifs comprennent les séparateurs de milliers', () => {
    expect(versEntier('25.000')).toBe(25000);
    expect(versEntier('25,000')).toBe(25000);
    expect(versEntier('25 000')).toBe(25000);
    expect(versEntier('1.500.000')).toBe(1500000);
    expect(versEntier('2500')).toBe(2500);
    expect(versEntier('2,5')).toBe(2.5);
  });
});
