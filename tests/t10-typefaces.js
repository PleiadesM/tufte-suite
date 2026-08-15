"use strict";

// The suite-level "Typefaces (Tufte theme)" section: a Latin/Chinese
// in-page tab bar over eight settings — Latin serif/sans faces and
// weights, and the two Chinese companions, each with a face and a FIXED
// Chinese weight (implemented as a synthesized @font-face remap family
// injected in a suite-owned <style>). Everything drives the Tufte
// theme's --tufte-* knobs as inline body styles, persisted under the
// reserved __typefaces key, removed again at "Theme default" and on
// plugin unload. The "Other…" picker lists system fonts — filtered to
// Chinese-capable families for the Chinese knobs. (jsdom has no
// FontFace, so the Chinese filter exercises its name-heuristic path
// here; the blank-font probe is validated in the Chrome harness.)

const { loadSuite, assert } = require("./harness");
const { ok, eq, deepEq } = assert;

const SUITE_DATA = ".obsidian/plugins/tufte-suite/data.json";
const PROPS = [
  "--tufte-serif-latin",
  "--tufte-serif-weight",
  "--tufte-sans-latin",
  "--tufte-sans-weight",
  "--tufte-cjk-serif",
  "--tufte-cjk-sans"
];
const STYLE_ID = "tufte-suite-cjk-weights";

function pane(container) {
  return container.querySelector(".tufte-suite-typeface-content");
}
// Dropdown-bearing setting rows inside the typeface pane (the active tab).
function typefaceSettings(env, container) {
  const p = pane(container);
  if (!p) return [];
  return Array.from(p.querySelectorAll(":scope > .setting-item"))
    .map((el) => env.registries.settings.find((s) => s.settingEl === el))
    .filter((s) => s && s.components.some((c) => c.kind === "dropdown"));
}
function paneSettings(env, container) {
  const p = pane(container);
  if (!p) return [];
  return Array.from(p.querySelectorAll(":scope > .setting-item")).map((el) =>
    env.registries.settings.find((s) => s.settingEl === el)
  );
}
function clickTab(container, which) {
  const btns = container.querySelectorAll(".tufte-suite-typeface-tabs button");
  btns[which === "cjk" ? 1 : 0].click();
}
function optionValues(setting) {
  return Array.from(setting.components[0].selectEl.querySelectorAll("option")).map((o) =>
    o.getAttribute("value")
  );
}

module.exports = async function t10() {
  // ---- defaults: no inline knob styles; Latin tab renders first ----
  const a = await loadSuite();
  for (const p of PROPS) {
    eq(a.env.document.body.style.getPropertyValue(p), "", p + " unset by default");
  }
  eq(a.env.document.getElementById(STYLE_ID), null, "no synthesized CJK weight css by default");

  const tab = a.env.registries.settingTabs[0];
  tab.containerEl = a.env.document.createElement("div");
  tab.display();

  const bar = tab.containerEl.querySelector(".tufte-suite-typeface-tabs");
  ok(bar, "the Latin/Chinese tab bar renders");
  eq(bar.querySelectorAll("button").length, 2, "two tabs");
  ok(bar.querySelectorAll("button")[0].classList.contains("is-active"), "Latin tab active by default");

  let dds = typefaceSettings(a.env, tab.containerEl);
  eq(dds.length, 4, "Latin tab: four dropdowns");
  deepEq(
    dds.map((s) => s.name),
    [
      "Serif — reading face",
      "Serif — reading weight",
      "Sans — data & interface face",
      "Sans — data & interface weight"
    ],
    "Latin rows in series order"
  );
  eq(optionValues(dds[0]).length, 8, "serif faces: default + 6 + Other");
  eq(optionValues(dds[1]).length, 10, "serif weights: default + 9");
  eq(optionValues(dds[2]).length, 6, "sans faces: default + 4 + Other");
  eq(optionValues(dds[3]).length, 10, "sans weights: default + 9");
  const sansValues = optionValues(dds[2]);
  ok(sansValues.some((v) => v && v.indexOf("Cabin, ") === 0), "Cabin is offered as the bundled face");
  ok(!sansValues.some((v) => v && v.indexOf("Johnston") !== -1), "no Johnston option remains");
  ok(!sansValues.some((v) => v && v.indexOf("Gill Sans Nova") === 1), "no Gill Sans Nova option remains");

  // ---- the Chinese tab: two faces, each with its fixed-weight row ----
  clickTab(tab.containerEl, "cjk");
  ok(
    tab.containerEl.querySelectorAll(".tufte-suite-typeface-tabs button")[1].classList.contains("is-active"),
    "Chinese tab activates on click"
  );
  let cjk = typefaceSettings(a.env, tab.containerEl);
  eq(cjk.length, 4, "Chinese tab: two faces + two weights");
  deepEq(
    cjk.map((s) => s.name),
    [
      "Chinese — serif companion (宋体)",
      "Chinese serif — weight (宋体字重)",
      "Chinese — sans companion (黑体)",
      "Chinese sans — weight (黑体字重)"
    ],
    "Chinese rows in series order"
  );
  eq(optionValues(cjk[0]).length, 4, "Chinese serifs: default + 2 + Other");
  eq(optionValues(cjk[1]).length, 10, "Chinese serif weights: follow-Latin + 9");
  eq(optionValues(cjk[2]).length, 3, "Chinese sans: default + 1 + Other");
  eq(optionValues(cjk[3]).length, 10, "Chinese sans weights: follow-Latin + 9");
  ok(
    optionValues(cjk[0]).some((v) => v && v.indexOf('"Source Han Serif SC"') === 0 && v.indexOf('"Songti SC"') !== -1),
    "Source Han Serif preset keeps the system chain behind it"
  );
  ok(
    optionValues(cjk[2]).some((v) => v && v.indexOf('"Source Han Sans SC"') === 0 && v.indexOf('"PingFang SC"') !== -1),
    "Source Han Sans preset keeps the system chain behind it"
  );

  // A Chinese face preset applies to its own knob and nothing else.
  const sourceHanSans = optionValues(cjk[2]).find((v) => v && v.indexOf('"Source Han Sans SC"') === 0);
  await cjk[2].components[0].fireChange(sourceHanSans);
  await a.env.settle();
  eq(a.env.document.body.style.getPropertyValue("--tufte-cjk-sans"), sourceHanSans, "Chinese sans preset applied");
  eq(a.env.document.body.style.getPropertyValue("--tufte-sans-latin"), "", "the Latin sans knob is untouched");
  cjk = typefaceSettings(a.env, tab.containerEl); // face onChange re-rendered the tab
  await cjk[2].components[0].fireChange("");
  await a.env.settle();
  eq(a.env.document.body.style.getPropertyValue("--tufte-cjk-sans"), "", "Chinese sans back to theme default");

  // ---- the FIXED Chinese weight: synthesized remap family + style el ----
  cjk = typefaceSettings(a.env, tab.containerEl);
  await cjk[3].components[0].fireChange("600");
  await a.env.settle();
  const fronted = a.env.document.body.style.getPropertyValue("--tufte-cjk-sans");
  ok(fronted.indexOf('"Tufte CJK Sans", ') === 0, "the synthesized family fronts the sans knob");
  ok(fronted.indexOf('"PingFang SC"') !== -1, "…over the theme's default chain");
  const styleEl = a.env.document.getElementById(STYLE_ID);
  ok(styleEl, "the suite injects its CJK weight style element");
  ok(styleEl.textContent.indexOf('font-family: "Tufte CJK Sans"') !== -1, "…declaring the synthesized family");
  ok(styleEl.textContent.indexOf("font-weight: 100 500") !== -1, "…with a base range");
  ok(styleEl.textContent.indexOf("font-weight: 600 900") !== -1, "…and a bold range");
  ok(styleEl.textContent.indexOf('local("PingFang SC Semibold")') !== -1, "…mapped to the named 600 cut");
  const persistedW = JSON.parse(a.env.adapter.__text(SUITE_DATA));
  eq(persistedW.__typefaces.cjkSansWeight, "600", "Chinese weight persisted");

  // Weight + non-default face compose: Source Han Serif at 700.
  cjk = typefaceSettings(a.env, tab.containerEl);
  const sourceHanSerif = optionValues(cjk[0]).find((v) => v && v.indexOf('"Source Han Serif SC"') === 0);
  await cjk[0].components[0].fireChange(sourceHanSerif);
  await a.env.settle();
  cjk = typefaceSettings(a.env, tab.containerEl);
  await cjk[1].components[0].fireChange("700");
  await a.env.settle();
  const serifFronted = a.env.document.body.style.getPropertyValue("--tufte-cjk-serif");
  ok(serifFronted.indexOf('"Tufte CJK Serif", "Source Han Serif SC", ') === 0, "serif knob fronted over the chosen preset");
  const styleTxt = a.env.document.getElementById(STYLE_ID).textContent;
  ok(styleTxt.indexOf('local("Source Han Serif SC Bold")') !== -1, "serif base range maps to the named 700 cut");
  ok(styleTxt.indexOf('local("Source Han Serif SC Heavy")') !== -1, "serif bold range maps to the named 900 cut");
  ok(styleTxt.indexOf('font-family: "Tufte CJK Sans"') !== -1, "both series coexist in the style element");

  // Back to follow-Latin: style pruned, props return to plain values.
  cjk = typefaceSettings(a.env, tab.containerEl);
  await cjk[1].components[0].fireChange("");
  await cjk[3].components[0].fireChange("");
  await a.env.settle();
  eq(a.env.document.getElementById(STYLE_ID), null, "style element removed when no fixed weights remain");
  eq(a.env.document.body.style.getPropertyValue("--tufte-cjk-serif"), sourceHanSerif, "serif knob back to the plain preset stack");
  cjk = typefaceSettings(a.env, tab.containerEl);
  await cjk[0].components[0].fireChange("");
  await a.env.settle();

  // ---- Latin flows (Cabin preset; persistence; pruning) ----
  clickTab(tab.containerEl, "latin");
  dds = typefaceSettings(a.env, tab.containerEl);
  const sansFace = dds[2].components[0];
  const cabin = optionValues(dds[2]).find((v) => v && v.indexOf("Cabin, ") === 0);
  await sansFace.fireChange(cabin);
  await a.env.settle();
  eq(a.env.document.body.style.getPropertyValue("--tufte-sans-latin"), cabin, "sans face applied as an inline body style");

  clickTab(tab.containerEl, "latin");
  dds = typefaceSettings(a.env, tab.containerEl);
  await dds[3].components[0].fireChange("600");
  await a.env.settle();
  eq(a.env.document.body.style.getPropertyValue("--tufte-sans-weight"), "600", "sans weight applied");

  const persisted = JSON.parse(a.env.adapter.__text(SUITE_DATA));
  eq(persisted.__typefaces.sansFace, cabin, "sans face persisted");
  eq(persisted.__typefaces.sansWeight, "600", "sans weight persisted");
  ok(!("serifFace" in persisted.__typefaces), "untouched knobs are not persisted");
  ok("__modules" in persisted, "__modules remains beside __typefaces");

  dds = typefaceSettings(a.env, tab.containerEl);
  await dds[3].components[0].fireChange("");
  await dds[2].components[0].fireChange("");
  await a.env.settle();
  const persisted3 = JSON.parse(a.env.adapter.__text(SUITE_DATA));
  ok(!("__typefaces" in persisted3), "an all-default section is pruned from data.json");
  eq(a.env.document.body.style.getPropertyValue("--tufte-sans-latin"), "", "face knob removed too");

  // ---- "Other…": custom family composes over the default chain ----
  clickTab(tab.containerEl, "latin");
  dds = typefaceSettings(a.env, tab.containerEl);
  await dds[2].components[0].fireChange("__custom__");
  await a.env.settle();
  ok(
    !paneSettings(a.env, tab.containerEl).some((s) => s && s.name === "Serif — your own font"),
    "no serif custom row while only the sans is set to Other"
  );
  const customRow = paneSettings(a.env, tab.containerEl).find((s) => s && s.name === "Sans — your own font");
  ok(customRow, "the 'Sans — your own font' row appears while Other is active");
  eq(customRow.components[0].kind, "text", "…as a typed-name field where fonts cannot be enumerated");
  eq(a.env.document.body.style.getPropertyValue("--tufte-sans-latin"), "", "an empty custom name applies nothing yet");

  await customRow.components[0].fireChange("Verlag");
  await a.env.settle();
  const applied = a.env.document.body.style.getPropertyValue("--tufte-sans-latin");
  ok(applied.indexOf("Verlag, ") === 0, "the custom family leads the applied stack");
  ok(applied.indexOf('"Gill Sans"') !== -1, "the theme's default chain rides behind it");
  const persisted4 = JSON.parse(a.env.adapter.__text(SUITE_DATA));
  eq(persisted4.__typefaces.sansFace, "__custom__", "custom sentinel persisted");
  eq(persisted4.__typefaces.sansFaceCustom, "Verlag", "custom family persisted");

  dds = typefaceSettings(a.env, tab.containerEl);
  await dds[2].components[0].fireChange("");
  await a.env.settle();
  eq(a.env.document.body.style.getPropertyValue("--tufte-sans-latin"), "", "back to theme default");
  const persisted5 = JSON.parse(a.env.adapter.__text(SUITE_DATA));
  ok(!("__typefaces" in persisted5), "leaving Other clears the custom name and prunes the section");
  ok(
    !paneSettings(a.env, tab.containerEl).some((s) => s && s.name === "Sans — your own font"),
    "the custom row disappears when Other is left"
  );

  // ---- saved values re-apply on a fresh load; unload removes them ----
  const seeded = await loadSuite({
    seed: (env) =>
      env.adapter.__seed(
        SUITE_DATA,
        JSON.stringify({
          __modules: {},
          __typefaces: {
            serifWeight: "500",
            sansFace: "__custom__",
            sansFaceCustom: "Optima Nova",
            cjkSansWeight: "600"
          }
        })
      )
  });
  eq(seeded.env.document.body.style.getPropertyValue("--tufte-serif-weight"), "500", "saved knob re-applied at load");
  ok(
    seeded.env.document.body.style.getPropertyValue("--tufte-sans-latin").indexOf("Optima Nova, ") === 0,
    "saved custom face recomposed at load"
  );
  ok(
    seeded.env.document.body.style.getPropertyValue("--tufte-cjk-sans").indexOf('"Tufte CJK Sans", ') === 0,
    "saved Chinese weight re-fronted at load"
  );
  ok(seeded.env.document.getElementById(STYLE_ID), "…with its style element re-injected");
  seeded.plugin.unload();
  await seeded.env.settle();
  for (const p of PROPS) {
    eq(seeded.env.document.body.style.getPropertyValue(p), "", p + " removed on unload");
  }
  eq(seeded.env.document.getElementById(STYLE_ID), null, "CJK weight style element removed on unload");

  // ---- "Other…" on an enumerable system: a picker of installed fonts ----
  const listed = await loadSuite({
    seed: (env) => {
      env.window.queryLocalFonts = async () => [
        { family: "Optima" },
        { family: "Avenir Next" },
        { family: "Avenir Next" },
        { family: "Gill Sans" },
        { family: "Songti SC" },
        { family: "LXGW WenKai" }
      ];
    }
  });
  const tab2 = listed.env.registries.settingTabs[0];
  tab2.containerEl = listed.env.document.createElement("div");
  tab2.display();
  const dds3 = typefaceSettings(listed.env, tab2.containerEl);
  await dds3[0].components[0].fireChange("__custom__"); // the serif side this time
  await listed.env.settle();
  const pick = paneSettings(listed.env, tab2.containerEl).find((s) => s && s.name === "Serif — your own font");
  ok(pick, "the serif companion row appears");
  eq(pick.components[0].kind, "dropdown", "…as a PICKER when the system list is readable");
  deepEq(
    optionValues(pick),
    ["", "Avenir Next", "Gill Sans", "LXGW WenKai", "Optima", "Songti SC"],
    "the Latin picker lists EVERY family, deduplicated and sorted"
  );
  await pick.components[0].fireChange("Avenir Next");
  await listed.env.settle();
  ok(
    listed.env.document.body.style.getPropertyValue("--tufte-serif-latin").indexOf("Avenir Next, ") === 0,
    "the picked system family leads the serif stack"
  );
  const persisted6 = JSON.parse(listed.env.adapter.__text(SUITE_DATA));
  eq(persisted6.__typefaces.serifFaceCustom, "Avenir Next", "the picked family persisted");

  // ---- the Chinese knob's picker shows ONLY Chinese-capable families ----
  clickTab(tab2.containerEl, "cjk");
  const cjkSerifRow = typefaceSettings(listed.env, tab2.containerEl)
    .find((s) => s.name === "Chinese — serif companion (宋体)");
  ok(cjkSerifRow, "the Chinese serif dropdown is present");
  await cjkSerifRow.components[0].fireChange("__custom__");
  await listed.env.settle();
  const cjkPick = paneSettings(listed.env, tab2.containerEl).find(
    (s) => s && s.name === "Chinese serif — your own font"
  );
  ok(cjkPick, "the Chinese serif companion row appears");
  eq(cjkPick.components[0].kind, "dropdown", "…as a picker");
  deepEq(optionValues(cjkPick), ["", "LXGW WenKai", "Songti SC"], "only the Chinese-capable families are listed");
  await cjkPick.components[0].fireChange("LXGW WenKai");
  await listed.env.settle();
  const cjkApplied = listed.env.document.body.style.getPropertyValue("--tufte-cjk-serif");
  ok(cjkApplied.indexOf("LXGW WenKai, ") === 0, "the picked Chinese family leads the CJK serif stack");
  ok(cjkApplied.indexOf('"Songti SC"') !== -1, "…with the system chain riding behind it");

  // A picked custom family + fixed weight synthesize from the custom name.
  const cjkWeightRow = typefaceSettings(listed.env, tab2.containerEl)
    .find((s) => s.name === "Chinese serif — weight (宋体字重)");
  await cjkWeightRow.components[0].fireChange("500");
  await listed.env.settle();
  const styleTxt2 = listed.env.document.getElementById(STYLE_ID).textContent;
  ok(styleTxt2.indexOf('local("LXGW WenKai Medium")') !== -1, "custom family's named 500 cut in the base range");
  ok(
    listed.env.document.body.style.getPropertyValue("--tufte-cjk-serif").indexOf('"Tufte CJK Serif", LXGW WenKai, ') === 0,
    "synthesized family fronts the composed custom stack"
  );

  return "tabbed UI; 8 settings; fixed CJK weights via synthesized faces; pickers verified";
};
