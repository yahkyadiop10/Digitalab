import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export function creerPool(databaseUrl: string, options: { searchPath?: string } = {}): Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10, ...(options.searchPath ? { options: `-c search_path=${options.searchPath}` } : {}) });
}

const DOSSIER_MIGRATIONS = new URL('../migrations/', import.meta.url).pathname;

/** Applique, dans l'ordre, les fichiers de `migrations/` pas encore appliqués. */
export async function migrer(pool: Pool): Promise<string[]> {
  await pool.query('CREATE TABLE IF NOT EXISTS migrations (nom text PRIMARY KEY, applique_le timestamptz NOT NULL DEFAULT now())');
  const faites = new Set((await pool.query<{ nom: string }>('SELECT nom FROM migrations')).rows.map((r) => r.nom));
  const fichiers = (await readdir(DOSSIER_MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  const nouvelles: string[] = [];
  for (const f of fichiers) {
    if (faites.has(f)) continue;
    const sql = await readFile(join(DOSSIER_MIGRATIONS, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO migrations (nom) VALUES ($1)', [f]);
      await c.query('COMMIT');
      nouvelles.push(f);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  return nouvelles;
}

export async function transaction<T>(pool: Pool, travail: (c: Client) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await travail(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
