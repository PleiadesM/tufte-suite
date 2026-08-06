"use strict";

// The suite's registration ORDER must equal the concatenation of the four
// originals' own registration order, in the canonical load order.

const { loadSuite, loadOriginal, assert } = require("./harness");
const { ok, eq, deepEq } = assert;

const ORDER = ["backlinks", "figures", "inline", "sidenotes"];

function domSeq(env) {
  return env.registries.domListeners.map(
    (l) => l.targetName + ":" + l.type + (l.capture ? ":capture" : ":bubble")
  );
}

function wsSeq(env) {
  return env.registries.workspaceEvents.map((e) => e.name);
}

module.exports = async function t3() {
  const goldenDom = [];
  const goldenWs = [];
  const perModule = {};

  for (const key of ORDER) {
    const { env } = await loadOriginal(key);
    const d = domSeq(env);
    const w = wsSeq(env);
    perModule[key] = { dom: d, ws: w };
    goldenDom.push(...d);
    goldenWs.push(...w);
    for (const l of env.registries.domListeners) {
      eq(l.targetName, "document", key + ": every registerDomEvent target must be document");
    }
  }

  const { env: envB } = await loadSuite();
  deepEq(domSeq(envB), goldenDom, "suite DOM listener registration sequence");
  deepEq(wsSeq(envB), goldenWs, "suite workspace event registration sequence");

  // Guard against a vacuous pass.
  ok(goldenDom.length >= 6, "expected at least 6 document listeners across the originals");
  ok(goldenWs.length >= 10, "expected at least 10 workspace event subscriptions");

  return (
    goldenDom.length + " dom listeners, " + goldenWs.length + " workspace subscriptions"
  );
};
