import { COUT_MOT_DE_PASSE_DEFAUT, type CoutMotDePasse } from './securite.js';

export interface Config {
  port: number;
  hote: string;
  databaseUrl: string;
  /** Sert à calculer l'empreinte des codes de secours. À garder secret en production. */
  secret: string;
  sessionJours: number;
  /** Coût de calcul des empreintes de mots de passe (scrypt). */
  coutMotDePasse: CoutMotDePasse;
  /**
   * Clé à saisir pour créer le premier administrateur : elle empêche qu'une personne du réseau prenne la main pendant l'installation.
   * Absente, le serveur en invente une au démarrage tant qu'aucun administrateur n'existe et l'affiche dans sa console.
   */
  cleInstallation: string | null;
  /** Origines web autorisées (CORS) ; `true` les autorise toutes. */
  origines: string[] | true;
}

export function lireConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env['NODE_ENV'] === 'production';
  const secret = env['DIGITALAB_SECRET'] ?? (production ? '' : 'secret-de-developpement-a-changer');
  if (secret.length < 16) throw new Error('DIGITALAB_SECRET est obligatoire en production (16 caractères au moins).');
  const databaseUrl = env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL est obligatoire (ex. postgres://utilisateur:motdepasse@localhost:5432/digitalab).');
  const origines = env['DIGITALAB_ORIGINES'];
  return {
    port: Number(env['PORT'] ?? 8080),
    hote: env['HOST'] ?? '0.0.0.0',
    databaseUrl,
    secret,
    sessionJours: 90,
    coutMotDePasse: COUT_MOT_DE_PASSE_DEFAUT,
    cleInstallation: env['DIGITALAB_CLE_INSTALLATION']?.trim() || null,
    origines: origines && origines !== '*' ? origines.split(',').map((o) => o.trim()).filter(Boolean) : true,
  };
}
