"use strict";

// Unloading the master plugin must unwind every registration made by every
// module, and must restore the DOM that tufte-backlinks took over.

const { loadSuite, assert } = require("./harness");
const { ok, eq, deepEq } = assert;

const RAW = "A line with Target in it.";

const PANE_HTML =
  '<div class="workspace-leaf-content" data-type="backlink">' +
  '<div class="backlink-pane">' +
  '<div class="tree-item">' +
  '<div class="search-result-file-title"><div class="tree-item-inner">Some Note</div></div>' +
  '<div class="search-result-file-matches">' +
  '<div class="search-result-file-match">' +
  '<div class="search-result-hover-button mod-top"></div>' +
  "<span>A line with </span>" +
  '<span class="search-result-file-matched-text">Target</span>' +
  "<span> in it.</span>" +
  '<div class="search-result-hover-button mod-bottom"></div>' +
  "</div></div></div></div></div>";

function seed(env) {
  env.document.body.innerHTML = PANE_HTML;
  const container = env.document.querySelector('.workspace-leaf-content[data-type="backlink"]');
  env.fixtures.leaves.set("backlink", [{ view: { containerEl: container, file: null } }]);
  env.fixtures.leaves.set("markdown", []);
  env.fixtures.links.set("Some Note", "Some Note.md");
  env.fixtures.files.add("Some Note.md");
}

function matchEl(env) {
  return env.document.querySelector(".search-result-file-match");
}

function chromeClasses(el) {
  return Array.from(el.children)
    .filter((c) => c.classList.contains("search-result-hover-button"))
    .map((c) => c.className);
}

module.exports = async function t7() {
  const { env, plugin } = await loadSuite({ seed });
  const r = env.registries;

  // ---- induce backlinks processing deterministically ----
  env.app.workspace.trigger("layout-change");
  await env.settle();

  const el = matchEl(env);
  ok(el, "the seeded backlink match element must still exist");

  const took = el.dataset.tufteBacklinks;
  const rendered = el.querySelector(":scope > .tufte-backlinks-rendered");
  ok(took && took !== "error", "backlinks marked the match (data-tufte-backlinks=" + took + ")");
  ok(rendered, "backlinks swapped in its rendered wrapper");
  eq(el.dataset.tufteBacklinksRaw, RAW, "the raw snippet was stashed verbatim");
  ok(
    rendered.querySelector(".search-result-file-matched-text"),
    "the native highlight was re-applied inside the rendered wrapper"
  );
  deepEq(
    chromeClasses(el),
    ["search-result-hover-button mod-top", "search-result-hover-button mod-bottom"],
    "Obsidian's chrome survived the swap"
  );

  // Baselines that must be non-zero, so the post-unload assertions mean something.
  ok(r.markdownPostProcessors.length === 3, "3 processors before unload");
  ok(r.commands.size === 11, "11 commands before unload");
  ok(r.domListeners.length === 6, "6 dom listeners before unload");
  ok(r.settingTabs.length === 1, "1 setting tab before unload");
  ok(r.editorExtensions.length === 1, "1 editor extension before unload");
  ok(
    env.document.body.classList.contains("tufte-sidenotes-enabled"),
    "body carries tufte-sidenotes-enabled before unload"
  );
  ok(
    env.document.body.classList.contains("tufte-figures-enabled"),
    "body carries tufte-figures-enabled before unload"
  );

  // ---- unload ----
  plugin.unload();
  await env.settle();

  eq(r.markdownPostProcessors.length, 0, "markdown post-processors cleared");
  eq(r.editorExtensions.length, 0, "editor extensions cleared");
  eq(r.commands.size, 0, "commands cleared");
  eq(r.settingTabs.length, 0, "setting tabs cleared");
  eq(r.domListeners.length, 0, "dom listeners removed");
  eq(r.intervals.length, 0, "intervals cleared");
  eq(r.workspaceEvents.length, 0, "workspace subscriptions unsubscribed");

  eq(
    env.document.body.classList.contains("tufte-sidenotes-enabled"),
    false,
    "body.tufte-sidenotes-enabled removed"
  );
  eq(
    env.document.body.classList.contains("tufte-figures-enabled"),
    false,
    "body.tufte-figures-enabled removed"
  );

  // ---- backlinks DOM restore ----
  const after = matchEl(env);
  ok(after, "the match element still exists after unload");
  eq(after.dataset.tufteBacklinks, undefined, "data-tufte-backlinks removed");
  eq(after.dataset.tufteBacklinksRaw, undefined, "data-tufte-backlinks-raw removed");
  eq(
    after.querySelector(":scope > .tufte-backlinks-rendered"),
    null,
    "the rendered wrapper is gone"
  );
  eq(after.textContent, RAW, "the raw snippet text is back in place");
  deepEq(
    chromeClasses(after),
    ["search-result-hover-button mod-top", "search-result-hover-button mod-bottom"],
    "Obsidian's chrome survived the restore"
  );

  // Further mutations must not resurrect anything.
  env.document.body.appendChild(env.document.createElement("div"));
  await env.settle();
  eq(matchEl(env).dataset.tufteBacklinks, undefined, "no re-processing after unload");

  return "backlinks DOM restored, all registries empty";
};
