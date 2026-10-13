import { loadBundle, RunBundle } from "../../lib/bundle/schema";

declare const __BUNDLES__: string[]; // *.json in public/bundles at build time (web/vite.config.ts)

export type Data = { bundle: RunBundle; synthetic: boolean };

// A real bundle wins. With none, fall back to the synthetic demo, and say so: `synthetic` drives a banner
// the UI cannot hide. Dropping a real bundle into public/bundles/ and rebuilding is the whole switch.
export async function loadData(): Promise<Data> {
  const file = __BUNDLES__.at(-1);
  if (!file) {
    const { demoFixture } = await import("../../tests/fixture");
    return { bundle: RunBundle.parse(demoFixture()), synthetic: true };
  }
  const bundle = await loadBundle(`${import.meta.env.BASE_URL}bundles/${file}`);
  return { bundle, synthetic: bundle.provenance.builder === "tests/fixture.ts" };
}
