"use strict";

// Toggling a module off and back on must fully unwind and then re-register in
// the canonical order, and must persist the module map.

const { loadSuite, assert } = require("./harness");
const { ok, eq, deepEq } = assert;

const SUITE_DATA = ".obsidian/plugins/tufte-suite/data.json";
const FIG_COMMANDS = [
  "tufte-figures:insert-figure",
  "tufte-figures:edit-figure",
  "tufte-figures:insert-image-quilt",
  "tufte-figures:insert-figure-reference",
  "tufte-figures:renumber-figures"
];

function procOwners(env) {
  return env.registries.markdownPostProcessors.map((p) => p.pluginId);
}

module.exports = async function t6() {
  const { env, plugin } = await loadSuite();
  const r = env.registries;

  deepEq(
    procOwners(env),
    ["tufte-figures", "tufte-inline", "tufte-sidenotes"],
    "baseline processor order"
  );
  eq(r.commands.size, 11, "baseline command count");
  eq(plugin.settingSections.length, 1, "baseline settings sections");

  // ---- off ----
  await plugin.setModuleEnabled("figures", false);
  await env.settle();

  eq(r.markdownPostProcessors.length, 2, "figures off: two processors remain");
  deepEq(procOwners(env), ["tufte-inline", "tufte-sidenotes"], "figures off: remaining owners");
  for (const id of FIG_COMMANDS) {
    eq(r.commands.has(id), false, "figures off: command " + id + " must be gone");
  }
  eq(r.commands.size, 6, "figures off: six commands remain");
  eq(plugin.settingSections.length, 0, "figures off: no captured settings sections");
  eq(r.editorExtensions.length, 1, "figures off: inline's editor extension survives");
  deepEq(
    plugin.loadedSubs.map((s) => s.manifest.id),
    ["tufte-backlinks", "tufte-inline", "tufte-sidenotes"],
    "figures off: loadedSubs"
  );

  let persisted = JSON.parse(env.adapter.__text(SUITE_DATA));
  eq(persisted.__modules.figures, false, "figures off: persisted __modules.figures === false");

  // ---- back on ----
  await plugin.setModuleEnabled("figures", true);
  await env.settle();

  eq(r.markdownPostProcessors.length, 3, "figures on: three processors");
  deepEq(
    procOwners(env),
    ["tufte-figures", "tufte-inline", "tufte-sidenotes"],
    "figures on: registration order is re-canonicalised (figures first)"
  );
  eq(r.commands.size, 11, "figures on: eleven commands");
  for (const id of FIG_COMMANDS) {
    ok(r.commands.has(id), "figures on: command " + id + " is back");
  }
  eq(plugin.settingSections.length, 1, "figures on: settings section restored");
  eq(r.settingTabs.length, 1, "figures on: still exactly one setting tab");
  eq(r.editorExtensions.length, 1, "figures on: one editor extension");
  deepEq(
    plugin.loadedSubs.map((s) => s.manifest.id),
    ["tufte-backlinks", "tufte-figures", "tufte-inline", "tufte-sidenotes"],
    "figures on: loadedSubs back in canonical order"
  );

  persisted = JSON.parse(env.adapter.__text(SUITE_DATA));
  eq(persisted.__modules.figures, true, "figures on: persisted __modules.figures === true");

  // No leaked DOM listeners from the off/on cycle.
  eq(r.domListeners.length, 6, "dom listener count is back to the baseline six");
  deepEq(
    r.workspaceEvents.map((e) => e.name).length,
    10,
    "workspace subscription count is back to the baseline ten"
  );

  return "off/on cycle clean";
};
