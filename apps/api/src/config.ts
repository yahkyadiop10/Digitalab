export interface Config {
  port: number;
  hote: string;
  databaseUrl: string;
  /** Sert à calculer l'empreinte des codes de connexion. À garder secret en production. */
  secret: string;
  sessionJours: number;
  codeValiditeMinutes: number;
  /** Renvoie le code dans la réponse (essais et démonstrations) : jamais en production. */
  codeDemo: boolean;
  /** Origines web autorisées (CORS) ; `true` les autorise toutes. */
  origines: string[] | true;
}

export function lireConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env['NODE_ENV'] === 'production';
  const secret = env['DIGITALAB_SECRET'] ?? (production ? '' : 'secret-de-developpement-a-changer');
  if (secret.length < 16) throw new Error('DIGITALAB_SECRET est obligatoire en production (16 caractères au moins).');
  const databaseUrl = env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL est obligatoire (ex. postgres://utilisateur:motdepasse@localhost:5432/digitalab).');
  const codeDemo = env['DIGITALAB_CODE_DEMO'] === '1';
  if (production && codeDemo) throw new Error('DIGITALAB_CODE_DEMO ne doit pas être activé en production.');
  const origines = env['DIGITALAB_ORIGINES'];
  return {
    port: Number(env['PORT'] ?? 8080),
    hote: env['HOST'] ?? '0.0.0.0',
    databaseUrl,
    secret,
    sessionJours: 90,
    codeValiditeMinutes: 10,
    codeDemo,
    origines: origines && origines !== '*' ? origines.split(',').map((o) => o.trim()).filter(Boolean) : true,
  };
}
