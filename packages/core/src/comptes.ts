/** Règles des comptes (identifiant et mot de passe), partagées par le serveur et l'application pour que les deux disent la même chose. */

export const MOT_DE_PASSE_MIN = 8;
export const MOT_DE_PASSE_MAX = 128;
/** Un mot de passe provisoire donné par l'administrateur cesse de fonctionner après ce délai. */
export const MOT_DE_PASSE_PROVISOIRE_JOURS = 5;
/** Après ce nombre d'échecs de suite sur un identifiant, il est bloqué quelques minutes. */
export const ESSAIS_CONNEXION_MAX = 5;
export const BLOCAGE_CONNEXION_MINUTES = 15;

const SANS_ACCENTS = /[̀-ͯ]/g;

/** « Aïssatou Ndiaye » → « aissatou-ndiaye » : minuscules, sans accents, seulement lettres, chiffres et tirets. */
export function simplifier(texte: string): string {
  return texte
    .normalize('NFD').replace(SANS_ACCENTS, '')
    .replace(/[œŒ]/g, 'oe').replace(/[æÆ]/g, 'ae')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Ce que l'on tape dans la case « identifiant » : espaces autour retirés, minuscules, sans accents. */
export function normaliserIdentifiant(brut: string): string {
  return brut.normalize('NFD').replace(SANS_ACCENTS, '').trim().toLowerCase();
}

/** Un identifiant valable : 3 à 40 caractères, lettres minuscules, chiffres, point, tiret ou tiret bas, commençant par une lettre ou un chiffre. */
export function problemeIdentifiant(identifiant: string): string | null {
  if (identifiant.length < 3) return 'L’identifiant doit avoir au moins 3 caractères.';
  if (identifiant.length > 40) return 'L’identifiant est trop long (40 caractères au plus).';
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(identifiant)) return 'L’identifiant ne peut contenir que des lettres sans accent, des chiffres, des points et des tirets.';
  return null;
}

/** L'identifiant proposé pour une personne : `nom.prenom`, par exemple « ndiaye.moussa ». */
export function identifiantDepuisNom(prenom: string, nom: string): string {
  const n = simplifier(nom);
  const p = simplifier(prenom);
  return [n, p].filter(Boolean).join('.').slice(0, 36);
}

/** Si l'identifiant est déjà pris, ajoute 2, 3, 4… jusqu'à en trouver un libre. */
export function identifiantLibre(base: string, pris: (identifiant: string) => boolean): string {
  if (!pris(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const essai = `${base}${i}`;
    if (!pris(essai)) return essai;
  }
  throw new Error('Aucun identifiant libre.');
}

const TROP_COURANTS = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', 'password', 'password1', 'motdepasse', 'motdepasse1', 'azertyui', 'azerty123',
  'azertyuiop', 'qwertyui', 'qwerty123', 'abcd1234', 'admin123', 'administrateur', 'bienvenue', 'senegal1', 'senegal123', 'dakar123', 'passer123',
]);

/** Le mot de passe est-il acceptable ? Renvoie la phrase à afficher, ou `null` s'il convient. */
export function problemeMotDePasse(motDePasse: string, identifiant = ''): string | null {
  if (motDePasse.length < MOT_DE_PASSE_MIN) return `Le mot de passe doit avoir au moins ${MOT_DE_PASSE_MIN} caractères.`;
  if (motDePasse.length > MOT_DE_PASSE_MAX) return `Le mot de passe est trop long (${MOT_DE_PASSE_MAX} caractères au plus).`;
  const bas = motDePasse.toLowerCase();
  if (TROP_COURANTS.has(bas)) return 'Ce mot de passe est trop courant. Choisissez-en un autre, plus difficile à deviner.';
  if (new Set(bas).size < 4) return 'Ce mot de passe est trop simple : variez les caractères.';
  if (identifiant && (bas === identifiant.toLowerCase() || (identifiant.length >= 4 && bas.includes(identifiant.toLowerCase())))) return 'Le mot de passe ne doit pas contenir votre identifiant.';
  return null;
}
