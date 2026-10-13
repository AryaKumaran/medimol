import type { RunBundle } from "./schema";
import { leaderboard } from "./scoring";

export type ControlResult = { drugId: string; name: string; rank: number | null; of: number; percentile: number | null };

// Where do known literature binders land among everything docked? Reported as-is, good or bad.
export function positiveControls(b: RunBundle): ControlResult[] {
  const rows = leaderboard(b, { includeControls: true }).filter((r) => r.confidence !== null);
  return b.drugs
    .filter((d) => d.positiveControl)
    .map((d) => {
      const i = rows.findIndex((r) => r.drug.id === d.id);
      const rank = i === -1 ? null : i + 1;
      return {
        drugId: d.id,
        name: d.name,
        rank,
        of: rows.length,
        percentile: rank === null ? null : Math.round((1 - (rank - 1) / rows.length) * 100),
      };
    });
}
