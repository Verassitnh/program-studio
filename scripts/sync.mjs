// Re-syncs the example data and reconciles open activities against it.
//   npm run db:sync                                   re-import ./data; nothing changes, nothing closes
//   npm run db:sync -- --with-demo-corrections        also apply data/corrections/*.simulated.json (SIMULATED)
//   npm run db:sync -- --json                         print the studio.syncs row as JSON
// 1. Re-runs the import into raw.* and app.* (studio.* is kept).
// 2. For every activity that isn't closed, recomputes its program's data fingerprint and data issues:
//    changed + no issues left → auto-closed (close_reason 'sync'); changed + issues remain → needs_review.
// 3. Records the run in studio.syncs.
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runSync } from "./lib/pipeline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {}
const args = process.argv.slice(2);
const withDemoCorrections = args.includes("--with-demo-corrections");
const json = args.includes("--json");
const source = args.find((a) => a.startsWith("--source="))?.slice(9) ?? "cli";
const databaseUrl = process.env.DATABASE_URL ?? "postgres:///program_studio";

const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  const t = Date.now();
  const { sync, imported } = await runSync(client, { root, source, withDemoCorrections });
  if (json) {
    console.log(JSON.stringify(sync));
  } else {
    console.log(`Program Studio · sync #${sync.id} (${source})`);
    console.log(`✓ re-imported ${imported.total.toLocaleString("en-US")} records from ${imported.files.length} files (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    if (imported.corrections.length) {
      for (const c of imported.corrections) console.log(`✓ corrections ${c.file}: ${c.records} records patched${c.simulated ? "  (SIMULATED demo data)" : ""}`);
    } else {
      console.log(`· no corrections applied${withDemoCorrections ? "" : " (demo corrections are opt-in: --with-demo-corrections)"}`);
    }
    const names = (xs) => xs.map((x) => x.name ?? `${x.title} · ${x.kind}`).join(", ");
    console.log(`· programs with changed data: ${sync.changed_programs.length ? names(sync.changed_programs) : "none"}`);
    console.log(`· activities auto-closed:     ${sync.closed.length ? names(sync.closed) : "none"}`);
    console.log(`· activities flagged:         ${sync.flagged.length ? names(sync.flagged) : "none"}`);
    console.log(`· recorded as activity        /a/${sync.activity_id}/sync`);
  }
} catch (err) {
  console.error(`✗ sync failed: ${err.message}`);
  if (err.code === "ECONNREFUSED" || err.code === "ENOENT" || err.code === "3D000") {
    console.error("  Is Postgres running and imported? Run npm run db:import first.");
  }
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
