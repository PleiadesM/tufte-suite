"use strict";

// Regression for the verifier's FINDING 1: two module toggles fired while a
// reload is mid-flight must serialize through queueReloadModules(), never
// interleave. The un-fixed suite ended up with every module instantiated
// twice (double drop handlers, double editor extension, doubled settings
// section). This drives the REAL settings-tab toggles, exactly like the UI.

const { loadSuite, assert } = require("./harness");
const { ok, eq, deepEq } = assert;

const SUITE_DATA = ".obsidian/plugins/tufte-suite/data.json";
const MODULE_NAMES = ["Tufte Backlinks", "Tufte Figures", "Tufte Inline", "Tufte Sidenotes"];

function procOwners(env) {
  return env.registries.markdownPostProcessors.map((p) => p.pluginId);
}
function subIds(plugin) {
  return plugin.loadedSubs.map((s) => s.manifest.id);
}
function moduleToggles(env, tab) {
  const byName = {};
  for (const s of env.registries.settings) {
    if (!s.settingEl || !tab.containerEl.contains(s.settingEl)) continue;
    const nameEl = s.settingEl.querySelector(".setting-item-name");
    const toggle = s.components.find((c) => c.kind === "toggle");
    if (nameEl && toggle && MODULE_NAMES.includes(nameEl.textContent)) {
      byName[nameEl.textContent] = toggle;
    }
  }
  return byName;
}

module.exports = async function t9() {
  const { env, plugin } = await loadSuite();
  const r = env.registries;

  const tab = r.settingTabs[0];
  tab.containerEl = env.document.createElement("div");
  tab.display();
  const toggles = moduleToggles(env, tab);
  deepEq(Object.keys(toggles).sort(), MODULE_NAMES.slice().sort(), "all four module toggles found");

  // ---- phase 1: two different modules toggled off concurrently (UI path) ----
  const c1 = toggles["Tufte Figures"].fireChange(false);
  const c2 = toggles["Tufte Inline"].fireChange(false);
  await Promise.all([c1, c2]);
  await env.settle();

  deepEq(subIds(plugin), ["tufte-backlinks", "tufte-sidenotes"], "one instance per enabled module");
  eq(plugin._children.length, plugin.loadedSubs.length, "no orphan children");
  deepEq(procOwners(env), ["tufte-sidenotes"], "processors match enabled modules");
  eq(r.domListeners.length, 2, "only sidenotes' two document listeners remain");
  eq(r.editorExtensions.length, 0, "inline's editor extension gone");
  eq(plugin.settingSections.length, 0, "figures settings section gone");
  const persisted = JSON.parse(env.adapter.__text(SUITE_DATA)).__modules;
  eq(persisted.figures, false, "figures=false persisted");
  eq(persisted.inline, false, "inline=false persisted");

  // ---- phase 2: both re-enabled concurrently (API path) ----
  await Promise.all([
    plugin.setModuleEnabled("figures", true),
    plugin.setModuleEnabled("inline", true)
  ]);
  await env.settle();

  deepEq(
    subIds(plugin),
    ["tufte-backlinks", "tufte-figures", "tufte-inline", "tufte-sidenotes"],
    "canonical order restored, one instance each"
  );
  deepEq(
    procOwners(env),
    ["tufte-figures", "tufte-inline", "tufte-sidenotes"],
    "canonical processor order restored"
  );
  eq(r.commands.size, 11, "all commands back exactly once");
  eq(r.editorExtensions.length, 1, "exactly one editor extension");
  eq(plugin.settingSections.length, 1, "exactly one figures settings section");
  eq(r.domListeners.length, 6, "document listener count back to baseline");

  // ---- phase 3: same module flipped off+on with no gap ----
  await Promise.all([
    plugin.setModuleEnabled("figures", false),
    plugin.setModuleEnabled("figures", true)
  ]);
  await env.settle();

  deepEq(
    subIds(plugin),
    ["tufte-backlinks", "tufte-figures", "tufte-inline", "tufte-sidenotes"],
    "rapid off/on of one module lands enabled, single instance"
  );
  eq(r.commands.size, 11, "command count stable after rapid flip");
  eq(
    JSON.parse(env.adapter.__text(SUITE_DATA)).__modules.figures,
    true,
    "last write wins in __modules"
  );
  ok(
    plugin._children.length === plugin.loadedSubs.length,
    "children and loadedSubs agree after all races"
  );

  return "concurrent toggles serialize; no duplicate instances";
};
