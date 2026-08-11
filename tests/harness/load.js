"use strict";

const fs = require("fs");
const path = require("path");

// Location-independent, exactly like build-tufte-suite.js: everything resolves
// from the suite root (two levels up from tests/harness/), so the same harness
// runs in the repo (module sources under src/modules/) and in a dev vault
// (module sources are the suite folder's siblings).
const SUITE_ROOT = path.resolve(__dirname, "..", "..");
const IDS = {
  backlinks: "tufte-backlinks",
  figures: "tufte-figures",
  inline: "tufte-inline",
  sidenotes: "tufte-sidenotes"
};
const MODULE_ROOTS = [
  path.join(SUITE_ROOT, "src", "modules"),
  path.join(SUITE_ROOT, "..")
];
const MODULE_ROOT = MODULE_ROOTS.find((dir) =>
  Object.values(IDS).every((id) => fs.existsSync(path.join(dir, id, "main.js")))
);
if (!MODULE_ROOT) {
  throw new Error(
    "harness: could not find the four module sources under any of:\n  " +
      MODULE_ROOTS.join("\n  ")
  );
}

const PLUGIN_PATHS = { suite: path.join(SUITE_ROOT, "main.js") };
for (const [key, id] of Object.entries(IDS)) {
  PLUGIN_PATHS[key] = path.join(MODULE_ROOT, id, "main.js");
}

// Manifests are READ from disk rather than hardcoded, so a version bump can
// never leave the harness asserting against stale numbers.
function readManifest(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
const MANIFESTS = { suite: readManifest(path.join(SUITE_ROOT, "manifest.json")) };
for (const [key, id] of Object.entries(IDS)) {
  MANIFESTS[key] = readManifest(path.join(MODULE_ROOT, id, "manifest.json"));
}

// A plugin's runtime `dir` is always its vault-relative install path, whatever
// layout the sources were read from.
for (const k of Object.keys(MANIFESTS)) {
  MANIFESTS[k].dir = ".obsidian/plugins/" + MANIFESTS[k].id;
}

const sourceCache = new Map();
function readSource(key) {
  if (!sourceCache.has(key)) {
    sourceCache.set(key, fs.readFileSync(PLUGIN_PATHS[key], "utf8"));
  }
  return sourceCache.get(key);
}

// The single parameter list every plugin source is evaluated with. Identical
// for originals and for the suite — that identity is what makes the golden
// comparisons meaningful.
const PARAMS = [
  "module",
  "exports",
  "require",
  "document",
  "window",
  "requestAnimationFrame",
  "getComputedStyle",
  "MutationObserver",
  "Node",
  "NodeFilter",
  "Image",
  "URL",
  "setTimeout",
  "clearTimeout",
  "navigator",
  "performance",
  "Element",
  "HTMLElement",
  "HTMLImageElement",
  "Blob"
];

function makeFakeRequire(env) {
  const cm = {
    "@codemirror/view": {
      ViewPlugin: { fromClass: (cls, spec) => ({ cls, spec }) },
      Decoration: {
        mark: (s) => ({ mark: s }),
        replace: (s) => ({ replace: s }),
        none: []
      },
      WidgetType: class {}
    },
    "@codemirror/state": {
      RangeSetBuilder: class {
        add() {}
        finish() {
          return [];
        }
      }
    },
    "@codemirror/language": {
      syntaxTree: () => ({ resolveInner: () => null })
    }
  };
  return function fakeRequire(id) {
    if (id === "obsidian") return env.obsidian;
    if (Object.prototype.hasOwnProperty.call(cm, id)) return cm[id];
    throw new Error(
      "Harness fake require(): refusing to resolve " +
        JSON.stringify(id) +
        " — plugin sources may only require 'obsidian' and the CodeMirror stubs."
    );
  };
}

function evaluateSource(src, env, filename) {
  const w = env.window;
  let fn;
  try {
    fn = new Function(...PARAMS, src);
  } catch (e) {
    throw new Error("Failed to compile " + filename + ": " + e.message);
  }
  const module = { exports: {} };
  fn(
    module,
    module.exports,
    makeFakeRequire(env),
    w.document,
    w,
    w.requestAnimationFrame,
    w.getComputedStyle,
    w.MutationObserver,
    w.Node,
    w.NodeFilter,
    w.Image,
    w.URL,
    w.setTimeout,
    w.clearTimeout,
    w.navigator,
    w.performance,
    w.Element,
    w.HTMLElement,
    w.HTMLImageElement,
    w.Blob
  );
  return (module.exports && module.exports.default) || module.exports;
}

function loadPluginClass(key, env) {
  return evaluateSource(readSource(key), env, PLUGIN_PATHS[key]);
}

// Component.load() is synchronous but the plugins' onload() is async; capture
// the promise the same way the suite runtime does so we can await it.
async function loadComponent(component) {
  let result;
  const original = component.onload;
  component.onload = function () {
    result = original.apply(this, arguments);
    return result;
  };
  try {
    component.load();
  } finally {
    component.onload = original;
  }
  if (result && typeof result.then === "function") await result;
  return component;
}

async function instantiateAndLoad(key, env, manifestOverride) {
  const Cls = loadPluginClass(key, env);
  const manifest = Object.assign({}, MANIFESTS[key], manifestOverride || {});
  const plugin = new Cls(env.app, manifest);
  await loadComponent(plugin);
  return plugin;
}

module.exports = {
  SUITE_ROOT,
  MODULE_ROOT,
  PLUGIN_PATHS,
  MANIFESTS,
  PARAMS,
  readSource,
  evaluateSource,
  loadPluginClass,
  loadComponent,
  instantiateAndLoad,
  makeFakeRequire
};
