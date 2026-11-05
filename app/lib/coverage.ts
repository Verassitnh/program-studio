import { useMemo } from "react";

export type BuildModel = {
  bench: { skill_id: string; name: string; weight: number; posting_count: number }[];
  taught: string[];
  postings: number;
  changes: { id: string; label: string; title: string; detail: string; effort: string; skills: string[]; defaultOn: boolean; courses: { edited: number; added: number }; placement?: boolean }[];
};

/** Skill coverage = posting-weighted share of the occupation's benchmark skills the curriculum teaches. */
export function useCoverageSteps(d: BuildModel, selected: Record<string, boolean>) {
  return useMemo(() => {
    const total = d.bench.reduce((s, b) => s + b.weight, 0);
    const cov = (set: Set<string>) => (total ? Math.round((100 * d.bench.filter((b) => set.has(b.skill_id)).reduce((s, b) => s + b.weight, 0)) / total) : 0);
    const taught = new Set(d.taught);
    const steps = [{ label: "Today", value: cov(taught) }];
    const deltas: Record<string, number> = {};
    for (const c of d.changes) {
      if (c.skills.length) deltas[c.id] = cov(new Set([...taught, ...c.skills])) - cov(taught);
    }
    const running = new Set(taught);
    for (const c of d.changes) {
      if (!selected[c.id] || !c.skills.length) continue;
      c.skills.forEach((s) => running.add(s));
      steps.push({ label: c.label, value: cov(running) });
    }
    return { steps, deltas, final: steps[steps.length - 1].value, start: steps[0].value };
  }, [d, selected]);
}
