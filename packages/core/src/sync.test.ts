import { describe, expect, it } from 'vitest';
import { ROLES, TABLES_SYNCHRONISEES, normaliserTelephone } from './sync';

describe('numéros de téléphone', () => {
  it('complète un numéro sénégalais à 9 chiffres', () => {
    expect(normaliserTelephone('77 123 45 67')).toBe('+221771234567');
    expect(normaliserTelephone('77.123.45.67')).toBe('+221771234567');
    expect(normaliserTelephone('221771234567')).toBe('+221771234567');
    expect(normaliserTelephone('00221771234567')).toBe('+221771234567');
  });
  it('garde un numéro international valide', () => {
    expect(normaliserTelephone('+33 6 12 34 56 78')).toBe('+33612345678');
  });
  it('refuse les numéros invalides', () => {
    for (const x of ['', 'abc', '12345', '+0123456789', '+22177', '771234', '0771234567']) expect(normaliserTelephone(x), x).toBeNull();
  });
});

describe('rôles et tables', () => {
  it('seuls le propriétaire et le soigneur écrivent', () => {
    expect(Object.entries(ROLES).filter(([, r]) => r.ecriture).map(([k]) => k)).toEqual(['proprietaire', 'soigneur']);
  });
  it('ne synchronise pas les réglages', () => {
    expect(TABLES_SYNCHRONISEES).not.toContain('reglages' as never);
    expect(new Set(TABLES_SYNCHRONISEES).size).toBe(TABLES_SYNCHRONISEES.length);
  });
});
