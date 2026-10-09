import { describe, expect, it } from 'vitest';
import { identifiantDepuisNom, identifiantLibre, normaliserIdentifiant, problemeIdentifiant, problemeMotDePasse, simplifier } from './comptes';

describe('identifiants', () => {
  it('compose nom.prénom sans accents ni majuscules', () => {
    expect(identifiantDepuisNom('Moussa', 'Ndiaye')).toBe('ndiaye.moussa');
    expect(identifiantDepuisNom('Aïssatou', 'Sow')).toBe('sow.aissatou');
    expect(identifiantDepuisNom('Marie Thérèse', 'De la Fontaine')).toBe('de-la-fontaine.marie-therese');
    expect(identifiantDepuisNom('Chloé', 'Œuvre')).toBe('oeuvre.chloe');
  });

  it('retire les caractères étranges et reste borné', () => {
    expect(simplifier("  N'Diaye  ")).toBe('n-diaye');
    expect(identifiantDepuisNom('A'.repeat(50), 'B'.repeat(50)).length).toBeLessThanOrEqual(36);
    expect(identifiantDepuisNom('', 'Fall')).toBe('fall');
  });

  it('ajoute un numéro quand l’identifiant est déjà pris', () => {
    const pris = new Set(['ndiaye.moussa', 'ndiaye.moussa2']);
    expect(identifiantLibre('ndiaye.moussa', (x) => pris.has(x))).toBe('ndiaye.moussa3');
    expect(identifiantLibre('sow.awa', (x) => pris.has(x))).toBe('sow.awa');
  });

  it('normalise ce qui est tapé dans la case identifiant', () => {
    expect(normaliserIdentifiant('  Ndiaye.Moussa ')).toBe('ndiaye.moussa');
    expect(normaliserIdentifiant('Éric')).toBe('eric');
  });

  it('refuse les identifiants invalides', () => {
    expect(problemeIdentifiant('admin')).toBeNull();
    expect(problemeIdentifiant('ndiaye.moussa')).toBeNull();
    expect(problemeIdentifiant('ab')).not.toBeNull();
    expect(problemeIdentifiant('a b c')).not.toBeNull();
    expect(problemeIdentifiant('.admin')).not.toBeNull();
    expect(problemeIdentifiant('x'.repeat(41))).not.toBeNull();
  });
});

describe('mots de passe', () => {
  it('exige 8 caractères au moins', () => {
    expect(problemeMotDePasse('abc12')).toMatch(/8 caractères/);
    expect(problemeMotDePasse('Poule-Pondeuse-7')).toBeNull();
  });

  it('refuse les mots de passe courants ou trop simples', () => {
    expect(problemeMotDePasse('12345678')).toMatch(/courant/);
    expect(problemeMotDePasse('PASSWORD')).toMatch(/courant/);
    expect(problemeMotDePasse('aaaaaaaa')).toMatch(/simple/);
    expect(problemeMotDePasse('abababab')).toMatch(/simple/);
  });

  it('refuse un mot de passe qui contient l’identifiant', () => {
    expect(problemeMotDePasse('ndiaye.moussa1', 'ndiaye.moussa')).toMatch(/identifiant/);
    expect(problemeMotDePasse('Mon-Poulailler-9', 'ndiaye.moussa')).toBeNull();
  });

  it('refuse un mot de passe démesuré', () => {
    expect(problemeMotDePasse('x1'.repeat(100))).toMatch(/trop long/);
  });
});
