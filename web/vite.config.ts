import { readdirSync } from "node:fs";
import { defineConfig } from "vite";

const bundles = new URL("../public/bundles/", import.meta.url);

// Vite root is web/. public/ stays at the repo root so tools/build_run_bundle.py keeps writing where it always has.
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  publicDir: "../public",
  build: { outDir: "../dist", emptyOutDir: true },
  // Real bundles found at build time. None means the app falls back to the labelled synthetic demo.
  define: { __BUNDLES__: JSON.stringify(readdirSync(bundles).filter((f) => f.endsWith(".json")).sort()) },
});
