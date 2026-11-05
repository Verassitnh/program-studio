// Types for pipeline.mjs, so app/lib/activities.server.ts can share the CLI's sync implementation.
type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

export type SyncRow = {
  id: number;
  ran_at: string;
  source: string;
  with_demo_corrections: boolean;
  changed_programs: { id: string; name: string }[];
  closed: SyncEntry[];
  flagged: SyncEntry[];
  /** The sync's activity (kind 'sync'). */
  activity_id: string | null;
};
export type SyncEntry = {
  id: string;
  program_id: string;
  kind: string;
  title: string;
  resolved: { key: string; label: string; count: number }[];
  remaining: { key: string; label: string; count: number }[];
};

export function studioFiles(root: string): Promise<string[]>;
export function applyStudio(client: Queryable, root: string): Promise<string[]>;
export function runSync(
  client: Queryable,
  opts: { root: string; dataDir?: string; source?: string; withDemoCorrections?: boolean },
): Promise<{ sync: SyncRow; activityId: string; imported: { total: number; files: string[]; corrections: { file: string; simulated: boolean; records: number }[] } }>;
