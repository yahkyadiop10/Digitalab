import { describe, expect, it } from 'vitest';
import { decrireEnregistrement, determinerAction, phraseJournal } from './journal';

describe('journal d’activité', () => {
  it('résume une fiche sans en dévoiler tout le contenu', () => {
    expect(decrireEnregistrement('pontes', { nombre: 9, casses: 2 })).toBe('9 œufs · 2 cassés');
    expect(decrireEnregistrement('pontes', { nombre: 9, casses: 0 })).toBe('9 œufs');
    expect(decrireEnregistrement('mouvements', { type: 'deces', quantite: -3 })).toBe('décès · 3 animaux');
    expect(decrireEnregistrement('operations', { sens: 'depense', montant: 12500, tiers: 'Quincaillerie' })).toBe('dépense · 12\u00a0500\u00a0FCFA · Quincaillerie');
    expect(decrireEnregistrement('distributions', { quantiteKg: 2.5 })).toBe('2,5 kg');
    expect(decrireEnregistrement('lots', { nom: 'Soie – lot A', especeCode: 'poule', secret: 'x' })).toBe('Soie – lot A');
    expect(decrireEnregistrement('inconnue', { a: 1 })).toBe('');
  });

  it('reconnaît création, annulation, rétablissement et validation', () => {
    expect(determinerAction(undefined, { id: 'a' })).toBe('creation');
    expect(determinerAction({ nombre: 1 }, { nombre: 2 })).toBe('modification');
    expect(determinerAction({ nombre: 1 }, { nombre: 1, supprimeLe: 5 })).toBe('annulation');
    expect(determinerAction({ supprimeLe: 5 }, { supprimeLe: null })).toBe('restauration');
    expect(determinerAction({ statut: 'a_valider' }, { statut: 'validee' })).toBe('validation');
    expect(determinerAction({ statut: 'a_valider' }, { statut: 'a_valider', montant: 3 })).toBe('modification');
  });

  it('écrit une phrase lisible', () => {
    expect(phraseJournal({ action: 'creation', table: 'pontes', description: '9 œufs' })).toBe('a ajouté une ponte : 9 œufs');
    expect(phraseJournal({ action: 'annulation', table: 'paiements', description: '' })).toBe('a annulé un règlement');
    expect(phraseJournal({ action: 'utilisateur', table: 'utilisateurs', description: 'a ajouté Moussa (Soigneur)' })).toBe('a ajouté Moussa (Soigneur)');
  });
});
