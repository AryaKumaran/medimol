import type { RunBundle } from "./schema";

export type PoseAssets = { sdf: string | null; pdb: string | null; pdbId: string; confidence: number };

// The files the 3D viewer needs for a drug's top pose on a target. Paths are relative to public/bundles/.
export function poseAssets(b: RunBundle, drugId: string, targetId: string): PoseAssets | null {
  const pose = b.poses.find((p) => p.drugId === drugId && p.targetId === targetId && p.rank === 1);
  const target = b.targets.find((t) => t.id === targetId);
  if (!pose || !target) return null;
  return { sdf: pose.sdf, pdb: target.pdbFile, pdbId: target.pdbId, confidence: pose.confidence };
}
