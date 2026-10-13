#!/usr/bin/env node
// Records the real app into seamless MP4 loops for the landing page.
//
//   pnpm loops                      build, then record every scene
//   node tools/capture.ts leads     record one scene from the existing build (add --keep to keep the PNGs)
//
// How: Playwright drives Chromium one video frame at a time. The app is opened with ?capture, so its motion
// clock only moves when this script says so: step the clock by exactly 1/60 s, take one PNG, repeat. The pointer
// is real (Playwright mouse events), and its path is the same spring maths the app uses. ffmpeg then stitches the
// PNGs into H.264. Each scene must end in the state it started in; the seam is checked before anything is written.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { preview } from "vite";
import { atRest, stepSpring, type SpringConfig } from "../web/src/motion/spring.ts";

const FPS = 60;
const VIEW = { width: 1280, height: 800 };
const SCALE = 1.5; // 1920x1200 frames
const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "public", "loops");
const FRAMES = join(ROOT, "captures");
const PORT = 4174;
const REST = { x: 1242, y: 452 }; // in the page gutter, where the pointer hovers nothing
const GLIDE: SpringConfig = { damping: 1, response: 0.55 };
const CURSOR = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><path d="M4 2.5v18.2l4.9-4.6 3.3 7.4 3.1-1.4-3.3-7.3h6.9z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

class Take {
  page: Page;
  dir: string;
  recording = false;
  frames = 0;
  x = { x: REST.x, v: 0 };
  y = { x: REST.y, v: 0 };
  to = { ...REST };
  glide = GLIDE;

  constructor(page: Page, dir: string) {
    this.page = page;
    this.dir = dir;
  }

  // One video frame: move the pointer, step the app's clock, let React commit, take the picture.
  async frame() {
    this.x = stepSpring(this.x, this.to.x, this.glide, 1 / FPS);
    this.y = stepSpring(this.y, this.to.y, this.glide, 1 / FPS);
    if (atRest(this.x, this.to.x, 0.05)) this.x = { x: this.to.x, v: 0 };
    if (atRest(this.y, this.to.y, 0.05)) this.y = { x: this.to.y, v: 0 };
    await this.page.mouse.move(this.x.x, this.y.x);
    const running = await this.page.evaluate(async ([x, y, ms]) => {
      document.getElementById("capture-cursor")!.style.transform = `translate(${x! - 4}px,${y! - 2.5}px)`;
      window.__medimol!.advance(ms!);
      for (let i = 0; i < 2; i++) await new Promise<void>((done) => { const c = new MessageChannel(); c.port1.onmessage = () => done(); c.port2.postMessage(0); });
      return document.getAnimations().length;
    }, [this.x.x, this.y.x, 1000 / FPS]);
    if (running) throw new Error(`${running} browser-driven animation(s) are running; every frame must come from the spring clock`);
    if (this.recording) await this.page.screenshot({ path: join(this.dir, `${String(this.frames++).padStart(5, "0")}.png`) });
  }

  async hold(seconds: number) {
    for (let i = 0; i < Math.round(seconds * FPS); i++) await this.frame();
  }

  // Until the pointer and every spring and timer in the app have come to rest.
  async settle(maxSeconds = 12) {
    for (let i = 0; i < maxSeconds * FPS; i++) {
      await this.frame();
      const still = this.x.x === this.to.x && this.y.x === this.to.y && this.x.v === 0 && this.y.v === 0;
      if (still && (await this.page.evaluate(() => window.__medimol!.idle()))) return;
    }
    throw new Error("the app never came to rest");
  }

  async until(test: () => boolean, maxSeconds = 20) {
    for (let i = 0; i < maxSeconds * FPS; i++) {
      await this.frame();
      if (await this.page.evaluate(test)) return;
    }
    throw new Error(`gave up waiting for ${test}`);
  }

  // rx/ry pick a point inside the element (0..1); ox nudges it in px.
  async spot(selector: string, rx = 0.5, ry = 0.5, ox = 0) {
    const box = await this.page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`nothing matches ${selector}`);
    return { x: Math.round(box.x + box.width * rx + ox), y: Math.round(box.y + box.height * ry) };
  }

  async glideTo(p: { x: number; y: number }, glide = GLIDE) {
    this.to = p;
    this.glide = glide;
    for (let i = 0; i < 6 * FPS; i++) {
      await this.frame();
      if (this.x.x === p.x && this.y.x === p.y) return;
    }
  }

  // Printed with the frame number, so a scene can be tuned by looking at the right PNGs (--keep).
  mark(what: string) {
    if (this.recording) console.log(`  ${String(this.frames).padStart(5)}  ${what}`);
  }

  async click(selector: string, rx = 0.5, ry = 0.5) {
    await this.glideTo(await this.spot(selector, rx, ry));
    this.mark(`click ${selector}`);
    await this.hold(0.08);
    await this.page.mouse.down();
    await this.hold(0.1); // long enough to see the press spring answer
    await this.page.mouse.up();
  }

  // Grab, throw, and let go while the pointer is still moving fast, so the app receives real release velocity.
  async flick(selector: string, dx: number, releaseAfterFrames: number, rx = 0.3) {
    const from = await this.spot(selector, rx);
    await this.glideTo(from);
    await this.hold(0.1);
    this.mark(`flick ${selector}`);
    await this.page.mouse.down();
    await this.hold(0.08);
    this.to = { x: from.x + dx, y: from.y };
    this.glide = { damping: 1, response: 0.75 }; // fastest about 0.12 s in: release near there
    for (let i = 0; i < releaseAfterFrames; i++) await this.frame();
    await this.page.mouse.up();
  }

  async drag(to: { x: number; y: number }, response: number) {
    this.mark(`drag to ${to.x},${to.y}`);
    await this.page.mouse.down();
    await this.hold(0.1);
    await this.glideTo(to, { damping: 1, response });
    await this.hold(0.15);
    await this.page.mouse.up();
  }
}

type Scene = { hash: string; warm?: (t: Take) => Promise<void>; run: (t: Take) => Promise<void> };
const done = () => document.querySelector(".stage [role=status]")?.textContent?.startsWith("Done") ?? false;
const FILTER = (n: number) => `.page-tools .seg-item:nth-of-type(${n})`;
const LANG = (n: number) => `.sheet-actions .seg-item:nth-of-type(${n})`;
const ROW = (n: number) => `.list .row:nth-child(${n})`;

const SCENES: Record<string, Scene> = {
  // Hero: the recorded run replays, then every tile flies into rank order.
  replay: {
    hash: "#/app/replay",
    warm: async (t) => {
      await t.click(".page-tools .seg-item:nth-of-type(3)"); // 10x
      await t.click(".page-tools .btn-primary");
      await t.until(done);
    },
    run: async (t) => {
      await t.hold(1.4);
      await t.click(".page-tools .btn-primary");
      await t.hold(0.5);
      await t.glideTo(REST);
      await t.until(done);
      await t.settle();
      await t.hold(1.2);
    },
  },
  // All -> Affordable reorders the list; a drug opens; its panel is thrown away; back to All.
  leads: {
    hash: "#/app/leads",
    run: async (t) => {
      await t.hold(0.6);
      await t.click(FILTER(2));
      await t.hold(1.5);
      await t.click(ROW(1), 0.3);
      await t.hold(2);
      await t.flick(".sheet-grab", 380, 9);
      await t.hold(1);
      await t.click(FILTER(1));
      await t.hold(0.6);
      await t.glideTo(REST);
      await t.settle();
      await t.hold(0.6);
    },
  },
  // The brief in English, in Spanish, for another drug, and back.
  brief: {
    hash: "#/app/leads",
    warm: async (t) => {
      await t.click(ROW(3), 0.3);
    },
    run: async (t) => {
      await t.hold(1);
      await t.click(LANG(2));
      await t.hold(2.4);
      await t.click(ROW(2), 0.3);
      await t.hold(2.2);
      await t.click(LANG(1));
      await t.hold(1.2);
      await t.click(ROW(3), 0.3);
      await t.hold(0.4);
      await t.glideTo(REST);
      await t.settle();
      await t.hold(0.8);
    },
  },
  // Docking noise off: the rank ranges collapse to what the weights alone do. Dragging the weight slider
  // widens them again. Then everything is put back.
  stability: {
    hash: "#/app/stability",
    run: async (t) => {
      await t.hold(0.8);
      await t.click(".switch input");
      await t.hold(1.6);
      const mid = await t.spot(".slider input");
      const end = await t.spot(".slider input", 1, 0.5, -3);
      await t.glideTo(mid);
      await t.drag(end, 1.2);
      await t.hold(1.6);
      await t.drag(mid, 1.2);
      await t.hold(0.5);
      await t.click(".switch input");
      await t.hold(0.4);
      await t.glideTo(REST);
      await t.settle();
      await t.hold(0.8);
    },
  },
};

function ffmpeg(args: string[]): string {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed:\n${r.stderr.slice(-800)}`);
  return r.stderr;
}

// The loop only works if the last state is the first state. Identical bytes pass at once; otherwise compare structure.
function checkSeam(first: string, after: string, name: string) {
  if (readFileSync(first).equals(readFileSync(after))) return;
  const ssim = Number(/All:([\d.]+)/.exec(ffmpeg(["-i", first, "-i", after, "-lavfi", "ssim", "-f", "null", "-"]))?.[1]);
  if (!(ssim >= 0.999)) throw new Error(`${name}: the scene does not end where it began (SSIM ${ssim}). It would jump when it loops.`);
}

async function record(name: string, scene: Scene, base: string, page: Page) {
  const dir = join(FRAMES, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await page.goto("about:blank"); // same-document hash changes would keep the previous scene's state
  await page.goto(`${base}?capture${scene.hash}`);
  await page.waitForSelector("html[data-ready]");
  await page.evaluate(async (svg) => {
    await document.fonts.ready;
    const c = Object.assign(document.createElement("div"), { id: "capture-cursor", innerHTML: svg });
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none" });
    document.documentElement.append(c); // outside the app root, so the app never sees it
  }, CURSOR);

  const t = new Take(page, dir);
  await t.settle();
  await scene.warm?.(t);
  await t.glideTo(REST);
  await t.settle();

  t.recording = true;
  await scene.run(t);
  t.recording = false;
  const after = join(dir, "after.png");
  await t.frame();
  await page.screenshot({ path: after });
  checkSeam(join(dir, "00000.png"), after, name);
  rmSync(after);

  ffmpeg([
    "-framerate", String(FPS), "-i", join(dir, "%05d.png"),
    // Screen RGB to BT.709 video, tagged as such, so browsers show the colours the app drew.
    "-vf", "scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-g", String(FPS * 2),
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-movflags", "+faststart", "-an", join(OUT, `${name}.mp4`),
  ]);
  ffmpeg(["-i", join(dir, "00000.png"), "-q:v", "3", join(OUT, `${name}.jpg`)]);
  console.log(`${name}: ${t.frames} frames, ${(t.frames / FPS).toFixed(1)} s -> public/loops/${name}.mp4`);
}

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const names = args.filter((a) => !a.startsWith("--"));
for (const n of names) if (!SCENES[n]) throw new Error(`unknown scene ${n}. Scenes: ${Object.keys(SCENES).join(", ")}`);

mkdirSync(OUT, { recursive: true });
const server = await preview({ configFile: join(ROOT, "web", "vite.config.ts"), logLevel: "silent", preview: { port: PORT, strictPort: true } });
// --force-color-profile pins colour, so the same build always records the same pixels.
const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--hide-scrollbars"] });
try {
  const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: "light", reducedMotion: "no-preference" });
  page.on("pageerror", (e) => { console.error(e); process.exitCode = 1; });
  const base = `http://localhost:${PORT}/`;
  for (const name of names.length ? names : Object.keys(SCENES)) await record(name, SCENES[name]!, base, page);
  const { bundle, synthetic } = await page.evaluate(() => ({ ...document.documentElement.dataset }));
  let scenes = names.length ? names : Object.keys(SCENES);
  try {
    // recording one scene keeps the others that are already there
    scenes = [...new Set([...JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8")).scenes, ...scenes])];
  } catch { /* first recording */ }
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ synthetic: synthetic === "true", bundleId: bundle ?? "", fps: FPS, scenes }, null, 2) + "\n");
} finally {
  await browser.close();
  await server.close();
  if (!keep) rmSync(FRAMES, { recursive: true, force: true });
}
