#!/usr/bin/env node
/* build-tufte-suite.js — regenerate the Tufte Suite bundle plugin from the
 * four module sources.
 *
 * The suite's main.js embeds each module's main.js BYTE-FOR-BYTE VERBATIM
 * inside a CommonJS factory wrapper (one documented exception: the figures
 * quilt-store path patch, asserted to hit exactly once). A small runtime
 * loads the four sub-plugins in a fixed order with per-module toggles,
 * namespaced settings storage, and one combined settings tab.
 *
 * Run:  node build-tufte-suite.js
 *
 * Location-independent by design — it reads and writes only relative to its
 * OWN directory, so the same script runs unchanged in both homes:
 *
 *   repo   <tufte-suite>/build-tufte-suite.js  ->  modules in src/modules/<id>/
 *   vault  .obsidian/plugins/tufte-suite/…     ->  modules in ../<id>/
 *            (in a vault the four plugin folders are the suite's siblings)
 *
 * Output is always {main.js,styles.css,manifest.json} next to this script.
 * Every invariant is asserted before anything is written.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const OUT_DIR = __dirname;
// Where the module sources live, tried in order. First hit wins, and the
// choice is reported in the build log so it is never ambiguous.
const MODULE_ROOTS = [
  { label: "repo (src/modules)", dir: path.join(__dirname, "src", "modules") },
  { label: "vault (sibling plugin folders)", dir: path.join(__dirname, "..") },
];

const SUITE_ID = "tufte-suite";
const SUITE_NAME = "Tufte Suite";
const SUITE_VERSION = "1.1.0";
const BUILD_DATE = "2026-08-14";

// Order == the four plugins' relative order in community-plugins.json
// (backlinks, figures, inline, sidenotes). This preserves today's
// post-processor registration order and capture-phase DOM handler order.
const MODULES = [
  {
    id: "tufte-backlinks",
    key: "backlinks",
    blurb: "Backlink and mention snippets rendered as formatted Markdown.",
  },
  {
    id: "tufte-figures",
    key: "figures",
    blurb:
      "Column, full-width and margin figures, captions, quilts, lightbox and references.",
    patches: [
      {
        find: "plugins/tufte-figures/quilts",
        replace: "plugins/tufte-suite/quilts",
        count: 1,
        why: "the quilt runtime store must live under the suite's own folder",
      },
    ],
  },
  {
    id: "tufte-inline",
    key: "inline",
    blurb: "Inline shorthands: ^^new thought^^, &&lead-in&&, @@CJK drop cap@@.",
  },
  {
    id: "tufte-sidenotes",
    key: "sidenotes",
    blurb: "Sidenotes and marginnotes in Reading view.",
  },
];

function fail(msg) {
  console.error("BUILD FAILED: " + msg);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}
function read(p) {
  return fs.readFileSync(p, "utf8");
}
function beginMarker(m) {
  return "/*<<<TUFTE-SUITE:BEGIN " + m.id + "/main.js v" + m.manifest.version + ">>>*/";
}
function endMarker(m) {
  return "/*<<<TUFTE-SUITE:END " + m.id + "/main.js>>>*/";
}

// ---------------------------------------------------------------------------
// Locate the module sources
// ---------------------------------------------------------------------------
const MODULE_ROOT = MODULE_ROOTS.find((r) =>
  MODULES.every((m) => fs.existsSync(path.join(r.dir, m.id, "main.js")))
);
if (!MODULE_ROOT) {
  fail(
    "could not find the four module sources. Looked for <id>/main.js under:\n" +
      MODULE_ROOTS.map((r) => "  " + r.dir + "   [" + r.label + "]").join("\n")
  );
}

// ---------------------------------------------------------------------------
// Load and validate inputs
// ---------------------------------------------------------------------------
for (const m of MODULES) {
  const dir = path.join(MODULE_ROOT.dir, m.id);
  m.manifest = JSON.parse(read(path.join(dir, "manifest.json")));
  assert(m.manifest.id === m.id, m.id + ": manifest id mismatch (" + m.manifest.id + ")");
  m.source = read(path.join(dir, "main.js"));
  assert(m.source.length > 0, m.id + ": empty main.js");
  assert(
    !m.source.includes("TUFTE-SUITE:"),
    m.id + ": source contains the embed marker string; pick a new marker"
  );

  m.patched = m.source;
  for (const p of m.patches || []) {
    const hits = m.source.split(p.find).length - 1;
    assert(
      hits === p.count,
      m.id + ': patch "' + p.find + '" matched ' + hits + " times, expected " + p.count
    );
    m.patched = m.patched.split(p.find).join(p.replace);
  }

  const cssPath = path.join(dir, "styles.css");
  m.css = fs.existsSync(cssPath) ? read(cssPath) : null;
}

const minAppVersions = MODULES.map((m) => m.manifest.minAppVersion);
assert(
  new Set(minAppVersions).size === 1,
  "minAppVersion differs across plugins (" + minAppVersions.join(", ") + ") — pick max manually"
);
assert(
  MODULES.every((m) => m.manifest.isDesktopOnly === false),
  "expected isDesktopOnly:false on all four plugins"
);

// ---------------------------------------------------------------------------
// Assemble main.js
// ---------------------------------------------------------------------------
const parts = [];

parts.push(
  "/* ============================================================================",
  " * " + SUITE_NAME + " " + SUITE_VERSION + " - the four Tufte plugins bundled as one plugin.",
  " *",
  " * GENERATED FILE - built " + BUILD_DATE + " by build-tufte-suite.js from:",
  ...MODULES.map(
    (m) =>
      " *   " +
      (m.id + " " + m.manifest.version).padEnd(26) +
      (m.patches && m.patches.length
        ? "(embedded with ONE patch: quilt store path -> plugins/tufte-suite/quilts)"
        : "(embedded verbatim)")
  ),
  " *",
  " * Module load order mirrors the vault's community-plugins.json order:",
  " *   backlinks -> figures -> inline -> sidenotes",
  " * so Markdown post-processor registration order and capture-phase DOM",
  " * handler order are exactly what the four standalone plugins produce today.",
  " *",
  " * Do not hand-edit the VERBATIM sections between TUFTE-SUITE:BEGIN/END",
  " * markers; fix the standalone plugin and regenerate. Suite-only logic",
  " * lives in the 'Tufte Suite runtime' section at the bottom of this file.",
  " * ============================================================================ */",
  "",
  'const obsidian = require("obsidian");',
  "",
  "const SUBMODULES = [];",
  "",
  "// Each standalone plugin's main.js is embedded unmodified inside a CommonJS",
  "// factory, so it keeps its own module/exports pair and top-level scope.",
  "// NOTE: this file deliberately has no top-level 'use strict' - the embedded",
  "// sources run in the same sloppy mode Obsidian's plugin loader gives them.",
  "function defineSubmodule(def, factory) {",
  "  const module = { exports: {} };",
  "  factory(module, module.exports, require);",
  "  const cls = (module.exports && module.exports.default) || module.exports;",
  "  SUBMODULES.push(Object.assign({}, def, { cls: cls }));",
  "}",
  ""
);

for (const m of MODULES) {
  parts.push(
    "defineSubmodule({",
    "  key: " + JSON.stringify(m.key) + ",",
    "  id: " + JSON.stringify(m.id) + ",",
    "  name: " + JSON.stringify(m.manifest.name) + ",",
    "  version: " + JSON.stringify(m.manifest.version) + ",",
    "  blurb: " + JSON.stringify(m.blurb),
    "}, function (module, exports, require) {",
    beginMarker(m),
    m.patched.replace(/\n$/, ""),
    endMarker(m),
    "});",
    ""
  );
}

// ---------------------------------------------------------------------------
// Suite runtime (the only hand-written code in the generated file).
// Deliberately written without template literals so this generator can hold
// it in one; keep it that way when editing.
// ---------------------------------------------------------------------------
const RUNTIME = `
/* ────────────────────────── Tufte Suite runtime ────────────────────────── */

const MODULES_KEY = "__modules";
const TYPEFACES_KEY = "__typefaces";

/* ── Typefaces (Tufte theme) ────────────────────────────────────────────
 * The GUI for the Tufte theme's typeface knobs — two Latin series (face
 * + weight each) and two Chinese companions (face each, plus a fixed
 * Chinese weight implemented suite-side), split into Latin/Chinese
 * in-page tabs. A theme cannot ship
 * a settings panel of its own, so its companion Suite carries one: each
 * control writes one --tufte-* custom property as an inline style on
 * <body> — outranking the theme's CSS defaults and any snippet — or
 * removes it again for "Theme default". Values persist under
 * "__typefaces" in the suite's data.json (a reserved key like
 * "__modules", so it can never collide with a module's namespace) and
 * are re-applied on every load; disabling the Suite restores the theme
 * defaults; under any other theme the properties are inert. Stacks are
 * pure Latin — the theme appends its CJK companions (Songti, Kaiti,
 * Heiti) where the knobs are consumed, so Chinese fallback survives any
 * choice. The theme BUNDLES one open sans — Cabin, the Johnston–Gill
 * school as a variable font (true 400–700) — so one recommended sans
 * renders on every machine; the other recommendations are system
 * faces. Each face dropdown also ends in an "Other…" row that opens a
 * picker of the user's OWN installed fonts — the same list Obsidian's
 * Settings → Appearance → Font shows, read through the app's bundled
 * get-fonts native module on desktop, through the Chromium Local Font
 * Access API where that is unavailable, and falling back to a plain
 * name field (mobile) where neither works. The chosen family is
 * composed over the theme's default chain, so a missing or misspelled
 * font degrades to exactly what the theme ships. The two Chinese
 * companion knobs (宋体 behind the serif, 黑体 behind the sans; Kaiti
 * stays fixed) work the same way, except their "Other…" picker filters
 * the system list down to families that can actually set Chinese — a
 * per-glyph probe against an embedded blank font on the
 * simplified-specific characters 这/们, with a name-pattern heuristic
 * where FontFace or canvas are missing. */
const TYPEFACE_WEIGHTS = [
  ["100", "100 — Thin"],
  ["200", "200 — Extra Light"],
  ["300", "300 — Light"],
  ["400", "400 — Regular"],
  ["500", "500 — Medium"],
  ["600", "600 — Semibold"],
  ["700", "700 — Bold"],
  ["800", "800 — Extra Bold"],
  ["900", "900 — Black"]
];

// The theme's own default chains — appended behind an "Other…" custom font
// so a typo or an uninstalled face degrades to exactly what the theme
// ships. MUST mirror the --tufte-serif-latin / --tufte-sans-latin defaults
// declared in the theme's Typeface knobs body rule.
const SERIF_CHAIN = '"et-book", "Palatino Linotype", "Book Antiqua", Palatino, Georgia';
const SANS_CHAIN = '"Gill Sans", "Gill Sans MT", "Gill Sans Nova", Seravek, "Trebuchet MS", Calibri';
// The Chinese companions' default chains — MUST mirror --tufte-cjk-serif /
// --tufte-cjk-sans in the theme's knob rule. (Kaiti, the italic companion,
// is deliberately not settable — a semantic role, not a taste.)
const CJK_SERIF_CHAIN = '"Songti SC", STSong, "Noto Serif CJK SC", "Source Han Serif SC", SimSun, serif';
const CJK_SANS_CHAIN = '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif';

// Sentinel stored in a face key while the user supplies their own family
// name (kept in the paired *Custom key); never a real CSS value.
const CUSTOM_FACE = "__custom__";

// A 636-byte TTF (generated with fontTools) that maps ONLY the two probe
// characters 这/们 to zero-advance blank glyphs — the fallback terminator
// for the Chinese-capability probe in filterChineseFamilies below.
const PROBE_BLANK_B64 = "AAEAAAAKAIAAAwAgT1MvMo/i1x0AAAEoAAAAYGNtYXDQ2A5bAAABkAAAADxnbHlmAAAAAAAAAdQAAAABaGVhZCxhQVwAAACsAAAANmhoZWEDIf86AAAA5AAAACRobXR4AAAAAAAAAYgAAAAGbG9jYQAAAAAAAAHMAAAABm1heHAAAwACAAABCAAAACBuYW1lAOJRTwAAAdgAAAB4cG9zdG1nc80AAAJQAAAALAABAAAAAQAAqILGbF8PPPUAAwPoAAAAAOalgD4AAAAA5qWAPgAAAAAAAAAAAAAAAwACAAAAAAAAAAEAAAMg/zgAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAEAAAACAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAwAAAZAABQAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAPz8/PwAATuyP2QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAIAAAADAAAAFAADAAEAAAAUAAQAKAAAAAYABAABAAJO7I/Z//8AAE7sj9n//7EVcCgAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAQANgABAAAAAAABAA8AAAABAAAAAAACAAcADwADAAEECQABAB4AFgADAAEECQACAA4ANFR1ZnRlUHJvYmVCbGFua1JlZ3VsYXIAVAB1AGYAdABlAFAAcgBvAGIAZQBCAGwAYQBuAGsAUgBlAGcAdQBsAGEAcgACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAECBWJsYW5r";

const TYPEFACE_SETTINGS = [
  {
    key: "serifFace",
    tab: "latin",
    customKey: "serifFaceCustom",
    customName: "Serif — your own font",
    chain: SERIF_CHAIN,
    prop: "--tufte-serif-latin",
    name: "Serif — reading face",
    desc:
      "Body text, headings, tables, captions. The theme default, et-book " +
      "(bundled with the theme), is the digital Bembo of Tufte's own books; " +
      "the alternatives are Monotype book faces in the same tradition, and " +
      "every one of them falls back to et-book when not installed.",
    defaultLabel: "Theme default — et-book, Tufte's Bembo",
    options: [
      ['"Bembo Book MT Pro", "Bembo Book MT Std", "Bembo MT Pro", "Bembo Std", Bembo, "et-book", "Palatino Linotype", Palatino, Georgia', "Bembo — the printed books' face (Monotype)"],
      ['"Plantin MT Pro", "Plantin Std", Plantin, "et-book", "Palatino Linotype", Palatino, Georgia', "Plantin (Monotype)"],
      ['Perpetua, "Perpetua Std", "et-book", "Palatino Linotype", Palatino, Georgia', "Perpetua — Eric Gill's serif (Monotype)"],
      ['Baskerville, "Baskerville Old Face", "Libre Baskerville", "et-book", "Palatino Linotype", Palatino, Georgia', "Baskerville (Monotype cut)"],
      ['"Palatino Linotype", Palatino, "Book Antiqua", "et-book", Georgia', "Palatino"],
      ['"Georgia Pro", Georgia, "et-book", "Palatino Linotype", Palatino', "Georgia"]
    ]
  },
  {
    key: "serifWeight",
    tab: "latin",
    prop: "--tufte-serif-weight",
    name: "Serif — reading weight",
    desc:
      "The weight body text is set at; bold always sits one step (+200) " +
      "above it. Faces snap to their nearest real cut — et-book ships " +
      "Regular and Bold only, so 600 already reads as Bold.",
    defaultLabel: "Theme default — 400 · Regular",
    options: TYPEFACE_WEIGHTS
  },
  {
    key: "sansFace",
    tab: "latin",
    customKey: "sansFaceCustom",
    customName: "Sans — your own font",
    chain: SANS_CHAIN,
    prop: "--tufte-sans-latin",
    name: "Sans — data & interface face",
    desc:
      "Task lists, tags, backlinks, Bases, table titles, and the " +
      "application interface. Gill Sans is the sans of Beautiful Evidence. " +
      "Cabin — the Johnston–Gill school, bundled inside the theme as a " +
      "variable font with true 400–700 weights — renders on every " +
      "machine; the other recommendations are system faces.",
    defaultLabel: "Theme default — Gill Sans, Beautiful Evidence",
    options: [
      ['Cabin, ' + SANS_CHAIN, "Cabin — the Johnston–Gill school, bundled (true 400–700)"],
      ['Optima, "URW Classico", Candara, ' + SANS_CHAIN, "Optima — Zapf's humanist (macOS)"],
      ['Seravek, "Gill Sans", "Gill Sans MT", "Trebuchet MS", Calibri', "Seravek (macOS)"],
      ['"Trebuchet MS", "Gill Sans", "Gill Sans MT", Seravek, Calibri', "Trebuchet MS (everywhere)"]
    ]
  },
  {
    key: "sansWeight",
    tab: "latin",
    prop: "--tufte-sans-weight",
    name: "Sans — data & interface weight",
    desc:
      "One weight for the whole sans series, this window included; the H5 " +
      "table title keeps its own +200 step above it. macOS Gill Sans ships " +
      "300/400/600/700/800; requests between cuts snap to the nearest one.",
    defaultLabel: "Theme default — 400 · Regular",
    options: TYPEFACE_WEIGHTS
  },
  {
    key: "cjkSerif",
    tab: "cjk",
    weightKey: "cjkSerifWeight",
    synthName: "Tufte CJK Serif",
    customKey: "cjkSerifCustom",
    customName: "Chinese serif — your own font",
    customFilter: "cjk",
    chain: CJK_SERIF_CHAIN,
    prop: "--tufte-cjk-serif",
    name: "Chinese — serif companion (宋体)",
    desc:
      "The Chinese face behind the Latin serif: body text, headings, " +
      "tables. The default is the system Song chain (Songti SC / SimSun); " +
      "Source Han Serif 思源宋体 is the open pan-CJK alternative. The " +
      "serif reading weight reaches it too. Italic contexts keep Kaiti " +
      "楷体 by design.",
    defaultLabel: "Theme default — Songti 宋体 (system chain)",
    options: [
      ['"Source Han Serif SC", "Source Han Serif", "Noto Serif CJK SC", "Noto Serif SC", ' + CJK_SERIF_CHAIN, "Source Han Serif 思源宋体 (open, all weights)"],
      ['"LXGW WenKai", "LXGW WenKai GB", "LXGW WenKai Screen", ' + CJK_SERIF_CHAIN, "LXGW WenKai 霞鹜文楷 (open, kaiti-flavored)"]
    ]
  },
  {
    key: "cjkSerifWeight",
    tab: "cjk",
    name: "Chinese serif — weight (宋体字重)",
    desc:
      "A FIXED weight for Chinese serif text, independent of the Latin " +
      "knobs: the Suite maps every run weight onto the cut you choose " +
      "(bold Chinese keeps a +200 step), via named cuts — Songti ships " +
      "Light/Regular/Bold/Black, 思源宋体 the full range; requests between " +
      "cuts take the nearest named one. The default keeps today's " +
      "behavior: Chinese follows the Latin weights.",
    defaultLabel: "Follow the Latin weights (theme default)",
    options: TYPEFACE_WEIGHTS
  },
  {
    key: "cjkSans",
    tab: "cjk",
    weightKey: "cjkSansWeight",
    synthName: "Tufte CJK Sans",
    customKey: "cjkSansCustom",
    customName: "Chinese sans — your own font",
    customFilter: "cjk",
    chain: CJK_SANS_CHAIN,
    prop: "--tufte-cjk-sans",
    name: "Chinese — sans companion (黑体)",
    desc:
      "The Chinese face behind the sans/data register: task lists, tags, " +
      "Bases, the interface. The default is the system Hei chain " +
      "(PingFang SC / Microsoft YaHei); Source Han Sans 思源黑体 is the " +
      "open pan-CJK alternative. The sans weight reaches it too.",
    defaultLabel: "Theme default — PingFang 苹方 (system chain)",
    options: [
      ['"Source Han Sans SC", "Source Han Sans", "Noto Sans CJK SC", "Noto Sans SC", ' + CJK_SANS_CHAIN, "Source Han Sans 思源黑体 (open, all weights)"]
    ]
  },
  {
    key: "cjkSansWeight",
    tab: "cjk",
    name: "Chinese sans — weight (黑体字重)",
    desc:
      "A FIXED weight for Chinese in the data register, independent of " +
      "the Latin knobs; bold keeps a +200 step. PingFang ships Ultralight " +
      "through Semibold, 思源黑体 the full range; requests between cuts " +
      "take the nearest named one. The default keeps today's behavior: " +
      "Chinese follows the Latin weights.",
    defaultLabel: "Follow the Latin weights (theme default)",
    options: TYPEFACE_WEIGHTS
  }
];

/* ── Chinese fixed weights: the synthesized-family mechanism ──────────────
 * CSS font-weight is per element, so Chinese glyphs in a mixed run cannot
 * simply be given a different weight than the Latin around them. What CSS
 * does allow is remapping which PHYSICAL CUT serves a given run weight:
 * a generated @font-face whose src is a local() reference to a specific
 * named cut, declared to cover a whole font-weight RANGE. When a Chinese
 * weight is chosen, applyTypefaces() injects one synthesized family per
 * series ("Tufte CJK Serif"/"Tufte CJK Sans") — a base face serving run
 * weights 100–500 with the chosen cut, and a bold face serving 600–900
 * with the cut two steps up, so strong/headings keep their step — and
 * fronts the series' knob stack with it. Cut names come from the tables
 * below for the known families, then generic style-name suffixes, then
 * the bare family (whose default cut is the graceful floor: text always
 * renders, at worst unshifted). local() matches full or PostScript names
 * in Chromium; a name that misses simply falls through the src list. */
const CJK_WEIGHT_NAMES = {
  "Songti SC": { 300: "Songti SC Light", 400: "Songti SC", 700: "Songti SC Bold", 900: "Songti SC Black" },
  "PingFang SC": { 100: "PingFang SC Ultralight", 200: "PingFang SC Thin", 300: "PingFang SC Light", 400: "PingFang SC", 500: "PingFang SC Medium", 600: "PingFang SC Semibold" },
  "Kaiti SC": { 400: "Kaiti SC", 700: "Kaiti SC Bold", 900: "Kaiti SC Black" },
  "Source Han Serif SC": { 200: "Source Han Serif SC ExtraLight", 300: "Source Han Serif SC Light", 400: "Source Han Serif SC", 500: "Source Han Serif SC Medium", 600: "Source Han Serif SC SemiBold", 700: "Source Han Serif SC Bold", 900: "Source Han Serif SC Heavy" },
  "Source Han Sans SC": { 200: "Source Han Sans SC ExtraLight", 300: "Source Han Sans SC Light", 400: "Source Han Sans SC", 500: "Source Han Sans SC Medium", 700: "Source Han Sans SC Bold", 900: "Source Han Sans SC Heavy" },
  "LXGW WenKai": { 300: "LXGW WenKai Light", 400: "LXGW WenKai", 500: "LXGW WenKai Medium" },
  "Microsoft YaHei": { 300: "Microsoft YaHei Light", 400: "Microsoft YaHei", 700: "Microsoft YaHei Bold" }
};

const CJK_GENERIC_SUFFIXES = {
  100: ["Thin", "Ultralight"],
  200: ["ExtraLight", "Thin"],
  300: ["Light"],
  400: ["", "Regular"],
  500: ["Medium"],
  600: ["Semibold", "SemiBold", "Demibold"],
  700: ["Bold"],
  800: ["ExtraBold", "Heavy"],
  900: ["Black", "Heavy"]
};

// First family of a stack, unquoted — the key for the tables above.
function cjkPrimaryFamily(stack) {
  const first = String(stack).split(",")[0].trim();
  return first.replace(/^"|"$/g, "");
}

// local() sources for one family at one weight slot: the table's nearest
// named cut first, then generic suffix guesses, then the bare family.
function cjkSrcList(family, weight) {
  const names = [];
  const table = CJK_WEIGHT_NAMES[family];
  if (table) {
    let best = null;
    for (const k of Object.keys(table)) {
      const kn = parseInt(k, 10);
      if (best === null || Math.abs(kn - weight) < Math.abs(best - weight) ||
          (Math.abs(kn - weight) === Math.abs(best - weight) && kn > best)) {
        best = kn;
      }
    }
    if (best !== null) names.push(table[best]);
  }
  for (const suffix of CJK_GENERIC_SUFFIXES[weight] || []) {
    names.push(suffix ? family + " " + suffix : family);
  }
  names.push(family);
  const seen = new Set();
  const srcs = [];
  for (const n of names) {
    if (seen.has(n)) continue;
    seen.add(n);
    srcs.push('local("' + n + '")');
  }
  return srcs.join(", ");
}

// The two @font-face blocks for one synthesized series family.
function cjkFontFaceCss(synthName, family, weight) {
  const boldWeight = Math.min(900, weight + 200);
  const NL = String.fromCharCode(10);   // no escape sequences: this file is
                                        // emitted through a template literal
  return [
    "@font-face {",
    '  font-family: "' + synthName + '";',
    "  font-weight: 100 500;",
    "  src: " + cjkSrcList(family, weight) + ";",
    "}",
    "@font-face {",
    '  font-family: "' + synthName + '";',
    "  font-weight: 600 900;",
    "  src: " + cjkSrcList(family, boldWeight) + ";",
    "}",
    ""
  ].join(NL);
}

class TufteSuiteSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const containerEl = this.containerEl;
    containerEl.empty();

    new obsidian.Setting(containerEl).setName("Bundled plugins").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Tufte Suite bundles the four standalone Tufte plugins as switchable modules. " +
        "Keep the standalone plugins disabled while Tufte Suite is enabled, or " +
        "everything renders twice. Toggling a module applies immediately."
    });

    for (const def of SUBMODULES) {
      new obsidian.Setting(containerEl)
        .setName(def.name)
        .setDesc(def.blurb)
        .addToggle((t) =>
          t.setValue(this.plugin.isModuleEnabled(def.key)).onChange(async (v) => {
            await this.plugin.setModuleEnabled(def.key, v);
            this.display();
          })
        );
    }

    // Per-module settings captured from the sub-plugins (today: Tufte Figures).
    for (const section of this.plugin.settingSections) {
      new obsidian.Setting(containerEl).setName(section.def.name).setHeading();
      section.tab.containerEl = containerEl.createDiv();
      section.tab.display();
    }

    // Typefaces (Tufte theme) — suite-level, not a module: the GUI home of
    // the theme's typeface knobs (see TYPEFACE_SETTINGS above). Split into
    // two in-page tabs — Latin and Chinese — because a plugin gets exactly
    // one sidebar settings entry (Obsidian's settings navigation assumes
    // one tab per plugin id), so sub-navigation lives inside the page. NB:
    // every wrapper here carries a class — the one bare classless <div>
    // per section is reserved for the sub-plugin tabs above.
    new obsidian.Setting(containerEl).setName("Typefaces (Tufte theme)").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Faces and weights for the Tufte theme's two type series — the serif " +
        "reading register and the sans data/interface register. Changes apply " +
        "immediately and persist with the Suite's settings; 'Theme default' " +
        "hands a knob back to the theme. Chinese companion faces follow " +
        "automatically. Requires the Tufte theme (inert under any other theme)."
    });

    if (!this.typefaceTab) this.typefaceTab = "latin";
    const tabsEl = containerEl.createDiv({ cls: "tufte-suite-typeface-tabs" });
    for (const t of [["latin", "Latin \u00b7 \u897f\u6587"], ["cjk", "Chinese \u00b7 \u4e2d\u6587"]]) {
      const btn = tabsEl.createEl("button", { text: t[1], cls: "tufte-suite-typeface-tab" });
      if (this.typefaceTab === t[0]) btn.addClass("is-active");
      btn.addEventListener("click", () => {
        this.typefaceTab = t[0];
        this.display();
      });
    }
    const paneEl = containerEl.createDiv({ cls: "tufte-suite-typeface-content" });

    for (const def of TYPEFACE_SETTINGS) {
      if (def.tab !== this.typefaceTab) continue;
      new obsidian.Setting(paneEl)
        .setName(def.name)
        .setDesc(def.desc)
        .addDropdown((d) => {
          d.addOption("", def.defaultLabel);
          for (const opt of def.options) d.addOption(opt[0], opt[1]);
          if (def.customKey) d.addOption(CUSTOM_FACE, "Other — a font installed on your system…");
          d.setValue(this.plugin.getTypeface(def.key));
          d.onChange(async (v) => {
            // Leaving "Other" clears the paired custom name, so storage
            // never keeps an inert leftover; entering it reads the system
            // font list FIRST, so the re-render paints the picker directly
            // instead of a loading row.
            if (def.customKey && v !== CUSTOM_FACE) {
              await this.plugin.setTypeface(def.customKey, "");
            }
            await this.plugin.setTypeface(def.key, v);
            if (def.customKey) {
              if (v === CUSTOM_FACE) await this.plugin.listFontsFor(def);
              this.display();
            }
          });
        });

      // The "Other…" companion row: only while that choice is active. A
      // dropdown of the user's OWN installed fonts when they can be
      // enumerated (the same list as Settings → Appearance → Font — and
      // for the Chinese companions, filtered down to the fonts that can
      // actually set Chinese); a typed name field where they cannot
      // (mobile, or enumeration denied); a quiet loading row for a first
      // paint that arrives before the list has been read (e.g. reopening
      // settings with a saved "Other" choice).
      if (def.customKey && this.plugin.getTypeface(def.key) === CUSTOM_FACE) {
        const row = new obsidian.Setting(paneEl).setName(def.customName);
        const fonts = def.customFilter === "cjk" ? this.plugin.chineseFonts : this.plugin.systemFonts;
        if (fonts === null) {
          row.setDesc("Reading your installed fonts…");
          this.plugin.listFontsFor(def).then(() => this.display());
        } else if (fonts.length) {
          row
            .setDesc(
              def.customFilter === "cjk"
                ? "Your installed Chinese fonts — the system list filtered " +
                  "to families that can actually set Chinese text. The " +
                  "theme's default chain stays behind the choice as fallback."
                : "Your installed fonts — the same list as Settings → " +
                  "Appearance → Font. The theme's default chain stays behind " +
                  "the choice as fallback, and the Chinese companion faces " +
                  "still apply."
            )
            .addDropdown((d) => {
              d.addOption("", "— pick a font —");
              const current = this.plugin.getTypeface(def.customKey);
              let listed = false;
              for (const fam of fonts) {
                d.addOption(fam, fam);
                if (fam === current) listed = true;
              }
              if (current && !listed) d.addOption(current, current + " (not found on this system)");
              d.setValue(current);
              d.onChange(async (v) => {
                await this.plugin.setTypeface(def.customKey, v);
              });
            });
        } else {
          row
            .setDesc(
              "Your fonts could not be listed here — type the family name " +
              "exactly as your system knows it (browse what is installed " +
              "under Settings → Appearance → Font). The theme's default " +
              "chain stays behind it as fallback, and the Chinese " +
              "companion faces still apply."
            )
            .addText((t) => {
              t.setPlaceholder("e.g. Avenir Next");
              t.setValue(this.plugin.getTypeface(def.customKey));
              t.onChange(async (v) => {
                await this.plugin.setTypeface(def.customKey, v);
              });
            });
        }
      }
    }
  }

  hide() {
    for (const section of this.plugin.settingSections) {
      if (typeof section.tab.hide === "function") {
        try {
          section.tab.hide();
        } catch (e) {
          console.error("Tufte Suite: sub-plugin settings hide() failed", e);
        }
      }
    }
    return super.hide();
  }
}

module.exports = class TufteSuitePlugin extends obsidian.Plugin {
  async onload() {
    this.loadedSubs = [];
    this.settingSections = [];
    this.systemFonts = null;   // null = not read yet; [] = unavailable
    this.chineseFonts = null;  // the same list filtered to Chinese-capable families

    // Namespaced storage: one section per module inside the suite's own
    // data.json ({ __modules: {...}, backlinks: ..., figures: ..., ... }).
    // First run imports each standalone plugin's data.json (read-only).
    this.suiteData = await this.loadData();
    const firstRun = !this.suiteData || typeof this.suiteData !== "object";
    if (firstRun) {
      this.suiteData = {};
      await this.importStandaloneSettings();
    }
    if (!this.suiteData[MODULES_KEY] || typeof this.suiteData[MODULES_KEY] !== "object") {
      this.suiteData[MODULES_KEY] = {};
    }
    if (firstRun) await this.saveData(this.suiteData);

    // One-time copy of the figures quilt store into the suite's folder
    // (matches the patched quiltDir() path). Never writes to the source.
    await this.importQuiltStore();

    // Re-assert any saved typeface knobs before the modules load, so the
    // first paint after enabling the suite already wears them.
    this.applyTypefaces();

    await this.loadEnabledModules();

    this.addSettingTab(new TufteSuiteSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => this.warnAboutStandalonePlugins());
  }

  isModuleEnabled(key) {
    const m = this.suiteData && this.suiteData[MODULES_KEY];
    return !m || m[key] !== false;
  }

  async setModuleEnabled(key, enabled) {
    this.suiteData[MODULES_KEY][key] = !!enabled;
    await this.saveData(this.suiteData);
    await this.queueReloadModules();
  }

  onunload() {
    // The typeface knobs are inline body styles and would otherwise
    // outlive the plugin, and the probe font sits in document.fonts;
    // everything else unwinds via the Component tree.
    this.clearTypefaces();
    if (this._cjkStyleEl) {
      this._cjkStyleEl.remove();
      this._cjkStyleEl = null;
    }
    if (this._probeFace && document.fonts && typeof document.fonts.delete === "function") {
      try { document.fonts.delete(this._probeFace); } catch (e) {}
    }
  }

  getTypeface(key) {
    const t = this.suiteData && this.suiteData[TYPEFACES_KEY];
    return t && typeof t[key] === "string" ? t[key] : "";
  }

  async setTypeface(key, value) {
    let t = this.suiteData[TYPEFACES_KEY];
    if (!t || typeof t !== "object") t = this.suiteData[TYPEFACES_KEY] = {};
    if (value) t[key] = value;
    else delete t[key];
    if (Object.keys(t).length === 0) delete this.suiteData[TYPEFACES_KEY];
    await this.saveData(this.suiteData);
    this.applyTypefaces();
  }

  // What a knob's stored value means as CSS: a preset option IS the stack;
  // the "__custom__" sentinel composes the user's own family name over the
  // theme's default chain (empty name = nothing yet = theme default).
  resolveTypeface(def) {
    const v = this.getTypeface(def.key);
    if (v !== CUSTOM_FACE) return v;
    const name = def.customKey ? this.getTypeface(def.customKey) : "";
    return name ? name + ", " + def.chain : "";
  }

  // Each configured knob becomes an inline body style; knobs at theme
  // default are REMOVED, so the theme's own CSS value shows through. The
  // Chinese series may additionally carry a fixed weight, implemented by
  // fronting the stack with a synthesized remap family (see the tables
  // above renderCjkWeightCss).
  applyTypefaces() {
    for (const def of TYPEFACE_SETTINGS) {
      if (!def.prop) continue;               // the CJK weight rows ride their face def
      if (def.weightKey) {
        this.applyCjkSeries(def);
        continue;
      }
      const v = this.resolveTypeface(def);
      if (v) document.body.style.setProperty(def.prop, v);
      else document.body.style.removeProperty(def.prop);
    }
    this.renderCjkWeightCss();
  }

  // One Chinese series: face stack + optional fixed weight. Without a
  // weight the knob behaves exactly as a Latin one (set or removed); with
  // one, the synthesized family fronts the stack — over the theme's
  // default chain when the face itself is untouched — so every run weight
  // lands on the chosen cut.
  applyCjkSeries(def) {
    const face = this.resolveTypeface(def);
    const w = parseInt(this.getTypeface(def.weightKey), 10);
    if (!w) {
      if (face) document.body.style.setProperty(def.prop, face);
      else document.body.style.removeProperty(def.prop);
      return;
    }
    const stack = face || def.chain;
    document.body.style.setProperty(def.prop, '"' + def.synthName + '", ' + stack);
  }

  // The one style element holding the synthesized @font-face blocks for
  // whichever Chinese series carry a fixed weight; removed when none do.
  renderCjkWeightCss() {
    let css = "";
    for (const def of TYPEFACE_SETTINGS) {
      if (!def.weightKey) continue;
      const w = parseInt(this.getTypeface(def.weightKey), 10);
      if (!w) continue;
      const stack = this.resolveTypeface(def) || def.chain;
      css += cjkFontFaceCss(def.synthName, cjkPrimaryFamily(stack), w);
    }
    if (!css) {
      if (this._cjkStyleEl) {
        this._cjkStyleEl.remove();
        this._cjkStyleEl = null;
      }
      return;
    }
    if (!this._cjkStyleEl) {
      this._cjkStyleEl = document.createElement("style");
      this._cjkStyleEl.id = "tufte-suite-cjk-weights";
      document.head.appendChild(this._cjkStyleEl);
    }
    this._cjkStyleEl.textContent = css;
  }

  clearTypefaces() {
    for (const def of TYPEFACE_SETTINGS) {
      document.body.style.removeProperty(def.prop);
    }
  }

  // The user's installed font families, for the Typefaces "Other…"
  // picker. Sources, in order: Obsidian's own bundled get-fonts native
  // module — the exact list the app's Settings → Appearance → Font
  // shows (desktop; the same call app.js makes) — then the Chromium
  // Local Font Access API, else an empty list, which makes the settings
  // tab fall back to a typed name field. Cached after the first read;
  // null means "not read yet". Entries are normalized to family-name
  // strings, deduplicated and sorted.
  async listSystemFonts() {
    if (this.systemFonts) return this.systemFonts;
    let entries = null;
    if (obsidian.Platform && obsidian.Platform.isDesktopApp) {
      try {
        entries = await require("get-fonts").getFonts();
      } catch (e) {
        entries = null;
      }
    }
    if (!entries) {
      try {
        if (typeof window !== "undefined" && typeof window.queryLocalFonts === "function") {
          entries = await window.queryLocalFonts();
        }
      } catch (e) {
        entries = null;
      }
    }
    const seen = new Set();
    for (const e of entries || []) {
      const fam = typeof e === "string" ? e : e && (e.family || e.name || e.fullName);
      if (fam && typeof fam === "string") seen.add(fam);
    }
    this.systemFonts = Array.from(seen).sort((a, b) => a.localeCompare(b));
    return this.systemFonts;
  }

  // Which list a given face def's "Other…" picker shows.
  listFontsFor(def) {
    return def.customFilter === "cjk" ? this.listChineseFonts() : this.listSystemFonts();
  }

  async listChineseFonts() {
    if (this.chineseFonts) return this.chineseFonts;
    this.chineseFonts = await this.filterChineseFamilies(await this.listSystemFonts());
    return this.chineseFonts;
  }

  // Keep only families that can actually SET Chinese, decided per glyph
  // with a blank probe font rather than any baseline comparison — canvas
  // always falls back for a missing glyph, and WHICH system font it falls
  // back to follows the resolved primary's class (a resolved Latin sans
  // pulls PingFang for both generic arms, a Japanese serif pulls Songti),
  // so ink-metric baselines cannot tell "covers" from "fell back to a
  // default" (measured in Chrome, 2026-08-14). The probe font ends the
  // ambiguity: TufteProbeBlank (636 bytes, generated with fontTools) maps
  // the two probe characters to ZERO-ADVANCE blank glyphs, and the stack
  // '"<family>", TufteProbeBlank' can no longer reach the system: width
  // 0 = the family lacks the glyph, width > 0 = the family itself drew
  // it. The characters are simplified-specific — 这 U+8FD9 and 们 U+4EEC
  // sit outside the Japanese and Korean standard sets — so JP/KR-only
  // fonts fail (verified against Hiragino Mincho ProN and Yu Gothic,
  // which the ink-metric approach wrongly admitted). Fallback where
  // FontFace/canvas are missing (the jsdom harness; mobile edge cases):
  // a name heuristic over CJK characters and common Chinese-family
  // markers.
  async ensureProbeFont() {
    if (this._probeFontReady !== undefined) return this._probeFontReady;
    let ready = false;
    try {
      if (
        typeof FontFace === "function" &&
        typeof document !== "undefined" &&
        document.fonts &&
        typeof document.fonts.add === "function"
      ) {
        const bin = window.atob(PROBE_BLANK_B64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        this._probeFace = new FontFace("TufteProbeBlank", bytes.buffer);
        await this._probeFace.load();
        document.fonts.add(this._probeFace);
        ready = true;
      }
    } catch (e) {
      ready = false;
    }
    this._probeFontReady = ready;
    return ready;
  }

  async filterChineseFamilies(families) {
    if (await this.ensureProbeFont()) {
      let ctx = null;
      try {
        const canvas = document.createElement("canvas");
        ctx = canvas.getContext ? canvas.getContext("2d") : null;
      } catch (e) {
        ctx = null;
      }
      if (ctx && typeof ctx.measureText === "function") {
        const CHARS = ["\u8fd9", "\u4eec"];
        return families.filter((fam) => {
          if (fam.indexOf('"') !== -1) return false;
          return CHARS.every((ch) => {
            ctx.font = '16px "' + fam + '", TufteProbeBlank';
            return ctx.measureText(ch).width > 0;
          });
        });
      }
    }
    const re = /[\u3400-\u9fff\u3000-\u303f]|\b(SC|TC|GB|CN|HK)\b|CJK|Song|Sung|Hei\b|Heiti|Kai|Ming|Yuan|FangSong|Fang Song|Sim(Sun|Hei)|YaHei|DengXian|PingFang|Source Han|WenQuanYi|LXGW|Sarasa|HarmonyOS Sans SC|MiSans/i;
    return families.filter((fam) => re.test(fam));
  }

  // Serialize reloads: a second toggle clicked while a reload is mid-flight
  // must queue behind it, not tear down the same loadedSubs array twice
  // (concurrent passes would leave every module instantiated twice).
  queueReloadModules() {
    const run = () => this.reloadModules();
    this._reloadChain = (this._reloadChain || Promise.resolve()).then(run, (e) => {
      console.error("Tufte Suite: previous module reload failed", e);
      return run();
    });
    return this._reloadChain;
  }

  // Unload everything, then reload the enabled modules in canonical order, so
  // registration order after a toggle matches a fresh plugin load.
  async reloadModules() {
    for (const sub of this.loadedSubs.slice().reverse()) {
      this.removeChild(sub);
    }
    this.loadedSubs = [];
    this.settingSections = [];
    await this.loadEnabledModules();
  }

  async loadEnabledModules() {
    for (const def of SUBMODULES) {
      if (!this.isModuleEnabled(def.key)) continue;
      try {
        await this.loadSubPlugin(def);
      } catch (e) {
        console.error("Tufte Suite: failed to load module " + def.id, e);
        new obsidian.Notice(
          'Tufte Suite: module "' + def.name + '" failed to load - see developer console.'
        );
      }
    }
  }

  async loadSubPlugin(def) {
    const manifest = Object.assign({}, this.manifest, {
      id: def.id,
      name: def.name,
      version: def.version,
      description: def.name + " " + def.version + ", bundled in " + this.manifest.name + "."
    });
    const sub = new def.cls(this.app, manifest);
    const suite = this;

    // Persistence shims: the sub-plugin reads/writes its namespaced section of
    // the suite's data.json. Copies mimic Obsidian's fresh-parse semantics.
    sub.loadData = async function () {
      const d = suite.suiteData[def.key];
      return d === undefined || d === null ? null : JSON.parse(JSON.stringify(d));
    };
    sub.saveData = async function (data) {
      suite.suiteData[def.key] = data === undefined ? null : JSON.parse(JSON.stringify(data));
      await suite.saveData(suite.suiteData);
    };

    // Setting tabs are collected into the suite's single tab instead of
    // adding sidebar entries for plugins that aren't installed standalone.
    sub.addSettingTab = function (tab) {
      suite.settingSections.push({ def: def, tab: tab });
    };

    // Load with the semantics Obsidian gives real plugins: sequential, with
    // each module's async onload() awaited before the next module starts.
    // addChild() ties the unload cascade; whether it also load()s the child
    // immediately depends on the parent's internal loaded flag, so call
    // load() as well - Component.load() is a no-op on a loaded component.
    let invoked = false;
    let onloadResult;
    const originalOnload = sub.onload;
    sub.onload = function () {
      invoked = true;
      onloadResult = originalOnload.apply(this, arguments);
      return onloadResult;
    };
    try {
      try {
        this.addChild(sub);
        if (!invoked) sub.load();
      } finally {
        sub.onload = originalOnload;
      }
      if (onloadResult && typeof onloadResult.then === "function") await onloadResult;
    } catch (e) {
      // Detach a half-loaded module so its partial registrations unwind and
      // repeated toggle cycles cannot accumulate dead children.
      this.removeChild(sub);
      throw e;
    }

    this.loadedSubs.push(sub);
    return sub;
  }

  async importStandaloneSettings() {
    const adapter = this.app.vault.adapter;
    for (const def of SUBMODULES) {
      const p = this.app.vault.configDir + "/plugins/" + def.id + "/data.json";
      try {
        if (await adapter.exists(p)) {
          this.suiteData[def.key] = JSON.parse(await adapter.read(p));
        }
      } catch (e) {
        console.warn("Tufte Suite: could not import settings from " + def.id, e);
      }
    }
  }

  async importQuiltStore() {
    const adapter = this.app.vault.adapter;
    // Source and destination deliberately mirror quiltDir()'s literals: the
    // original in tufte-figures and the patched copy embedded above.
    const src = this.app.vault.configDir + "/plugins/tufte-figures/quilts";
    const dst = this.app.vault.configDir + "/plugins/tufte-suite/quilts";
    try {
      if (!(await adapter.exists(src))) return;
      if (await adapter.exists(dst)) return;
      await this.copyFolder(adapter, src, dst);
    } catch (e) {
      console.warn("Tufte Suite: quilt store import failed", e);
    }
  }

  async copyFolder(adapter, src, dst) {
    await adapter.mkdir(dst);
    const listing = await adapter.list(src);
    for (const file of listing.files) {
      const name = file.slice(file.lastIndexOf("/") + 1);
      await adapter.writeBinary(dst + "/" + name, await adapter.readBinary(file));
    }
    for (const folder of listing.folders) {
      const name = folder.slice(folder.lastIndexOf("/") + 1);
      await this.copyFolder(adapter, folder, dst + "/" + name);
    }
  }

  warnAboutStandalonePlugins() {
    try {
      const enabled = this.app.plugins && this.app.plugins.enabledPlugins;
      if (!enabled || typeof enabled.has !== "function") return;
      const dupes = SUBMODULES.filter((d) => enabled.has(d.id)).map((d) => d.name);
      if (dupes.length) {
        new obsidian.Notice(
          "Tufte Suite: " +
            dupes.join(", ") +
            (dupes.length > 1 ? " are" : " is") +
            " also enabled standalone. Disable the standalone version" +
            (dupes.length > 1 ? "s" : "") +
            " to avoid double rendering.",
          10000
        );
      }
    } catch (e) {
      /* advisory only */
    }
  }
};
`;

parts.push(RUNTIME.trimStart());

const mainJs = parts.join("\n");

// ---------------------------------------------------------------------------
// Self-checks: re-extract every embedded section and compare bytes
// ---------------------------------------------------------------------------
for (const m of MODULES) {
  const b = beginMarker(m);
  const e = endMarker(m);
  const i = mainJs.indexOf(b);
  const j = mainJs.indexOf(e);
  assert(i !== -1 && j !== -1, m.id + ": embed markers missing in output");
  assert(mainJs.indexOf(b, i + 1) === -1, m.id + ": BEGIN marker not unique");
  assert(mainJs.indexOf(e, j + 1) === -1, m.id + ": END marker not unique");
  const embedded = mainJs.slice(i + b.length + 1, j); // skip marker line's \n
  const expected = m.patched.replace(/\n$/, "") + "\n";
  assert(
    embedded === expected,
    m.id + ": embedded section is not byte-identical to the (patched) source"
  );
  // Verbatim modules must equal the original source exactly.
  if (!(m.patches || []).length) {
    assert(m.patched === m.source, m.id + ": unexpected patch applied");
  }
}

// The figures patch must be the ONLY difference between source and patched.
{
  const fig = MODULES.find((m) => m.id === "tufte-figures");
  const back = fig.patched.split("plugins/tufte-suite/quilts").join("plugins/tufte-figures/quilts");
  assert(back === fig.source, "tufte-figures: patch is not cleanly reversible");
}

// ---------------------------------------------------------------------------
// styles.css: concatenation in module load order (inline has no CSS)
// ---------------------------------------------------------------------------
const cssParts = [
  "/* " + SUITE_NAME + " " + SUITE_VERSION + " - GENERATED " + BUILD_DATE + " by build-tufte-suite.js.",
  "   One suite-level block (the settings tab bar), then a concatenation of",
  "   the standalone plugins' styles.css in load order:",
  "   " + MODULES.filter((m) => m.css).map((m) => m.id).join(", ") + ".",
  "   (tufte-inline has no styles.css; its styling lives in the Tufte theme.)",
  "   Do not hand-edit; fix the generator (suite block) or the standalone",
  "   plugin's styles.css and regenerate. */",
  "",
  "/* ═══════════ suite-level: the Typefaces Latin/Chinese tab bar ═══════════ */",
  "",
  ".tufte-suite-typeface-tabs {",
  "  display: flex;",
  "  gap: var(--size-4-2);",
  "  margin: var(--size-4-2) 0 var(--size-4-3);",
  "}",
  ".tufte-suite-typeface-tabs .tufte-suite-typeface-tab.is-active {",
  "  border-bottom: 2px solid var(--interactive-accent);",
  "  border-bottom-left-radius: 0;",
  "  border-bottom-right-radius: 0;",
  "  font-weight: var(--font-semibold);",
  "}",
  "",
];
for (const m of MODULES) {
  if (!m.css) continue;
  cssParts.push(
    "/* ═══════════ " + m.id + " " + m.manifest.version + " styles.css ═══════════ */",
    "",
    m.css.replace(/\n$/, ""),
    ""
  );
}
const stylesCss = cssParts.join("\n");
for (const m of MODULES) {
  if (m.css) assert(stylesCss.includes(m.css.replace(/\n$/, "")), m.id + ": css not embedded intact");
}

// ---------------------------------------------------------------------------
// manifest.json
// ---------------------------------------------------------------------------
const manifest = {
  id: SUITE_ID,
  name: SUITE_NAME,
  version: SUITE_VERSION,
  minAppVersion: minAppVersions[0],
  description:
    "The four Tufte plugins - Sidenotes, Figures, Inline and Backlinks - bundled as a single plugin with per-module toggles. Disable the standalone plugins while this is enabled.",
  author: MODULES[0].manifest.author,
  authorUrl: MODULES[0].manifest.authorUrl,
  isDesktopOnly: false,
};

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "main.js"), mainJs);
fs.writeFileSync(path.join(OUT_DIR, "styles.css"), stylesCss);
fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log("Tufte Suite " + SUITE_VERSION + " build OK -> " + OUT_DIR);
console.log("  sources:   " + MODULE_ROOT.dir + "   [" + MODULE_ROOT.label + "]");
console.log("  main.js    " + Buffer.byteLength(mainJs, "utf8") + " bytes");
console.log("  styles.css " + Buffer.byteLength(stylesCss, "utf8") + " bytes");
console.log(
  "  modules:   " +
    MODULES.map((m) => m.id + "@" + m.manifest.version).join(", ")
);
console.log("  patches:   tufte-figures quilt path (1 occurrence), all other bytes verbatim");
