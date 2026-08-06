"use strict";

// First-run migration: the suite imports each standalone plugin's settings and
// copies the figures quilt store into its own folder, WITHOUT ever writing to
// the standalone plugins' directories, and without re-migrating on reload.

const { makeEnv, load, assert } = require("./harness");
const { ok, eq, deepEq } = assert;

const CFG = ".obsidian";
const FIG_DATA = CFG + "/plugins/tufte-figures/data.json";
const SUITE_DATA = CFG + "/plugins/tufte-suite/data.json";
const FIG_QUILT = CFG + "/plugins/tufte-figures/quilts/123";
const SUITE_QUILT = CFG + "/plugins/tufte-suite/quilts/123";

const SEEDED_FIGURES = {
  interceptDrops: false,
  labelPrefix: "Figure",
  quiltFolder: "custom/q"
};
const QUILT_JSON = '{"tiles":[{"path":"a.png"}],"rowHeight":120}';
const TILE_BYTES = [1, 2, 3];

const ORIGINAL_DIRS = [
  CFG + "/plugins/tufte-backlinks/",
  CFG + "/plugins/tufte-figures/",
  CFG + "/plugins/tufte-inline/",
  CFG + "/plugins/tufte-sidenotes/"
];

function seedAdapter(env) {
  env.adapter.__seed(FIG_DATA, JSON.stringify(SEEDED_FIGURES));
  env.adapter.__seed(FIG_QUILT + "/quilt.json", QUILT_JSON);
  env.adapter.__seed(FIG_QUILT + "/tile-0.png", new Uint8Array(TILE_BYTES));
}

async function loadSuiteInto(env) {
  const Cls = load.loadPluginClass("suite", env);
  const plugin = new Cls(
    env.app,
    Object.assign({}, load.MANIFESTS.suite, { dir: CFG + "/plugins/tufte-suite" })
  );
  await load.loadComponent(plugin);
  await env.settle();
  return plugin;
}

function foreignWrites(log) {
  return log.filter((w) => ORIGINAL_DIRS.some((d) => w.path.startsWith(d)));
}

module.exports = async function t4() {
  const env = makeEnv();
  seedAdapter(env);

  const plugin = await loadSuiteInto(env);

  // ---- suite data.json ----
  ok(env.adapter.__has(SUITE_DATA), "suite data.json must exist after first run");
  const suiteData = JSON.parse(env.adapter.__text(SUITE_DATA));
  deepEq(suiteData.figures, SEEDED_FIGURES, "imported figures settings section");
  // In memory the module map always exists...
  ok(
    plugin.suiteData.__modules && typeof plugin.suiteData.__modules === "object",
    "__modules must be present on the in-memory suite data"
  );
  // Fixed after README "Finding 1": onload() now seeds __modules BEFORE the
  // first-run save, so the file on disk carries the module map from day one.
  eq(
    Object.prototype.hasOwnProperty.call(suiteData, "__modules"),
    true,
    "first-run data.json includes the __modules map (Finding 1 fixed)"
  );

  // ---- the figures sub-instance really got them ----
  const figuresSub = plugin.loadedSubs.find((s) => s.manifest.id === "tufte-figures");
  ok(figuresSub, "figures submodule instance");
  eq(figuresSub.settings.interceptDrops, false, "figures sub read the imported interceptDrops");
  eq(figuresSub.settings.labelPrefix, "Figure", "figures sub read the imported labelPrefix");
  eq(figuresSub.settings.quiltFolder, "custom/q", "figures sub read the imported quiltFolder");

  // ---- quilt store copied byte-identically ----
  eq(
    env.adapter.__text(SUITE_QUILT + "/quilt.json"),
    QUILT_JSON,
    "quilt.json copied verbatim"
  );
  deepEq(
    env.adapter.__bytes(SUITE_QUILT + "/tile-0.png"),
    TILE_BYTES,
    "tile-0.png copied byte-identically"
  );

  // ---- isolation ----
  const bad = foreignWrites(env.adapter.__writeLog);
  deepEq(bad, [], "no writes may touch a standalone plugin's directory");
  eq(
    env.adapter.__text(FIG_DATA),
    JSON.stringify(SEEDED_FIGURES),
    "the standalone figures data.json is untouched"
  );

  // ---- unload + a SECOND suite instance on the same adapter ----
  const before = env.adapter.__writeLog.length;
  plugin.unload();
  await env.settle();

  const plugin2 = await loadSuiteInto(env);
  const deltaLog = env.adapter.__writeLog.slice(before);
  const recopies = deltaLog.filter((w) => w.path.startsWith(SUITE_QUILT));
  deepEq(recopies, [], "the quilt store must not be copied a second time");
  deepEq(
    foreignWrites(deltaLog),
    [],
    "the second run must also leave the standalone directories alone"
  );

  const figuresSub2 = plugin2.loadedSubs.find((s) => s.manifest.id === "tufte-figures");
  eq(figuresSub2.settings.labelPrefix, "Figure", "settings persist across a reload");
  eq(figuresSub2.settings.interceptDrops, false, "settings persist across a reload (bool)");
  deepEq(
    JSON.parse(env.adapter.__text(SUITE_DATA)).figures,
    SEEDED_FIGURES,
    "the persisted figures section is unchanged by the reload"
  );

  return deltaLog.length + " writes on reload, none re-migrating";
};
