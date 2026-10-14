import { COUT_MOT_DE_PASSE_DEFAUT, type CoutMotDePasse } from './securite.js';

export interface Config {
  port: number;
  hote: string;
  databaseUrl: string;
  sessionJours: number;
  /** Coût de calcul des empreintes de mots de passe (scrypt). */
  coutMotDePasse: CoutMotDePasse;
  /** Dossier de l'application construite (`apps/web/dist`) que le serveur distribue à son adresse : ouvrir le lien affiche l'application. */
  dossierWeb: string | null;
  /** Le serveur est derrière un relais de confiance (hébergement) : l'adresse du client est alors lue dans X-Forwarded-For. */
  derriereProxy: boolean;
  /** Origines web autorisées (CORS) ; `true` les autorise toutes. */
  origines: string[] | true;
}

export function lireConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL est obligatoire (ex. postgres://utilisateur:motdepasse@localhost:5432/digitalab).');
  const origines = env['DIGITALAB_ORIGINES'];
  return {
    port: Number(env['PORT'] ?? 8080),
    hote: env['HOST'] ?? '0.0.0.0',
    databaseUrl,
    sessionJours: 90,
    coutMotDePasse: COUT_MOT_DE_PASSE_DEFAUT,
    dossierWeb: env['DIGITALAB_WEB']?.trim() || null,
    derriereProxy: env['DIGITALAB_DERRIERE_PROXY'] === '1',
    origines: origines && origines !== '*' ? origines.split(',').map((o) => o.trim()).filter(Boolean) : true,
  };
}
