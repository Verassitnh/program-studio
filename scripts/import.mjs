// Imports the example data products into a local Postgres database.
//   npm run db:import            (or: node scripts/import.mjs [dataDir])
// 1. Creates the database if needed (DATABASE_URL, default postgres:///program_studio).
// 2. Loads every companion JSON file verbatim into raw.<name> (one JSONB row per record).
// 3. Builds the normalized app.* tables and views with db/transform.sql.
// 4. Applies db/studio*.sql (the app's own state: activities, events, sync history).
// Safe to re-run: raw and app are dropped and rebuilt each time; studio is never dropped.
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runImport } from "./lib/pipeline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(root, ".env")); // optional; real env vars take precedence
} catch {}
const dataDir = path.resolve(process.argv[2] ?? path.join(root, "data"));
const databaseUrl = process.env.DATABASE_URL ?? "postgres:///program_studio";
const dbName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
const started = Date.now();

const fmt = (n) => n.toLocaleString("en-US");
const secs = (t) => `${((Date.now() - t) / 1000).toFixed(1)}s`;

async function ensureDatabase() {
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const { rowCount } = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
  if (!rowCount) await admin.query(`create database "${dbName.replace(/"/g, '""')}"`);
  await admin.end();
  return !rowCount;
}

async function main() {
  console.log(`Program Studio · data import`);
  console.log(`  database  ${databaseUrl}`);
  console.log(`  data dir  ${path.relative(process.cwd(), dataDir) || "."}\n`);

  const created = await ensureDatabase();
  console.log(created ? `✓ created database "${dbName}"` : `✓ database "${dbName}" exists`);

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  // 1 + 2 · raw (verbatim JSON) and app (normalized), rebuilt in one transaction; then studio (kept)
  let t = Date.now();
  const { imported, studio } = await runImport(client, { root, dataDir });
  const { rawCounts, total, files } = imported;
  console.log(`✓ raw      ${fmt(total)} records from ${files.length} files`);
  const w = Math.max(...rawCounts.map(([n]) => n.length));
  for (const [name, n] of rawCounts) console.log(`    ${name.padEnd(w)}  ${fmt(n).padStart(7)}`);

  const { rows: rels } = await client.query(
    `select c.relname as name, case c.relkind when 'v' then 'view' when 'm' then 'matview' else 'table' end as kind
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app' and c.relkind in ('r', 'v', 'm') order by c.relkind, c.relname`,
  );
  const appCounts = [];
  for (const r of rels) {
    const { rows } = await client.query(`select count(*)::int as n from app."${r.name}"`);
    appCounts.push([`app.${r.name}`, r.kind, rows[0].n]);
  }
  const nTables = appCounts.filter(([, k]) => k === "table").length;
  console.log(`✓ app      ${nTables} tables, ${appCounts.length - nTables} views (${secs(t)})`);
  const w2 = Math.max(...appCounts.map(([n]) => n.length));
  for (const [name, kind, n] of appCounts) console.log(`    ${name.padEnd(w2)}  ${fmt(n).padStart(7)}${kind === "table" ? "" : `  (${kind})`}`);

  // 3 · studio: the app's own state (activities, events, sync history). Never dropped.
  const { rows: st } = await client.query(
    `select (select count(*) from studio.activities)::int as activities, (select count(*) from studio.syncs)::int as syncs`,
  );
  console.log(`✓ studio   ${studio.join(", ")} applied · kept ${fmt(st[0].activities)} activities, ${fmt(st[0].syncs)} syncs`);

  // 4 · sanity checks the app depends on
  const { rows: chk } = await client.query(
    `select (select count(*) from app.alumni where institution_id = 'north-sound-state')::int as nssu_alumni,
            (select count(*) from app.programs where institution_id = 'north-sound-state')::int as nssu_programs,
            (select count(*) from app.alumni where has_employment)::int as matched,
            (select count(*) from app.alumni)::int as alumni`,
  );
  const c = chk[0];
  if (!c.nssu_alumni || !c.nssu_programs) throw new Error("Sanity check failed: no North Sound State alumni/programs after transform");
  await client.end();

  console.log(
    `\nDone in ${secs(started)} · ${fmt(c.alumni)} alumni (${fmt(c.matched)} with a known job) · ` +
      `North Sound State: ${fmt(c.nssu_programs)} programs, ${fmt(c.nssu_alumni)} alumni.\n` +
      `Demo corrections (data/corrections/*.simulated.json) are never applied here; see npm run db:sync -- --with-demo-corrections.\nNext: npm run dev`,
  );
}

main().catch((err) => {
  console.error(`\n✗ import failed: ${err.message}`);
  if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
    console.error("  Is Postgres running? Set DATABASE_URL if it isn't at postgres:///program_studio (see .env.example).");
  }
  process.exit(1);
});
