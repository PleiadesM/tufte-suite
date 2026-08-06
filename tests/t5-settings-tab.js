"use strict";

// The suite's single settings tab must offer the four module toggles and must
// render the figures section exactly as the standalone FigureSettingTab does.

const { loadSuite, loadOriginal, assert } = require("./harness");
const { ok, eq, deepEq, htmlEq } = assert;

const MODULE_NAMES = ["Tufte Backlinks", "Tufte Figures", "Tufte Inline", "Tufte Sidenotes"];
const FIG_DATA = ".obsidian/plugins/tufte-figures/data.json";
const SUITE_DATA = ".obsidian/plugins/tufte-suite/data.json";

// Map a rendered .setting-item element back to the Setting object that built it.
function settingFor(env, el) {
  return env.registries.settings.find((s) => s.settingEl === el) || null;
}

// Structural descriptor: name, desc, heading flag, control kinds and values.
function describe(env, container) {
  return Array.from(container.querySelectorAll(":scope > .setting-item")).map((el) => {
    const s = settingFor(env, el);
    return {
      name: el.querySelector(".setting-item-name").textContent,
      desc: el.querySelector(".setting-item-description").textContent,
      heading: el.classList.contains("setting-item-heading"),
      controls: s ? s.components.map((c) => ({ kind: c.kind, value: c.getValue() })) : null
    };
  });
}

function figuresSection(containerEl) {
  const bare = Array.from(containerEl.children).filter(
    (c) => c.tagName === "DIV" && c.className === ""
  );
  eq(bare.length, 1, "exactly one bare <div> section wrapper (the figures section)");
  return bare[0];
}

module.exports = async function t5() {
  // ---- env A: the standalone figures settings tab ----
  const a = await loadOriginal("figures");
  eq(a.env.registries.settingTabs.length, 1, "original figures registers one setting tab");
  const tabA = a.env.registries.settingTabs[0];
  tabA.display();
  const descA = describe(a.env, tabA.containerEl);
  ok(descA.length >= 3, "the original figures tab renders at least three settings");

  // ---- env B: the suite tab ----
  const b = await loadSuite();
  eq(b.env.registries.settingTabs.length, 1, "suite registers exactly one setting tab");
  const tabB = b.env.registries.settingTabs[0];
  tabB.containerEl = b.env.document.createElement("div");
  tabB.display();

  const topLevel = describe(b.env, tabB.containerEl);
  const toggles = topLevel.filter(
    (s) => !s.heading && s.controls && s.controls.some((c) => c.kind === "toggle")
  );
  deepEq(
    toggles.map((t) => t.name),
    MODULE_NAMES,
    "the four module toggles, in canonical order"
  );
  for (const t of toggles) {
    eq(t.controls.length, 1, t.name + ": exactly one toggle control");
    eq(t.controls[0].value, true, t.name + ": module enabled by default");
    ok(t.desc.length > 0, t.name + ": toggle carries a description");
  }

  // ---- the figures section must match the original, structurally and byte-wise
  const section = figuresSection(tabB.containerEl);
  const descB = describe(b.env, section);
  deepEq(descB, descA, "figures section setting sequence must match the original tab");
  htmlEq(
    section.outerHTML,
    tabA.containerEl.outerHTML,
    "figures section subtree must be byte-equal to the original tab's containerEl"
  );

  // ---- flipping a figures control writes through the suite, not the original
  const prefixEl = Array.from(section.querySelectorAll(":scope > .setting-item")).find(
    (el) => el.querySelector(".setting-item-name").textContent === "Figure label prefix"
  );
  ok(prefixEl, "the 'Figure label prefix' setting must be present in the suite tab");
  const prefixSetting = settingFor(b.env, prefixEl);
  ok(prefixSetting && prefixSetting.components.length === 1, "prefix setting has one control");

  const writesBefore = b.env.adapter.__writeLog.length;
  await prefixSetting.components[0].fireChange("X.");
  await b.env.settle();

  const persisted = JSON.parse(b.env.adapter.__text(SUITE_DATA));
  eq(persisted.figures.labelPrefix, "X.", "suite data.json .figures.labelPrefix updated");

  const figuresSub = b.plugin.loadedSubs.find((s) => s.manifest.id === "tufte-figures");
  eq(figuresSub.settings.labelPrefix, "X.", "the figures sub-instance holds the new value");

  const newWrites = b.env.adapter.__writeLog.slice(writesBefore);
  ok(newWrites.length > 0, "the change must actually have been persisted somewhere");
  deepEq(
    newWrites.filter((w) => w.path.startsWith(".obsidian/plugins/tufte-figures/")),
    [],
    "no write may land in the standalone figures plugin directory"
  );
  eq(b.env.adapter.__has(FIG_DATA), false, "the standalone figures data.json is never created");

  return descA.length + " figures settings matched";
};
