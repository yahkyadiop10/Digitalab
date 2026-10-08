import type { Alerte, Niveau } from '@digitalab/core';

export const NIVEAUX: Record<Niveau | 'vert', string> = {
  vert: 'Tout va bien',
  jaune: 'À surveiller',
  orange: 'Action aujourd’hui',
  rouge: 'Urgence',
};

export const CAUSES_DECES = ['Inconnue', 'Maladie', 'Prédateur', 'Chaleur ou froid', 'Accident', 'Naturelle'] as const;

export const TYPES_LOGEMENT = { batiment: 'Bâtiment', cage: 'Cage', voliere: 'Volière', parc: 'Parc', quarantaine: 'Zone de quarantaine' } as const;

export interface Noms {
  lot: (id?: string) => string;
  logement: (id?: string) => string;
  incubation: (id?: string) => string;
  quarantaine: (id?: string) => string;
}

export interface MessageAlerte {
  titre: string;
  detail: string;
  conseil?: string;
}

const pluriel = (n: number, un: string, plusieurs: string) => (n > 1 ? plusieurs : un);
const nombre = (x: number) => String(x).replace('.', ',');

/** Met une alerte en phrases. Le moteur ne renvoie que des codes et des chiffres : la langue se change ici. */
export function messageAlerte(a: Alerte, noms: Noms): MessageAlerte {
  const p = a.params;
  switch (a.code) {
    case 'densite': {
      const lg = noms.logement(a.logementId);
      const titre = a.niveau === 'rouge' ? `Surdensité : ${lg}` : a.niveau === 'orange' ? `Presque plein : ${lg}` : `Place à surveiller : ${lg}`;
      return {
        titre,
        detail: `${p.pct} % de la place conseillée est occupée.`,
        conseil: a.niveau === 'rouge' ? 'Retirez ou transférez des animaux.' : 'Prévoyez de la place avant la prochaine arrivée ou éclosion.',
      };
    }
    case 'mortalite': {
      const lot = noms.lot(a.lotId);
      const deces = p.deces ?? 0;
      const quand = p.jours === 1 ? 'aujourd’hui' : 'sur 7 jours';
      return {
        titre: a.niveau === 'jaune' ? `Décès à noter : ${lot}` : `Mortalité élevée : ${lot}`,
        detail: `${deces} ${pluriel(deces, 'mort', 'morts')} ${quand} (${nombre(p.taux ?? 0)} %).`,
        ...(a.niveau !== 'jaune' ? { conseil: 'Isolez les animaux malades, notez les symptômes et demandez conseil à un vétérinaire.' } : {}),
      };
    }
    case 'chute_ponte':
      return {
        titre: `Chute de ponte : ${noms.lot(a.lotId)}`,
        detail: `${p.valeur} œufs contre ${nombre(p.moyenne ?? 0)} en moyenne ces derniers jours (${p.pct} %).`,
        conseil: 'Vérifiez l’eau, l’aliment, la chaleur et les dérangements (prédateurs, bruit).',
      };
    case 'incubation': {
      const nom = noms.incubation(a.incubationId);
      const retard = p.retard ?? 0;
      const dans = p.dans ?? 0;
      const jourJ = p.jourJ ?? 0;
      const auto = p.auto === 1;
      const separe = p.separe === 1;
      const quand = (action: string) => (retard > 0 ? `${action} en retard` : dans > 0 ? `${action} ${dans === 1 ? 'demain' : `dans ${dans} jours`}` : `${action} aujourd’hui`);
      const detail = retard > 0 ? `Prévu il y a ${retard} ${pluriel(retard, 'jour', 'jours')} (jour ${jourJ}).` : dans > 0 ? `Prévu au jour ${jourJ} d’incubation.` : `Jour ${jourJ} d’incubation.`;
      if (a.etape === 'mirage')
        return { titre: `${quand('Mirage')} : ${nom}`, detail, conseil: dans > 0 ? 'Préparez la lampe de mirage.' : 'Contrôlez les œufs à la lumière, retirez les œufs clairs ou morts, puis notez-les.' };
      if (a.etape === 'retournement')
        return {
          titre: `${quand(auto ? 'Arrêt du retournement automatique' : 'Arrêt du retournement')} : ${nom}`,
          detail,
          conseil: dans > 0
            ? 'Prévoyez de couper le retournement et d’augmenter l’humidité, selon la notice de votre appareil.'
            : `${auto ? 'Coupez le retournement automatique (ou posez les œufs à plat)' : 'Ne tournez plus les œufs'} et passez à l’humidité d’éclosion${separe ? ', puis transférez-les dans l’éclosoir' : ''}, selon la notice.`,
        };
      if (a.etape === 'transfert')
        return { titre: `${quand('Transfert vers l’éclosoir')} : ${nom}`, detail, conseil: dans > 0 ? 'Préparez l’éclosoir : propre, chauffé, à la bonne humidité.' : 'Posez les œufs dans l’éclosoir déjà chauffé, sans les tourner.' };
      return {
        titre: `${retard > 0 ? 'Éclosion en retard' : dans > 0 ? `Éclosion ${dans === 1 ? 'demain' : `dans ${dans} jours`}` : 'Éclosion attendue aujourd’hui'} : ${nom}`,
        detail: retard > 0 ? detail : dans > 0 ? `Prévue au jour ${jourJ} d’incubation.` : 'Les poussins devraient éclore aujourd’hui.',
        conseil: dans > 0 ? 'Préparez l’éleveuse : chaleur, eau et aliment de démarrage prêts.' : 'Évitez d’ouvrir la couveuse pendant l’éclosion, puis notez le résultat.',
      };
    }
    case 'vaccin': {
      const lot = noms.lot(a.lotId);
      const nom = a.libelle ?? 'Vaccin';
      const retard = p.retard ?? 0;
      const dans = p.dans ?? 0;
      const titre = retard > 0 ? `${nom} en retard : ${lot}` : dans > 0 ? `${nom} ${dans === 1 ? 'demain' : `dans ${dans} jours`} : ${lot}` : `${nom} aujourd’hui : ${lot}`;
      return {
        titre,
        detail: retard > 0 ? `Prévu il y a ${retard} ${pluriel(retard, 'jour', 'jours')}.` : 'Selon votre calendrier de vaccination.',
        conseil: retard > 0 ? 'Faites le vaccin dès que possible, puis notez-le pour que le rappel soit recalculé.' : 'Préparez le vaccin et notez-le une fois fait.',
      };
    }
    case 'delai_attente': {
      const jours = p.jours ?? 0;
      return {
        titre: `Œufs et viande à ne pas consommer : ${noms.lot(a.lotId)}`,
        detail: `${p.enCours === 1 ? 'Traitement en cours' : 'Délai d’attente'} (${a.libelle ?? 'traitement'}) : encore ${jours} ${pluriel(jours, 'jour', 'jours')}.`,
        conseil: 'Ne vendez ni ne consommez les œufs ou la viande de ce lot avant la fin du délai.',
      };
    }
    case 'sante_grave':
      return {
        titre: `${p.gravite === 3 ? 'Symptômes graves' : 'Symptômes inquiétants'} : ${noms.lot(a.lotId)}`,
        detail: `${p.symptomes ?? 0} ${pluriel(p.symptomes ?? 0, 'symptôme noté', 'symptômes notés')} récemment.`,
        conseil: 'Isolez les animaux concernés, appelez un vétérinaire et consultez les pistes dans l’onglet Santé.',
      };
    case 'foyer':
      return {
        titre: `Possible foyer : ${noms.logement(a.logementId)}`,
        detail: `${p.lots} lots du même local présentent des symptômes inquiétants.`,
        conseil: 'Limitez les déplacements entre lots, désinfectez le matériel et prévenez un vétérinaire.',
      };
    case 'quarantaine': {
      const nom = noms.quarantaine(a.quarantaineId);
      if (a.etape === 'inquiet') {
        const malades = p.malades ?? 0;
        return {
          titre: `Quarantaine inquiétante : ${nom}`,
          detail: malades > 0 ? `${malades} ${pluriel(malades, 'animal semble malade', 'animaux semblent malades')} d’après la dernière note.` : 'La dernière note est inquiétante.',
          conseil: 'Gardez le groupe à l’écart, notez les symptômes dans l’onglet Santé et demandez conseil à un vétérinaire.',
        };
      }
      const retard = p.retard ?? 0;
      return retard > 0 || (p.restants ?? 1) <= 0
        ? { titre: `Fin de quarantaine à décider : ${nom}`, detail: retard > 0 ? `La durée prévue est dépassée de ${retard} ${pluriel(retard, 'jour', 'jours')}.` : 'La durée prévue se termine aujourd’hui.', conseil: 'Si les animaux sont en bonne santé, intégrez-les à l’élevage ; sinon prolongez la quarantaine.' }
        : { titre: `Fin de quarantaine demain : ${nom}`, detail: 'Faites le point sur les observations avant de décider.', conseil: 'Relisez le journal et vérifiez que les contrôles prévus sont faits.' };
    }
    case 'stock_aliment':
      return a.niveau === 'rouge'
        ? { titre: 'Stock d’aliment épuisé', detail: 'Le stock enregistré est à zéro.', conseil: 'Achetez de l’aliment, puis enregistrez l’achat.' }
        : { titre: 'Stock d’aliment bas', detail: `Environ ${nombre(p.jours ?? 0)} ${pluriel(p.jours ?? 0, 'jour', 'jours')} d’autonomie (${nombre(p.stock ?? 0)} kg).`, conseil: 'Prévoyez un achat.' };
  }
}

export const fr = {
  nav: { accueil: 'Accueil', saisie: 'Saisie', cheptel: 'Cheptel', couveuse: 'Couveuse', sante: 'Santé', alertes: 'Alertes', reglages: 'Réglages' },
  jour: (d: Date) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
};
