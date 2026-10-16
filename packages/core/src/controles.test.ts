import { describe, expect, it } from 'vitest';
import { champsFigesModifies, problemeForme } from './controles';

describe('champs figés', () => {
  it('une recette ne devient pas une dépense, mais son statut peut changer', () => {
    const recette = { id: 'o1', sens: 'recette', montant: 5000, statut: 'en_attente', misAJour: 1 };
    expect(champsFigesModifies('operations', recette, { ...recette, sens: 'depense', misAJour: 2 })).toEqual(['sens']);
    expect(champsFigesModifies('operations', recette, { ...recette, statut: 'valide', misAJour: 2 })).toEqual([]);
  });

  it('une annulation (supprimeLe) n’est pas une modification de contenu', () => {
    const ponte = { id: 'p1', nombre: 120, misAJour: 1 };
    expect(champsFigesModifies('pontes', ponte, { ...ponte, supprimeLe: 3, misAJour: 3 })).toEqual([]);
    expect(champsFigesModifies('pontes', ponte, { ...ponte, nombre: 0 })).toEqual(['nombre']);
  });

  it('les tables libres se modifient sans restriction', () => {
    expect(champsFigesModifies('lots', { id: 'l', nom: 'A' }, { id: 'l', nom: 'B' })).toEqual([]);
  });
});

describe('forme des fiches', () => {
  it('accepte une fiche normale', () => {
    expect(problemeForme('operations', { id: 'o', sens: 'depense', montant: 2500, date: '2026-10-08', libelle: 'Aliment' })).toBeNull();
  });

  it('refuse les types inattendus, les dates mal écrites et les montants négatifs', () => {
    expect(problemeForme('lots', { nom: 42 })).toMatch(/texte/);
    expect(problemeForme('pontes', { jour: '08/10/2026' })).toMatch(/date/);
    expect(problemeForme('operations', { montant: -1 })).toMatch(/négatif/);
    expect(problemeForme('operations', { montant: Number.NaN })).toMatch(/nombre/);
    expect(problemeForme('lots', { nom: 'x'.repeat(501) })).toMatch(/long/);
  });

  it('vérifie les lignes de facture et le logo', () => {
    expect(problemeForme('operations', { lignes: [{ libelle: 'Poulets', quantite: 2, prixUnitaire: 3000 }] })).toBeNull();
    expect(problemeForme('operations', { lignes: [{ libelle: 'Poulets' }] })).toMatch(/ligne/);
    expect(problemeForme('profil', { logo: 'data:image/png;base64,iVBORw0KGgo=' })).toBeNull();
    expect(problemeForme('profil', { logo: 'https://exemple.com/x.png' })).toMatch(/image/);
  });
});
