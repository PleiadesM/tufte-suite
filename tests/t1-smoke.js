"use strict";

const { loadSuite, loadOriginal, assert } = require("./harness");
const { ok, eq, deepEq } = assert;

const EXPECTED_ORDER = ["backlinks", "figures", "inline", "sidenotes"];
const EXPECTED_IDS = [
  "tufte-backlinks",
  "tufte-figures",
  "tufte-inline",
  "tufte-sidenotes"
];

const EXPECTED_COMMANDS = [
  "tufte-figures:insert-figure",
  "tufte-figures:edit-figure",
  "tufte-figures:insert-image-quilt",
  "tufte-figures:insert-figure-reference",
  "tufte-figures:renumber-figures",
  "tufte-inline:wrap-newthought",
  "tufte-inline:wrap-leadin",
  "tufte-inline:wrap-dropcap",
  "tufte-sidenotes:insert-sidenote",
  "tufte-sidenotes:insert-marginnote",
  "tufte-sidenotes:insert-epigraph"
];

// The golden command names, measured from the ORIGINALS in their own envs.
async function goldenCommandNames() {
  const names = new Map();
  for (const key of ["figures", "inline", "sidenotes"]) {
    const { env } = await loadOriginal(key);
    for (const [id, rec] of env.registries.commands) names.set(id, rec.name);
  }
  return names;
}

async function runVariant(addChildAutoloads, golden) {
  const label = "addChildAutoloads=" + addChildAutoloads;
  const { env, plugin } = await loadSuite({ addChildAutoloads });
  const r = env.registries;

  ok(Array.isArray(plugin.loadedSubs), label + ": plugin.loadedSubs must be an array");
  eq(plugin.loadedSubs.length, 4, label + ": four submodules must load");
  deepEq(
    plugin.loadedSubs.map((s) => s.manifest.id),
    EXPECTED_IDS,
    label + ": submodule load order"
  );
  for (const sub of plugin.loadedSubs) {
    ok(sub._loaded, label + ": submodule " + sub.manifest.id + " must be loaded");
  }

  eq(r.markdownPostProcessors.length, 3, label + ": markdown post-processor count");
  deepEq(
    r.markdownPostProcessors.map((p) => p.pluginId),
    ["tufte-figures", "tufte-inline", "tufte-sidenotes"],
    label + ": post-processor registration order"
  );
  eq(r.editorExtensions.length, 1, label + ": editor extension count");
  eq(r.editorExtensions[0].pluginId, "tufte-inline", label + ": editor extension owner");

  const ids = [...r.commands.keys()].sort();
  deepEq(ids, EXPECTED_COMMANDS.slice().sort(), label + ": exact command id set");
  eq(r.commands.size, 11, label + ": command count");

  for (const id of EXPECTED_COMMANDS) {
    eq(
      r.commands.get(id).name,
      golden.get(id),
      label + ": command display name for " + id + " must match the original"
    );
  }

  eq(r.settingTabs.length, 1, label + ": exactly one setting tab (the suite's own)");
  eq(
    plugin.settingSections.length,
    1,
    label + ": exactly one captured sub-plugin settings section"
  );
  eq(plugin.settingSections[0].def.key, "figures", label + ": that section is figures");

  return { env, plugin };
}

module.exports = async function t1() {
  const golden = await goldenCommandNames();
  // Sanity: the golden map must actually carry the 11 names.
  eq(golden.size, 11, "golden command map size");
  await runVariant(true, golden);
  await runVariant(false, golden);
  deepEq(EXPECTED_ORDER, EXPECTED_ORDER, "module order constant");
};
