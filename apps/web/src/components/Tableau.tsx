import { useMemo, type ReactNode } from 'react';
import { peut } from '../droits';
import { stockAlimentKg, consommationMoyenneKg, jourLocal, tableauDeBord, type LigneLocal, type Niveau, type TableauDeBord } from '@digitalab/core';
import { TYPES_LOGEMENT } from '../i18n/fr';
import { dateCourte, formatMontant, signe, virgule } from '../format';
import type { Elevage } from '../useElevage';

/** Niveau de couleur d'une densité en %, d'après les seuils réglés. */
function niveauDensite(pct: number | null, seuils: { jaune: number; orange: number; rouge: number }): Niveau | 'vert' {
  if (pct === null) return 'vert';
  if (pct >= seuils.rouge * 100) return 'rouge';
  if (pct >= seuils.orange * 100) return 'orange';
  if (pct >= seuils.jaune * 100) return 'jaune';
  return 'vert';
}

function Carte({ titre, lien, libelleLien, children }: { titre: string; lien?: string; libelleLien?: string; children: ReactNode }) {
  return (
    <section className="carte tb-carte" aria-label={titre}>
      <header className="tb-titre">
        <h3>{titre}</h3>
        {lien && <a className="lien" href={`#/${lien}`}>{libelleLien ?? 'Voir'}</a>}
      </header>
      {children}
    </section>
  );
}

function Barre({ part, niveau = 'vert' }: { part: number; niveau?: Niveau | 'vert' }) {
  return <span className={`barre n-${niveau}`} role="presentation"><i style={{ width: `${Math.min(100, Math.max(0, part))}%` }} /></span>;
}

function Ligne({ libelle, valeur, detail }: { libelle: ReactNode; valeur: ReactNode; detail?: ReactNode }) {
  return <div className="ligne"><span>{libelle}{detail && <><br /><small className="muet">{detail}</small></>}</span><b>{valeur}</b></div>;
}

function Oeufs7j({ jours }: { jours: TableauDeBord['production']['oeufs7j'] }) {
  const max = Math.max(1, ...jours.map((j) => j.n));
  const l = 40, h = 56;
  return (
    <svg viewBox={`0 0 ${l * jours.length} ${h + 18}`} className="barres" role="img" aria-label={`Œufs des 7 derniers jours : ${jours.map((j) => j.n).join(', ')}`}>
      {jours.map((j, i) => {
        const hauteur = (j.n / max) * h;
        const lettre = new Date(`${j.jour}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'narrow' });
        return (
          <g key={j.jour}>
            <rect x={i * l + 6} y={h - hauteur} width={l - 12} height={Math.max(hauteur, j.n > 0 ? 2 : 0)} rx="3" />
            <text x={i * l + l / 2} y={h + 13} fontSize="11" textAnchor="middle">{lettre.toUpperCase()}</text>
          </g>
        );
      })}
    </svg>
  );
}

function LocalLigne({ l, niveau }: { l: LigneLocal; niveau: Niveau | 'vert' }) {
  const libelleNiveau = { vert: '', jaune: ' · à surveiller', orange: ' · presque plein', rouge: ' · surdensité' }[niveau];
  return (
    <div className="tb-local">
      <div className="ligne">
        <span>{l.nom}<br /><small className="muet">{l.nom === TYPES_LOGEMENT[l.type] ? '' : `${TYPES_LOGEMENT[l.type]} · `}{l.effectif} animaux{l.surfaceM2 ? ` · ${virgule(l.surfaceM2)} m²` : ''}</small></span>
        <b>{l.densitePct === null ? '–' : `${l.densitePct} %`}</b>
      </div>
      {l.densitePct !== null && <Barre part={l.densitePct} niveau={niveau} />}
      {libelleNiveau && <small className={`tb-niveau n-${niveau}`}>{libelleNiveau.slice(3)}</small>}
    </div>
  );
}

export function Tableau({ elevage }: { elevage: Elevage }) {
  const { donnees, operations, paiements, employes, reglages, maintenant } = elevage;
  const t = useMemo(() => tableauDeBord({ donnees, operations, paiements, employes, especes: reglages.especes, protocoles: reglages.protocoles, maintenant }), [donnees, operations, paiements, employes, reglages.especes, reglages.protocoles, maintenant]);
  const auj = jourLocal(maintenant);
  const stock = donnees.entreesStock.length > 0 ? stockAlimentKg(donnees) : null;
  const conso = consommationMoyenneKg(donnees, auj);
  const maxEspece = Math.max(1, ...t.cheptel.parEspece.map((e) => e.effectif));
  const quarantaines = donnees.quarantaines.filter((q) => !q.sortie);

  return (
    <>
      <h2>Tableau de bord</h2>
      <div className="tb-grille">
        <Carte titre="Cheptel" lien="cheptel" libelleLien="Mes lots">
          <div className="tb-grand"><b>{t.cheptel.total}</b><span>animaux dans {t.cheptel.lotsActifs} lot{t.cheptel.lotsActifs > 1 ? 's' : ''}</span></div>
          {t.cheptel.parEspece.map((e) => (
            <div key={e.code}><Ligne libelle={e.nom} valeur={e.effectif} detail={`${e.lots} lot${e.lots > 1 ? 's' : ''}`} /><Barre part={(e.effectif / maxEspece) * 100} /></div>
          ))}
          <h4>Par âge</h4>
          <Ligne libelle="Poussins (moins de 4 semaines)" valeur={t.cheptel.parAge.poussins} />
          <Ligne libelle="Jeunes" valeur={t.cheptel.parAge.jeunes} />
          <Ligne libelle="Adultes" valeur={t.cheptel.parAge.adultes} />
          {t.cheptel.parAge.inconnu > 0 && <Ligne libelle="Âge non renseigné" valeur={t.cheptel.parAge.inconnu} />}
          {t.cheptel.parRace.length > 0 && (
            <>
              <h4>Races</h4>
              {t.cheptel.parRace.slice(0, 6).map((r) => <Ligne key={`${r.espece}|${r.race}`} libelle={r.race} detail={r.espece} valeur={r.effectif} />)}
              {t.cheptel.parRace.length > 6 && <p className="muet">et {t.cheptel.parRace.length - 6} autre(s)</p>}
            </>
          )}
        </Carte>

        <Carte titre="Bâtiments et cages" lien="reglages" libelleLien="Gérer">
          {t.locaux.length === 0 && <p className="muet">Aucun local. Ajoutez vos bâtiments et cages dans Réglages pour suivre la place disponible.</p>}
          {t.locaux.map((l) => <LocalLigne key={l.logementId} l={l} niveau={niveauDensite(l.densitePct, reglages.seuils.densite)} />)}
          {t.sansLocal.effectif > 0 && <Ligne libelle="Sans local" detail={`${t.sansLocal.lots} lot${t.sansLocal.lots > 1 ? 's' : ''}`} valeur={t.sansLocal.effectif} />}
          <p className="muet">Le pourcentage compare les animaux à la place conseillée.</p>
        </Carte>

        <Carte titre="Production" lien="cheptel" libelleLien="Détails">
          <div className="tb-grand"><b>{t.production.oeufsAujourdhui}</b><span>œufs aujourd’hui</span></div>
          <Oeufs7j jours={t.production.oeufs7j} />
          <Ligne libelle="Œufs sur 7 jours" valeur={t.production.oeufs7j.reduce((a, j) => a + j.n, 0)} />
          <Ligne libelle="Taux de ponte (7 jours)" valeur={t.production.tauxPonte7jPct === null ? '–' : `${t.production.tauxPonte7jPct} %`} detail="œufs par pondeuse et par jour" />
        </Carte>

        <Carte titre="Couveuse" lien="couveuse" libelleLien="Ouvrir">
          {t.incubation.misesEnCours === 0 ? <p className="muet">Aucun œuf en incubation.</p> : (
            <>
              <div className="tb-grand"><b>{t.incubation.oeufsEnCours}</b><span>œufs en incubation ({t.incubation.misesEnCours} mise{t.incubation.misesEnCours > 1 ? 's' : ''})</span></div>
              {t.incubation.prochaineEclosion && <Ligne libelle="Prochaine éclosion" detail={t.incubation.prochaineEclosion.nom} valeur={dateCourte(t.incubation.prochaineEclosion.date)} />}
            </>
          )}
        </Carte>

        <Carte titre="Santé et quarantaine" lien="sante" libelleLien="Santé">
          <Ligne libelle="Vaccins à faire" valeur={t.sante.vaccinsAFaire} />
          <Ligne libelle="Traitements en cours" valeur={t.sante.traitementsEnCours} />
          <Ligne libelle="Délais d’attente en cours" valeur={t.sante.delaisAttente} />
          <Ligne libelle="Animaux en quarantaine" detail={quarantaines.length > 0 ? `${quarantaines.length} arrivage${quarantaines.length > 1 ? 's' : ''}` : undefined} valeur={t.cheptel.enQuarantaine} />
          <div className="actions"><a className="lien" href="#/quarantaine">Zone de quarantaine</a></div>
        </Carte>

        {peut(elevage, 'finances.voir_recettes') && peut(elevage, 'finances.voir_depenses') && (
        <Carte titre="Situation financière" lien="finances" libelleLien="Finances">
          <div className="tb-duo">
            <div><span className="muet">Total des entrées</span><b className="gain">{formatMontant(t.finances.recettesTotal)}</b></div>
            <div><span className="muet">Total des sorties</span><b>{formatMontant(t.finances.depensesTotal)}</b></div>
          </div>
          <Ligne libelle="Solde" valeur={`${signe(t.finances.resultatTotal)} ${formatMontant(t.finances.resultatTotal)}`.trim()} />
          <h4>Ce mois-ci</h4>
          <Ligne libelle="Entrées" valeur={formatMontant(t.finances.recettesMois)} />
          <Ligne libelle="Sorties" valeur={formatMontant(t.finances.depensesMois)} />
          <Ligne libelle="Résultat" valeur={`${signe(t.finances.resultatMois)} ${formatMontant(t.finances.resultatMois)}`.trim()} />
          {(t.finances.aEncaisser > 0 || t.finances.aPayer > 0) && (
            <>
              <h4>En attente</h4>
              <Ligne libelle="On vous doit" valeur={formatMontant(t.finances.aEncaisser)} />
              <Ligne libelle="Vous devez" valeur={formatMontant(t.finances.aPayer)} />
              {t.finances.enRetard > 0 && <p className="erreur">{t.finances.enRetard} règlement{t.finances.enRetard > 1 ? 's' : ''} en retard</p>}
            </>
          )}
          {t.finances.salairesAPayer > 0 && (
            <p><a className="lien" href="#/finances/salaires">{t.finances.salairesAPayer} salaire{t.finances.salairesAPayer > 1 ? 's' : ''} à payer ce mois-ci</a></p>
          )}
        </Carte>
        )}

        <Carte titre="Aliment" lien="saisie/stock" libelleLien="Mettre à jour">
          {stock === null ? <p className="muet">Le stock n’est pas suivi. Enregistrez votre stock de départ pour être prévenu avant la rupture.</p> : (
            <>
              <div className="tb-grand"><b>{virgule(stock)}</b><span>kg en stock</span></div>
              {conso ? <Ligne libelle="Autonomie" detail={`environ ${virgule(Math.round(conso * 10) / 10)} kg par jour`} valeur={`${Math.floor(stock / conso)} jours`} /> : <p className="muet">Notez l’aliment distribué pour calculer l’autonomie.</p>}
            </>
          )}
        </Carte>
      </div>
    </>
  );
}
