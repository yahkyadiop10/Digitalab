import { useState, type ChangeEvent, type FormEvent } from 'react';
import { SEUILS_PAR_DEFAUT, problemeDeCode, type Logement, type Seuils, type TypeLogement } from '@digitalab/core';
import { Champ, useNotifier, versNombre, useConfirmer } from '../components/ui';
import { ErreurCode, securite, useAppareil } from '../securite';
import { verrouillerMaintenant } from '../session';
import { synchro } from '../sync';
import { chargerDemo } from '../demo';
import { peut, profilDe } from '../droits';
import { redimensionnerLogo } from '../logo';
import { depuisQuand, useConnexion } from './Compte';
import { TYPES_LOGEMENT } from '../i18n/fr';
import { ErreurSaisie, repo } from '../repo';
import type { Reglages } from '../reglages';
import type { Elevage } from '../useElevage';

export function Reglages({ elevage }: { elevage: Elevage }) {
  return (
    <>
      <h2>Session et sécurité</h2>
      <SessionEtSecurite elevage={elevage} />
      <h2>Compte et équipe</h2>
      <CarteCompte />
      {peut(elevage, 'admin.utilisateurs') && (
        <a className="carte ligne" href="#/utilisateurs" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span>Gestion des utilisateurs<br /><small className="muet">{elevage.moi.relie ? 'Ajouter des personnes, choisir ce que chacune voit et fait' : 'Ajouter des personnes et choisir ce que chacune voit et fait (demande un compte relié)'}</small></span>
          <b aria-hidden="true">›</b>
        </a>
      )}
      {peut(elevage, 'admin.journal') && (
        <a className="carte ligne" href="#/journal" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span>Journal d’activité<br /><small className="muet">Qui a fait quoi, et quand</small></span>
          <b aria-hidden="true">›</b>
        </a>
      )}
      {peut(elevage, 'admin.elevage') && (
        <>
          <h2>Mon élevage</h2>
          <MonElevage elevage={elevage} />
        </>
      )}
      {peut(elevage, 'cheptel.locaux') && (
        <>
          <h2>Mes locaux</h2>
          <Locaux logements={elevage.donnees.logements} />
        </>
      )}
      {peut(elevage, 'admin.seuils') && (
        <>
          <h2>Places et seuils d’alerte</h2>
          <Seuillage elevage={elevage} />
        </>
      )}
      {peut(elevage, 'admin.elevage') && (
        <>
          <h2>Mes données</h2>
          <Donnees />
        </>
      )}
      <h2>À propos</h2>
      <div className="carte muet">
        AviMaster, version de travail. Vos données restent sur cet appareil (et sur le serveur si vous avez relié un compte) ; faites régulièrement une sauvegarde. L’application fonctionne sans connexion une fois chargée.
      </div>
    </>
  );
}

function SessionEtSecurite({ elevage }: { elevage: Elevage }) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const appareil = useAppareil();
  const relie = elevage.moi.relie;
  const { verrouillageMin, deconnexionMin } = elevage.politique;
  const [mode, setMode] = useState<'aucun' | 'code'>('aucun');
  const [ancien, setAncien] = useState('');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [lock, setLock] = useState(String(verrouillageMin));
  const [decon, setDecon] = useState(String(deconnexionMin));

  const enregistrerCode = async (e: FormEvent) => {
    e.preventDefault();
    const probleme = problemeDeCode(code);
    if (probleme) return setErreur(probleme);
    if (code !== confirmation) return setErreur('Les deux codes ne sont pas identiques.');
    try {
      await securite.definirCode(code, appareil?.aCode ? ancien : undefined);
      notifier('Code enregistré ✓');
      setMode('aucun');
      setAncien(''); setCode(''); setConfirmation(''); setErreur(null);
    } catch (err) {
      setErreur(err instanceof ErreurCode ? err.message : 'Enregistrement impossible.');
    }
  };

  return (
    <div className="carte">
      <p className="muet">
        {relie || appareil?.aCode
          ? `L’application se verrouille après ${verrouillageMin} minute${verrouillageMin > 1 ? 's' : ''} sans utilisation${relie ? ` et vous déconnecte après ${deconnexionMin} minute${deconnexionMin > 1 ? 's' : ''}` : ''}.`
          : 'Sans compte, l’application reste ouverte. Vous pouvez la protéger par un code : elle se verrouillera quand vous ne l’utilisez plus.'}
      </p>
      <div className="rangee">
        {appareil?.aCode && <button className="bouton court" onClick={() => verrouillerMaintenant(elevage.politique)}>🔒 Verrouiller maintenant</button>}
        {relie && <button className="bouton alt court" onClick={async () => { if (await confirmer('Se déconnecter ? Vos données restent sur cet appareil, mais il faudra vous reconnecter avec un code pour les rouvrir.')) await synchro.deconnecter(); }}>Se déconnecter</button>}
        <button className="bouton alt court" onClick={() => setMode(mode === 'code' ? 'aucun' : 'code')}>{appareil?.aCode ? 'Changer mon code' : 'Définir un code de verrouillage'}</button>
      </div>
      {mode === 'code' && (
        <form onSubmit={enregistrerCode}>
          {appareil?.aCode && <Champ libelle="Code actuel"><input type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} value={ancien} onChange={(e) => setAncien(e.target.value.replace(/\D/g, ''))} /></Champ>}
          <Champ libelle="Nouveau code (4 à 6 chiffres)"><input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Champ>
          <Champ libelle="Confirmez le nouveau code"><input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={confirmation} onChange={(e) => setConfirmation(e.target.value.replace(/\D/g, ''))} /></Champ>
          {erreur && <p className="erreur" role="alert">{erreur}</p>}
          <button className="bouton court" disabled={code.length < 4}>Enregistrer le code</button>
          {!relie && appareil?.aCode && (
            <button type="button" className="lien danger" onClick={async () => { try { await securite.retirerCode(ancien); notifier('Code retiré'); setMode('aucun'); } catch { setErreur('Entrez votre code actuel pour le retirer.'); } }}>Retirer le code</button>
          )}
        </form>
      )}
      {peut(elevage, 'admin.elevage') && relie && (
        <>
          <h3>Délais de la ferme</h3>
          <p className="muet">Valables pour toutes les personnes de l’élevage. Le verrouillage se débloque avec le code, même sans réseau ; la déconnexion demande un nouveau code de connexion, donc du réseau.</p>
          <div className="duo">
            <Champ libelle="Verrouiller après (minutes)"><input inputMode="numeric" value={lock} onChange={(e) => setLock(e.target.value)} /></Champ>
            <Champ libelle="Déconnecter après (minutes)"><input inputMode="numeric" value={decon} onChange={(e) => setDecon(e.target.value)} /></Champ>
          </div>
          <button className="bouton alt court" onClick={async () => { await repo.enregistrerProfil({ securite: { verrouillageMin: Number(lock), deconnexionMin: Number(decon) } }); notifier('Délais enregistrés ✓'); }}>Enregistrer les délais</button>
        </>
      )}
      <p className="muet">Le verrouillage cache l’application mais ne chiffre pas les données de l’appareil : gardez aussi le verrouillage d’écran de votre téléphone.</p>
    </div>
  );
}

function CarteCompte() {
  const connexion = useConnexion();
  return (
    <a className="carte ligne" href="#/compte" style={{ textDecoration: 'none', color: 'inherit' }}>
      <span>
        {connexion ? `Relié à « ${connexion.organisationNom} »` : 'Partager avec mes aides et mon vétérinaire'}
        <br />
        <small className="muet">{connexion ? `Dernière synchronisation : ${depuisQuand(connexion.derniereSync)}` : 'Créer un compte et synchroniser plusieurs téléphones'}</small>
      </span>
      <b aria-hidden="true">›</b>
    </a>
  );
}

function MonElevage({ elevage }: { elevage: Elevage }) {
  const p = profilDe(elevage);
  const [v, setV] = useState({ nom: p.nom === 'Mon élevage' && !elevage.reglages.nomElevage ? '' : p.nom, adresse: p.adresse, telephone: p.telephone, ninea: p.ninea });
  const [erreur, setErreur] = useState<string | null>(null);
  const notifier = useNotifier();

  const enregistrer = async () => {
    try {
      await repo.enregistrerProfil({ nom: v.nom, adresse: v.adresse, telephone: v.telephone, ninea: v.ninea });
      await repo.ecrireReglage('nomElevage', v.nom.trim());
      notifier('Enregistré ✓');
    } catch (e) {
      setErreur(e instanceof ErreurSaisie ? e.message : 'Enregistrement impossible.');
    }
  };

  const choisirLogo = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      await repo.enregistrerProfil({ logo: await redimensionnerLogo(f) });
      setErreur(null);
      notifier('Logo enregistré ✓');
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Logo impossible.');
    }
  };

  return (
    <div className="carte">
      <div className="logo-bloc">
        {p.logo ? <img className="logo-elevage" src={p.logo} alt={`Logo de ${p.nom}`} /> : <p className="muet">Pas encore de logo.</p>}
        <label className="bouton alt court">
          {p.logo ? 'Changer le logo' : 'Ajouter le logo'}
          <input type="file" accept="image/*" hidden onChange={(e) => void choisirLogo(e)} />
        </label>
        {p.logo && <button className="lien danger" onClick={async () => { await repo.enregistrerProfil({ logo: null }); notifier('Logo retiré'); }}>Retirer</button>}
        <p className="muet">Il s’affiche dans l’application et s’imprime en haut de vos factures, reçus et récapitulatifs.</p>
      </div>
      <Champ libelle="Nom de l’élevage"><input value={v.nom} onChange={(e) => setV({ ...v, nom: e.target.value })} /></Champ>
      <Champ libelle="Adresse (facultatif)"><input value={v.adresse} onChange={(e) => setV({ ...v, adresse: e.target.value })} /></Champ>
      <Champ libelle="Téléphone (facultatif)"><input type="tel" value={v.telephone} onChange={(e) => setV({ ...v, telephone: e.target.value })} /></Champ>
      <Champ libelle="NINEA ou registre de commerce (facultatif)"><input value={v.ninea} onChange={(e) => setV({ ...v, ninea: e.target.value })} /></Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <button className="bouton court" onClick={() => void enregistrer()}>Enregistrer</button>
    </div>
  );
}

function Locaux({ logements }: { logements: Logement[] }) {
  const [edition, setEdition] = useState<string | 'nouveau' | null>(null);
  return (
    <>
      {logements.length === 0 && <div className="carte muet">Aucun local. Ajoutez-en un pour surveiller la place disponible.</div>}
      {logements.map((l) =>
        edition === l.id ? (
          <FormLocal key={l.id} initial={l} fin={() => setEdition(null)} />
        ) : (
          <div key={l.id} className="carte ligne">
            <span>{l.nom} · {TYPES_LOGEMENT[l.type]}{l.surfaceM2 ? ` · ${String(l.surfaceM2).replace('.', ',')} m²` : ''}</span>
            <button className="lien" onClick={() => setEdition(l.id)}>Modifier</button>
          </div>
        ),
      )}
      {edition === 'nouveau' ? <FormLocal fin={() => setEdition(null)} /> : <button className="bouton alt" onClick={() => setEdition('nouveau')}>+ Ajouter un local</button>}
    </>
  );
}

function FormLocal({ initial, fin }: { initial?: Logement; fin: () => void }) {
  const [nom, setNom] = useState(initial?.nom ?? '');
  const [type, setType] = useState<TypeLogement>(initial?.type ?? 'batiment');
  const [surface, setSurface] = useState(initial?.surfaceM2 ? String(initial.surfaceM2) : '');
  const [erreur, setErreur] = useState<string | null>(null);
  const donnees = { nom, type, surfaceM2: surface ? versNombre(surface) : null };
  const soumettre = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (initial) await repo.modifierLogement(initial.id, donnees);
      else await repo.creerLogement(donnees);
      fin();
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Enregistrement impossible.');
    }
  };
  return (
    <form className="carte" onSubmit={soumettre}>
      <Champ libelle="Nom"><input value={nom} onChange={(e) => setNom(e.target.value)} /></Champ>
      <Champ libelle="Type">
        <select value={type} onChange={(e) => setType(e.target.value as TypeLogement)}>
          {Object.entries(TYPES_LOGEMENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Champ>
      <Champ libelle="Surface en m² (facultatif)"><input inputMode="decimal" value={surface} onChange={(e) => setSurface(e.target.value)} /></Champ>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      <div className="rangee">
        <button className="bouton court">Enregistrer</button>
        <button type="button" className="bouton alt court" onClick={fin}>Fermer</button>
        {initial && (
          <button type="button" className="lien" onClick={async () => { try { await repo.supprimerLogement(initial.id); fin(); } catch (err) { setErreur(err instanceof ErreurSaisie ? err.message : 'Suppression impossible.'); } }}>Supprimer</button>
        )}
      </div>
    </form>
  );
}

function Seuillage({ elevage }: { elevage: Elevage }) {
  const { reglages } = elevage;
  const notifier = useNotifier();
  const enregistrerSeuils = async (s: Seuils) => { await repo.ecrireReglage('seuils', s); notifier('Seuils enregistrés ✓'); };
  const s = reglages.seuils;
  const num = (v: string, defaut: number) => { const x = versNombre(v); return Number.isFinite(x) ? x : defaut; };

  return (
    <>
      <div className="carte">
        <p className="muet">Place minimale par animal, en m². Valeurs de départ à adapter à chaque race.</p>
        {Object.values(reglages.especes).map((e) => (
          <Champ key={e.code} libelle={`${e.nom} (m² par animal)`}>
            <input inputMode="decimal" defaultValue={String(e.m2ParAnimal).replace('.', ',')} onBlur={async (ev) => {
              const v = num(ev.target.value, e.m2ParAnimal);
              if (v > 0 && v !== e.m2ParAnimal) {
                const actuel = await repo.lireReglage<Record<string, { m2ParAnimal?: number }>>('especes', {});
                await repo.ecrireReglage('especes', { ...actuel, [e.code]: { ...(actuel[e.code] ?? {}), m2ParAnimal: v } });
                notifier('Enregistré ✓');
              }
            }} />
          </Champ>
        ))}
      </div>
      <div className="carte">
        <p className="muet">Seuils d’alerte. Ce sont des exemples de départ, à valider avec un vétérinaire.</p>
        <Seuil libelle="Place occupée : jaune à (%)" valeur={s.densite.jaune * 100} onSave={(v) => enregistrerSeuils({ ...s, densite: { ...s.densite, jaune: num(v, 80) / 100 } })} />
        <Seuil libelle="Place occupée : orange à (%)" valeur={s.densite.orange * 100} onSave={(v) => enregistrerSeuils({ ...s, densite: { ...s.densite, orange: num(v, 90) / 100 } })} />
        <Seuil libelle="Place occupée : rouge à (%)" valeur={s.densite.rouge * 100} onSave={(v) => enregistrerSeuils({ ...s, densite: { ...s.densite, rouge: num(v, 100) / 100 } })} />
        <Seuil libelle="Mortalité en 1 jour : orange à (%)" valeur={s.mortalite1j.orange} onSave={(v) => enregistrerSeuils({ ...s, mortalite1j: { ...s.mortalite1j, orange: num(v, 1) } })} />
        <Seuil libelle="Mortalité en 1 jour : rouge à (%)" valeur={s.mortalite1j.rouge} onSave={(v) => enregistrerSeuils({ ...s, mortalite1j: { ...s.mortalite1j, rouge: num(v, 2) } })} />
        <Seuil libelle="Mortalité en 7 jours : orange à (%)" valeur={s.mortalite7j.orange} onSave={(v) => enregistrerSeuils({ ...s, mortalite7j: { ...s.mortalite7j, orange: num(v, 3) } })} />
        <Seuil libelle="Mortalité en 7 jours : rouge à (%)" valeur={s.mortalite7j.rouge} onSave={(v) => enregistrerSeuils({ ...s, mortalite7j: { ...s.mortalite7j, rouge: num(v, 5) } })} />
        <Seuil libelle="Morts minimum pour une alerte orange ou rouge" valeur={s.minDeces} onSave={(v) => enregistrerSeuils({ ...s, minDeces: Math.max(1, Math.round(num(v, 2))) })} />
        <Seuil libelle="Ponte : orange sous (% de la moyenne)" valeur={s.ponte.orange * 100} onSave={(v) => enregistrerSeuils({ ...s, ponte: { ...s.ponte, orange: num(v, 85) / 100 } })} />
        <Seuil libelle="Ponte : rouge sous (% de la moyenne)" valeur={s.ponte.rouge * 100} onSave={(v) => enregistrerSeuils({ ...s, ponte: { ...s.ponte, rouge: num(v, 60) / 100 } })} />
        <Seuil libelle="Ponte du jour jugée à partir de (heure)" valeur={s.heureBilanPonte} onSave={(v) => enregistrerSeuils({ ...s, heureBilanPonte: Math.min(23, Math.max(0, Math.round(num(v, 17)))) })} />
        <Seuil libelle="Aliment : jaune sous (jours)" valeur={s.autonomieAliment.jaune} onSave={(v) => enregistrerSeuils({ ...s, autonomieAliment: { ...s.autonomieAliment, jaune: num(v, 7) } })} />
        <Seuil libelle="Aliment : orange sous (jours)" valeur={s.autonomieAliment.orange} onSave={(v) => enregistrerSeuils({ ...s, autonomieAliment: { ...s.autonomieAliment, orange: num(v, 3) } })} />
        <button className="lien" onClick={async () => { await repo.ecrireReglage('seuils', SEUILS_PAR_DEFAUT); notifier('Valeurs de départ rétablies'); }}>Rétablir les valeurs de départ</button>
      </div>
    </>
  );
}

function Seuil({ libelle, valeur, onSave }: { libelle: string; valeur: number; onSave: (v: string) => void }) {
  const texte = String(Math.round(valeur * 10) / 10).replace('.', ',');
  return (
    <Champ libelle={libelle}>
      <input key={texte} inputMode="decimal" defaultValue={texte} onBlur={(e) => { if (e.target.value !== texte) onSave(e.target.value); }} />
    </Champ>
  );
}

function Donnees() {
  const confirmer = useConfirmer();
  const notifier = useNotifier();
  const sauvegarder = async () => {
    const blob = new Blob([await repo.exporter()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `digitalab-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    notifier('Sauvegarde téléchargée ✓');
  };
  const restaurer = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!await confirmer('Remplacer toutes les données actuelles par cette sauvegarde ? Si un compte est relié, les fiches plus récentes du serveur reviendront à la prochaine synchronisation.')) return;
    try {
      await repo.importer(await f.text());
      notifier('Sauvegarde restaurée ✓');
    } catch (err) {
      notifier(err instanceof ErreurSaisie ? err.message : 'Restauration impossible.', { erreur: true });
    }
  };
  return (
    <div className="carte">
      <button className="bouton" onClick={sauvegarder}>Télécharger une sauvegarde</button>
      <label className="bouton alt">
        Restaurer une sauvegarde
        <input type="file" accept="application/json,.json" hidden onChange={restaurer} />
      </label>
      <div className="actions">
        <button className="lien" onClick={async () => { if (await confirmer('Ajouter des données d’exemple à votre élevage ?')) { await chargerDemo(); notifier('Exemple chargé'); } }}>Ajouter des données d’exemple</button>
        <button className="lien danger" onClick={async () => { if (await confirmer('Effacer toutes les données de cet appareil ? Si un compte est relié, elles reviendront depuis le serveur à la prochaine synchronisation.')) { await repo.toutEffacer(); notifier('Données effacées'); } }}>Tout effacer</button>
      </div>
    </div>
  );
}
