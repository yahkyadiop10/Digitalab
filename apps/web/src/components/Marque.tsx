import type { ProfilAffiche } from '../droits';

/**
 * Logo du produit, en haut de chaque écran. Texte et œuf dessinés ici en attendant le logo définitif :
 * pour le remplacer, renseignez `LOGO_PRODUIT` (image encodée en `data:`) et il s'affichera à la place.
 */
export const LOGO_PRODUIT: string | null = null;

export function LogoProduit() {
  if (LOGO_PRODUIT) return <img className="logo-produit" src={LOGO_PRODUIT} alt="AviMaster" />;
  return (
    <span className="logo-produit" role="img" aria-label="AviMaster">
      <svg viewBox="0 0 24 28" width="18" height="21" aria-hidden="true" focusable="false">
        <path d="M12 1C7 1 2.5 9.2 2.5 16.2 2.5 22.2 6.6 27 12 27s9.5-4.8 9.5-10.8C21.5 9.2 17 1 12 1Z" fill="var(--jaune-oeuf)" />
        <path d="M7 17.5c1.4 2.6 3.1 3.8 5.4 3.9" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="logo-texte"><span>Avi</span><b>Master</b></span>
    </span>
  );
}

/** Logo de la ferme, ou ses initiales tant qu'elle n'en a pas. */
export function Embleme({ profil }: { profil: ProfilAffiche }) {
  if (profil.logo) {
    return (
      <span className="embleme embleme-logo-cadre">
        <img src={profil.logo} alt={`Logo de ${profil.nom}`} />
      </span>
    );
  }
  const initiales = profil.nom.split(/[\s'’-]+/).filter(Boolean).slice(0, 2).map((m) => m[0]!.toUpperCase()).join('') || 'É';
  return <span className="embleme embleme-initiales" aria-hidden="true">{initiales}</span>;
}

/** Pied de page : la plateforme et son éditeur. */
export function Pied() {
  return (
    <footer className="pied">
      <span><b>AviMaster</b> · éditée par <b>AYA BUSINESS</b></span>
    </footer>
  );
}
