import pg from "pg";

// Numeric columns come back as strings by default; parse them so loaders return numbers.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.FLOAT8, (v) => (v === null ? null : Number(v)));

// Optional .env (see .env.example); variables already set in the environment win.
try {
  process.loadEnvFile();
} catch {}

declare global {
  var __pool: pg.Pool | undefined;
}

export const pool = (globalThis.__pool ??= new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres:///program_studio",
  max: 8,
}));

// Idle clients get terminated when the database is dropped/re-imported under a running server;
// without a listener that 'error' event would crash the process. The next query reconnects.
if (!pool.listenerCount("error")) {
  pool.on("error", (err) => console.warn(`[db] idle client error: ${err.message}`));
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await pool.query(text, params);
  return rows as T[];
}

export async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T> {
  const rows = await q<T>(text, params);
  return rows[0];
}
