// Storage strings come from FDA labels via tools/fetch_public_data.py: "20-25C" or "30C" (store below 30 °C).
export type Band = { min: number; max: number };

export function parseStorage(s: string | null): Partial<Band> | null {
  const m = s?.match(/^(?:(-?\d+(?:\.\d+)?)-)?(-?\d+(?:\.\d+)?)C$/);
  if (!m) return null;
  return m[1] === undefined ? { max: Number(m[2]) } : { min: Number(m[1]), max: Number(m[2]) };
}

// The band every shortlisted drug tolerates: the intersection of their label ranges.
// A drug with no lower limit only constrains the top. Null when no drug has a range, or the ranges do not overlap
// (then no single storage spot fits all, and the UI must say so instead of picking one).
export function storageBand(storage: (string | null)[]): Band | null | "conflict" {
  const ranges = storage.map(parseStorage).filter((r): r is Partial<Band> => r !== null);
  if (!ranges.length) return null;
  const min = Math.max(...ranges.map((r) => r.min ?? -Infinity));
  const max = Math.min(...ranges.map((r) => r.max ?? Infinity));
  if (min > max) return "conflict";
  return { min: Number.isFinite(min) ? min : max - 10, max }; // ponytail: "below X" alone gets a 10 °C-wide band so the low alarm still means something
}
