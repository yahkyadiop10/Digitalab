import { useState, type FormEvent } from 'react';
import { Champ, Nombre, versNombre } from '../components/ui';
import { chargerDemo } from '../demo';
import { ErreurSaisie, repo } from '../repo';

export function Demarrage() {
  const [nom, setNom] = useState('');
  const [poules, setPoules] = useState(true);
  const [cailles, setCailles] = useState(false);
  const [nbPoules, setNbPoules] = useState('');
  const [nbCailles, setNbCailles] = useState('');
  const [surfacePoules, setSurfacePoules] = useState('');
  const [surfaceCailles, setSurfaceCailles] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  const creer = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const surface = (s: string) => (s ? versNombre(s) : null);
      if (poules && nbPoules) {
        const lg = await repo.creerLogement({ nom: 'Poulailler', type: 'batiment', surfaceM2: surface(surfacePoules) });
        await repo.creerLot({ nom: 'Mes poules', especeCode: 'poule', logementId: lg, effectif: versNombre(nbPoules) });
      }
      if (cailles && nbCailles) {
        const lg = await repo.creerLogement({ nom: 'Cages cailles', type: 'cage', surfaceM2: surface(surfaceCailles) });
        await repo.creerLot({ nom: 'Mes cailles', especeCode: 'caille', logementId: lg, effectif: versNombre(nbCailles) });
      }
      await repo.ecrireReglage('nomElevage', nom.trim());
      await repo.ecrireReglage('demarrageFait', true);
    } catch (err) {
      setErreur(err instanceof ErreurSaisie ? err.message : 'Création impossible. Réessayez.');
    }
  };

  return (
    <main className="demarrage">
      <h1>Bienvenue sur Digitalab</h1>
      <p className="muet">Quelques questions pour préparer votre élevage. Vous pourrez tout modifier plus tard.</p>
      <form onSubmit={creer}>
        <Champ libelle="Nom de votre élevage (facultatif)"><input value={nom} onChange={(e) => setNom(e.target.value)} /></Champ>
        <fieldset>
          <legend>Que élevez-vous ?</legend>
          <label className="case"><input type="checkbox" checked={poules} onChange={(e) => setPoules(e.target.checked)} /> Poules</label>
          {poules && (
            <>
              <Champ libelle="Combien de poules ?"><Nombre valeur={nbPoules} onChange={setNbPoules} /></Champ>
              <Champ libelle="Surface du poulailler en m² (facultatif)" aide="Sert à surveiller la place disponible."><Nombre valeur={surfacePoules} onChange={setSurfacePoules} pas={0.5} unite="m²" /></Champ>
            </>
          )}
          <label className="case"><input type="checkbox" checked={cailles} onChange={(e) => setCailles(e.target.checked)} /> Cailles</label>
          {cailles && (
            <>
              <Champ libelle="Combien de cailles ?"><Nombre valeur={nbCailles} onChange={setNbCailles} /></Champ>
              <Champ libelle="Surface des cages en m² (facultatif)"><Nombre valeur={surfaceCailles} onChange={setSurfaceCailles} pas={0.5} unite="m²" /></Champ>
            </>
          )}
        </fieldset>
        {erreur && <p className="erreur" role="alert">{erreur}</p>}
        <button className="bouton">Commencer</button>
      </form>
      <div className="actions">
        <button className="lien" onClick={() => void chargerDemo()}>Essayer avec des données d’exemple</button>
        <button className="lien" onClick={() => void repo.ecrireReglage('demarrageFait', true)}>Passer</button>
      </div>
    </main>
  );
}
