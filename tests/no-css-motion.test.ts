import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The web app's rule: everything that changes over time is a spring on the motion clock (web/src/motion).
// Browser-driven timing (CSS transitions, keyframes, easing curves, the Web Animations API, smooth scrolling)
// cannot be interrupted with velocity and cannot be stepped frame by frame by the loop recorder, so it is banned.
const BANNED: [RegExp, string][] = [
  [/\btransition(-[a-z]+)?\s*:/i, "CSS transition"],
  [/\banimation(-[a-z]+)?\s*:/i, "CSS animation"],
  [/@keyframes\b/i, "@keyframes"],
  [/cubic-bezier\s*\(/i, "cubic-bezier easing"],
  [/\b(ease|ease-in|ease-out|ease-in-out|step-start|step-end)\s*[;,)}]/i, "easing keyword"],
  [/\b(steps|linear)\s*\(/i, "easing function"],
  [/@starting-style\b/i, "@starting-style"],
  [/scroll-behavior\s*:\s*smooth/i, "smooth scrolling"],
  [/behavior\s*:\s*["']smooth["']/i, "smooth scrolling"],
  [/@view-transition\b|startViewTransition/i, "view transitions"],
  [/\.animate\s*\(/, "Web Animations API"],
  [/\.style\.(transition|animation)\b/, "inline transition/animation"],
  [/\b(transition|animation)[A-Z][A-Za-z]*\s*:/, "React inline transition/animation style"],
  [/from\s+["'](motion|framer-motion|gsap|animejs|@react-spring\/[a-z]+|react-transition-group)["']/, "animation library"],
];

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

export const violations = (text: string) => BANNED.filter(([re]) => re.test(strip(text))).map(([, what]) => what);

describe("spring-only motion", () => {
  const files = walk("web").filter((f) => /\.(css|tsx?|html)$/.test(f));

  it("finds the app's source", () => expect(files.length).toBeGreaterThan(8));

  for (const f of files) it(`${f} uses no browser-driven timing`, () => expect(violations(readFileSync(f, "utf8"))).toEqual([]));

  it("the detector catches what it claims to", () => {
    for (const bad of [
      ".a { transition: transform 200ms; }", ".a{transition-duration:1s}", ".a { animation: spin 1s infinite; }", "@keyframes spin {}",
      "x { y: cubic-bezier(0.2, 0, 0, 1) }", ".a { foo: ease-out; }", "html { scroll-behavior: smooth }", "el.animate([{}], 200)",
      "el.style.transition = 'none'", "<div style={{ transitionDuration: '1s' }} />", 'import { animate } from "motion";',
      "window.scrollTo({ top: 0, behavior: 'smooth' })", ".a { b: linear(0, 1) }", "@starting-style { }",
    ])
      expect(violations(bad), bad).not.toEqual([]);
    for (const fine of [
      "/* no transition: here */ .a { transform: translateX(1px); will-change: transform; }", "// transition: was banned\nconst x = 1;",
      ".a { background: linear-gradient(to bottom, red, blue); }", "const release = () => thumb.to({ scale: 1 });", "a { color: var(--accent); }",
    ])
      expect(violations(fine), fine).toEqual([]);
  });
});
