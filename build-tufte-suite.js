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
const SUITE_VERSION = "1.0.1";
const BUILD_DATE = "2026-08-05";

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
  "   Concatenation of the standalone plugins' styles.css in load order:",
  "   " + MODULES.filter((m) => m.css).map((m) => m.id).join(", ") + ".",
  "   (tufte-inline has no styles.css; its styling lives in the Tufte theme.)",
  "   Do not hand-edit; fix the standalone plugin's styles.css and regenerate. */",
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
