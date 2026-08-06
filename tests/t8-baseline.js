"use strict";

// Every ORIGINAL plugin must load and onload cleanly in the harness, under
// both addChild autoload semantics. This detects stub gaps independently of
// anything the suite does.

const fs = require("fs");
const { loadOriginal, load, assert } = require("./harness");
const { ok, eq, deepEq } = assert;

// Source provenance: the suite must embed each original byte-verbatim, with
// exactly the one documented figures patch.
const EXPECTED_PATCHES = {
  "tufte-backlinks": [],
  "tufte-figures": [
    [
      "  return `${app.vault.configDir}/plugins/tufte-figures/quilts/${id}`;",
      "  return `${app.vault.configDir}/plugins/tufte-suite/quilts/${id}`;"
    ]
  ],
  "tufte-inline": [],
  "tufte-sidenotes": []
};

function checkEmbedding() {
  const suite = fs.readFileSync(load.PLUGIN_PATHS.suite, "utf8");
  for (const key of ["backlinks", "figures", "inline", "sidenotes"]) {
    const id = load.MANIFESTS[key].id;
    const begin = suite.indexOf("/*<<<TUFTE-SUITE:BEGIN " + id + "/main.js");
    ok(begin >= 0, id + ": BEGIN marker present in the suite");
    const bodyStart = suite.indexOf("\n", begin) + 1;
    const end = suite.indexOf("/*<<<TUFTE-SUITE:END " + id + "/main.js", bodyStart);
    ok(end > bodyStart, id + ": END marker present in the suite");

    const embedded = suite.slice(bodyStart, end).split("\n");
    const original = fs.readFileSync(load.PLUGIN_PATHS[key], "utf8").split("\n");
    eq(embedded.length, original.length, id + ": embedded line count matches the original");

    const patches = [];
    for (let i = 0; i < original.length; i++) {
      if (original[i] !== embedded[i]) patches.push([original[i], embedded[i]]);
    }
    deepEq(patches, EXPECTED_PATCHES[id], id + ": only the documented patch may differ");
  }
}

const EXPECT = {
  backlinks: { processors: 0, extensions: 0, commands: 0, domListeners: 0, wsEvents: 3 },
  figures: { processors: 1, extensions: 0, commands: 5, domListeners: 4, wsEvents: 4 },
  inline: { processors: 1, extensions: 1, commands: 3, domListeners: 0, wsEvents: 0 },
  sidenotes: { processors: 1, extensions: 0, commands: 3, domListeners: 2, wsEvents: 3 }
};

module.exports = async function t8() {
  checkEmbedding();
  const notes = ["sources embedded verbatim (+1 documented patch)"];
  for (const autoload of [true, false]) {
    for (const key of Object.keys(EXPECT)) {
      const label = key + " (addChildAutoloads=" + autoload + ")";
      const { env, plugin } = await loadOriginal(key, { addChildAutoloads: autoload });
      const r = env.registries;
      ok(plugin && plugin._loaded, label + ": plugin must report loaded");
      eq(r.markdownPostProcessors.length, EXPECT[key].processors, label + ": processors");
      eq(r.editorExtensions.length, EXPECT[key].extensions, label + ": editor extensions");
      eq(r.commands.size, EXPECT[key].commands, label + ": commands");
      eq(r.domListeners.length, EXPECT[key].domListeners, label + ": dom listeners");
      eq(r.workspaceEvents.length, EXPECT[key].wsEvents, label + ": workspace events");
      // Nothing should have written to the vault just by loading.
      eq(env.adapter.__writeLog.length, 0, label + ": load must not write to the vault");

      // A clean unload must not throw either.
      plugin.unload();
      await env.settle();
      eq(r.commands.size, 0, label + ": commands cleared on unload");
      eq(r.domListeners.length, 0, label + ": dom listeners cleared on unload");
    }
    notes.push("autoload=" + autoload + " ok");
  }
  return notes.join(", ");
};
