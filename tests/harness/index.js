"use strict";

const { makeEnv } = require("./env");
const load = require("./load");
const assert = require("./assert");
const fixtures = require("./fixtures");

// Read from the shipped manifest.json (via load.js) so a version bump never
// leaves the harness testing a stale number.
const SUITE_MANIFEST = load.MANIFESTS.suite;

// Load the suite into a fresh env and return {env, plugin}.
async function loadSuite(opts = {}) {
  const env = makeEnv(opts);
  if (typeof opts.seed === "function") opts.seed(env);
  const Cls = load.loadPluginClass("suite", env);
  const plugin = new Cls(env.app, Object.assign({}, SUITE_MANIFEST));
  await load.loadComponent(plugin);
  await env.settle();
  return { env, plugin, Cls };
}

// Load one original standalone plugin into a fresh env.
async function loadOriginal(key, opts = {}) {
  const env = makeEnv(opts);
  if (typeof opts.seed === "function") opts.seed(env);
  const plugin = await load.instantiateAndLoad(key, env);
  await env.settle();
  return { env, plugin };
}

module.exports = {
  makeEnv,
  load,
  assert,
  fixtures,
  loadSuite,
  loadOriginal,
  SUITE_MANIFEST
};
