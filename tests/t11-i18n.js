"use strict";

// Simplified Chinese localization. Every module and the suite runtime carry
// their own TUFTE_ZH table plus a tzh(s) helper that reads
// window.localStorage "language" LAZILY, per call, and falls back to its own
// input. So:
//
//   * with no Chinese language set, every string must be the exact English
//     literal it has always been (t3/t5 guard the byte-level DOM; this group
//     pins the visible text itself), and
//   * with "language" = zh / zh-CN / zh-TW, the same call sites must render
//     the Chinese values — identically whether a module runs standalone or
//     inside the Suite, since the Suite embeds the module verbatim.
//
// jsdom refuses localStorage on an opaque origin (the env's own origin), so
// each case installs a tiny store of its own; the unseeded default therefore
// also exercises tzh()'s try/catch escape hatch.

const { loadSuite, loadOriginal, assert } = require("./harness");
const { ok, eq, deepEq } = assert;

// A seed that installs a minimal localStorage. lang === null → present but
// empty (the "no language chosen" path); omit the seed entirely to leave
// jsdom's throwing accessor in place.
function withLanguage(lang) {
  return (env) => {
    const store = lang === null ? {} : { language: lang };
    Object.defineProperty(env.window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => {
          store[k] = String(v);
        },
        removeItem: (k) => {
          delete store[k];
        }
      }
    });
  };
}

// A fake editor: enough surface for the figures commands used below.
function fakeEditor() {
  return {
    getLine: () => "",
    getCursor: () => ({ line: 0, ch: 0 }),
    getValue: () => "",
    lastLine: () => 0,
    lineCount: () => 1,
    replaceRange() {},
    setCursor() {},
    focus() {}
  };
}

// Run a command by its full id and return its record.
function command(env, fullId) {
  const rec = env.registries.commands.get(fullId);
  ok(rec, fullId + " is registered");
  return rec;
}

// Open the figures modal via the insert-figure command and hand back its
// contentEl (the Setting instances it builds are our way back to the DOM).
function openFigureModal(env) {
  const before = env.registries.settings.length;
  command(env, "tufte-figures:insert-figure").cmd.editorCallback(fakeEditor());
  const built = env.registries.settings.slice(before);
  ok(built.length > 0, "the figure modal built settings rows");
  const modal = built[0].settingEl.closest(".tufte-figure-modal");
  ok(modal, "the modal content element is reachable from its settings");
  return modal;
}

function modalTabLabels(modal) {
  return Array.from(modal.querySelectorAll(".tufte-fig-tabs button")).map(
    (b) => b.textContent
  );
}

// Setting-row names inside a container, in construction order.
function rowNames(container) {
  return Array.from(container.querySelectorAll(".setting-item")).map((el) => {
    const n = el.querySelector(".setting-item-name");
    return n ? n.textContent : "";
  });
}

function renderSuiteTab(ctx) {
  const tab = ctx.env.registries.settingTabs[0];
  tab.containerEl = ctx.env.document.createElement("div");
  tab.display();
  return tab;
}

function typefaceTabLabels(containerEl) {
  return Array.from(
    containerEl.querySelectorAll(".tufte-suite-typeface-tabs button")
  ).map((b) => b.textContent);
}

// The first typeface row's name + its "" (theme-default) option label.
function firstTypefaceRow(env, containerEl) {
  const pane = containerEl.querySelector(".tufte-suite-typeface-content");
  ok(pane, "the typeface pane renders");
  const el = pane.querySelector(":scope > .setting-item");
  const setting = env.registries.settings.find((s) => s.settingEl === el);
  ok(setting, "the first typeface row maps back to its Setting");
  const dd = setting.components.find((c) => c.kind === "dropdown");
  ok(dd, "…and carries a dropdown");
  const first = dd.selectEl.querySelector('option[value=""]');
  return {
    name: el.querySelector(".setting-item-name").textContent,
    desc: el.querySelector(".setting-item-description").textContent,
    defaultLabel: first ? first.textContent : null
  };
}

// The suite's module toggle rows (name + description).
function moduleToggleRows(env, containerEl) {
  return Array.from(containerEl.querySelectorAll(":scope > .setting-item"))
    .map((el) => ({
      el,
      s: env.registries.settings.find((x) => x.settingEl === el)
    }))
    .filter((r) => r.s && r.s.components.some((c) => c.kind === "toggle"))
    .map((r) => ({
      name: r.el.querySelector(".setting-item-name").textContent,
      desc: r.el.querySelector(".setting-item-description").textContent
    }));
}

const EN_MODAL_TABS = ["Basic", "Multiple images", "Image quilt"];
const ZH_MODAL_TABS = ["基础", "多图", "图像拼图"];

module.exports = async function t11() {
  // ======================================================================
  // (a) no language set — everything is the English it has always been
  // ======================================================================
  for (const [label, opts] of [
    ["localStorage unavailable", {}],
    ["localStorage present, no language", { seed: withLanguage(null) }],
    ["language = en", { seed: withLanguage("en") }]
  ]) {
    const en = await loadSuite(opts);
    const tab = renderSuiteTab(en);

    const headings = Array.from(
      tab.containerEl.querySelectorAll(":scope > .setting-item-heading .setting-item-name")
    ).map((el) => el.textContent);
    ok(headings.includes("Bundled plugins"), label + ": 'Bundled plugins' heading in English");
    ok(
      headings.includes("Typefaces (Tufte theme)"),
      label + ": 'Typefaces (Tufte theme)' heading in English"
    );

    deepEq(
      typefaceTabLabels(tab.containerEl),
      ["Latin · 西文", "Chinese · 中文"],
      label + ": the typeface tab bar keeps its bilingual labels"
    );

    const row = firstTypefaceRow(en.env, tab.containerEl);
    eq(row.name, "Serif — reading face", label + ": first typeface row name");
    eq(
      row.defaultLabel,
      "Theme default — et-book, Tufte's Bembo",
      label + ": its theme-default option label"
    );
    ok(
      row.desc.indexOf("Body text, headings, tables, captions.") === 0,
      label + ": its description is the English one"
    );

    const toggles = moduleToggleRows(en.env, tab.containerEl);
    deepEq(
      toggles.map((t) => t.name),
      ["Tufte Backlinks", "Tufte Figures", "Tufte Inline", "Tufte Sidenotes"],
      label + ": module display names"
    );
    eq(
      toggles[3].desc,
      "Sidenotes and marginnotes in Reading view.",
      label + ": the sidenotes blurb is English"
    );

    deepEq(
      modalTabLabels(openFigureModal(en.env)),
      EN_MODAL_TABS,
      label + ": figures modal tab labels in English"
    );

    eq(
      command(en.env, "tufte-sidenotes:insert-sidenote").cmd.name,
      "Insert sidenote at cursor",
      label + ": sidenotes command name in English"
    );
    eq(
      command(en.env, "tufte-figures:insert-image-quilt").cmd.name,
      "Insert image quilt",
      label + ": figures command name in English"
    );
    eq(
      command(en.env, "tufte-inline:wrap-dropcap").cmd.name,
      "Wrap first character in CJK drop cap (@@…@@)",
      label + ": inline command name in English"
    );

    command(en.env, "tufte-figures:renumber-figures").cmd.editorCallback(fakeEditor());
    deepEq(
      en.env.registries.notices.map((n) => n.message),
      ["No figures found to renumber"],
      label + ": the renumber Notice is English"
    );
  }

  // ======================================================================
  // (b) language = zh — the whole surface switches
  // ======================================================================
  const zh = await loadSuite({ seed: withLanguage("zh") });
  const zhTab = renderSuiteTab(zh);

  const zhHeadings = Array.from(
    zhTab.containerEl.querySelectorAll(":scope > .setting-item-heading .setting-item-name")
  ).map((el) => el.textContent);
  ok(zhHeadings.includes("捆绑的插件"), "'Bundled plugins' heading is Chinese");
  ok(zhHeadings.includes("字体（Tufte 主题）"), "'Typefaces' heading is Chinese");

  deepEq(
    typefaceTabLabels(zhTab.containerEl),
    ["西文", "中文"],
    "the typeface tab bar drops the bilingual pairing under Chinese"
  );

  const zhRow = firstTypefaceRow(zh.env, zhTab.containerEl);
  eq(zhRow.name, "衬线 — 正文阅读字体", "first typeface row name is Chinese");
  eq(
    zhRow.defaultLabel,
    "主题默认 — et-book，Tufte 的 Bembo",
    "its theme-default option label is Chinese"
  );
  ok(zhRow.desc.indexOf("正文、标题、表格、图注。") === 0, "its description is Chinese");

  const zhToggles = moduleToggleRows(zh.env, zhTab.containerEl);
  deepEq(
    zhToggles.map((t) => t.name),
    ["Tufte Backlinks", "Tufte Figures", "Tufte Inline", "Tufte Sidenotes"],
    "module display names stay English — they are product names"
  );
  eq(
    zhToggles[3].desc,
    "阅读视图中的旁注与边注。",
    "…but their blurbs are translated"
  );

  // The Chinese typeface tab's rows, and the figures section captured from
  // the sub-plugin's own settings tab, are Chinese too.
  zhTab.containerEl.querySelectorAll(".tufte-suite-typeface-tabs button")[1].click();
  const zhCjkPane = zhTab.containerEl.querySelector(".tufte-suite-typeface-content");
  deepEq(
    rowNames(zhCjkPane),
    ["中文衬线（宋体）", "中文衬线字重（宋体）", "中文无衬线（黑体）", "中文无衬线字重（黑体）"],
    "the Chinese typeface tab's four rows"
  );
  const zhFiguresSection = Array.from(zhTab.containerEl.children).find(
    (c) => c.tagName === "DIV" && c.className === ""
  );
  ok(zhFiguresSection, "the figures settings section is present");
  deepEq(
    rowNames(zhFiguresSection),
    ["拦截图片拖放与粘贴", "图标签前缀", "图像拼图输出文件夹"],
    "the embedded figures settings tab is Chinese"
  );

  const zhModal = openFigureModal(zh.env);
  deepEq(modalTabLabels(zhModal), ZH_MODAL_TABS, "figures modal tab labels are Chinese");
  const zhModalRows = rowNames(zhModal);
  for (const expected of [
    "图片链接",
    "显示方式",
    "图编号",
    "替代文本",
    "图注",
    "尺寸（像素）",
    "正文中的引用"
  ]) {
    ok(zhModalRows.includes(expected), "figures modal field label: " + expected);
  }

  eq(
    command(zh.env, "tufte-sidenotes:insert-sidenote").cmd.name,
    "在光标处插入旁注",
    "sidenotes command name is Chinese"
  );
  eq(
    command(zh.env, "tufte-figures:insert-image-quilt").cmd.name,
    "插入图像拼图",
    "figures command name is Chinese"
  );
  eq(
    command(zh.env, "tufte-inline:wrap-dropcap").cmd.name,
    "将首字包裹为中文首字下沉（@@…@@）",
    "inline command name is Chinese"
  );

  command(zh.env, "tufte-figures:renumber-figures").cmd.editorCallback(fakeEditor());
  deepEq(
    zh.env.registries.notices.map((n) => n.message),
    ["未找到可重新编号的图"],
    "the renumber Notice fires in Chinese"
  );

  // ======================================================================
  // (c) the prefix rule: zh-TW / zh-CN hit the same table
  // ======================================================================
  for (const tag of ["zh-TW", "zh-CN", "ZH"]) {
    const v = await loadSuite({ seed: withLanguage(tag) });
    const vTab = renderSuiteTab(v);
    deepEq(typefaceTabLabels(vTab.containerEl), ["西文", "中文"], tag + ": typeface tabs Chinese");
    eq(
      command(v.env, "tufte-sidenotes:insert-marginnote").cmd.name,
      "在段落后插入边注",
      tag + ": command name Chinese"
    );
    deepEq(modalTabLabels(openFigureModal(v.env)), ZH_MODAL_TABS, tag + ": modal tabs Chinese");
  }

  // A language that merely CONTAINS "zh" must not match (prefix, not search).
  const notZh = await loadSuite({ seed: withLanguage("hzh") });
  deepEq(
    modalTabLabels(openFigureModal(notZh.env)),
    EN_MODAL_TABS,
    "'hzh' is not a Chinese locale — the prefix test rejects it"
  );

  // ======================================================================
  // (d) standalone module == suite build, under both languages
  // ======================================================================
  for (const [lang, expectTabs] of [[null, EN_MODAL_TABS], ["zh", ZH_MODAL_TABS]]) {
    const solo = await loadOriginal("figures", { seed: withLanguage(lang) });
    const suite = await loadSuite({ seed: withLanguage(lang) });
    const tag = lang === null ? "no language" : lang;

    const soloModal = openFigureModal(solo.env);
    const suiteModal = openFigureModal(suite.env);
    deepEq(modalTabLabels(soloModal), expectTabs, tag + ": standalone modal tabs");
    deepEq(
      modalTabLabels(suiteModal),
      modalTabLabels(soloModal),
      tag + ": suite modal tabs match the standalone module's"
    );
    deepEq(
      rowNames(suiteModal),
      rowNames(soloModal),
      tag + ": suite modal field labels match the standalone module's"
    );

    // …and so do the settings tab and the command names.
    const soloTab = solo.env.registries.settingTabs[0];
    soloTab.display();
    const suiteSection = Array.from(renderSuiteTab(suite).containerEl.children).find(
      (c) => c.tagName === "DIV" && c.className === ""
    );
    deepEq(
      rowNames(suiteSection),
      rowNames(soloTab.containerEl),
      tag + ": suite figures settings match the standalone tab"
    );
    for (const id of [
      "tufte-figures:insert-figure",
      "tufte-figures:edit-figure",
      "tufte-figures:insert-image-quilt",
      "tufte-figures:insert-figure-reference",
      "tufte-figures:renumber-figures"
    ]) {
      eq(
        command(suite.env, id).cmd.name,
        command(solo.env, id).cmd.name,
        tag + ": " + id + " name matches standalone"
      );
    }
  }

  return "en/zh/zh-TW across suite tab, typefaces, figures modal, commands, notices; standalone parity";
};
