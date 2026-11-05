// Shared data pipeline for `npm run db:import`, `npm run db:sync` and the app's POST /api/sync.
//   raw.*    verbatim JSON from ./data (dropped and rebuilt)
//   app.*    normalized tables from db/transform.sql (dropped and rebuilt)
//   studio.* the app's own state from db/studio*.sql (never dropped; `create ... if not exists`)
// Plain ESM with no app imports, so the CLI scripts and the server bundle share one implementation.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const tableName = (file) => file.replace(/\.json$/, "").replace(/-/g, "_");
const NSSU = "north-sound-state";
/** pg_advisory_lock key, so a CLI sync and a UI sync never rebuild the schemas at the same time. */
const LOCK = 4_242_017;

/** Every db/studio*.sql file, sorted (studio.sql first, then add-ons such as studio-workspace.sql). */
export async function studioFiles(root) {
  const dir = path.join(root, "db");
  const names = (await readdir(dir)).filter((f) => /^studio.*\.sql$/.test(f)).sort();
  // The base schema first: add-ons may reference its tables.
  return [...names.filter((f) => f === "studio.sql"), ...names.filter((f) => f !== "studio.sql")].map((f) => path.join(dir, f));
}

export async function applyStudio(client, root) {
  const files = await studioFiles(root);
  for (const f of files) await client.query(await readFile(f, "utf8"));
  return files.map((f) => path.basename(f));
}

/** Correction files in data/corrections. Demo files (`*.simulated.json`) only load when asked for. */
export async function correctionFiles(dataDir, { withDemoCorrections = false } = {}) {
  const dir = path.join(dataDir, "corrections");
  let names = [];
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return names.filter((f) => withDemoCorrections || !f.endsWith(".simulated.json")).map((f) => path.join(dir, f));
}

/**
 * Patches raw records before the transform runs. File format:
 *   { "dataset": "alumni-record", "patches": [{ "id": "<record id>", "merge": { "<top-level key>": <value> } }] }
 * `merge` replaces those top-level keys of the record (jsonb `||`).
 */
async function applyCorrections(client, files) {
  const applied = [];
  for (const file of files) {
    const doc = JSON.parse(await readFile(file, "utf8"));
    const table = `raw.${tableName(`${doc.dataset}.json`)}`;
    let n = 0;
    for (const p of doc.patches ?? []) {
      const { rowCount } = await client.query(`update ${table} set record = record || $2::jsonb where record->>'id' = $1`, [p.id, JSON.stringify(p.merge)]);
      n += rowCount;
    }
    applied.push({ file: path.basename(file), simulated: !!doc.simulated, records: n });
  }
  return applied;
}

/** Rebuilds raw.* and app.* in one transaction. Returns counts for logging. */
export async function importData(client, { root, dataDir, withDemoCorrections = false }) {
  const files = (await readdir(dataDir)).filter((f) => f.endsWith(".json") && !f.endsWith(".schema.json")).sort();
  if (!files.length) throw new Error(`No *.json data files found in ${dataDir}`);
  const rawCounts = [];
  let total = 0;
  await client.query("begin");
  try {
    await client.query("drop schema if exists raw cascade; create schema raw;");
    for (const file of files) {
      const parsed = JSON.parse(await readFile(path.join(dataDir, file), "utf8"));
      const records = Array.isArray(parsed) ? parsed : [parsed];
      const table = `raw.${tableName(file)}`;
      await client.query(`create table ${table} (id serial primary key, record jsonb not null)`);
      await client.query(`insert into ${table} (record) select jsonb_array_elements($1::jsonb)`, [JSON.stringify(records)]);
      total += records.length;
      rawCounts.push([table, records.length]);
    }
    const corrections = await applyCorrections(client, await correctionFiles(dataDir, { withDemoCorrections }));
    await client.query(await readFile(path.join(root, "db", "transform.sql"), "utf8"));
    await client.query("commit");
    return { files, rawCounts, total, corrections };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  }
}

/** Fingerprints for every NSSU program plus any program an activity points at. Empty before the first import. */
async function fingerprints(client) {
  try {
    const { rows } = await client.query(
      `select id, studio.program_fingerprint(id) as fp from (
         select id from app.programs where institution_id = $1
         union select program_id from studio.activities where program_id is not null) p`,
      [NSSU],
    );
    return new Map(rows.map((r) => [r.id, r.fp]));
  } catch {
    return new Map();
  }
}

const day = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * After a re-import: for every activity that isn't closed, compare its program's data with the
 * fingerprint stored when the activity opened (or was last flagged).
 *   unchanged                         → nothing
 *   changed, every data issue cleared → auto-close (close_reason 'sync')
 *   changed, issues remain            → needs_review (and the new fingerprint/issues become the baseline)
 * Records one studio.syncs row and an event per touched activity.
 */
export async function reconcile(client, { source, withDemoCorrections, before }) {
  const after = await fingerprints(client);
  const changed = [...after].filter(([id, fp]) => before.size && before.get(id) !== fp).map(([id]) => id);
  const { rows: live } = await client.query(
    `select a.id, a.program_id, a.kind, a.title, a.fingerprint, a.issues,
            studio.program_fingerprint(a.program_id) as fp_now, studio.program_issues(a.program_id) as issues_now
     from studio.activities a where a.status <> 'closed' and a.kind in ('review', 'outcomes') order by a.updated_at desc`,
  );
  await client.query("begin");
  try {
    const { rows: names } = await client.query(`select id, name from app.programs where id = any($1)`, [changed]);
    const changedPrograms = changed.map((id) => ({ id, name: names.find((n) => n.id === id)?.name ?? id }));
    const {
      rows: [sync],
    } = await client.query(`insert into studio.syncs (source, with_demo_corrections, changed_programs) values ($1, $2, $3) returning *`, [
      source,
      withDemoCorrections,
      JSON.stringify(changedPrograms),
    ]);
    const closed = [];
    const flagged = [];
    const note = `Closed by sync on ${day(new Date(sync.ran_at))}: data updated and corrected`;
    for (const a of live) {
      if (a.fp_now === a.fingerprint) continue;
      const entry = { id: a.id, program_id: a.program_id, kind: a.kind, title: a.title, resolved: a.issues, remaining: a.issues_now };
      if (a.issues_now.length === 0) {
        await client.query(
          `update studio.activities set status = 'closed', closed_at = now(), close_reason = 'sync', close_note = $2, needs_review = false,
                  fingerprint = $3, issues = '[]', updated_at = now() where id = $1`,
          [a.id, note, a.fp_now],
        );
        await client.query(`insert into studio.activity_events (activity_id, type, data) values ($1, 'closed', $2)`, [
          a.id,
          JSON.stringify({ reason: "sync", sync_id: sync.id, note, resolved: a.issues }),
        ]);
        closed.push(entry);
      } else {
        await client.query(`update studio.activities set needs_review = true, fingerprint = $2, issues = $3, updated_at = now() where id = $1`, [
          a.id,
          a.fp_now,
          JSON.stringify(a.issues_now),
        ]);
        await client.query(`insert into studio.activity_events (activity_id, type, data) values ($1, 'flagged', $2)`, [
          a.id,
          JSON.stringify({ reason: "sync", sync_id: sync.id, before: a.issues, remaining: a.issues_now }),
        ]);
        flagged.push(entry);
      }
    }
    const {
      rows: [done],
    } = await client.query(`update studio.syncs set closed = $2, flagged = $3 where id = $1 returning *`, [sync.id, JSON.stringify(closed), JSON.stringify(flagged)]);
    await client.query("commit");
    return done;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Full sync: lock, re-import (optionally with demo corrections), reconcile activities, record history.
 * Every run is also an activity (kind 'sync', no program): "In progress" while it runs, then closed with
 * close_reason 'finished' (Completed) and linked both ways to its studio.syncs row, or 'failed' with the error.
 */
export async function runSync(client, { root, dataDir = path.join(root, "data"), source = "cli", withDemoCorrections = false }) {
  await applyStudio(client, root);
  const label = withDemoCorrections ? "Lightcast import + simulated corrections" : "Lightcast import";
  const {
    rows: [activity],
  } = await client.query(
    `insert into studio.activities (kind, stage, status, title, state) values ('sync', 'run', 'running', $1, $2) returning id`,
    [`${label} · running`, JSON.stringify({ source, withDemoCorrections })],
  );
  await client.query(`insert into studio.activity_events (activity_id, type, data) values ($1, 'opened', $2)`, [activity.id, JSON.stringify({ source, withDemoCorrections })]);
  await client.query("select pg_advisory_lock($1)", [LOCK]);
  try {
    const before = await fingerprints(client);
    const imported = await importData(client, { root, dataDir, withDemoCorrections });
    await applyStudio(client, root);
    const sync = await reconcile(client, { source, withDemoCorrections, before });
    const n = sync.changed_programs.length;
    const summary = n ? `${plural(n, "program")} changed` : "no changes";
    await client.query(`update studio.syncs set activity_id = $2 where id = $1`, [sync.id, activity.id]);
    await client.query(
      `update studio.activities set status = 'closed', stage = 'done', close_reason = 'finished', closed_at = now(), updated_at = now(),
              ref_id = $2, title = $3, state = state || $4::jsonb, close_note = $5
       where id = $1`,
      [
        activity.id,
        String(sync.id),
        `${label} · ${summary}`,
        JSON.stringify({ records: imported.total, files: imported.files.length, corrections: imported.corrections }),
        `Finished: ${summary}; ${plural(sync.closed.length, "activity")} auto-closed, ${plural(sync.flagged.length, "activity")} flagged.`,
      ],
    );
    await client.query(`insert into studio.activity_events (activity_id, type, data) values ($1, 'finished', $2)`, [
      activity.id,
      JSON.stringify({ sync_id: sync.id, changed: n, closed: sync.closed.length, flagged: sync.flagged.length }),
    ]);
    return { sync: { ...sync, activity_id: activity.id }, imported, activityId: activity.id };
  } catch (err) {
    await client
      .query(
        `update studio.activities set status = 'closed', stage = 'done', close_reason = 'failed', closed_at = now(), updated_at = now(),
                title = $2, close_note = $3 where id = $1`,
        [activity.id, `${label} · failed`, String(err?.message ?? err).slice(0, 500)],
      )
      .catch(() => {});
    await client.query(`insert into studio.activity_events (activity_id, type, data) values ($1, 'failed', $2)`, [activity.id, JSON.stringify({ error: String(err?.message ?? err) })]).catch(() => {});
    err.activityId = activity.id;
    throw err;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK]).catch(() => {});
  }
}

/** Plain import (no reconcile, no history row), still serialized with syncs. */
export async function runImport(client, { root, dataDir = path.join(root, "data") }) {
  await client.query("select pg_advisory_lock($1)", [LOCK]);
  try {
    const imported = await importData(client, { root, dataDir });
    const studio = await applyStudio(client, root);
    return { imported, studio };
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK]).catch(() => {});
  }
}
