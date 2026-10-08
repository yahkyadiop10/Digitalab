import { aDroit, aUnDroit, TOUTES_LES_FONCTIONS, fonctionsDuModule } from '@digitalab/core';
import type { Elevage } from './useElevage';

/** La personne connectée a-t-elle ce droit ? (Sans compte relié, l'éleveur seul sur son appareil a tous les droits.) */
export const peut = (elevage: Pick<Elevage, 'moi'>, code: string): boolean => aDroit(elevage.moi.droits, code);

export const peutUn = (elevage: Pick<Elevage, 'moi'>, codes: readonly string[]): boolean => aUnDroit(elevage.moi.droits, codes);

/** A au moins un droit dans ce module : sinon on ne lui montre pas l'onglet. */
export const aLeModule = (elevage: Pick<Elevage, 'moi'>, module: string): boolean => aUnDroit(elevage.moi.droits, fonctionsDuModule(module));

export const tousLesDroits = (): string[] => [...TOUTES_LES_FONCTIONS];

/** Nom, coordonnées et logo à imprimer : la fiche partagée de l'élevage, sinon ce qui avait été saisi sur cet appareil. */
export function profilDe(elevage: Pick<Elevage, 'profil' | 'reglages'>): { nom: string; adresse: string; telephone: string; ninea: string; logo?: string } {
  const p = elevage.profil;
  const r = elevage.reglages;
  return {
    nom: p?.nom?.trim() || r.nomElevage || 'Mon élevage',
    adresse: p?.adresse ?? r.identite.adresse,
    telephone: p?.telephone ?? r.identite.telephone,
    ninea: p?.ninea ?? r.identite.ninea,
    ...(p?.logo ? { logo: p.logo } : {}),
  };
}

/** Les entrées du menu « Que voulez-vous noter ? » et le droit qu'il faut pour chacune. */
export const TUILES_SAISIE: { href: string; droit: string }[] = [
  { href: 'saisie/ponte', droit: 'saisie.ponte' },
  { href: 'saisie/aliment', droit: 'saisie.aliment' },
  { href: 'saisie/deces', droit: 'saisie.deces' },
  { href: 'saisie/sortie', droit: 'saisie.vente' },
  { href: 'saisie/stock', droit: 'saisie.stock' },
  { href: 'finances/depense', droit: 'finances.saisir_depense' },
  { href: 'finances/recette', droit: 'finances.saisir_facture' },
  { href: 'sante/probleme', droit: 'sante.probleme' },
  { href: 'sante/vaccin', droit: 'sante.vaccin' },
  { href: 'couveuse/nouvelle', droit: 'couveuse.mise' },
  { href: 'quarantaine/arrivee', droit: 'quarantaine.arrivee' },
  { href: 'cheptel/nouveau', droit: 'cheptel.lots' },
];

export const aDesTuilesDeSaisie = (elevage: Pick<Elevage, 'moi'>): boolean => TUILES_SAISIE.some((t) => peut(elevage, t.droit));

/** Droits demandés pour ouvrir une page (au moins un des codes). Une page absente de la liste est ouverte à tous. */
export function droitsRequis(segments: string[]): string[] | null {
  const [section, a, b] = segments;
  switch (section) {
    case 'saisie':
      return { ponte: ['saisie.ponte'], aliment: ['saisie.aliment'], deces: ['saisie.deces'], sortie: ['saisie.vente'], stock: ['saisie.stock'] }[a ?? ''] ?? null;
    case 'cheptel':
      if (a === 'nouveau') return ['cheptel.lots'];
      if (b === 'fiche') return ['cheptel.fiche'];
      return ['cheptel.voir'];
    case 'couveuse':
      return a === 'nouvelle' ? ['couveuse.mise'] : a === 'appareil' ? ['couveuse.appareils'] : ['couveuse.voir'];
    case 'sante':
      return { probleme: ['sante.probleme'], vaccin: ['sante.vaccin'], traitement: ['sante.traitement'], quarantaine: ['sante.isolement'] }[a ?? ''] ?? ['sante.voir'];
    case 'quarantaine':
      return a === 'arrivee' ? ['quarantaine.arrivee'] : ['quarantaine.voir'];
    case 'finances':
      if (a === 'depense') return ['finances.saisir_depense'];
      if (a === 'recette') return ['finances.saisir_facture'];
      if (a === 'carnet') return ['finances.carnet', 'finances.saisir_facture', 'finances.encaisser'];
      if (a === 'salaires') return b === 'employe' ? ['salaires.gerer'] : b === 'payer' ? ['salaires.payer'] : ['salaires.voir'];
      return [...fonctionsDuModule('finances')];
    default:
      return null;
  }
}

