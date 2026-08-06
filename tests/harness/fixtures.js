"use strict";

// Fixture corpus. Each entry is pure data (an HTML string + a ctx factory) so
// every environment can build its OWN identical copy from the same source.

const SIDENOTE_MD = [
  "Text with a ref[^1] here.",
  "",
  "> [!sidenote] 1",
  "> The sidenote body.",
  "",
  "Another paragraph.",
  "",
  "> [!marginnote]",
  "> A margin note with no image."
].join("\n");

const FIGURE_MD = [
  "> [!figure] Fig. 1.",
  "> ![[diagram.png|Alt]]",
  "> Caption text.",
  "",
  "^fig-1"
].join("\n");

const FIGURE_MARGIN_MD = [
  "> [!figure-margin] Fig. 2.",
  "> ![[small.png|Small]]",
  "> Margin caption text.",
  "",
  "^fig-2"
].join("\n");

function ctxFactory(text, lineEnd) {
  return function makeCtx() {
    return {
      sourcePath: "Test.md",
      frontmatter: null,
      getSectionInfo: () => ({
        lineStart: 0,
        lineEnd: lineEnd == null ? text.split("\n").length - 1 : lineEnd,
        text
      }),
      addChild() {}
    };
  };
}

const EMPTY_CTX = function () {
  return {
    sourcePath: "Test.md",
    frontmatter: null,
    getSectionInfo: () => null,
    addChild() {}
  };
};

const FIXTURES = [
  // ---------------- inline ----------------
  {
    module: "inline",
    name: "inline/basic-shorthands",
    html:
      '<div><p>^^New thought^^ then &amp;&amp;lead in&amp;&amp; and @@字@@ plus code <code>^^x^^</code>.</p></div>',
    ctx: EMPTY_CTX,
    expectChange: true
  },
  {
    module: "inline",
    name: "inline/no-matches",
    html: '<div><p>Plain prose with no shorthand delimiters at all.</p></div>',
    ctx: EMPTY_CTX,
    expectChange: false
  },
  {
    module: "inline",
    name: "inline/nested-link",
    html:
      '<div><p>see <a href="#x">^^inside link^^</a> and ^^outside^^ plus &amp;&amp;run in&amp;&amp;.</p></div>',
    ctx: EMPTY_CTX,
    expectChange: true
  },

  // ---------------- sidenotes ----------------
  {
    module: "sidenotes",
    name: "sidenotes/inline-ref",
    html:
      '<div class="markdown-preview-view markdown-rendered">' +
      "<div><p>Text with a ref[^1] here.</p></div>" +
      "</div>",
    elSelector: ":scope > div",
    ctx: ctxFactory(SIDENOTE_MD),
    expectChange: true
  },
  {
    module: "sidenotes",
    name: "sidenotes/sidenote-callout",
    html:
      '<div class="markdown-preview-view markdown-rendered"><div>' +
      "<p>Text with a ref[^1] here.</p>" +
      '<div class="callout" data-callout="sidenote">' +
      '<div class="callout-title"><div class="callout-title-inner">1</div></div>' +
      '<div class="callout-content"><p>The sidenote body.</p></div>' +
      "</div>" +
      "</div></div>",
    elSelector: ":scope > div",
    ctx: ctxFactory(SIDENOTE_MD),
    expectChange: true
  },
  {
    module: "sidenotes",
    name: "sidenotes/marginnote-no-image",
    html:
      '<div class="markdown-preview-view markdown-rendered"><div>' +
      '<div class="callout" data-callout="marginnote">' +
      '<div class="callout-title"><div class="callout-title-inner">Marginnote</div></div>' +
      '<div class="callout-content"><p>A margin note with no image.</p></div>' +
      "</div>" +
      "</div></div>",
    elSelector: ":scope > div",
    ctx: ctxFactory(SIDENOTE_MD),
    expectChange: false
  },

  // ---------------- figures ----------------
  {
    module: "figures",
    name: "figures/default-figure",
    html:
      "<div>" +
      '<div class="callout" data-callout="figure">' +
      '<div class="callout-title"><div class="callout-title-inner">Fig. 1.</div></div>' +
      '<div class="callout-content">' +
      '<p><span class="internal-embed image-embed" src="diagram.png" alt="Alt">' +
      '<img src="app://x/diagram.png" alt="Alt"></span></p>' +
      "<p>Caption text.</p>" +
      "</div></div>" +
      "<p>^fig-1</p>" +
      "</div>",
    ctx: ctxFactory(FIGURE_MD),
    expectChange: true
  },
  {
    module: "figures",
    name: "figures/margin-figure",
    html:
      "<div>" +
      '<div class="callout" data-callout="figure-margin">' +
      '<div class="callout-title"><div class="callout-title-inner">Fig. 2.</div></div>' +
      '<div class="callout-content">' +
      '<p><span class="internal-embed image-embed" src="small.png" alt="Small">' +
      '<img src="app://x/small.png" alt="Small"></span></p>' +
      "<p>Margin caption text.</p>" +
      "</div></div>" +
      "<p>^fig-2</p>" +
      "</div>",
    ctx: ctxFactory(FIGURE_MARGIN_MD),
    expectChange: true
  },
  {
    module: "figures",
    name: "figures/marginnote-with-image",
    html:
      "<div>" +
      '<div class="callout" data-callout="marginnote">' +
      '<div class="callout-title"><div class="callout-title-inner">Marginnote</div></div>' +
      '<div class="callout-content"><p>Fig. 3. A margin figure caption. ' +
      '<span class="internal-embed image-embed" src="tiny.png" alt="Tiny">' +
      '<img src="app://x/tiny.png" alt="Tiny"></span></p></div>' +
      "</div></div>",
    ctx: EMPTY_CTX,
    expectChange: true
  },
  {
    module: "figures",
    name: "figures/marginnote-without-image",
    html:
      "<div>" +
      '<div class="callout" data-callout="marginnote">' +
      '<div class="callout-title"><div class="callout-title-inner">Marginnote</div></div>' +
      '<div class="callout-content"><p>Plain margin note, no image at all.</p></div>' +
      "</div></div>",
    ctx: EMPTY_CTX,
    expectChange: false
  }
];

// Build a fixture's DOM inside `env`'s document. Returns {root, el}.
function build(env, fixture) {
  const holder = env.document.createElement("div");
  holder.innerHTML = fixture.html;
  const root = holder.firstElementChild;
  const el = fixture.elSelector ? root.querySelector(fixture.elSelector) : root;
  if (!el) throw new Error("fixture " + fixture.name + ": elSelector matched nothing");
  return { root, el, holder };
}

function pristine(fixture) {
  return fixture.html;
}

module.exports = { FIXTURES, build, pristine, SIDENOTE_MD, FIGURE_MD, FIGURE_MARGIN_MD };
