import { describe, expect, it } from 'vitest';
import {
  CATEGORIES_ACHATS, DROITS_DES_PROFILS, MODULES, REGLES_TABLES, TOUTES_LES_FONCTIONS, aDroit, basculerModule, droitPourValiderDepense, droitsDuProfil, droitsEffectifs,
  etatModule, nettoyerDroits, peutAnnuler, peutEcrireTable, peutLireTable, tablesEcrivables,
} from './permissions';
import { TABLES_SYNCHRONISEES } from './sync';
import { filtrerParZones } from './zones';

describe('catalogue des fonctions', () => {
  it('chaque code est unique et préfixé par son module', () => {
    expect(new Set(TOUTES_LES_FONCTIONS).size).toBe(TOUTES_LES_FONCTIONS.length);
    for (const m of MODULES) for (const x of m.fonctions) expect(x.code.startsWith(`${m.code}.`), x.code).toBe(true);
  });
  it('les profils n’utilisent que des fonctions du catalogue', () => {
    for (const [profil, droits] of Object.entries(DROITS_DES_PROFILS)) expect(nettoyerDroits(droits), profil).toEqual([...new Set(droits)]);
  });
  it('toutes les tables synchronisées ont une règle, et inversement', () => {
    expect(Object.keys(REGLES_TABLES).sort()).toEqual([...TABLES_SYNCHRONISEES].sort());
    for (const r of Object.values(REGLES_TABLES)) {
      expect(nettoyerDroits([...r.ecriture, ...r.annulation, ...(r.lecture === 'base' ? [] : r.lecture)]).length).toBe(new Set([...r.ecriture, ...r.annulation, ...(r.lecture === 'base' ? [] : r.lecture)]).size);
    }
  });
  it('ignore les codes inconnus', () => {
    expect(nettoyerDroits(['saisie.ponte', 'nimporte.quoi', 'saisie.ponte'])).toEqual(['saisie.ponte']);
  });
});

describe('cocher un module entier', () => {
  it('coche et décoche toutes les fonctions du module sans toucher aux autres', () => {
    const base = ['saisie.ponte', 'sante.voir'];
    const tout = basculerModule(base, 'finances', true);
    expect(etatModule(tout, 'finances')).toBe('tout');
    expect(aDroit(tout, 'saisie.ponte')).toBe(true);
    const rien = basculerModule(tout, 'finances', false);
    expect(etatModule(rien, 'finances')).toBe('aucun');
    expect(rien.sort()).toEqual(['saisie.ponte', 'sante.voir']);
  });
  it('signale un module coché en partie', () => {
    expect(etatModule(['finances.encaisser'], 'finances')).toBe('partiel');
  });
});

describe('profils', () => {
  it('le propriétaire a tout, même si on lui donne une liste restreinte', () => {
    expect(droitsEffectifs('proprietaire', ['saisie.ponte'])).toEqual(TOUTES_LES_FONCTIONS);
  });
  it('le gérant a tout sauf la gestion des utilisateurs', () => {
    const g = droitsDuProfil('gerant');
    expect(aDroit(g, 'finances.annuler_depense')).toBe(true);
    expect(aDroit(g, 'admin.utilisateurs')).toBe(false);
  });
  it('à défaut de droits choisis un par un, le profil donne les droits', () => {
    expect(droitsEffectifs('soigneur', null)).toEqual(droitsDuProfil('soigneur'));
    expect(droitsEffectifs('soigneur', ['saisie.ponte'])).toEqual(['saisie.ponte']);
    expect(droitsEffectifs('personnalise', null)).toEqual([]);
  });
  it('le soigneur ne voit ni finances ni salaires', () => {
    const d = droitsDuProfil('soigneur');
    expect(peutLireTable(d, 'operations')).toBe(false);
    expect(peutLireTable(d, 'paiements')).toBe(false);
    expect(peutLireTable(d, 'employes')).toBe(false);
    expect(peutLireTable(d, 'pontes')).toBe(true);
    expect(peutEcrireTable(d, 'pontes')).toBe(true);
    expect(peutEcrireTable(d, 'operations')).toBe(false);
  });
  it('le caissier encaisse et facture mais ne voit pas les salaires ni la santé', () => {
    const d = droitsDuProfil('caissier');
    expect(peutEcrireTable(d, 'operations')).toBe(true);
    expect(peutEcrireTable(d, 'paiements')).toBe(true);
    expect(peutLireTable(d, 'employes')).toBe(false);
    expect(peutLireTable(d, 'evenementsSante')).toBe(false);
    expect(peutEcrireTable(d, 'pontes')).toBe(false);
  });
  it('le vétérinaire écrit dans la santé mais pas dans la ponte ni les finances', () => {
    const d = droitsDuProfil('veterinaire');
    expect(peutEcrireTable(d, 'evenementsSante')).toBe(true);
    expect(peutEcrireTable(d, 'pontes')).toBe(false);
    expect(peutLireTable(d, 'operations')).toBe(false);
  });
  it('le lecteur ne peut rien écrire', () => {
    expect(tablesEcrivables(droitsDuProfil('lecteur'))).toEqual([]);
  });
  it('sans aucun droit, on ne lit rien', () => {
    for (const t of TABLES_SYNCHRONISEES) expect(peutLireTable([], t), t).toBe(false);
  });
});

describe('annulation et validation', () => {
  it('annuler une dépense et annuler une vente sont deux droits distincts', () => {
    expect(peutAnnuler(['finances.annuler_depense'], 'operations', { sens: 'depense' })).toBe(true);
    expect(peutAnnuler(['finances.annuler_depense'], 'operations', { sens: 'recette' })).toBe(false);
    expect(peutAnnuler(['finances.annuler_vente'], 'paiements', { sens: 'recette' })).toBe(true);
    expect(peutAnnuler(['saisie.ponte'], 'pontes')).toBe(false);
    expect(peutAnnuler(['saisie.annuler'], 'pontes')).toBe(true);
  });
  it('les achats se valident avec leur propre droit', () => {
    for (const c of CATEGORIES_ACHATS) expect(droitPourValiderDepense(c)).toBe('finances.valider_achat');
    expect(droitPourValiderDepense('soins')).toBe('finances.valider_depense');
  });
});

describe('zones', () => {
  const base = { misAJour: 0 };
  const donnees = {
    logements: [{ id: 'A', ...base, nom: 'A', type: 'batiment' as const }, { id: 'B', ...base, nom: 'B', type: 'batiment' as const }],
    lots: [{ id: 'l1', ...base, nom: '1', especeCode: 'poule', logementId: 'A' }, { id: 'l2', ...base, nom: '2', especeCode: 'poule', logementId: 'B' }, { id: 'l3', ...base, nom: '3', especeCode: 'poule' }],
    mouvements: [{ id: 'm1', ...base, lotId: 'l1', type: 'arrivee' as const, quantite: 5, date: '2026-10-01' }, { id: 'm2', ...base, lotId: 'l2', type: 'arrivee' as const, quantite: 7, date: '2026-10-01' }],
    pontes: [{ id: 'p1', ...base, lotId: 'l2', date: '2026-10-01', nombre: 3, casses: 0 }],
    distributions: [], entreesStock: [{ id: 's', ...base, date: '2026-10-01', quantiteKg: 5, prixTotal: null }], couveuses: [], incubations: [], mirages: [], evenementsSante: [],
    quarantaines: [], notesQuarantaine: [],
  };
  it('garde tout sans zone', () => {
    expect(filtrerParZones(donnees, [])).toBe(donnees);
  });
  it('ne garde que les lots, mouvements et pontes de ses bâtiments, et le stock commun', () => {
    const d = filtrerParZones(donnees, ['A']);
    expect(d.logements.map((l) => l.id)).toEqual(['A']);
    expect(d.lots.map((l) => l.id)).toEqual(['l1']);
    expect(d.mouvements.map((m) => m.id)).toEqual(['m1']);
    expect(d.pontes).toEqual([]);
    expect(d.entreesStock).toHaveLength(1);
  });
});
