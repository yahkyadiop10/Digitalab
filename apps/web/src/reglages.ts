import { ESPECES_PAR_DEFAUT, PROTOCOLES_PAR_DEFAUT, SEUILS_PAR_DEFAUT, type EspeceConfig, type ProtocoleVaccin, type Seuils } from '@digitalab/core';

export interface Reglages {
  nomElevage: string;
  demarrageFait: boolean;
  seuils: Seuils;
  especes: Record<string, EspeceConfig>;
  protocoles: ProtocoleVaccin[];
}

export function fusionnerReglages(brut: Record<string, unknown>): Reglages {
  const s = (brut['seuils'] ?? {}) as Partial<Seuils>;
  const e = (brut['especes'] ?? {}) as Record<string, Partial<EspeceConfig>>;
  const especes: Record<string, EspeceConfig> = {};
  for (const [code, d] of Object.entries(ESPECES_PAR_DEFAUT)) especes[code] = { ...d, ...(e[code] ?? {}) };
  return {
    nomElevage: typeof brut['nomElevage'] === 'string' ? (brut['nomElevage'] as string) : '',
    demarrageFait: brut['demarrageFait'] === true,
    seuils: { ...SEUILS_PAR_DEFAUT, ...s },
    especes,
    protocoles: Array.isArray(brut['protocoles']) ? (brut['protocoles'] as ProtocoleVaccin[]) : PROTOCOLES_PAR_DEFAUT,
  };
}
