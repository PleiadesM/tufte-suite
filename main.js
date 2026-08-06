/* ============================================================================
 * Tufte Suite 1.0.0 - the four Tufte plugins bundled as one plugin.
 *
 * GENERATED FILE - built 2026-08-05 by build-tufte-suite.js from:
 *   tufte-backlinks 1.0.1     (embedded verbatim)
 *   tufte-figures 1.7.2       (embedded with ONE patch: quilt store path -> plugins/tufte-suite/quilts)
 *   tufte-inline 1.2.0        (embedded verbatim)
 *   tufte-sidenotes 1.7.0     (embedded verbatim)
 *
 * Module load order mirrors the vault's community-plugins.json order:
 *   backlinks -> figures -> inline -> sidenotes
 * so Markdown post-processor registration order and capture-phase DOM
 * handler order are exactly what the four standalone plugins produce today.
 *
 * Do not hand-edit the VERBATIM sections between TUFTE-SUITE:BEGIN/END
 * markers; fix the standalone plugin and regenerate. Suite-only logic
 * lives in the 'Tufte Suite runtime' section at the bottom of this file.
 * ============================================================================ */

const obsidian = require("obsidian");

const SUBMODULES = [];

// Each standalone plugin's main.js is embedded unmodified inside a CommonJS
// factory, so it keeps its own module/exports pair and top-level scope.
// NOTE: this file deliberately has no top-level 'use strict' - the embedded
// sources run in the same sloppy mode Obsidian's plugin loader gives them.
function defineSubmodule(def, factory) {
  const module = { exports: {} };
  factory(module, module.exports, require);
  const cls = (module.exports && module.exports.default) || module.exports;
  SUBMODULES.push(Object.assign({}, def, { cls: cls }));
}

defineSubmodule({
  key: "backlinks",
  id: "tufte-backlinks",
  name: "Tufte Backlinks",
  version: "1.0.1",
  blurb: "Backlink and mention snippets rendered as formatted Markdown."
}, function (module, exports, require) {
/*<<<TUFTE-SUITE:BEGIN tufte-backlinks/main.js v1.0.1>>>*/
const { Component, MarkdownRenderer, Plugin } = require("obsidian");

/* ============================================================================
   Tufte Backlinks — render "Linked mentions" / "Unlinked mentions" snippets
   as formatted Markdown instead of raw source.

   Obsidian's core backlink plugin inserts each mention as PLAIN TEXT, so
   `**bold**`, `[[wikilinks]]` and `# headings` show their markers. The theme
   can only style that text; turning it into rendered Markdown needs JS, hence
   this companion plugin.

   Two behaviours the rest of the file exists to protect:

     1. A heading caught in a snippet must read at BODY size. The markers are
        stripped before rendering (so inline formatting inside the heading
        text still renders) and styles.css keeps an h1–h6 safety net for
        anything the stripper misses.
     2. In Linked mentions, the link that resolves to the page whose backlinks
        are being shown — the backlink reference itself — is tagged
        `tufte-backlinks-target` + `search-result-file-matched-text`, and the
        stylesheet renders it bold + underlined + accent red. Links to OTHER
        pages in the same snippet render normally.

   Everything keys off `.backlink-pane`, which covers the sidebar pane AND the
   in-document block (`.embedded-backlinks` wraps a `.backlink-pane`), and
   structurally excludes the global Search pane.

   The real shape of a `.search-result-file-match` (read out of the Obsidian
   1.13 bundle, after a first attempt assumed otherwise):

     - The snippet is NOT bare text. Obsidian's span renderer wraps EVERY run:
       non-matched runs in CLASS-LESS `<span>`s, matched runs in
       `span.search-result-file-matched-text`. Line breaks arrive as literal
       `\n` inside a span's text, not reliably as `<br>`.
     - The match element also holds Obsidian's own live CHROME: the
       `div.search-result-hover-button.mod-top` / `.mod-bottom` "show more
       context" chevrons, built in the constructor, and — on unlinked
       mentions, appended later — the `button.search-result-file-match-replace-button`
       ("Link") action. Child order can be chevrons, then spans, then button.

   So the plugin distinguishes CONTENT (which it replaces with the rendered
   wrapper) from CHROME (which it leaves in place, untouched, throughout the
   swap, the unload restore, and the observer's foreign-add test).
   ============================================================================ */

const MARK_ATTR = "data-tufte-backlinks";
const RENDERED_CLASS = "tufte-backlinks-rendered";
const TARGET_CLASS = "tufte-backlinks-target";
// Obsidian's own class for a matched run. Re-applying it (rather than a
// plugin-private class) keeps theme.css's linked-red / unlinked-muted-dotted
// sibling rules working against rendered content, unchanged.
const HIGHLIGHT_CLASS = "search-result-file-matched-text";
// Obsidian's live controls inside a match: the "show more context" chevrons
// and, on unlinked mentions, the "Link" action button. Never our content.
const CHROME_SELECTOR =
  ".search-result-hover-button, .search-result-file-match-replace-button";
const DEBOUNCE_MS = 120;

// Ellipsis-tolerant: a snippet is a slice of the note, so a heading line can
// arrive as "…# Reference". Keep the indent and the ellipsis, drop the hashes.
const ATX_HEADING_RE = /^(\s*)((?:…|\.\.\.)\s*)?#{1,6}\s+/;
const SETEXT_UNDERLINE_RE = /^\s*(={2,}|-{2,})\s*$/;

module.exports = class TufteBacklinksPlugin extends Plugin {
  async onload() {
    // One long-lived child Component owns every render, so MarkdownRenderer's
    // per-render children (embeds, math, callouts) unload with the plugin
    // instead of leaking one Component per mention.
    this.renderComp = new Component();
    this.addChild(this.renderComp);

    this.processTimer = 0;
    this.renderToken = 0;
    // Element -> token of the render currently in flight for it. A marked
    // element with no rendered child is ambiguous — either Obsidian rewrote it
    // in place, or its render simply hasn't landed yet — and only this tells
    // the two apart.
    this.pending = new WeakMap();

    this.registerBacklinkObserver();

    const schedule = () => this.scheduleProcess();
    this.registerEvent(this.app.workspace.on("layout-change", schedule));
    this.registerEvent(this.app.workspace.on("active-leaf-change", schedule));
    this.registerEvent(this.app.workspace.on("file-open", schedule));
    this.app.workspace.onLayoutReady(() => this.processAll());
  }

  onunload() {
    // Observers, events and the timer are unwound by register*(); the DOM is
    // not. Put the raw snippets back so disabling the plugin returns the pane
    // to its native state immediately (Obsidian regenerates the native match
    // highlights on the next natural refresh).
    document.querySelectorAll("[" + MARK_ATTR + "]").forEach((el) => {
      const wrapper = el.querySelector(":scope > ." + RENDERED_CLASS);
      const raw = el.dataset.tufteBacklinksRaw;
      // Swap the wrapper back out for the raw text in place — never
      // `el.textContent = raw`, which would take Obsidian's chrome with it.
      // No wrapper means the render never landed (in flight, or the error
      // sentinel); then there is nothing to put back.
      if (wrapper && typeof raw === "string") {
        el.insertBefore(document.createTextNode(raw), wrapper);
        wrapper.remove();
      }
      delete el.dataset.tufteBacklinks;
      delete el.dataset.tufteBacklinksRaw;
    });
  }

  registerBacklinkObserver() {
    // childList only — the plugin's own dataset writes are attribute changes,
    // and characterData would fire on every keystroke reflected into a mention.
    const observer = new MutationObserver((records) => {
      // The whole batch is scanned, never short-circuited on the first record
      // worth acting on: one batch can carry an invalidation for each of
      // SEVERAL marked elements, and a skipped one leaves its in-flight render
      // alive to land stale content over Obsidian's new text. Scheduling is
      // hoisted out of the loop instead — the pass is debounced anyway.
      let schedule = false;

      for (const record of records) {
        const node = record.target;
        const target =
          node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (!target) continue;

        // A mutation on or under a match this plugin already took needs three
        // cases told apart — the first two are the plugin's own work echoing
        // back, and re-entering on those is an infinite loop.
        const marked = target.closest("[" + MARK_ATTR + "]");
        if (marked) {
          // Deeper than the match itself: the wrapper filling in, or
          // MarkdownRenderer's async post-processing. Always ours.
          if (target !== marked) continue;
          // On the match itself: the swap-in adds exactly the rendered
          // wrapper, and Obsidian appends the "Link" button to an unlinked
          // mention on its own schedule — neither means the element was
          // reclaimed. Anything ELSE added does. (Pure-removal records add
          // nothing and fall through here; the foreign ADD that follows does
          // the work.)
          const foreignAdd = Array.prototype.some.call(
            record.addedNodes,
            (added) =>
              !(
                (added.nodeType === Node.ELEMENT_NODE &&
                  added.classList.contains(RENDERED_CLASS)) ||
                isChromeEl(added)
              )
          );
          if (!foreignAdd) continue;
          // Obsidian rewrote a processed match in place. Dropping the mark
          // both frees the element for immediate reprocessing and invalidates
          // any in-flight render, whose token check will now fail — stale
          // content can never land on top of Obsidian's new text. No
          // `.backlink-pane` re-check: a marked element only ever exists
          // inside one.
          delete marked.dataset.tufteBacklinks;
          delete marked.dataset.tufteBacklinksRaw;
          schedule = true;
          continue;
        }

        if (!target.closest(".backlink-pane")) continue;
        schedule = true;
      }

      if (schedule) this.scheduleProcess();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    this.register(() => observer.disconnect());
    this.register(() => window.clearTimeout(this.processTimer));
  }

  // Trailing debounce: Obsidian rebuilds the pane in bursts (collapse/expand,
  // re-search on edit), and only the settled DOM is worth rendering.
  scheduleProcess() {
    window.clearTimeout(this.processTimer);
    this.processTimer = window.setTimeout(() => {
      this.processTimer = 0;
      this.processAll();
    }, DEBOUNCE_MS);
  }

  processAll() {
    const workspace = this.app.workspace;
    const activeFile = workspace.getActiveFile();
    // root element -> the file whose mentions that root shows. Needed per root
    // because several panes can be open at once (sidebar + two split notes,
    // each with its own in-document backlinks).
    const roots = new Map();

    for (const leaf of workspace.getLeavesOfType("backlink")) {
      const container = leaf.view && leaf.view.containerEl;
      if (!container) continue;
      // A pinned backlink view carries its own file; an unpinned one follows
      // the active note and may not expose one.
      roots.set(container, (leaf.view && leaf.view.file) || activeFile);
    }
    for (const leaf of workspace.getLeavesOfType("markdown")) {
      const container = leaf.view && leaf.view.containerEl;
      if (!container) continue;
      const file = (leaf.view && leaf.view.file) || null;
      container
        .querySelectorAll(".embedded-backlinks")
        .forEach((node) => roots.set(node, file));
    }

    roots.forEach((targetFile, root) => {
      root
        .querySelectorAll(".backlink-pane .search-result-file-match")
        .forEach((el) => this.considerMatch(el, targetFile));
    });
  }

  considerMatch(el, targetFile) {
    // Belt and braces: the global Search pane uses the same match class, and
    // must stay structurally untouched.
    if (el.closest('.workspace-leaf-content[data-type="search"]')) return;

    const mark = el.dataset.tufteBacklinks;
    if (mark === "error") return;
    if (mark) {
      if (el.querySelector(":scope > ." + RENDERED_CLASS)) return;
      // Marked, no rendered child, but a render is in flight: taken, not
      // clobbered. Clearing the mark here would restart that render — and
      // under continuous pane churn, restart it again on every pass.
      if (this.pending.has(el)) return;
      // Marked but no rendered child: Obsidian rewrote the match in place
      // (new search results reuse the element). Treat it as fresh.
      delete el.dataset.tufteBacklinks;
      delete el.dataset.tufteBacklinksRaw;
    }

    if (!isPlainSnippet(el)) return;
    // Not awaited: the mark is written synchronously inside, so a second pass
    // arriving mid-render sees the element as taken.
    this.renderMatch(el, targetFile);
  }

  async renderMatch(el, targetFile) {
    const raw = readSnippetText(el);
    const highlights = Array.prototype.map
      .call(el.querySelectorAll("." + HIGHLIGHT_CLASS), (n) => n.textContent)
      .filter((text) => text && text.trim());

    const token = String(++this.renderToken);
    el.dataset.tufteBacklinks = token;
    el.dataset.tufteBacklinksRaw = raw;
    this.pending.set(el, token);

    try {
      const sourcePath = resolveSourcePath(this.app, el);
      const wrapper = document.createElement("div");
      wrapper.className = RENDERED_CLASS;

      try {
        // Rendered DETACHED, then swapped in one move — the pane never shows
        // an empty match while the renderer is mid-flight.
        await renderMarkdown(
          this.app,
          preprocessSnippet(raw),
          wrapper,
          sourcePath,
          this.renderComp
        );
      } catch (error) {
        // Sentinel rather than an unmark: a snippet the renderer chokes on
        // would otherwise be retried on every observer tick.
        el.dataset.tufteBacklinks = "error";
        return;
      }

      removeFootnoteTail(wrapper);
      tagTargetLinks(this.app, wrapper, sourcePath, targetFile);
      reapplyHighlights(wrapper, highlights);

      // The pane may have been rebuilt while awaiting; a stale render must not
      // land on a recycled element.
      if (!el.isConnected || el.dataset.tufteBacklinks !== token) return;

      // Content out, wrapper in — but the chrome stays exactly where it is.
      // The hover chevrons and the unlinked "Link" button are Obsidian's own
      // live controls; `replaceChildren` would delete them (and their
      // handlers) along with the text.
      const contentNodes = Array.prototype.filter.call(
        el.childNodes,
        (node) => !isChromeEl(node)
      );
      el.insertBefore(wrapper, contentNodes[0] || null);
      contentNodes.forEach((node) => node.remove());
    } finally {
      // Token-conditional: if an overlapping newer render has already claimed
      // this element, its pending entry is not this one's to clear.
      if (this.pending.get(el) === token) this.pending.delete(el);
    }
  }
};

/* ---- Reading the native snippet ----------------------------------------- */

function isChromeEl(node) {
  return node.nodeType === Node.ELEMENT_NODE && node.matches(CHROME_SELECTOR);
}

// The fail-safe boundary: exactly the shapes Obsidian builds a text snippet
// out of. A class-less span is one of its plain runs — but only if it holds
// nothing but text, since a span carrying real structure would mean this is
// some other kind of match than the one modeled here.
function isContentNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return true;
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = node.tagName.toLowerCase();
  if (tag === "br") return true;
  if (tag !== "span") return false;
  if (!node.classList.contains(HIGHLIGHT_CLASS) && node.classList.length !== 0) {
    return false;
  }
  // The text/br-only requirement covers highlight spans and class-less runs
  // alike, deliberately: readSnippetText reads run spans by their children's
  // nodeValue, so a span with element structure would be read as empty. It
  // has to fail the guard, not slip through it.
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br") {
      continue;
    }
    return false;
  }
  return true;
}

// Only text snippets get rendered. Property matches and any future DOM stay
// native — as does a match holding nothing but chrome (nothing to render).
function isPlainSnippet(el) {
  let hasContent = false;
  for (const node of el.childNodes) {
    if (isChromeEl(node)) continue;
    if (!isContentNode(node)) return false;
    hasContent = true;
  }
  return hasContent;
}

// textContent over the whole element would sweep in the chrome's own labels
// and lose the `<br>` line breaks — and the per-line heading strip below
// depends on the lines. (Literal `\n` inside a run's text survives as-is.)
function readSnippetText(el) {
  let text = "";
  for (const node of el.childNodes) {
    if (isChromeEl(node)) continue;
    if (isBreak(node)) {
      text += "\n";
      continue;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      // A run span: its own children are text and breaks, same rule again.
      for (const child of node.childNodes) {
        text += isBreak(child) ? "\n" : child.nodeValue || "";
      }
      continue;
    }
    text += node.nodeValue || "";
  }
  return text;
}

function isBreak(node) {
  return node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === "br";
}

/* ---- Snippet -> Markdown ------------------------------------------------- */

function preprocessSnippet(raw) {
  const lines = String(raw || "").split("\n");
  const out = [];
  for (const line of lines) {
    // Setext underline under a non-blank line would promote that line to a
    // heading — the one heading form with no marker on the text line itself.
    const previous = out.length ? out[out.length - 1] : "";
    if (SETEXT_UNDERLINE_RE.test(line) && previous.trim()) continue;

    // Embeds would inject a whole note or image into the pane. Demoted to
    // ordinary links; styles.css keeps a display:none net for the rest.
    // The heading strip keeps one space after a leading ellipsis, so a
    // truncated "…# Reference" reads "… Reference", not "…Reference".
    out.push(
      line
        .replace(ATX_HEADING_RE, (match, indent, ellipsis) =>
          ellipsis ? indent + ellipsis.trimEnd() + " " : indent
        )
        .replace(/!(?=\[)/g, "")
    );
  }
  // Everything else is left alone: a snippet truncated mid-syntax renders as
  // literal text, which is exactly the status quo for that fragment.
  return dedentSnippet(out).join("\n");
}

// A snippet sliced from the middle of a nested list keeps its source
// indentation, but the fragment carries no parent list to anchor it — so a
// shared margin of a tab / 4+ spaces reads as an INDENTED CODE BLOCK and the
// whole mention renders monospace. Stripping the longest literal whitespace
// prefix the non-blank lines share restores the shallowest line to column 0
// while preserving relative nesting, so nested (task) lists render as lists.
// Literal prefix, not column math: a tab is never split, and if lines mix
// tabs and spaces the common prefix simply ends early (partial dedent — the
// status quo for that fragment). Known trade-off: a mention inside an
// INDENTED code block (the rare, non-fenced kind) is flattened to prose;
// fenced blocks keep their fences and still render as code.
function dedentSnippet(lines) {
  let prefix = null;
  for (const line of lines) {
    if (!line.trim()) continue; // blank lines don't vote
    const indent = (line.match(/^[ \t]*/) || [""])[0];
    if (prefix === null) {
      prefix = indent;
    } else {
      let i = 0;
      while (i < prefix.length && i < indent.length && prefix[i] === indent[i]) i++;
      prefix = prefix.slice(0, i);
    }
    if (!prefix) return lines;
  }
  if (!prefix) return lines;
  return lines.map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line));
}

// Resolving links relative to the note the mention lives in (not the note
// being viewed) is what makes relative wikilinks in the snippet land right.
function resolveSourcePath(app, el) {
  const active = app.workspace.getActiveFile();
  const activePath = active ? active.path : "";
  const title = readFileTitle(el);
  if (title) {
    const dest = app.metadataCache.getFirstLinkpathDest(title, activePath);
    if (dest) return dest.path;
  }
  return activePath;
}

function readFileTitle(el) {
  let item = el.closest(".tree-item");
  while (item) {
    const title = item.querySelector(":scope > .search-result-file-title");
    if (title) {
      // The title element also holds the match-count flair; the name lives in
      // `.tree-item-inner`.
      const inner = title.querySelector(".tree-item-inner");
      return (inner || title).textContent.trim();
    }
    item = item.parentElement && item.parentElement.closest(".tree-item");
  }
  return "";
}

/* ---- Post-processing the rendered snippet -------------------------------- */

function removeFootnoteTail(root) {
  if (!root) return;
  root
    .querySelectorAll(
      '.footnotes, ol:has(> li[data-footnote-id^="fn-"]), ol:has(> li[id^="fn-"])'
    )
    .forEach((node) => node.remove());
}

// Resolution-based, not text-based: this catches aliases (`[[Page|alias]]`),
// subpath links (`[[Page#heading]]`) and markdown-style links alike, while
// leaving links to other notes styled normally.
function tagTargetLinks(app, wrapper, sourcePath, targetFile) {
  if (!targetFile) return;
  wrapper.querySelectorAll("a.internal-link").forEach((link) => {
    const href = link.getAttribute("data-href") || link.getAttribute("href") || "";
    const linkpath = href.split("#")[0].split("^")[0].trim();
    // A bare subpath (`[[#heading]]`) points inside its own note, never at the
    // target.
    if (!linkpath) return;
    const dest = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    if (dest && dest.path === targetFile.path) {
      link.classList.add(TARGET_CLASS, HIGHLIGHT_CLASS);
    }
  });
}

// Unlinked mentions match plain text, so nothing in the rendered output
// carries the highlight class — it has to be put back by string.
function reapplyHighlights(wrapper, texts) {
  for (const text of texts) {
    const needle = text.trim();
    if (!needle) continue;
    wrapTextOccurrence(wrapper, needle);
  }
}

function wrapTextOccurrence(wrapper, needle) {
  const doc = wrapper.ownerDocument || document;
  const walker = doc.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.includes(needle)) {
        return NodeFilter.FILTER_REJECT;
      }
      // Already highlighted — which includes the tagged target link, since it
      // carries the highlight class too.
      const parent = node.parentElement;
      if (!parent || parent.closest("." + HIGHLIGHT_CLASS)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const node = walker.nextNode();
  // Truncation and rendered-away syntax can make a captured match unfindable.
  // The mention still reads fine unhighlighted, so give up silently rather
  // than guess at a position.
  if (!node) return false;

  const middle = node.splitText(node.nodeValue.indexOf(needle));
  middle.splitText(needle.length);
  const span = doc.createElement("span");
  span.className = HIGHLIGHT_CLASS;
  middle.parentNode.replaceChild(span, middle);
  span.appendChild(middle);
  return true;
}

async function renderMarkdown(app, markdown, el, sourcePath, component) {
  if (MarkdownRenderer.render) {
    await MarkdownRenderer.render(app, markdown || " ", el, sourcePath, component);
    return;
  }

  await MarkdownRenderer.renderMarkdown(markdown || " ", el, sourcePath, component);
}
/*<<<TUFTE-SUITE:END tufte-backlinks/main.js>>>*/
});

defineSubmodule({
  key: "figures",
  id: "tufte-figures",
  name: "Tufte Figures",
  version: "1.7.2",
  blurb: "Column, full-width and margin figures, captions, quilts, lightbox and references."
}, function (module, exports, require) {
/*<<<TUFTE-SUITE:BEGIN tufte-figures/main.js v1.7.2>>>*/
const {
  MarkdownRenderer,
  Plugin,
  Modal,
  Setting,
  PluginSettingTab,
  Notice
} = require("obsidian");

// Tufte Figures — drop-to-insert Tufte-style figures.
//
// Three display modes, written as portable Markdown and rendered by the
// companion stylesheet in Reading view only (the editor stays single-column,
// matching the Tufte Sidenotes plugin):
//
//   1. Default — image in the text column, caption floated into the margin:
//        > [!figure] Fig. 1.
//        > ![[diagram.png|Alt]]
//        > Caption text.
//
//        ^fig-1
//
//   2. Full-width — image spans column + margin, caption below:
//        > [!figure-full] Fig. 2.
//        > ![[wide.png|Alt]]
//        > Caption text.
//
//        ^fig-2
//
//   3. Margin figure — image and caption both in the margin:
//        > [!figure-margin] Fig. 3.
//        > ![[small.png|Alt]]
//        > Caption text.
//
//        ^fig-3
//
// Each figure carries a `^fig-N` block anchor so the clickable in-text
// indicator `[[#^fig-N|(Fig. N)]]` resolves and scrolls to it.

const ENABLED_CLASS = "tufte-figures-enabled";
const DEFAULT_SETTINGS = {
  interceptDrops: true,
  labelPrefix: "Fig.",
  quiltFolder: "img/quilt"
};

const ANCHOR_LINE_RE = /^\s*\^fig-(\d+)\s*$/;
const CALLOUT_HEADER_RE = /^(\s*>\s*\[!([a-z-]+)\][+-]?)(?:\s+(.*))?$/i;
const BLOCKQUOTE_LINE_RE = /^\s*>\s?(.*)$/;
const IMAGE_MARKDOWN_RE = /^\s*(?:!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]+\))\s*$/;
// Same image embed, but as a *leading* match so trailing label/caption text
// on the same line can follow (multi-image entry lines).
const IMAGE_LEAD_RE = /^\s*(!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]+\))\s*(.*)$/;
// `(label) caption` — the order letter in parentheses, then the caption.
const ENTRY_LABEL_RE = /^\(([^)]*)\)\s*(.*)$/;
const FIGURE_CALLOUT_TYPES = new Set([
  "figure",
  "figure-full",
  "figure-margin",
  "marginnote"
]);
const CAPTION_MARKER_RE = /^\s*\[!caption\]\s*/i;

module.exports = class TufteFiguresPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.syncEnabledClass();
    this.register(() => {
      document.body?.classList.remove(ENABLED_CLASS);
      document.documentElement?.classList.remove(ENABLED_CLASS);
    });

    // Keep the enabled class in sync as the active theme changes.
    this.registerEvent(
      this.app.workspace.on("css-change", () => this.syncEnabledClass())
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.syncEnabledClass())
    );

    this.addSettingTab(new FigureSettingTab(this.app, this));

    this.addCommand({
      id: "insert-figure",
      name: "Insert figure",
      editorCallback: (editor) => {
        const line = editor.getLine(editor.getCursor().line) || "";
        const m = line.match(/!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]+\)/);
        new FigureModal(this.app, this, editor, {
          embed: m ? m[0] : "",
          altDefault: "",
          pos: editor.getCursor()
        }).open();
      }
    });

    // Contextual: only available while the cursor sits inside a figure
    // callout. Opens the modal pre-filled with that figure, replacing it on
    // save. Bind a hotkey in Settings → Hotkeys.
    this.addCommand({
      id: "edit-figure",
      name: "Edit figure at cursor",
      editorCheckCallback: (checking, editor) => {
        const found = findFigureAtCursor(editor);
        if (!found) return false;
        if (checking) return true;
        const parsed = parseFigureBlock(found.lines);
        const sourcePath = this.app.workspace.getActiveFile()?.path || "";
        // A single-image figure embedding `quilt-<id>.png` with a saved config
        // sidecar re-opens on the quilt tab; everything else opens as before.
        (async () => {
          let quilt = null;
          if (parsed.images.length === 1) {
            const id = quiltIdFromEmbed(parsed.images[0].embed);
            if (id) {
              const dir = quiltDir(this.app, id);
              try {
                if (await this.app.vault.adapter.exists(`${dir}/config.json`)) {
                  quilt = { id, dir };
                }
              } catch {}
            }
          }
          new FigureModal(this.app, this, editor, {
            edit: parsed,
            editRange: { from: found.start, to: found.end },
            pos: editor.getCursor(),
            sourcePath,
            quilt
          }).open();
        })();
        return true;
      }
    });

    this.addCommand({
      id: "insert-image-quilt",
      name: "Insert image quilt",
      editorCallback: (editor) => {
        new FigureModal(this.app, this, editor, {
          embed: "",
          altDefault: "",
          pos: editor.getCursor(),
          openTab: "quilt",
          sourcePath: this.app.workspace.getActiveFile()?.path || ""
        }).open();
      }
    });

    this.addCommand({
      id: "insert-figure-reference",
      name: "Insert figure reference",
      editorCallback: (editor) => {
        new FigureReferenceModal(this.app, this, editor).open();
      }
    });

    this.addCommand({
      id: "renumber-figures",
      name: "Renumber all figures",
      editorCallback: (editor) => {
        const count = renumberAllFigures(editor);
        new Notice(
          count
            ? `Renumbered ${count} figure${count === 1 ? "" : "s"}`
            : "No figures found to renumber"
        );
      }
    });

    this.registerEvent(
      this.app.workspace.on("editor-drop", (evt, editor, info) =>
        this.handleImageInsertEvent(evt, editor, info, "drop")
      )
    );
    this.registerEvent(
      this.app.workspace.on("editor-paste", (evt, editor, info) =>
        this.handleImageInsertEvent(evt, editor, info, "paste")
      )
    );

    // Markdown postprocessor — default figures get a canonical DOM so Reading
    // view can place the caption in the margin. Live Preview keeps the same
    // DOM but CSS hides the injected label there because the editable callout
    // title already shows "Fig. N.".
    this.registerMarkdownPostProcessor(async (el, ctx) => {
      if (!this.syncEnabledClass()) return;
      for (const callout of matchingElements(el, '.callout[data-callout="figure"]')) {
        await decorateDefaultFigure(callout, ctx, this.app, this, el);
      }
      for (const callout of matchingElements(el, '.callout[data-callout="figure-full"]')) {
        await decorateFullFigure(callout, ctx, this.app, this, el);
      }
      for (const callout of matchingElements(el, '.callout[data-callout="figure-margin"]')) {
        await decorateMarginFigure(callout, ctx, this.app, this, el);
      }
      matchingElements(el, '.callout[data-callout="marginnote"]').forEach(decorateLegacyMarginFigure);
      hideOrphanFigureAnchors(el);
    });

    // Click a figure image in Reading view to enlarge it (lightbox).
    this.registerDomEvent(
      document,
      "click",
      (evt) => this.handleFigureImageClick(evt),
      { capture: true }
    );

    // Snapshot any image being dragged from inside Obsidian (file explorer,
    // search, etc.) the moment the drag starts. The drag manager is sometimes
    // cleared before `editor-drop` fires, so this snapshot is the reliable
    // source for opening the modal on an internally-dragged image.
    this._lastDraggedImages = [];
    this._lastDragStartedAt = 0;
    this.registerDomEvent(document, "dragstart", (e) => {
      this._lastDraggedImages = this.imagesFromDragSource(e);
      this._lastDragStartedAt = Date.now();
    });
    this.registerDomEvent(document, "dragend", () => {
      this._lastDraggedImages = [];
    });

    // Obsidian ≥1.6 (verified against 1.13.4's app.js): when a drag begins
    // INSIDE the app, the editor's drop handler sees app.dragManager.draggable
    // and inserts a plain link directly — `editor-drop` is only triggered on
    // its external-drag branch, so handleImageInsertEvent never runs for a
    // drag from the file explorer. Catch the DOM drop first, in the capture
    // phase, and open the figure modal from there.
    this.registerDomEvent(
      document,
      "drop",
      (e) => this.handleInternalDropCapture(e),
      { capture: true }
    );
  }

  // Capture-phase companion to handleImageInsertEvent, for image drags that
  // start inside the vault (file explorer, search, bookmarks) and would
  // otherwise be consumed by Obsidian's own drop handling before
  // `editor-drop` ever fires.
  handleInternalDropCapture(evt) {
    if (!evt || evt.defaultPrevented) return;
    if (!this.settings.interceptDrops) return;
    // A held modifier asks Obsidian for one of its alternate drop behaviors
    // (copy path, drop-into-pane…) — stay out of the way.
    if (evt.shiftKey || evt.altKey || evt.ctrlKey || evt.metaKey) return;
    const target = evt.target;
    if (!(target instanceof Element)) return;
    // Only editable Markdown panes. Reading view and the modal's own drop
    // zones keep their existing handling.
    const paneEl = target.closest(".markdown-source-view.mod-cm6");
    if (!paneEl) return;
    // Only drags that started inside the vault and carry an image file;
    // external OS drags leave both sources empty and fall through to the
    // `editor-drop` path.
    const tfile =
      draggedImageFiles(this.app)[0] || this.snapshotImage() || null;
    if (!tfile) return;
    if (!this.syncEnabledClass()) return;
    const view = this.markdownViewAround(paneEl);
    const editor = view && view.editor;
    if (!editor) return;
    evt.preventDefault();
    evt.stopPropagation();
    // Consume the snapshot so a missed `dragend` can't leave it around to
    // hijack a later, unrelated drop.
    this._lastDraggedImages = [];
    const pos = posFromMouse(editor, evt) || editor.getCursor();
    const sourcePath =
      (view.file && view.file.path) ||
      this.app.workspace.getActiveFile()?.path ||
      "";
    const embed = this.buildEmbed(tfile, sourcePath);
    // Insertions never seed alt text: a `|alt` display segment on the embed
    // renders as a grey caption box under the figure, so alt stays opt-in
    // via the modal's Alt field. Same rule on every insertion path below.
    new FigureModal(this.app, this, editor, {
      embed,
      altDefault: "",
      pos,
      sourcePath
    }).open();
  }

  // The dragstart snapshot, guarded by age: if a `dragend` was ever missed
  // (window teardown mid-drag), a stale snapshot must not claim a later,
  // unrelated drop. Any real drag's drop lands well within the window.
  snapshotImage() {
    if (!this._lastDraggedImages || !this._lastDraggedImages.length) return null;
    if (Date.now() - (this._lastDragStartedAt || 0) > 30000) return null;
    return this._lastDraggedImages[0];
  }

  // The markdown view whose DOM contains `el` — the drop may land on a pane
  // that isn't the active one.
  markdownViewAround(el) {
    let found = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf && leaf.view;
      if (
        !found &&
        view &&
        typeof view.getViewType === "function" &&
        view.getViewType() === "markdown" &&
        view.containerEl &&
        view.containerEl.contains(el)
      ) {
        found = view;
      }
    });
    return found;
  }

  // Resolve the image TFile(s) at the source of a drag: first the Obsidian
  // drag manager, then a `data-path` attribute on the dragged element (file
  // explorer / search rows carry one), so we don't depend solely on internals.
  imagesFromDragSource(e) {
    const fromManager = draggedImageFiles(this.app);
    if (fromManager.length) return fromManager;
    const el = e.target && e.target.closest ? e.target.closest("[data-path]") : null;
    if (el) {
      const p = el.getAttribute("data-path");
      const f = p ? this.app.vault.getAbstractFileByPath(p) : null;
      if (isImageTFile(f)) return [f];
    }
    return [];
  }

  handleFigureImageClick(evt) {
    if (!this.syncEnabledClass()) return;
    const target = evt.target;
    if (!(target instanceof HTMLImageElement)) return;
    if (!target.closest(".markdown-preview-view")) return;
    if (
      !target.closest(
        '.callout[data-callout="figure"], .callout[data-callout="figure-full"], .callout[data-callout="figure-margin"], .callout[data-callout="marginnote"]'
      )
    ) {
      return;
    }
    evt.preventDefault();
    evt.stopPropagation();
    this.openLightbox(target.currentSrc || target.src, target.alt || "");
  }

  openLightbox(src, alt) {
    if (!src) return;
    const overlay = document.createElement("div");
    overlay.className = "tufte-fig-lightbox";
    const img = document.createElement("img");
    img.src = src;
    if (alt) img.alt = alt;
    overlay.appendChild(img);

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
    };
    overlay.addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  syncEnabledClass() {
    const enabled = this.isTufteThemeActive();
    document.body?.classList.toggle(ENABLED_CLASS, enabled);
    document.documentElement?.classList.toggle(ENABLED_CLASS, enabled);
    return enabled;
  }

  isTufteThemeActive() {
    // Desktop: vault config exposes the active CSS theme name.
    try {
      if (this.app.vault.getConfig?.("cssTheme") === "Tufte") return true;
    } catch {}
    // Mobile / fallback: probe for a CSS variable the theme defines.
    try {
      const targets = [
        document.body,
        document.documentElement,
        document.querySelector(".workspace-leaf.mod-active") ||
          document.querySelector(".markdown-source-view, .markdown-preview-view")
      ].filter(Boolean);
      for (const target of targets) {
        const probe = getComputedStyle(target)
          .getPropertyValue("--tufte-accent")
          .trim();
        if (probe.length > 0) return true;
      }
    } catch {}
    return false;
  }

  handleImageInsertEvent(evt, editor, info, kind) {
    if (!evt || evt.defaultPrevented) return;
    if (!this.settings.interceptDrops) return;
    if (!this.syncEnabledClass()) return;

    const dt = kind === "drop" ? evt.dataTransfer : evt.clipboardData;
    const file = firstImageFile(dt);

    let pos = editor.getCursor();
    if (kind === "drop") {
      const dropPos = posFromMouse(editor, evt);
      if (dropPos) pos = dropPos;
    }

    if (file) {
      evt.preventDefault();
      this.saveAndOpenModal(file, editor, info, pos);
      return;
    }

    // Internal vault image (dragged from the file explorer or as a link):
    // there's no external File, but Obsidian's drag manager — or the dropped
    // text — points at an existing image TFile. Open the modal on it directly.
    if (kind === "drop") {
      const tfile = this.internalImageFromDrop(evt, info);
      if (tfile) {
        evt.preventDefault();
        const sourcePath =
          info?.file?.path || this.app.workspace.getActiveFile()?.path || "";
        const embed = this.buildEmbed(tfile, sourcePath);
        new FigureModal(this.app, this, editor, {
          embed,
          altDefault: "",
          pos,
          sourcePath
        }).open();
      }
    }
  }

  internalImageFromDrop(evt, info) {
    const fromManager = draggedImageFiles(this.app);
    if (fromManager.length) return fromManager[0];

    // Snapshot captured at dragstart — survives the drag manager being cleared
    // before this drop event fires (the common file-explorer case).
    const snap = this.snapshotImage();
    if (snap) return snap;

    let text = "";
    try {
      text = evt.dataTransfer?.getData("text/plain") || "";
    } catch {}
    const linkpath = linkpathFromDropText(text);
    if (!linkpath) return null;
    const sourcePath =
      info?.file?.path || this.app.workspace.getActiveFile()?.path || "";
    const f = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    return isImageTFile(f) ? f : null;
  }

  async saveAndOpenModal(file, editor, info, pos) {
    const sourcePath =
      info?.file?.path || this.app.workspace.getActiveFile()?.path || "";

    let embed = "";
    try {
      const ext = extFromType(file.type) || fileExt(file.name) || "png";
      const baseName =
        file.name && file.name.toLowerCase() !== "image.png"
          ? file.name
          : `pasted-image-${Date.now()}.${ext}`;
      const path = await this.app.fileManager.getAvailablePathForAttachment(
        baseName,
        sourcePath
      );
      const buffer = await file.arrayBuffer();
      const tfile = await this.app.vault.createBinary(path, buffer);
      embed = this.buildEmbed(tfile, sourcePath);
    } catch (e) {
      console.error("tufte-figures: failed to save dropped image", e);
      new Notice("Tufte Figures: couldn't save the image.");
      return;
    }

    new FigureModal(this.app, this, editor, { embed, altDefault: "", pos, sourcePath }).open();
  }

  buildEmbed(tfile, sourcePath) {
    let link = "";
    try {
      link = this.app.fileManager.generateMarkdownLink(tfile, sourcePath) || "";
    } catch {}
    if (!link) link = `![[${tfile.path}]]`;
    if (!link.startsWith("!")) link = "!" + link;
    return link;
  }

};

// --- image-event helpers -------------------------------------------------

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
  "heic",
  "heif"
]);

function isImageTFile(file) {
  return !!(file && file.extension && IMAGE_EXTS.has(file.extension.toLowerCase()));
}

// Image TFiles currently being dragged from inside Obsidian (file explorer,
// search results, etc.), via the app drag manager.
function draggedImageFiles(app) {
  try {
    const d = app.dragManager && app.dragManager.draggable;
    if (!d) return [];
    if (Array.isArray(d.files)) return d.files.filter(isImageTFile);
    if (d.file && isImageTFile(d.file)) return [d.file];
  } catch {}
  return [];
}

// Best-effort linkpath from the text a drop carries — a wiki embed/link,
// a markdown link target, or a bare image path.
function linkpathFromDropText(text) {
  if (!text) return "";
  const wiki = text.match(/\[\[([^\]|#]+)/);
  if (wiki) return wiki[1].trim();
  const md = text.match(/\]\(([^)\s]+)/);
  if (md) {
    try {
      return decodeURIComponent(md[1].trim());
    } catch {
      return md[1].trim();
    }
  }
  const trimmed = text.trim();
  if (/\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|heif)$/i.test(trimmed)) return trimmed;
  return "";
}

function firstImageFile(dt) {
  if (!dt) return null;
  const files = dt.files;
  if (files && files.length) {
    for (const f of files) {
      if (f && typeof f.type === "string" && f.type.startsWith("image/")) {
        return f;
      }
    }
  }
  const items = dt.items;
  if (items && items.length) {
    for (const it of items) {
      if (it.kind === "file" && it.type && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) return f;
      }
    }
  }
  return null;
}

function posFromMouse(editor, evt) {
  try {
    const cm = editor.cm;
    if (cm && typeof cm.posAtCoords === "function") {
      const offset = cm.posAtCoords({ x: evt.clientX, y: evt.clientY });
      if (offset != null && typeof editor.offsetToPos === "function") {
        return editor.offsetToPos(offset);
      }
    }
  } catch {}
  return null;
}

function extFromType(type) {
  if (!type) return "";
  const map = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/avif": "avif",
    "image/heic": "heic"
  };
  return map[type.toLowerCase()] || "";
}

function fileExt(name) {
  if (!name || name.indexOf(".") === -1) return "";
  return name.split(".").pop();
}

// --- embed parsing / sizing ----------------------------------------------

// A trailing pipe segment of `WIDTH` or `WIDTHxHEIGHT` is Obsidian's native
// image size; an earlier segment is alt/display text.
const EMBED_SIZE_RE = /^(\d+)(?:x(\d+))?$/;

// Split an image embed into its parts. Recognises wiki embeds
// (`![[path|alt|WxH]]`, any of alt/size optional) and markdown embeds
// (`![alt|WxH](url)`). `kind: "other"` means an embed we can't resize.
function parseEmbed(embed) {
  const raw = (embed || "").trim();

  const wiki = raw.match(/^!\[\[([^\]]+)\]\]$/);
  if (wiki) {
    const segs = wiki[1].split("|");
    const path = segs.shift();
    let width, height, alt;
    if (segs.length) {
      const size = segs[segs.length - 1].trim().match(EMBED_SIZE_RE);
      if (size) {
        width = size[1];
        height = size[2];
        segs.pop();
      }
    }
    if (segs.length) alt = segs.join("|");
    return { kind: "wiki", path, alt, width, height, raw };
  }

  const md = raw.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (md) {
    const segs = (md[1] || "").split("|");
    let width, height;
    if (segs.length > 1) {
      const size = segs[segs.length - 1].trim().match(EMBED_SIZE_RE);
      if (size) {
        width = size[1];
        height = size[2];
        segs.pop();
      }
    }
    return { kind: "md", path: md[2], alt: segs.join("|"), width, height, raw };
  }

  return { kind: "other", path: "", alt: "", width: undefined, height: undefined, raw };
}

// Rebuild an embed string from parts, emitting Obsidian's native size token.
// `W` when only a width is set (height stays auto, preserving the ratio);
// `WxH` when an explicit independent height is set.
function composeEmbed(parts) {
  const { kind, path, raw } = parts;
  const alt = (parts.alt || "").trim();
  const width = parts.width != null ? String(parts.width).trim() : "";
  const height = parts.height != null ? String(parts.height).trim() : "";
  const size = width ? (height ? `${width}x${height}` : width) : "";

  if (kind === "wiki") {
    const segs = [path];
    if (alt) segs.push(alt);
    if (size) segs.push(size);
    return `![[${segs.join("|")}]]`;
  }

  if (kind === "md") {
    const altField = size ? `${alt}|${size}` : alt;
    return `![${altField}](${path})`;
  }

  return raw;
}

function embedHasSize(markdown) {
  return parseEmbed(markdown).width != null;
}

// --- image-quilt helpers -------------------------------------------------

function mimeFromExt(ext) {
  const e = (ext || "").toLowerCase();
  const map = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    avif: "image/avif",
    heic: "image/heic",
    heif: "image/heif"
  };
  return map[e] || "image/png";
}

// Vault-adapter writeBinary wants an ArrayBuffer; normalise a Uint8Array view.
function toArrayBuffer(u8) {
  if (u8 instanceof ArrayBuffer) return u8;
  if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) return u8.buffer;
  return u8.slice().buffer;
}

// The hidden per-quilt folder under the vault config dir (e.g. `.obsidian`),
// so it never shows in the file explorer.
function quiltDir(app, id) {
  return `${app.vault.configDir}/plugins/tufte-suite/quilts/${id}`;
}

// Normalise the user's quilt-output folder setting to a clean vault-relative
// path (no leading/trailing slashes); empty means the vault root.
function normalizeQuiltFolder(s) {
  return String(s || "").trim().replace(/^\/+|\/+$/g, "");
}

// Create a folder and every missing parent, ignoring "already exists".
async function ensureFolder(adapter, path) {
  const parts = path.split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    try {
      if (!(await adapter.exists(cur))) await adapter.mkdir(cur);
    } catch {}
  }
}

// A figure that embeds `quilt-<id>.png` is a generated quilt; pull the id back
// out so its config sidecar can be located for re-editing.
function quiltIdFromEmbed(embed) {
  const parsed = parseEmbed(embed);
  const path = (parsed.path || "").split("#")[0];
  const m = path.match(/quilt-(\d+)(?:[ _-]\d+)?\.png$/i);
  return m ? m[1] : null;
}

// Pure layout: uniform-height tiles packed edge-to-edge left-to-right, wrapping
// when the next tile would exceed maxWidth. Ragged right edge (transparent in
// the export). Returns total {width,height} and per-tile {x,y,w,h} placements.
function layoutQuilt(tiles, rowHeight, maxWidth) {
  const limit = Math.max(rowHeight, maxWidth || 480);
  const placements = [];
  let x = 0;
  let y = 0;
  let widest = 0;
  for (const tile of tiles) {
    const w = Math.max(1, Math.round(rowHeight * (tile.ratio || 1)));
    if (x > 0 && x + w > limit) {
      y += rowHeight;
      x = 0;
    }
    placements.push({ tile, x, y, w, h: rowHeight });
    x += w;
    if (x > widest) widest = x;
  }
  return {
    width: widest,
    height: placements.length ? y + rowHeight : 0,
    placements
  };
}

// --- markdown builders ---------------------------------------------------

function buildFigureBlock(mode, fields) {
  const { embed, caption, number, labelPrefix } = fields;
  const num = number || "1";
  const parsed = parseEmbed(embed);
  const alt = fields.alt != null ? fields.alt.trim() : parsed.alt;
  const width = fields.width != null ? fields.width : parsed.width;
  const height = fields.height != null ? fields.height : parsed.height;
  const finalEmbed = composeEmbed({ ...parsed, alt, width, height });
  const anchor = `\n\n^fig-${num}`;
  const label = `${labelPrefix || "Fig."} ${num}.`;

  const calloutType =
    mode === "full" ? "figure-full" : mode === "margin" ? "figure-margin" : "figure";
  const cap = caption ? `\n> ${caption}` : "";
  // Callout title is the rendered figure label ("Fig. N.") — same text
  // both in the editor and in reading view.
  return `> [!${calloutType}] ${label}\n> ${finalEmbed}${cap}${anchor}`;
}

// A row of images in one callout (≥2 images). Each entry line is
// `> <embed> (label) caption`; a trailing non-image line is the overall
// caption. Per-image width is precomputed from the shared row height so the
// images render at equal heights with their ratios preserved.
function buildMultiFigureBlock(mode, fields) {
  const { entries, overallCaption, number, labelPrefix } = fields;
  const num = number || "1";
  const label = `${labelPrefix || "Fig."} ${num}.`;
  const calloutType =
    mode === "full" ? "figure-full" : mode === "margin" ? "figure-margin" : "figure";

  const lines = [`> [!${calloutType}] ${label}`];
  for (const entry of entries) {
    const parsed = parseEmbed(entry.embed);
    const width = entry.width != null && entry.width !== "" ? entry.width : parsed.width;
    const embed = composeEmbed({ ...parsed, width, height: "" });
    const lbl = entry.label ? ` (${entry.label})` : "";
    const cap = entry.caption ? ` ${entry.caption}` : "";
    lines.push(`> ${embed}${lbl}${cap}`);
  }
  if (overallCaption && overallCaption.trim()) {
    lines.push(`> ${overallCaption.trim()}`);
  }
  return `${lines.join("\n")}\n\n^fig-${num}`;
}

function insertBlockAtPos(editor, block, pos) {
  const target = pos || editor.getCursor();
  const lineText = editor.getLine(target.line) || "";
  const beforeCursor = lineText.slice(0, target.ch);
  const atCleanLineStart = /^\s*$/.test(beforeCursor);
  const prefix = atCleanLineStart ? "" : "\n";
  editor.replaceRange(`${prefix}${block}\n`, target);
  editor.focus?.();
}

const EDITABLE_FIGURE_TYPES = new Set(["figure", "figure-full", "figure-margin"]);

// Locate the figure block enclosing the cursor (the cursor may sit on a
// blockquote line, the trailing `^fig-N` anchor, or a blank line between
// them). Returns the inclusive line range and its lines, or null.
function findFigureAtCursor(editor) {
  const total = editor.lineCount();
  const cur = editor.getCursor().line;
  const isQuote = (i) => i >= 0 && i < total && /^\s*>/.test(editor.getLine(i) || "");
  const isBlank = (i) => /^\s*$/.test(editor.getLine(i) || "");

  let calloutLine = -1;
  if (isQuote(cur)) {
    calloutLine = cur;
  } else {
    let i = cur;
    while (i >= 0 && (isBlank(i) || ANCHOR_LINE_RE.test(editor.getLine(i) || ""))) i--;
    if (isQuote(i)) calloutLine = i;
  }
  if (calloutLine < 0) return null;

  let start = calloutLine;
  while (start > 0 && isQuote(start - 1)) start--;
  let end = calloutLine;
  while (end < total - 1 && isQuote(end + 1)) end++;

  const header = (editor.getLine(start) || "").match(CALLOUT_HEADER_RE);
  if (!header) return null;
  const type = (header[2] || "").toLowerCase();
  if (!EDITABLE_FIGURE_TYPES.has(type)) return null;

  let blockEnd = end;
  let j = end + 1;
  while (j < total && isBlank(j)) j++;
  if (j < total && ANCHOR_LINE_RE.test(editor.getLine(j) || "")) blockEnd = j;

  const lines = [];
  for (let k = start; k <= blockEnd; k++) lines.push(editor.getLine(k) || "");
  return { start, end: blockEnd, type, lines };
}

// Parse a figure block's lines into modal-ready state: mode, number, the
// image entries (embed + optional label/caption) and the overall caption.
function parseFigureBlock(lines) {
  let type = "figure";
  let number = "";
  let started = false;
  const images = [];
  const textLines = [];

  for (const line of lines) {
    const header = line.match(CALLOUT_HEADER_RE);
    if (header && !started) {
      type = (header[2] || "").toLowerCase();
      const title = (header[3] || "").trim();
      const nm = title.match(/(\d+)/);
      if (nm) number = nm[1];
      started = true;
      continue;
    }
    if (!started) continue;
    const anchor = line.match(ANCHOR_LINE_RE);
    if (anchor) {
      number = anchor[1];
      break;
    }
    const quote = line.match(BLOCKQUOTE_LINE_RE);
    if (!quote) continue;
    const body = (quote[1] || "").trim();
    if (!body) continue;
    const lead = body.match(IMAGE_LEAD_RE);
    if (lead) {
      let label = "";
      let caption = (lead[2] || "").trim();
      const labelled = caption.match(ENTRY_LABEL_RE);
      if (labelled) {
        label = labelled[1].trim();
        caption = (labelled[2] || "").trim();
      }
      caption = caption.replace(CAPTION_MARKER_RE, "").trim();
      images.push({ embed: lead[1], label, caption });
    } else {
      textLines.push(body.replace(CAPTION_MARKER_RE, ""));
    }
  }

  const mode =
    type === "figure-full" ? "full" : type === "figure-margin" ? "margin" : "default";
  return { mode, number, images, overall: textLines.join("\n").trim() };
}

// --- numbering -----------------------------------------------------------

function nextFigureNumber(source) {
  const re = /\^fig-(\d+)\b/g;
  let max = 0;
  let m;
  while ((m = re.exec(source))) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

function figureAnchorNumbers(source) {
  const nums = [];
  const seen = new Set();
  const re = /^\s*\^fig-(\d+)\s*$/gm;
  let m;
  while ((m = re.exec(source))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    nums.push(m[1]);
  }
  return nums;
}

function selectedOrNearbyFigureNumber(editor) {
  try {
    const selection = editor.getSelection?.() || "";
    const selected = selection.match(/\b(?:fig\.?|figure|\^fig-)?\s*(\d+)\b/i);
    if (selected) return selected[1];
  } catch {}

  try {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line) || "";
    const before = line.slice(0, cursor.ch);
    const after = line.slice(cursor.ch);
    const nearby = `${before.slice(-40)}${after.slice(0, 40)}`;
    const match =
      nearby.match(/\^fig-(\d+)\b/i) ||
      nearby.match(/\b(?:fig\.?|figure)\s+(\d+)\b/i);
    if (match) return match[1];
  } catch {}

  return "";
}

function defaultFigureReferenceNumber(editor) {
  const nearby = selectedOrNearbyFigureNumber(editor);
  if (nearby) return nearby;
  const nums = figureAnchorNumbers(editor.getValue());
  return nums.length ? nums[nums.length - 1] : "1";
}

function figureReferenceText(number) {
  const n = String(number || "N").trim() || "N";
  return `[[#^fig-${n}|(Fig. ${n})]]`;
}

function insertInlineText(editor, text) {
  if (typeof editor.replaceSelection === "function") {
    editor.replaceSelection(text);
    return;
  }
  editor.replaceRange(text, editor.getCursor());
}

function renumberAllFigures(editor) {
  const lines = editor.getValue().split("\n");

  // 1. Locate figure units: a figure/figure-full/figure-margin/marginnote
  //    callout whose block is immediately followed (after optional blank
  //    lines) by a `^fig-OLD` anchor line.
  const units = [];
  for (let i = 0; i < lines.length; i++) {
    const anchorMatch = lines[i].match(ANCHOR_LINE_RE);
    if (!anchorMatch) continue;

    // Walk back over blank lines to the preceding block's last line.
    let j = i - 1;
    while (j >= 0 && /^\s*$/.test(lines[j])) j--;
    if (j < 0) continue;

    // The preceding block must be a blockquote (callout). Walk up to its top.
    if (!/^\s*>/.test(lines[j])) continue;
    let k = j;
    while (k >= 0 && /^\s*>/.test(lines[k])) k--;
    const calloutStart = k + 1;

    const header = lines[calloutStart].match(CALLOUT_HEADER_RE);
    if (!header) continue;
    const type = header[2].toLowerCase();
    if (!FIGURE_CALLOUT_TYPES.has(type)) continue;

    units.push({
      old: anchorMatch[1],
      anchorLine: i,
      type,
      calloutStart,
      calloutEnd: j
    });
  }

  if (!units.length) return 0;

  // 2. Sequential numbering in document order.
  const map = new Map();
  units.forEach((u, idx) => map.set(u.old, String(idx + 1)));

  // 3. Per-unit rewrites: anchor line, callout title (modes 1, 2, and new
  //    margin figures — supports legacy bare-number "1" and "Fig. 1.")
  //    or the literal "Fig. N." in legacy marginnote captions.
  for (const u of units) {
    const neu = map.get(u.old);

    lines[u.anchorLine] = lines[u.anchorLine].replace(
      /\^fig-\d+/,
      `^fig-${neu}`
    );

    if (
      u.type === "figure" ||
      u.type === "figure-full" ||
      u.type === "figure-margin"
    ) {
      lines[u.calloutStart] = lines[u.calloutStart].replace(
        /^(\s*>\s*\[![a-z-]+\][+-]?\s+)(.*)$/i,
        (full, head, tail) => {
          const t = tail.trim();
          if (/^(Fig\.?|Figure)\s+\d+\.?$/i.test(t)) {
            // "Fig. 5" / "Fig. 5." / "Figure 5" — rewrite to "Fig. NEW."
            return `${head}Fig. ${neu}.`;
          }
          if (/^\d+$/.test(t)) {
            // Legacy bare-number title — upgrade to "Fig. NEW."
            return `${head}Fig. ${neu}.`;
          }
          // Unrecognized title form — replace any digit run after Fig./Figure
          // if present, else leave untouched.
          const tNew = t.replace(/(Fig\.?|Figure)\s+\d+(\.?)/i, (m, p, dot) => `${p} ${neu}${dot || "."}`);
          return `${head}${tNew}`;
        }
      );
    } else {
      const oldNumRe = new RegExp(`(Figure|Fig\\.?)\\s+${u.old}\\b`, "g");
      for (let li = u.calloutStart; li <= u.calloutEnd; li++) {
        lines[li] = lines[li].replace(oldNumRe, (mm, label) => `${label} ${neu}`);
      }
    }
  }

  // 4. Rewrite every reference `[[#^fig-OLD|…]]` / `[[#^fig-OLD]]` using the
  //    map to the canonical `[[#^fig-NEW|(Fig. NEW)]]` form. A single
  //    left-to-right pass reads OLD from the match, so there is no chained
  //    re-mapping even though OLD and NEW number spaces overlap. Legacy
  //    aliases (bare number) are upgraded in the process.
  let body = lines.join("\n");
  body = body.replace(/\[\[#\^fig-(\d+)(?:\|[^\]]*)?\]\]/g, (full, old) => {
    const neu = map.get(old);
    return neu ? `[[#^fig-${neu}|(Fig. ${neu})]]` : full;
  });

  const cursor = editor.getCursor();
  editor.setValue(body);
  try {
    const lineCount = editor.lineCount();
    editor.setCursor({ line: Math.min(cursor.line, lineCount - 1), ch: 0 });
  } catch {}

  return units.length;
}

// --- DOM decoration ------------------------------------------------------
//
// The postprocessor runs in both reading view and the editor's live-preview
// embedded callouts. Each helper is idempotent: it marks the callout with
// `data-tufte-figure-decorated="1"` so subsequent passes are no-ops.
//
// `findFigureParas` returns the rendered image-bearing paragraph and caption
// paragraph inside a callout content element. It tolerates the `<p>` ->
// `<.el-p>` -> `<p>` wrappers Obsidian sometimes emits inside callouts; an
// explicit `[!caption]` marker wins, with legacy non-image paragraphs as a
// fallback.

function matchingElements(root, selector) {
  const matches = [];
  if (root.matches?.(selector)) matches.push(root);
  root.querySelectorAll?.(selector).forEach((el) => matches.push(el));
  return matches;
}

function innerParaForHolder(holder) {
  if (!holder) return null;
  if (holder.tagName === "P") return holder;
  return (
    holder.querySelector(":scope > p") ||
    holder.querySelector(":scope > .el-p > p") ||
    holder
  );
}

function holderHasImage(holder) {
  return (
    holder.matches?.(".internal-embed, .image-embed, img") ||
    holder.querySelector(".internal-embed, .image-embed, img") != null
  );
}

function holderHasCaptionMarker(holder) {
  return CAPTION_MARKER_RE.test(holder.textContent || "");
}

function stripCaptionMarker(holder) {
  const match = (holder.textContent || "").match(CAPTION_MARKER_RE);
  if (!match) return false;

  let remaining = match[0].length;
  const walker = (holder.ownerDocument || document).createTreeWalker(
    holder,
    NodeFilter.SHOW_TEXT,
    null
  );
  let node;
  while (remaining > 0 && (node = walker.nextNode())) {
    if (!node.nodeValue) continue;
    const cut = Math.min(remaining, node.nodeValue.length);
    node.nodeValue = node.nodeValue.slice(cut);
    remaining -= cut;
  }
  return true;
}

function findFigureParas(content) {
  const direct = Array.from(content.children);
  const imageHolders = [];
  const explicitCaptionHolders = [];
  const captionHolders = [];
  for (const child of direct) {
    if (child.tagName !== "P" && !child.classList?.contains("el-p")) continue;
    const hasCaptionMarker = holderHasCaptionMarker(child);
    const hasImage = holderHasImage(child);
    if (hasCaptionMarker) explicitCaptionHolders.push(child);
    if (hasImage) imageHolders.push(child);
    else if (!hasCaptionMarker) captionHolders.push(child);
  }
  const captions = explicitCaptionHolders.length
    ? explicitCaptionHolders
    : captionHolders;
  const captionHolder = captions[0] || null;
  const captionPara = innerParaForHolder(captionHolder);
  const imageHolder = imageHolders[0] || null;
  const imagePara = innerParaForHolder(imageHolder);
  if (explicitCaptionHolders.length && captionPara) {
    stripCaptionMarker(captionPara);
  }
  return { imageHolder, captionHolder, captionPara, imagePara };
}

function directFigureBlocks(content) {
  return Array.from(content.children).filter((child) => {
    if (
      child.classList?.contains("tufte-fig-image-holder") ||
      child.classList?.contains("tufte-fig-caption-holder")
    ) {
      return false;
    }
    return (
      child.tagName === "P" ||
      child.classList?.contains("el-p") ||
      holderHasImage(child) ||
      (child.textContent || "").trim().length > 0
    );
  });
}

function findDefaultFigureParts(content) {
  const blocks = directFigureBlocks(content);
  const explicitCaptionBlock =
    blocks.find((block) => holderHasCaptionMarker(block)) || null;
  const imageBlock =
    blocks.find((block) => holderHasImage(block)) ||
    blocks.find((block) => block !== explicitCaptionBlock) ||
    null;

  let captionBlock = explicitCaptionBlock;
  if (!captionBlock) {
    const imageIndex = imageBlock ? blocks.indexOf(imageBlock) : -1;
    captionBlock =
      blocks.find((block, idx) => {
        if (block === imageBlock) return false;
        if (holderHasImage(block)) return false;
        if (imageIndex >= 0 && idx < imageIndex) return false;
        return (block.textContent || "").trim().length > 0;
      }) || null;
  }

  if (!captionBlock) {
    captionBlock =
      blocks.find((block) => block !== imageBlock && !holderHasImage(block)) ||
      null;
  }

  if (captionBlock) stripCaptionMarker(captionBlock);

  return { imageBlock, captionBlock };
}

// Last-resort caption recovery for the single-figure decorators. In PDF
// export `getSectionInfo` returns nothing AND the common authoring pattern
//   > ![[image.png]]
//   > A caption line.
// renders as ONE <p> (image + <br> + text), so `findDefaultFigureParts`
// sees only an image block: the caption text is trapped inside it and
// would be destroyed with `emptyElement(content)`. Rebuild the callout's
// source-style lines from the rendered DOM (the multi-image path's proven
// export-safe device), drop image leads and anchors, and hand back the
// remaining text as caption markdown to re-render.
function recoverCaptionMarkdownFromDom(content) {
  const lines = [];
  for (const line of reconstructFigureLines(content)) {
    if (ANCHOR_LINE_RE.test(line)) continue;
    const lead = line.match(IMAGE_LEAD_RE);
    const text = (lead ? lead[2] || "" : line).replace(CAPTION_MARKER_RE, "").trim();
    if (text) lines.push(text);
  }
  return lines.join("\n");
}

function getSectionInfo(ctx, el, fallbackEl) {
  try {
    return (
      ctx?.getSectionInfo?.(el) ||
      (fallbackEl && fallbackEl !== el ? ctx?.getSectionInfo?.(fallbackEl) : null) ||
      null
    );
  } catch {
    return null;
  }
}

function extractFigureMarkdown(ctx, callout, fallbackEl, calloutType) {
  const sectionInfo = getSectionInfo(ctx, callout, fallbackEl);
  const source = sectionInfo?.text || "";
  if (!source) return { imageMarkdown: "", captionMarkdown: "" };

  // Scope parsing to THIS callout's lines. `getSectionInfo` returns the whole
  // file text plus the rendered element's line range; without slicing we'd
  // always match the first callout of this type in the file, so every
  // same-mode figure would render the first figure's image and caption.
  const allLines = source.split(/\r?\n/);
  const start = Number.isInteger(sectionInfo.lineStart) ? sectionInfo.lineStart : 0;
  const end = Number.isInteger(sectionInfo.lineEnd)
    ? sectionInfo.lineEnd
    : allLines.length - 1;
  const lines = allLines.slice(start, end + 1);
  let inFigure = false;
  let sawImage = false;
  let collectingCaption = false;
  let imageMarkdown = "";
  const captionLines = [];

  for (const line of lines) {
    const header = line.match(CALLOUT_HEADER_RE);
    if (header) {
      const type = (header[2] || "").toLowerCase();
      if (!inFigure && type === calloutType) {
        inFigure = true;
        continue;
      }
      if (inFigure && collectingCaption) break;
    }

    if (!inFigure) continue;
    if (ANCHOR_LINE_RE.test(line)) break;

    const quote = line.match(BLOCKQUOTE_LINE_RE);
    if (!quote) {
      if (collectingCaption) break;
      continue;
    }

    let body = quote[1] || "";
    if (!sawImage) {
      if (IMAGE_MARKDOWN_RE.test(body.trim())) {
        imageMarkdown = body.trim();
        sawImage = true;
      }
      continue;
    }

    if (ANCHOR_LINE_RE.test(body)) break;
    if (!collectingCaption && !body.trim()) continue;
    if (!collectingCaption && IMAGE_MARKDOWN_RE.test(body.trim())) continue;

    body = body.replace(CAPTION_MARKER_RE, "");
    if (!collectingCaption && !body.trim()) continue;
    collectingCaption = true;
    captionLines.push(body);
  }

  return {
    imageMarkdown,
    captionMarkdown: captionLines.join("\n").trim()
  };
}

function extractDefaultFigureMarkdown(ctx, callout, fallbackEl) {
  return extractFigureMarkdown(ctx, callout, fallbackEl, "figure");
}

function extractFullFigureMarkdown(ctx, callout, fallbackEl) {
  return extractFigureMarkdown(ctx, callout, fallbackEl, "figure-full");
}

function extractMarginFigureMarkdown(ctx, callout, fallbackEl) {
  return extractFigureMarkdown(ctx, callout, fallbackEl, "figure-margin");
}

// Parse a figure callout as a multi-image row. Returns every image entry
// (with its `(label)` and individual caption) plus the trailing overall
// caption. `isMulti` is true only when 2+ images are present, so single
// figures fall through to the existing single-image decoration path.
function extractMultiFigure(ctx, callout, fallbackEl, calloutType) {
  const sectionInfo = getSectionInfo(ctx, callout, fallbackEl);
  const source = sectionInfo?.text || "";
  if (!source) return { entries: [], overallCaption: "", isMulti: false };

  const allLines = source.split(/\r?\n/);
  const start = Number.isInteger(sectionInfo.lineStart) ? sectionInfo.lineStart : 0;
  const end = Number.isInteger(sectionInfo.lineEnd)
    ? sectionInfo.lineEnd
    : allLines.length - 1;
  const lines = allLines.slice(start, end + 1);

  let inFigure = false;
  const entries = [];
  const overallLines = [];
  for (const line of lines) {
    const header = line.match(CALLOUT_HEADER_RE);
    if (header) {
      const type = (header[2] || "").toLowerCase();
      if (!inFigure && type === calloutType) {
        inFigure = true;
        continue;
      }
      if (inFigure) break; // a different callout begins — stop
    }
    if (!inFigure) continue;
    if (ANCHOR_LINE_RE.test(line)) break;

    const quote = line.match(BLOCKQUOTE_LINE_RE);
    if (!quote) continue;
    const body = (quote[1] || "").trim();
    if (!body || ANCHOR_LINE_RE.test(body)) continue;

    const lead = body.match(IMAGE_LEAD_RE);
    if (lead) {
      const imageMarkdown = lead[1];
      let label = "";
      let caption = (lead[2] || "").trim();
      const labelled = caption.match(ENTRY_LABEL_RE);
      if (labelled) {
        label = labelled[1].trim();
        caption = (labelled[2] || "").trim();
      }
      caption = caption.replace(CAPTION_MARKER_RE, "").trim();
      entries.push({ imageMarkdown, label, caption });
    } else {
      overallLines.push(body.replace(CAPTION_MARKER_RE, ""));
    }
  }

  return {
    entries,
    overallCaption: overallLines.join("\n").trim(),
    isMulti: entries.length >= 2
  };
}

// Rebuild the figure's source-style lines from already-rendered DOM. Obsidian
// merges the consecutive blockquote lines of a callout into a single <p> with
// <br> separators, so we split on <br> and block boundaries to recover one
// string per original line. Image embeds become `![[src|width]]` so they can
// be re-rendered cleanly (moving the live nodes fails — in Live Preview they
// are often unhydrated placeholders that never load once relocated).
function reconstructFigureLines(content) {
  const lines = [];
  let current = "";
  const flush = () => {
    lines.push(current);
    current = "";
  };
  const walk = (node) => {
    for (const child of node.childNodes || []) {
      if (child.nodeType === 3) {
        current += child.nodeValue || "";
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (tag === "BR") {
        flush();
      } else if (tag === "IMG" || child.matches?.(".internal-embed, .image-embed")) {
        const src = child.getAttribute?.("src") || child.getAttribute?.("alt") || "";
        const width = child.getAttribute?.("width") || "";
        if (src) current += width ? `![[${src}|${width}]]` : `![[${src}]]`;
      } else if (tag === "P" || tag === "DIV") {
        if (current.trim()) flush();
        walk(child);
        if (current.trim()) flush();
      } else {
        walk(child);
      }
    }
  };
  walk(content);
  if (current.trim()) flush();
  return lines.map((l) => l.trim()).filter((l) => l.length);
}

// Fallback for when the section source is unavailable (notably Live Preview,
// where getSectionInfo returns nothing). Reconstructs the figure's lines from
// the rendered DOM and parses them exactly like the source path, so entries
// carry `imageMarkdown` (re-rendered, not moved) and each image keeps its own
// caption.
function extractMultiFromDom(content) {
  if (!content) return { entries: [], overallCaption: "", isMulti: false };

  const lines = reconstructFigureLines(content);
  const entries = [];
  const overallLines = [];
  for (const line of lines) {
    if (ANCHOR_LINE_RE.test(line)) continue;
    const lead = line.match(IMAGE_LEAD_RE);
    if (lead) {
      let label = "";
      let caption = (lead[2] || "").trim();
      const labelled = caption.match(ENTRY_LABEL_RE);
      if (labelled) {
        label = labelled[1].trim();
        caption = (labelled[2] || "").trim();
      }
      caption = caption.replace(CAPTION_MARKER_RE, "").trim();
      entries.push({ imageMarkdown: lead[1], label, caption });
    } else {
      overallLines.push(line.replace(CAPTION_MARKER_RE, "").trim());
    }
  }

  return {
    entries,
    overallCaption: overallLines.join("\n").trim(),
    isMulti: entries.length >= 2
  };
}

function closestWithin(el, selector, boundary) {
  let current = el;
  let found = null;
  while (current && current !== boundary) {
    if (current.matches?.(selector)) found = current;
    current = current.parentElement;
  }
  if (boundary?.matches?.(selector)) found = boundary;
  return found;
}

function imageVisualForBlock(imageBlock) {
  if (!imageBlock) return null;
  const imageNode = imageBlock.matches?.(".internal-embed, .image-embed, img")
    ? imageBlock
    : imageBlock.querySelector(".internal-embed, .image-embed, img");
  if (!imageNode) return null;
  if (imageNode.matches?.("img")) {
    return closestWithin(imageNode, ".internal-embed, .image-embed", imageBlock) || imageNode;
  }
  return imageNode;
}

function moveImageVisualIntoHolder(imageHolder, imageBlock, doc) {
  const visual = imageVisualForBlock(imageBlock);
  if (!visual) {
    if (imageBlock) imageHolder.appendChild(imageBlock);
    return;
  }

  const shell = doc.createElement("div");
  shell.className = "tufte-fig-image-block";
  shell.appendChild(visual);
  imageHolder.appendChild(shell);
}

function emptyElement(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

async function renderMarkdown(app, markdown, el, sourcePath, component) {
  if (MarkdownRenderer.render) {
    await MarkdownRenderer.render(app, markdown || " ", el, sourcePath, component);
    return;
  }
  await MarkdownRenderer.renderMarkdown(markdown || " ", el, sourcePath, component);
}

function prependFigureLabel(holder, titleText) {
  if (!holder || !titleText) return false;
  const captionPara = innerParaForHolder(holder);
  if (!captionPara) return false;
  const existing = captionPara.querySelector(
    ":scope > .tufte-fig-label:first-child"
  );
  if (existing) return true;

  const label = (captionPara.ownerDocument || document).createElement("span");
  label.className = "tufte-fig-label";
  const labelText = /\.$/.test(titleText) ? titleText : `${titleText}.`;
  label.textContent = `${labelText} `;
  captionPara.insertBefore(label, captionPara.firstChild);
  return true;
}

// Insert a verbatim red-italic label (e.g. "(a)") at the start of a holder's
// caption paragraph. Unlike prependFigureLabel it adds no trailing period.
function insertLabelSpan(holder, labelText) {
  if (!holder || !labelText) return false;
  const para = innerParaForHolder(holder);
  const target = para || holder;
  const existing = target.querySelector?.(":scope > .tufte-fig-label:first-child");
  if (existing) return true;
  const span = (target.ownerDocument || document).createElement("span");
  span.className = "tufte-fig-label";
  span.textContent = `${labelText} `;
  target.insertBefore(span, target.firstChild);
  return true;
}

// Render a caption holder: the caption markdown, optionally prefixed with a
// label. `figureLabel` (e.g. "Fig. 4.") gets a trailing period; an entry
// label (e.g. "(a)") is inserted verbatim.
async function buildMultiCaption(app, doc, sourcePath, component, className, labelText, captionMarkdown, isFigureLabel) {
  const holder = doc.createElement("div");
  holder.className = className;
  await renderMarkdown(app, captionMarkdown || " ", holder, sourcePath, component);
  if (labelText) {
    if (isFigureLabel) prependFigureLabel(holder, labelText);
    else insertLabelSpan(holder, labelText);
  }
  return holder;
}

// Build the canonical multi-image DOM. Modes differ only in where captions
// sit: mode 1 (figure) lists all captions in the margin column; modes 2/3
// (figure-full / figure-margin) place each caption under its image and the
// overall caption after the row.
async function renderMultiFigure(callout, content, ctx, app, component, calloutType, data) {
  const doc = callout.ownerDocument || document;
  const sourcePath =
    ctx?.sourcePath || app?.workspace?.getActiveFile?.()?.path || "";
  const titleEl = callout.querySelector(".callout-title");
  const titleInner = callout.querySelector(".callout-title-inner");
  const titleText = (titleInner?.textContent || titleEl?.textContent || "").trim();
  const perCellCaption = calloutType !== "figure";

  const imageHolder = doc.createElement("div");
  imageHolder.className = "tufte-fig-image-holder";
  const row = doc.createElement("div");
  row.className = "tufte-fig-row";
  imageHolder.appendChild(row);

  for (const entry of data.entries) {
    const cell = doc.createElement("div");
    cell.className = "tufte-fig-cell";
    const imgWrap = doc.createElement("div");
    imgWrap.className = "tufte-fig-cell-image";
    if (entry.imageNode) {
      const shell = doc.createElement("div");
      shell.className = "tufte-fig-image-block";
      shell.appendChild(entry.imageNode);
      imgWrap.appendChild(shell);
    } else {
      await renderMarkdown(app, entry.imageMarkdown, imgWrap, sourcePath, component);
    }
    cell.appendChild(imgWrap);
    if (perCellCaption && (entry.label || entry.caption)) {
      cell.appendChild(
        await buildMultiCaption(
          app, doc, sourcePath, component,
          "tufte-fig-cell-caption",
          entry.label ? `(${entry.label})` : "",
          entry.caption, false
        )
      );
    }
    row.appendChild(cell);
  }

  const captionHolder = doc.createElement("div");
  captionHolder.className = "tufte-fig-caption-holder";

  if (!perCellCaption) {
    // Mode 1: every individual caption lives in the margin column.
    const list = doc.createElement("div");
    list.className = "tufte-fig-caption-list";
    for (const entry of data.entries) {
      if (!entry.label && !entry.caption) continue;
      list.appendChild(
        await buildMultiCaption(
          app, doc, sourcePath, component,
          "tufte-fig-caption-item",
          entry.label ? `(${entry.label})` : "",
          entry.caption, false
        )
      );
    }
    if (list.childElementCount) captionHolder.appendChild(list);
  }

  if (data.overallCaption || titleText) {
    captionHolder.appendChild(
      await buildMultiCaption(
        app, doc, sourcePath, component,
        "tufte-fig-overall-caption",
        titleText, data.overallCaption, true
      )
    );
    if (titleText) titleEl?.classList.add("tufte-figure-title-hidden");
  }

  emptyElement(content);
  content.appendChild(imageHolder);
  content.appendChild(captionHolder);

  callout.classList.add("tufte-fig-multi");
  callout.classList.add("tufte-fig-sized"); // entries carry native widths
  callout.dataset.tufteFigureDecorated = "1";
}

async function decorateDefaultFigure(callout, ctx, app, component, sectionEl) {
  if (
    callout.dataset.tufteFigureDecorated === "1" ||
    callout.dataset.tufteFigureDecorated === "pending"
  ) {
    return;
  }
  callout.dataset.tufteFigureDecorated = "pending";

  try {
    const titleEl = callout.querySelector(".callout-title");
    const titleInner = callout.querySelector(".callout-title-inner");
    const titleText = (titleInner?.textContent || titleEl?.textContent || "").trim();

    const content = callout.querySelector(".callout-content");
    if (!content) {
      callout.dataset.tufteFigureDecorated = "1";
      return;
    }

    let multi = extractMultiFigure(ctx, callout, sectionEl, "figure");
    if (!multi.isMulti) {
      const dom = extractMultiFromDom(content);
      if (dom.isMulti) multi = dom;
    }
    if (multi.isMulti) {
      await renderMultiFigure(callout, content, ctx, app, component, "figure", multi);
      return;
    }

    const { imageMarkdown, captionMarkdown } = extractDefaultFigureMarkdown(
      ctx,
      callout,
      sectionEl
    );
    callout.classList.toggle("tufte-fig-sized", embedHasSize(imageMarkdown));
    const { imageBlock, captionBlock } = findDefaultFigureParts(content);
    const doc = callout.ownerDocument || document;
    const imageHolder = doc.createElement("div");
    imageHolder.className = "tufte-fig-image-holder";
    const captionHolder = doc.createElement("div");
    captionHolder.className = "tufte-fig-caption-holder";

    if (imageMarkdown) {
      await renderMarkdown(app, imageMarkdown, imageHolder, ctx?.sourcePath || "", component);
    } else {
      moveImageVisualIntoHolder(imageHolder, imageBlock, doc);
    }

    if (captionMarkdown) {
      await renderMarkdown(app, captionMarkdown, captionHolder, ctx?.sourcePath || "", component);
    } else if (captionBlock && captionBlock !== imageBlock) {
      captionHolder.appendChild(captionBlock);
    } else {
      // PDF export path: no section source and no separate caption block —
      // the `> ![[img]]` + `> caption` authoring renders as ONE <p>, so the
      // caption is trapped in the image block. The embed visual has already
      // been moved to the image holder above, so when the holder really
      // holds a visual and the block still carries text, that text IS the
      // caption, inline markup intact — adopt it. Odder shapes fall back
      // to re-rendering lines reconstructed from the DOM
      // (recoverCaptionMarkdownFromDom). Both stages are gated on a real
      // image being present: an imageless figure callout keeps its legacy
      // shape (prose in the main column, empty caption) instead of having
      // its prose migrate into the caption column.
      const holderVisual = imageHolder.querySelector(".internal-embed, .image-embed, img");
      if (!imageMarkdown && imageBlock && holderVisual && (imageBlock.textContent || "").trim()) {
        stripCaptionMarker(imageBlock);
        while (
          imageBlock.firstChild &&
          ((imageBlock.firstChild.nodeType === 3 &&
            !(imageBlock.firstChild.nodeValue || "").trim()) ||
            imageBlock.firstChild.tagName === "BR")
        ) {
          imageBlock.removeChild(imageBlock.firstChild);
        }
        captionHolder.appendChild(imageBlock);
      } else {
        const recovered =
          imageMarkdown || holderVisual ? recoverCaptionMarkdownFromDom(content) : "";
        if (recovered) {
          await renderMarkdown(app, recovered, captionHolder, ctx?.sourcePath || "", component);
        } else {
          const synthetic = doc.createElement("p");
          captionHolder.appendChild(synthetic);
        }
      }
    }

    const labelInserted = prependFigureLabel(captionHolder, titleText);
    if (labelInserted) titleEl?.classList.add("tufte-figure-title-hidden");

    emptyElement(content);
    content.appendChild(imageHolder);
    content.appendChild(captionHolder);

    callout.dataset.tufteFigureDecorated = "1";
  } catch (err) {
    console.error("Tufte Figures: failed to decorate default figure", err);
    delete callout.dataset.tufteFigureDecorated;
  }
}

async function decorateFullFigure(callout, ctx, app, component, sectionEl) {
  if (
    callout.dataset.tufteFigureDecorated === "1" ||
    callout.dataset.tufteFigureDecorated === "pending"
  ) {
    return;
  }
  callout.dataset.tufteFigureDecorated = "pending";

  try {
    const titleEl = callout.querySelector(".callout-title");
    const titleInner = callout.querySelector(".callout-title-inner");
    const titleText = (titleInner?.textContent || titleEl?.textContent || "").trim();
    const content = callout.querySelector(".callout-content");
    if (!content) {
      callout.dataset.tufteFigureDecorated = "1";
      return;
    }

    let multi = extractMultiFigure(ctx, callout, sectionEl, "figure-full");
    if (!multi.isMulti) {
      const dom = extractMultiFromDom(content);
      if (dom.isMulti) multi = dom;
    }
    if (multi.isMulti) {
      await renderMultiFigure(callout, content, ctx, app, component, "figure-full", multi);
      return;
    }

    const { imageMarkdown, captionMarkdown } = extractFullFigureMarkdown(
      ctx,
      callout,
      sectionEl
    );
    callout.classList.toggle("tufte-fig-sized", embedHasSize(imageMarkdown));
    const { imageBlock, captionBlock } = findDefaultFigureParts(content);
    const doc = callout.ownerDocument || document;
    const imageHolder = doc.createElement("div");
    imageHolder.className = "tufte-fig-image-holder";
    const captionHolder = doc.createElement("div");
    captionHolder.className = "tufte-fig-caption-holder";

    if (imageMarkdown) {
      await renderMarkdown(app, imageMarkdown, imageHolder, ctx?.sourcePath || "", component);
    } else {
      moveImageVisualIntoHolder(imageHolder, imageBlock, doc);
    }

    if (captionMarkdown) {
      await renderMarkdown(app, captionMarkdown, captionHolder, ctx?.sourcePath || "", component);
    } else if (captionBlock && captionBlock !== imageBlock) {
      captionHolder.appendChild(captionBlock);
    } else {
      // PDF export path: no section source and no separate caption block —
      // the `> ![[img]]` + `> caption` authoring renders as ONE <p>, so the
      // caption is trapped in the image block. The embed visual has already
      // been moved to the image holder above, so when the holder really
      // holds a visual and the block still carries text, that text IS the
      // caption, inline markup intact — adopt it. Odder shapes fall back
      // to re-rendering lines reconstructed from the DOM
      // (recoverCaptionMarkdownFromDom). Both stages are gated on a real
      // image being present: an imageless figure callout keeps its legacy
      // shape (prose in the main column, empty caption) instead of having
      // its prose migrate into the caption column.
      const holderVisual = imageHolder.querySelector(".internal-embed, .image-embed, img");
      if (!imageMarkdown && imageBlock && holderVisual && (imageBlock.textContent || "").trim()) {
        stripCaptionMarker(imageBlock);
        while (
          imageBlock.firstChild &&
          ((imageBlock.firstChild.nodeType === 3 &&
            !(imageBlock.firstChild.nodeValue || "").trim()) ||
            imageBlock.firstChild.tagName === "BR")
        ) {
          imageBlock.removeChild(imageBlock.firstChild);
        }
        captionHolder.appendChild(imageBlock);
      } else {
        const recovered =
          imageMarkdown || holderVisual ? recoverCaptionMarkdownFromDom(content) : "";
        if (recovered) {
          await renderMarkdown(app, recovered, captionHolder, ctx?.sourcePath || "", component);
        } else {
          const synthetic = doc.createElement("p");
          captionHolder.appendChild(synthetic);
        }
      }
    }

    const labelInserted = prependFigureLabel(captionHolder, titleText);
    if (labelInserted) titleEl?.classList.add("tufte-figure-title-hidden");

    emptyElement(content);
    content.appendChild(imageHolder);
    content.appendChild(captionHolder);

    callout.dataset.tufteFigureDecorated = "1";
  } catch (err) {
    console.error("Tufte Figures: failed to decorate full-width figure", err);
    delete callout.dataset.tufteFigureDecorated;
  }
}

async function decorateMarginFigure(callout, ctx, app, component, sectionEl) {
  if (
    callout.dataset.tufteFigureDecorated === "1" ||
    callout.dataset.tufteFigureDecorated === "pending"
  ) {
    return;
  }
  callout.dataset.tufteFigureDecorated = "pending";

  try {
    const titleEl = callout.querySelector(".callout-title");
    const titleInner = callout.querySelector(".callout-title-inner");
    const titleText = (titleInner?.textContent || titleEl?.textContent || "").trim();
    const content = callout.querySelector(".callout-content");
    if (!content) {
      callout.dataset.tufteFigureDecorated = "1";
      return;
    }

    let multi = extractMultiFigure(ctx, callout, sectionEl, "figure-margin");
    if (!multi.isMulti) {
      const dom = extractMultiFromDom(content);
      if (dom.isMulti) multi = dom;
    }
    if (multi.isMulti) {
      await renderMultiFigure(callout, content, ctx, app, component, "figure-margin", multi);
      return;
    }

    const { imageMarkdown, captionMarkdown } = extractMarginFigureMarkdown(
      ctx,
      callout,
      sectionEl
    );
    callout.classList.toggle("tufte-fig-sized", embedHasSize(imageMarkdown));
    const { imageBlock, captionBlock } = findDefaultFigureParts(content);
    const doc = callout.ownerDocument || document;
    const imageHolder = doc.createElement("div");
    imageHolder.className = "tufte-fig-image-holder";
    const captionHolder = doc.createElement("div");
    captionHolder.className = "tufte-fig-caption-holder";

    if (imageMarkdown) {
      await renderMarkdown(app, imageMarkdown, imageHolder, ctx?.sourcePath || "", component);
    } else {
      moveImageVisualIntoHolder(imageHolder, imageBlock, doc);
    }

    if (captionMarkdown) {
      await renderMarkdown(app, captionMarkdown, captionHolder, ctx?.sourcePath || "", component);
    } else if (captionBlock && captionBlock !== imageBlock) {
      captionHolder.appendChild(captionBlock);
    } else {
      // PDF export path: no section source and no separate caption block —
      // the `> ![[img]]` + `> caption` authoring renders as ONE <p>, so the
      // caption is trapped in the image block. The embed visual has already
      // been moved to the image holder above, so when the holder really
      // holds a visual and the block still carries text, that text IS the
      // caption, inline markup intact — adopt it. Odder shapes fall back
      // to re-rendering lines reconstructed from the DOM
      // (recoverCaptionMarkdownFromDom). Both stages are gated on a real
      // image being present: an imageless figure callout keeps its legacy
      // shape (prose in the main column, empty caption) instead of having
      // its prose migrate into the caption column.
      const holderVisual = imageHolder.querySelector(".internal-embed, .image-embed, img");
      if (!imageMarkdown && imageBlock && holderVisual && (imageBlock.textContent || "").trim()) {
        stripCaptionMarker(imageBlock);
        while (
          imageBlock.firstChild &&
          ((imageBlock.firstChild.nodeType === 3 &&
            !(imageBlock.firstChild.nodeValue || "").trim()) ||
            imageBlock.firstChild.tagName === "BR")
        ) {
          imageBlock.removeChild(imageBlock.firstChild);
        }
        captionHolder.appendChild(imageBlock);
      } else {
        const recovered =
          imageMarkdown || holderVisual ? recoverCaptionMarkdownFromDom(content) : "";
        if (recovered) {
          await renderMarkdown(app, recovered, captionHolder, ctx?.sourcePath || "", component);
        } else {
          const synthetic = doc.createElement("p");
          captionHolder.appendChild(synthetic);
        }
      }
    }

    const labelInserted = prependFigureLabel(captionHolder, titleText);
    if (labelInserted) titleEl?.classList.add("tufte-figure-title-hidden");

    emptyElement(content);
    content.appendChild(imageHolder);
    content.appendChild(captionHolder);

    callout.dataset.tufteFigureDecorated = "1";
  } catch (err) {
    console.error("Tufte Figures: failed to decorate margin figure", err);
    delete callout.dataset.tufteFigureDecorated;
  }
}

function decorateLegacyMarginFigure(callout) {
  if (callout.dataset.tufteFigureDecorated === "1") return;
  // Only treat the marginnote as a *figure* when it contains an image.
  // Plain marginnotes (the sidenotes plugin owns those) stay untouched.
  if (!callout.querySelector(".internal-embed.image-embed, img")) return;
  const content = callout.querySelector(".callout-content");
  if (!content) {
    callout.dataset.tufteFigureDecorated = "1";
    return;
  }
  // Find the first text node anywhere inside the content whose value starts
  // with "Fig. N." (or "Figure N.") and wrap that prefix in a coloured span.
  const walker = (callout.ownerDocument || document).createTreeWalker(
    content,
    NodeFilter.SHOW_TEXT,
    null
  );
  let node;
  while ((node = walker.nextNode())) {
    if (!node.nodeValue) continue;
    const m = node.nodeValue.match(/^\s*(Fig\.?|Figure)\s+\d+\.\s*/);
    if (!m) continue;
    const labelText = m[0].trim();
    const rest = node.nodeValue.slice(m[0].length);
    const span = (node.ownerDocument || document).createElement("span");
    span.className = "tufte-fig-label";
    span.textContent = `${labelText} `;
    const after = (node.ownerDocument || document).createTextNode(rest);
    const parent = node.parentNode;
    if (!parent) break;
    parent.insertBefore(span, node);
    parent.insertBefore(after, node);
    parent.removeChild(node);
    break;
  }
  callout.dataset.tufteFigureDecorated = "1";
}

function hideOrphanFigureAnchors(root) {
  // Block IDs (`^fig-N`) attach to the preceding block via Obsidian's
  // parser, but on some builds the line still leaks into the rendered DOM
  // as a bare paragraph. Hide any paragraph whose entire visible text is
  // an anchor token so the figure ends cleanly.
  matchingElements(root, "p").forEach((p) => {
    const t = (p.textContent || "").trim();
    if (/^\^fig-\d+$/.test(t)) p.style.display = "none";
  });
}

// --- modal ---------------------------------------------------------------

class FigureReferenceModal extends Modal {
  constructor(app, plugin, editor) {
    super(app);
    this.plugin = plugin;
    this.editor = editor;
    this.number = defaultFigureReferenceNumber(editor);
    this.referenceInput = null;
  }

  onOpen() {
    const { contentEl } = this;
    const known = figureAnchorNumbers(this.editor.getValue());
    contentEl.empty();
    contentEl.addClass("tufte-figure-modal");
    contentEl.createEl("h3", { text: "Insert figure reference" });

    new Setting(contentEl)
      .setName("Figure number")
      .setDesc(
        known.length
          ? `Detected figures: ${known.join(", ")}.`
          : "No figure anchors detected in this note yet."
      )
      .addText((t) => {
        t.setValue(this.number).onChange((v) => {
          this.number = v.trim();
          this.updateReference();
        });
        t.inputEl.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter") {
            evt.preventDefault();
            this.doInsert();
          }
        });
        window.setTimeout(() => {
          t.inputEl.focus();
          t.inputEl.select();
        }, 0);
      });

    new Setting(contentEl)
      .setName("Reference")
      .setDesc("This will be inserted at the cursor.")
      .addText((t) => {
        this.referenceInput = t;
        t.setValue(this.referenceText());
        t.inputEl.readOnly = true;
      });

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Insert reference")
        .setCta()
        .onClick(() => this.doInsert())
    );
  }

  referenceText() {
    return figureReferenceText(this.number);
  }

  updateReference() {
    if (this.referenceInput) this.referenceInput.setValue(this.referenceText());
  }

  doInsert() {
    const number = (this.number || "").trim();
    if (!/^\d+$/.test(number)) {
      new Notice("Tufte Figures: enter a figure number.");
      return;
    }
    insertInlineText(this.editor, figureReferenceText(number));
    this.editor.focus?.();
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

class FigureModal extends Modal {
  constructor(app, plugin, editor, opts) {
    super(app);
    this.plugin = plugin;
    this.editor = editor;
    this.opts = opts || {};
    this.sourcePath =
      this.opts.sourcePath || app.workspace.getActiveFile()?.path || "";
    this.isEdit = !!this.opts.editRange;

    this.mode = "default";
    this.embed = this.opts.embed || "";
    this.alt = "";
    this.width = "";
    this.height = "";
    this.caption = "";
    this.number = String(nextFigureNumber(editor.getValue()));
    this.ratio = null;
    this.indicatorInput = null;
    this.widthInput = null;
    this.heightInput = null;

    // Multiple-images tab state.
    this.tab = "basic";
    this.rowHeight = 200;
    this.overallCaption = "";
    this.entries = [];
    this.entriesEl = null;

    // Image-quilt tab state. Source tiles are held in memory (bytes) and are
    // only persisted under .obsidian/ on generate, so the vault shows the
    // single generated PNG and nothing else.
    this.quilt = {
      id: null,
      dir: null,
      pngPath: null,
      tiles: [], // { bytes:Uint8Array, ext, name, ratio, url, imgEl }
      rowHeight: 150,
      zoom: 100,
      grayscale: false,
      loading: false
    };
    this.quiltStageEl = null;
    this._objectUrls = [];
    this._quiltRowSlider = null;
    this._quiltZoomSlider = null;
    this._quiltGrayToggle = null;

    const edit = this.opts.edit;
    if (edit) {
      // Editing an existing figure: pre-fill from its parsed block.
      this.mode = edit.mode || "default";
      if (edit.number) this.number = edit.number;
      if (edit.images.length >= 2) {
        this.tab = "multi";
        this.entries = edit.images.map((im, i) => {
          const p = parseEmbed(im.embed);
          return {
            embed: im.embed,
            name: p.path || im.embed,
            label: im.label || String.fromCharCode(97 + i),
            caption: im.caption || "",
            ratio: null,
            width: p.width || "",
            src: ""
          };
        });
        this.overallCaption = edit.overall || "";
      } else {
        const im = edit.images[0];
        if (im) {
          this.embed = im.embed;
          const p = parseEmbed(im.embed);
          this.alt = p.alt || "";
          this.width = p.width || "";
          this.height = p.height || "";
        }
        this.caption = (im && im.caption) || edit.overall || "";
      }
    } else {
      // Insert flow: seed alt/size and the first multi-tab entry from the embed.
      const parsed = parseEmbed(this.embed);
      this.alt = this.opts.altDefault || parsed.alt || "";
      this.width = parsed.width || "";
      this.height = parsed.height || "";
      if (this.embed) {
        this.entries.push({
          embed: this.embed,
          name: parsed.path || this.embed,
          label: "a",
          caption: "",
          ratio: null,
          width: "",
          src: ""
        });
      }
    }

    // Open straight onto a chosen tab (e.g. the "Insert image quilt" command).
    if (this.opts.openTab) this.tab = this.opts.openTab;
    // Re-editing an existing quilt: the figure embeds quilt-<id>.png and a
    // saved config sidecar was found, so jump to the quilt tab and lazy-load it.
    if (this.opts.quilt) {
      this.tab = "quilt";
      this.quilt.id = this.opts.quilt.id;
      this.quilt.dir = this.opts.quilt.dir;
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tufte-figure-modal");
    contentEl.createEl("h3", {
      text: this.isEdit ? "Edit Tufte figure" : "Insert Tufte figure"
    });

    const tabs = contentEl.createDiv({ cls: "tufte-fig-tabs" });
    const basicBtn = tabs.createEl("button", { text: "Basic" });
    const multiBtn = tabs.createEl("button", { text: "Multiple images" });
    const quiltBtn = tabs.createEl("button", { text: "Image quilt" });
    const basicEl = contentEl.createDiv({ cls: "tufte-fig-tab-panel" });
    const multiEl = contentEl.createDiv({ cls: "tufte-fig-tab-panel" });
    const quiltEl = contentEl.createDiv({ cls: "tufte-fig-tab-panel" });

    const setTab = (tab) => {
      this.tab = tab;
      basicBtn.toggleClass("is-active", tab === "basic");
      multiBtn.toggleClass("is-active", tab === "multi");
      quiltBtn.toggleClass("is-active", tab === "quilt");
      basicEl.style.display = tab === "basic" ? "" : "none";
      multiEl.style.display = tab === "multi" ? "" : "none";
      quiltEl.style.display = tab === "quilt" ? "" : "none";
      // The stage needs a real width to pack tiles; it's 0 while hidden, so
      // (re)render on switch-in.
      if (tab === "quilt") this.renderQuiltStage();
    };
    basicBtn.onclick = () => setTab("basic");
    multiBtn.onclick = () => setTab("multi");
    quiltBtn.onclick = () => setTab("quilt");

    this.buildBasicTab(basicEl);
    this.buildMultiTab(multiEl);
    this.buildQuiltTab(quiltEl);
    setTab(this.tab);

    this.resolveNaturalSize();
  }

  buildBasicTab(contentEl) {
    new Setting(contentEl)
      .setName("Image link")
      .setDesc("The embed inserted into the figure.")
      .addText((t) =>
        t.setValue(this.embed).onChange((v) => {
          this.embed = v;
          this.resolveNaturalSize();
        })
      );

    new Setting(contentEl).setName("Display").addDropdown((d) => {
      d.addOption("default", "Default — image in column, caption in margin");
      d.addOption("full", "Full-width — image spans column + margin");
      d.addOption("margin", "Margin figure — [!figure-margin]");
      d.setValue(this.mode).onChange((v) => {
        this.mode = v;
      });
    });

    new Setting(contentEl)
      .setName("Figure number")
      .setDesc("Auto-suggested; edit to set it manually.")
      .addText((t) =>
        t.setValue(this.number).onChange((v) => {
          this.number = v.trim();
          this.updateIndicator();
        })
      );

    new Setting(contentEl)
      .setName("Alt text")
      .addText((t) =>
        t.setValue(this.alt).onChange((v) => {
          this.alt = v;
        })
      );

    new Setting(contentEl).setName("Caption").addTextArea((t) => {
      t.setValue(this.caption).onChange((v) => {
        this.caption = v;
      });
      t.inputEl.rows = 3;
      t.inputEl.style.width = "100%";
    });

    new Setting(contentEl)
      .setName("Size (px)")
      .setDesc("Width × height. Ratio is locked — editing one updates the other. Leave blank for the original size.")
      .addText((t) => {
        this.widthInput = t;
        t.setPlaceholder("width");
        t.setValue(this.width);
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.inputEl.style.width = "5.5em";
        t.onChange((v) => this.onWidthChanged(v));
      })
      .addText((t) => {
        this.heightInput = t;
        t.setPlaceholder("height");
        t.setValue(this.height);
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.inputEl.style.width = "5.5em";
        t.onChange((v) => this.onHeightChanged(v));
      });

    const indicator = new Setting(contentEl)
      .setName("In-text reference")
      .setDesc("Clickable link to this figure — copy it into your prose.");
    indicator.addText((t) => {
      this.indicatorInput = t;
      t.setValue(this.indicatorText());
      t.inputEl.readOnly = true;
    });
    indicator.addButton((b) =>
      b.setButtonText("Copy").onClick(async () => {
        try {
          await navigator.clipboard.writeText(this.indicatorText());
          new Notice("Figure reference copied");
        } catch {
          new Notice("Couldn't access the clipboard");
        }
      })
    );

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText(this.isEdit ? "Save figure" : "Insert figure")
        .setCta()
        .onClick(() => this.doInsert())
    );
  }

  buildMultiTab(contentEl) {
    contentEl.createEl("p", {
      cls: "tufte-fig-multi-hint",
      text: "A row of up to 5 images sharing one caption. Heights are equalised; each image keeps its ratio."
    });

    new Setting(contentEl).setName("Display").addDropdown((d) => {
      d.addOption("default", "Default — row in column, captions in margin");
      d.addOption("full", "Full-width — row spans column + margin");
      // No margin mode: a row of images doesn't lay out well in the margin.
      d.setValue(this.mode === "margin" ? "default" : this.mode).onChange((v) => {
        this.mode = v;
      });
    });

    new Setting(contentEl)
      .setName("Figure number")
      .addText((t) =>
        t.setValue(this.number).onChange((v) => {
          this.number = v.trim();
        })
      );

    new Setting(contentEl)
      .setName("Row height (px)")
      .setDesc("Shared height; per-image widths follow each ratio.")
      .addText((t) => {
        t.setValue(String(this.rowHeight));
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.inputEl.style.width = "6em";
        t.onChange((v) => {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n > 0) {
            this.rowHeight = n;
            this.refreshEntryWidths();
          }
        });
      });

    this.entriesEl = contentEl.createDiv({ cls: "tufte-fig-entries" });
    this.entries.forEach((entry) => this.loadEntryRatio(entry));
    this.renderEntries();

    const zone = contentEl.createDiv({ cls: "tufte-fig-dropzone" });
    zone.createSpan({ cls: "tufte-fig-dropzone-plus", text: "+" });
    zone.createSpan({
      cls: "tufte-fig-dropzone-text",
      text: "Drag images here, or click to browse"
    });
    zone.addEventListener("click", () => this.pickImage());
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.addClass("is-dragover");
    });
    zone.addEventListener("dragleave", () => zone.removeClass("is-dragover"));
    zone.addEventListener("drop", (e) => this.onZoneDrop(e, zone));

    new Setting(contentEl).setName("Overall caption").addTextArea((t) => {
      t.setValue(this.overallCaption).onChange((v) => {
        this.overallCaption = v;
      });
      t.inputEl.rows = 2;
      t.inputEl.style.width = "100%";
    });

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText(this.isEdit ? "Save figure" : "Insert figure")
        .setCta()
        .onClick(() => this.doInsertMulti())
    );
  }

  renderEntries() {
    const el = this.entriesEl;
    if (!el) return;
    el.empty();
    this.entries.forEach((entry, i) => {
      const row = el.createDiv({ cls: "tufte-fig-entry" });
      if (entry.src) {
        const thumb = row.createEl("img", { cls: "tufte-fig-entry-thumb" });
        thumb.src = entry.src;
      } else {
        row.createDiv({ cls: "tufte-fig-entry-thumb tufte-fig-entry-thumb-empty" });
      }
      row.createSpan({ cls: "tufte-fig-entry-name", text: entry.name || entry.embed });

      const lab = row.createEl("input", { type: "text" });
      lab.value = entry.label;
      lab.placeholder = "a";
      lab.addClass("tufte-fig-entry-label");
      lab.oninput = () => {
        entry.label = lab.value;
      };

      const cap = row.createEl("input", { type: "text" });
      cap.value = entry.caption;
      cap.placeholder = "individual caption";
      cap.addClass("tufte-fig-entry-caption");
      cap.oninput = () => {
        entry.caption = cap.value;
      };

      const rm = row.createEl("button", { text: "✕", cls: "tufte-fig-entry-remove" });
      rm.onclick = () => {
        this.entries.splice(i, 1);
        this.renderEntries();
      };
    });
  }

  pickImage() {
    if (this.entries.length >= 5) {
      new Notice("Tufte Figures: a row holds at most 5 images.");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (file) await this.addImageFile(file);
    };
    input.click();
  }

  async addImageFile(file) {
    try {
      const ext = extFromType(file.type) || fileExt(file.name) || "png";
      const baseName =
        file.name && file.name.toLowerCase() !== "image.png"
          ? file.name
          : `pasted-image-${Date.now()}.${ext}`;
      const path = await this.app.fileManager.getAvailablePathForAttachment(
        baseName,
        this.sourcePath
      );
      const buffer = await file.arrayBuffer();
      const tfile = await this.app.vault.createBinary(path, buffer);
      this.addEntryFromTFile(tfile);
    } catch (e) {
      console.error("tufte-figures: failed to save image", e);
      new Notice("Tufte Figures: couldn't save the image.");
    }
  }

  addEntryFromTFile(tfile) {
    if (this.entries.length >= 5) return;
    const entry = {
      embed: this.plugin.buildEmbed(tfile, this.sourcePath),
      name: tfile.basename || tfile.name,
      label: String.fromCharCode(97 + this.entries.length),
      caption: "",
      ratio: null,
      width: ""
    };
    this.entries.push(entry);
    this.loadEntryRatio(entry);
    this.renderEntries();
  }

  async onZoneDrop(evt, zone) {
    evt.preventDefault();
    evt.stopPropagation();
    zone.removeClass("is-dragover");

    // External image files.
    const files = Array.from((evt.dataTransfer && evt.dataTransfer.files) || []).filter(
      (f) => f.type && f.type.startsWith("image/")
    );
    if (files.length) {
      for (const f of files) {
        if (this.entries.length >= 5) break;
        await this.addImageFile(f);
      }
      return;
    }

    // Internal vault images (dragged from the file explorer); fall back to the
    // plugin's dragstart snapshot when the drag manager is already cleared.
    const tfiles = draggedImageFiles(this.app);
    const internal = tfiles.length ? tfiles : this.plugin._lastDraggedImages || [];
    if (internal.length) {
      for (const tf of internal) this.addEntryFromTFile(tf);
      return;
    }

    let text = "";
    try {
      text = evt.dataTransfer?.getData("text/plain") || "";
    } catch {}
    const linkpath = linkpathFromDropText(text);
    if (linkpath) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(linkpath, this.sourcePath);
      if (isImageTFile(tf)) this.addEntryFromTFile(tf);
    }
  }

  loadEntryRatio(entry) {
    const parsed = parseEmbed(entry.embed);
    let src = "";
    if (parsed.kind === "wiki") {
      const tf = this.app.metadataCache.getFirstLinkpathDest(
        (parsed.path || "").split("#")[0],
        this.sourcePath
      );
      if (tf) {
        try {
          src = this.app.vault.getResourcePath(tf);
        } catch {}
      }
    } else if (parsed.kind === "md") {
      src = parsed.path;
    }
    entry.src = src;
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        entry.ratio = img.naturalWidth / img.naturalHeight;
        // Keep an existing width (an edited figure's own size); only derive
        // it for fresh entries that don't carry one yet.
        if (!entry.width) {
          entry.width = String(Math.round(this.rowHeight * entry.ratio));
        }
      }
    };
    img.src = src;
  }

  refreshEntryWidths() {
    for (const entry of this.entries) {
      if (entry.ratio) entry.width = String(Math.round(this.rowHeight * entry.ratio));
    }
  }

  doInsertMulti() {
    if (this.entries.length < 2) {
      new Notice("Tufte Figures: add at least 2 images, or use the Basic tab.");
      return;
    }
    // Fill in any missing widths without clobbering ones already set (changing
    // the row height runs refreshEntryWidths, which intentionally rescales all).
    for (const e of this.entries) {
      if (e.ratio && !e.width) e.width = String(Math.round(this.rowHeight * e.ratio));
    }
    // Margin mode isn't offered for rows; fall back to default if inherited.
    const mode = this.mode === "margin" ? "default" : this.mode;
    const block = buildMultiFigureBlock(mode, {
      entries: this.entries.map((e) => ({
        embed: e.embed,
        label: (e.label || "").trim(),
        caption: (e.caption || "").trim(),
        width: e.width || ""
      })),
      overallCaption: this.overallCaption.trim(),
      number: this.number || "1",
      labelPrefix: this.plugin.settings.labelPrefix
    });
    this.commitBlock(block);
    this.close();
  }

  // --- image-quilt tab ---------------------------------------------------

  buildQuiltTab(contentEl) {
    contentEl.createEl("p", {
      cls: "tufte-fig-multi-hint",
      text:
        "Combine many images into one quilt — a tight grid of uniform-height tiles. " +
        "Drag tiles to reorder, ✕ to remove. Generates a single transparent PNG inserted " +
        "as a figure; re-editable later via 'Edit figure at cursor'."
    });

    new Setting(contentEl).setName("Display").addDropdown((d) => {
      d.addOption("default", "Default — quilt in column, caption in margin");
      d.addOption("full", "Full-width — quilt spans column + margin");
      // No margin mode: a wide quilt doesn't lay out well in the margin.
      d.setValue(this.mode === "margin" ? "default" : this.mode).onChange((v) => {
        this.mode = v;
      });
    });

    new Setting(contentEl)
      .setName("Figure number")
      .addText((t) =>
        t.setValue(this.number).onChange((v) => {
          this.number = v.trim();
        })
      );

    new Setting(contentEl)
      .setName("Tile height (px)")
      .setDesc("Shared height of every tile; widths follow each image's ratio.")
      .addSlider((s) => {
        this._quiltRowSlider = s;
        s.setLimits(40, 320, 5);
        s.setValue(this.quilt.rowHeight);
        s.setDynamicTooltip();
        s.onChange((v) => {
          this.quilt.rowHeight = v;
          this.renderQuiltStage();
        });
      });

    new Setting(contentEl)
      .setName("Zoom (%)")
      .setDesc("Magnify and crop the image inside each tile.")
      .addSlider((s) => {
        this._quiltZoomSlider = s;
        s.setLimits(100, 300, 5);
        s.setValue(this.quilt.zoom);
        s.setDynamicTooltip();
        s.onChange((v) => {
          this.quilt.zoom = v;
          this.renderQuiltStage();
        });
      });

    new Setting(contentEl)
      .setName("Grayscale")
      .setDesc("Render the quilt in black and white.")
      .addToggle((t) => {
        this._quiltGrayToggle = t;
        t.setValue(this.quilt.grayscale).onChange((v) => {
          this.quilt.grayscale = v;
          this.renderQuiltStage();
        });
      });

    this.quiltStageEl = contentEl.createDiv({ cls: "tufte-quilt-stage" });

    const zone = contentEl.createDiv({ cls: "tufte-fig-dropzone" });
    zone.createSpan({ cls: "tufte-fig-dropzone-plus", text: "+" });
    zone.createSpan({
      cls: "tufte-fig-dropzone-text",
      text: "Drag images here, or click to browse"
    });
    zone.addEventListener("click", () => this.pickQuiltImages());
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.addClass("is-dragover");
    });
    zone.addEventListener("dragleave", () => zone.removeClass("is-dragover"));
    zone.addEventListener("drop", (e) => this.onQuiltZoneDrop(e, zone));

    new Setting(contentEl).setName("Caption").addTextArea((t) => {
      t.setValue(this.caption).onChange((v) => {
        this.caption = v;
      });
      t.inputEl.rows = 2;
      t.inputEl.style.width = "100%";
    });

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText(this.isEdit ? "Save quilt" : "Generate & insert quilt")
        .setCta()
        .onClick(() => this.doInsertQuilt())
    );

    // Re-edit: pull the saved tiles + settings in from the sidecar.
    if (this.opts.quilt) this.loadQuiltFromConfig();
  }

  pickQuiltImages() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      for (const f of files) await this.addQuiltImageFile(f);
    };
    input.click();
  }

  async onQuiltZoneDrop(evt, zone) {
    evt.preventDefault();
    evt.stopPropagation();
    zone.removeClass("is-dragover");

    const files = Array.from((evt.dataTransfer && evt.dataTransfer.files) || []).filter(
      (f) => f.type && f.type.startsWith("image/")
    );
    if (files.length) {
      for (const f of files) await this.addQuiltImageFile(f);
      return;
    }

    const tfiles = draggedImageFiles(this.app);
    const internal = tfiles.length ? tfiles : this.plugin._lastDraggedImages || [];
    if (internal.length) {
      for (const tf of internal) await this.addQuiltTileFromTFile(tf);
      return;
    }

    let text = "";
    try {
      text = evt.dataTransfer?.getData("text/plain") || "";
    } catch {}
    const linkpath = linkpathFromDropText(text);
    if (linkpath) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(linkpath, this.sourcePath);
      if (isImageTFile(tf)) await this.addQuiltTileFromTFile(tf);
    }
  }

  async addQuiltImageFile(file) {
    try {
      const ext = extFromType(file.type) || fileExt(file.name) || "png";
      const buffer = await file.arrayBuffer();
      await this.addQuiltTile(new Uint8Array(buffer), ext, file.name || `image.${ext}`);
    } catch (e) {
      console.error("tufte-figures: failed to read quilt image", e);
      new Notice("Tufte Figures: couldn't read the image.");
    }
  }

  async addQuiltTileFromTFile(tfile) {
    try {
      const buffer = await this.app.vault.readBinary(tfile);
      const ext = tfile.extension || "png";
      await this.addQuiltTile(new Uint8Array(buffer), ext, tfile.name);
    } catch (e) {
      console.error("tufte-figures: failed to read vault image", e);
    }
  }

  // Load an image's bytes into a tile (object URL + natural ratio), then
  // re-render the stage. Resolves once the tile is added.
  addQuiltTile(bytes, ext, name) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeFromExt(ext) }));
      this._objectUrls.push(url);
      const tile = { bytes, ext, name, ratio: 1, url, imgEl: null };
      const img = new Image();
      const done = () => {
        tile.imgEl = img;
        if (img.naturalWidth && img.naturalHeight) {
          tile.ratio = img.naturalWidth / img.naturalHeight;
        }
        this.quilt.tiles.push(tile);
        this.renderQuiltStage();
        resolve();
      };
      img.onload = done;
      img.onerror = done;
      img.src = url;
    });
  }

  quiltStageWidth() {
    const w = this.quiltStageEl && this.quiltStageEl.clientWidth;
    return w && w > 20 ? w : 480;
  }

  renderQuiltStage() {
    const stage = this.quiltStageEl;
    if (!stage) return;
    stage.empty();

    if (this.quilt.loading) {
      stage.createDiv({ cls: "tufte-quilt-empty", text: "Loading quilt…" });
      return;
    }
    if (!this.quilt.tiles.length) {
      stage.createDiv({
        cls: "tufte-quilt-empty",
        text: "No images yet — drop some below to build the quilt."
      });
      return;
    }

    const h = this.quilt.rowHeight;
    const scale = this.quilt.zoom / 100;
    this.quilt.tiles.forEach((tile, i) => {
      const cell = stage.createDiv({ cls: "tufte-quilt-tile" });
      cell.style.height = `${h}px`;
      cell.style.width = `${Math.max(1, Math.round(h * (tile.ratio || 1)))}px`;
      cell.dataset.index = String(i);

      const img = cell.createEl("img");
      img.src = tile.url;
      img.draggable = false;
      img.style.transform = `scale(${scale})`;
      img.style.filter = this.quilt.grayscale ? "grayscale(1)" : "";

      const rm = cell.createEl("button", { text: "✕", cls: "tufte-quilt-tile-remove" });
      rm.onclick = (e) => {
        e.stopPropagation();
        const at = Number(cell.dataset.index);
        this.quilt.tiles.splice(at, 1);
        this.renderQuiltStage();
      };

      this.attachQuiltDrag(cell);
    });
  }

  // Pointer-based drag-to-reorder (works on desktop and touch). On crossing
  // into another tile, the dragged tile is spliced to that index and the stage
  // re-renders live.
  attachQuiltDrag(cell) {
    cell.addEventListener("pointerdown", (e) => {
      if (e.target instanceof HTMLElement && e.target.closest(".tufte-quilt-tile-remove")) {
        return;
      }
      e.preventDefault();
      const tiles = this.quilt.tiles;
      let from = Number(cell.dataset.index);
      cell.classList.add("is-dragging");

      const onMove = (ev) => {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const overCell = el && el.closest && el.closest(".tufte-quilt-tile");
        if (!overCell) return;
        const to = Number(overCell.dataset.index);
        if (!Number.isInteger(to) || to === from) return;
        const [moved] = tiles.splice(from, 1);
        tiles.splice(to, 0, moved);
        from = to;
        this.renderQuiltStage();
        const fresh = this.quiltStageEl.querySelector(
          `.tufte-quilt-tile[data-index="${to}"]`
        );
        if (fresh) fresh.classList.add("is-dragging");
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        this.renderQuiltStage();
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  // Render the arranged tiles to a transparent-background PNG. The layout uses
  // the same maxWidth as the live stage so the export matches what the user
  // arranged; the canvas is up-scaled for crispness while drawing from the
  // full-resolution source images.
  renderQuiltCanvas() {
    const tiles = this.quilt.tiles.filter((t) => t.imgEl);
    if (!tiles.length) return Promise.resolve(null);
    const h = this.quilt.rowHeight;
    const { width, height, placements } = layoutQuilt(tiles, h, this.quiltStageWidth());
    if (!width || !height) return Promise.resolve(null);
    const exportScale = Math.max(2, Math.min(6, 2000 / width));

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * exportScale));
    canvas.height = Math.max(1, Math.round(height * exportScale));
    const ctx = canvas.getContext("2d");
    ctx.scale(exportScale, exportScale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (this.quilt.grayscale && "filter" in ctx) ctx.filter = "grayscale(100%)";

    const z = this.quilt.zoom / 100;
    for (const p of placements) {
      const img = p.tile.imgEl;
      const nw = img.naturalWidth || 1;
      const nh = img.naturalHeight || 1;
      const sw = nw / z;
      const sh = nh / z;
      const sx = (nw - sw) / 2;
      const sy = (nh - sh) / 2;
      try {
        ctx.drawImage(img, sx, sy, sw, sh, p.x, p.y, p.w, p.h);
      } catch (e) {
        console.error("tufte-figures: failed to draw quilt tile", e);
      }
    }

    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }

  async doInsertQuilt() {
    if (!this.quilt.tiles.length) {
      new Notice("Tufte Figures: add at least one image to the quilt.");
      return;
    }
    if (this.quilt.tiles.some((t) => !t.imgEl)) {
      new Notice("Tufte Figures: images still loading — try again in a moment.");
      return;
    }
    try {
      const adapter = this.app.vault.adapter;
      const id = this.quilt.id || String(Date.now());
      const dir = quiltDir(this.app, id);
      await ensureFolder(adapter, `${dir}/src`);

      // Persist the source tiles (hidden under .obsidian/) and the config list.
      const cfgTiles = [];
      for (let i = 0; i < this.quilt.tiles.length; i++) {
        const tile = this.quilt.tiles[i];
        const rel = `src/${i}.${tile.ext || "png"}`;
        await adapter.writeBinary(`${dir}/${rel}`, toArrayBuffer(tile.bytes));
        cfgTiles.push({ file: rel, ratio: tile.ratio || 1, name: tile.name || rel });
      }

      // Render the quilt PNG.
      const blob = await this.renderQuiltCanvas();
      if (!blob) {
        new Notice("Tufte Figures: couldn't render the quilt.");
        return;
      }
      const pngBuf = await blob.arrayBuffer();

      // Margin mode isn't offered for quilts; fall back to default if inherited.
      const mode = this.mode === "margin" ? "default" : this.mode;

      // Save (first time) or overwrite (re-edit) the visible PNG in the vault.
      let pngPath = this.quilt.pngPath;
      let tfile = pngPath ? this.app.vault.getAbstractFileByPath(pngPath) : null;
      if (tfile) {
        await this.app.vault.modifyBinary(tfile, pngBuf);
      } else {
        // Generated quilts go to a user-configurable folder (default img/quilt).
        const folder = normalizeQuiltFolder(this.plugin.settings.quiltFolder);
        if (folder) await ensureFolder(this.app.vault.adapter, folder);
        pngPath = folder ? `${folder}/quilt-${id}.png` : `quilt-${id}.png`;
        tfile = await this.app.vault.createBinary(pngPath, pngBuf);
      }
      this.quilt.id = id;
      this.quilt.dir = dir;
      this.quilt.pngPath = pngPath;

      // Write the re-editable config sidecar.
      const config = {
        version: 1,
        id,
        pngPath,
        rowHeight: this.quilt.rowHeight,
        zoom: this.quilt.zoom,
        grayscale: this.quilt.grayscale,
        mode,
        number: this.number || "1",
        caption: this.caption || "",
        tiles: cfgTiles
      };
      await adapter.write(`${dir}/config.json`, JSON.stringify(config, null, 2));

      // Hand off to the ordinary figure pipeline (caption, number, anchor,
      // reference, click-to-enlarge, the three modes — all reused).
      const embed = this.plugin.buildEmbed(tfile, this.sourcePath);
      const block = buildFigureBlock(mode, {
        embed,
        // Alt stays empty like every other insertion path — a `|alt`
        // segment renders as a grey caption box under the figure.
        alt: "",
        caption: (this.caption || "").trim(),
        number: this.number || "1",
        labelPrefix: this.plugin.settings.labelPrefix
      });
      this.commitBlock(block);
      new Notice(this.isEdit ? "Quilt updated" : "Quilt inserted");
      this.close();
    } catch (e) {
      console.error("tufte-figures: failed to generate quilt", e);
      new Notice("Tufte Figures: couldn't generate the quilt.");
    }
  }

  async loadQuiltFromConfig() {
    const opt = this.opts.quilt;
    if (!opt) return;
    const adapter = this.app.vault.adapter;
    const dir = opt.dir;
    this.quilt.loading = true;
    this.renderQuiltStage();
    try {
      const cfg = JSON.parse(await adapter.read(`${dir}/config.json`));
      this.quilt.id = cfg.id || opt.id;
      this.quilt.dir = dir;
      this.quilt.pngPath = cfg.pngPath || this.quilt.pngPath;
      this.quilt.rowHeight = cfg.rowHeight || 150;
      this.quilt.zoom = cfg.zoom || 100;
      this.quilt.grayscale = !!cfg.grayscale;
      if (cfg.mode) this.mode = cfg.mode;
      if (cfg.number) this.number = String(cfg.number);
      if (typeof cfg.caption === "string") this.caption = cfg.caption;

      const tiles = [];
      for (const ct of cfg.tiles || []) {
        try {
          const bytes = new Uint8Array(await adapter.readBinary(`${dir}/${ct.file}`));
          const ext = (ct.file.split(".").pop() || "png").toLowerCase();
          const url = URL.createObjectURL(new Blob([bytes], { type: mimeFromExt(ext) }));
          this._objectUrls.push(url);
          const tile = {
            bytes,
            ext,
            name: ct.name || ct.file,
            ratio: ct.ratio || 1,
            url,
            imgEl: null
          };
          await new Promise((res) => {
            const img = new Image();
            const done = () => {
              tile.imgEl = img;
              if (img.naturalWidth && img.naturalHeight) {
                tile.ratio = img.naturalWidth / img.naturalHeight;
              }
              res();
            };
            img.onload = done;
            img.onerror = done;
            img.src = url;
          });
          tiles.push(tile);
        } catch (e) {
          console.error("tufte-figures: failed to load quilt tile", ct, e);
        }
      }
      this.quilt.tiles = tiles;
    } catch (e) {
      console.error("tufte-figures: failed to load quilt config", e);
      new Notice("Tufte Figures: couldn't load the saved quilt.");
    } finally {
      this.quilt.loading = false;
      // Sync widgets that were built before the async config arrived.
      this._quiltRowSlider?.setValue(this.quilt.rowHeight);
      this._quiltZoomSlider?.setValue(this.quilt.zoom);
      this._quiltGrayToggle?.setValue(this.quilt.grayscale);
      this.renderQuiltStage();
    }
  }

  indicatorText() {
    return figureReferenceText(this.number || "N");
  }

  updateIndicator() {
    if (this.indicatorInput) this.indicatorInput.setValue(this.indicatorText());
  }

  onWidthChanged(v) {
    this.width = (v || "").trim();
    if (!this.width) {
      this.height = "";
      this.heightInput?.setValue("");
    } else if (this.ratio) {
      this.height = String(Math.round(parseInt(this.width, 10) / this.ratio));
      this.heightInput?.setValue(this.height);
    }
  }

  onHeightChanged(v) {
    this.height = (v || "").trim();
    if (!this.height) {
      this.width = "";
      this.widthInput?.setValue("");
    } else if (this.ratio) {
      this.width = String(Math.round(parseInt(this.height, 10) * this.ratio));
      this.widthInput?.setValue(this.width);
    }
  }

  // Load the image so we can lock the width/height ratio and show its
  // natural dimensions as placeholders. Degrades gracefully (independent
  // fields) when the source can't be resolved.
  resolveNaturalSize() {
    const parsed = parseEmbed(this.embed);
    let src = "";
    if (parsed.kind === "wiki") {
      const linkpath = (parsed.path || "").split("#")[0];
      const tfile = this.app.metadataCache.getFirstLinkpathDest(
        linkpath,
        this.sourcePath
      );
      if (tfile) {
        try {
          src = this.app.vault.getResourcePath(tfile);
        } catch {}
      }
    } else if (parsed.kind === "md") {
      src = parsed.path;
    }
    if (!src) {
      this.ratio = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        this.ratio = img.naturalWidth / img.naturalHeight;
        this.applyNaturalPlaceholders(img.naturalWidth, img.naturalHeight);
      }
    };
    img.onerror = () => {
      this.ratio = null;
    };
    img.src = src;
  }

  applyNaturalPlaceholders(w, h) {
    this.widthInput?.setPlaceholder(String(w));
    this.heightInput?.setPlaceholder(String(h));
    // Keep the pre-filled pair consistent when an embed carried only one axis.
    if (this.ratio && this.width && !this.height) {
      this.height = String(Math.round(parseInt(this.width, 10) / this.ratio));
      this.heightInput?.setValue(this.height);
    } else if (this.ratio && this.height && !this.width) {
      this.width = String(Math.round(parseInt(this.height, 10) * this.ratio));
      this.widthInput?.setValue(this.width);
    }
  }

  doInsert() {
    if (!this.embed || !this.embed.trim()) {
      new Notice("Tufte Figures: the image link is empty.");
      return;
    }
    // Ratio locked → encode width only (height stays auto, preserving the
    // ratio). No ratio (e.g. external image) → encode both axes as typed.
    const width = this.width || "";
    const height = this.ratio ? "" : this.height || "";
    const block = buildFigureBlock(this.mode, {
      embed: this.embed.trim(),
      alt: this.alt,
      caption: this.caption.trim(),
      number: this.number || "1",
      labelPrefix: this.plugin.settings.labelPrefix,
      width,
      height
    });
    this.commitBlock(block);
    this.close();
  }

  // Replace the original figure block when editing; otherwise insert anew.
  commitBlock(block) {
    const range = this.opts.editRange;
    if (range) {
      const to = Math.min(range.to, this.editor.lineCount() - 1);
      const endCh = (this.editor.getLine(to) || "").length;
      this.editor.replaceRange(block, { line: range.from, ch: 0 }, { line: to, ch: endCh });
      this.editor.focus?.();
      return;
    }
    insertBlockAtPos(this.editor, block, this.opts.pos);
  }

  onClose() {
    for (const url of this._objectUrls || []) {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }
    this._objectUrls = [];
    this.contentEl.empty();
  }
}

// --- settings ------------------------------------------------------------

class FigureSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Intercept image drops and pastes")
      .setDesc(
        "When on, dragging or pasting an image into the editor opens the figure modal. Turn off to use plain Obsidian embedding and the 'Insert figure' command only."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.interceptDrops).onChange(async (v) => {
          this.plugin.settings.interceptDrops = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Figure label prefix")
      .setDesc(
        "Prefix shown before the number in margin-figure captions, e.g. 'Fig.' → 'Fig. 1.'"
      )
      .addText((t) =>
        t.setValue(this.plugin.settings.labelPrefix).onChange(async (v) => {
          this.plugin.settings.labelPrefix = v || "Fig.";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Image quilt output folder")
      .setDesc(
        "Vault-relative folder where generated image-quilt PNGs are saved (created if missing). Leave blank for the vault root. Default: img/quilt."
      )
      .addText((t) =>
        t
          .setPlaceholder("img/quilt")
          .setValue(this.plugin.settings.quiltFolder)
          .onChange(async (v) => {
            this.plugin.settings.quiltFolder = normalizeQuiltFolder(v);
            await this.plugin.saveSettings();
          })
      );
  }
}
/*<<<TUFTE-SUITE:END tufte-figures/main.js>>>*/
});

defineSubmodule({
  key: "inline",
  id: "tufte-inline",
  name: "Tufte Inline",
  version: "1.2.0",
  blurb: "Inline shorthands: ^^new thought^^, &&lead-in&&, @@CJK drop cap@@."
}, function (module, exports, require) {
/*<<<TUFTE-SUITE:BEGIN tufte-inline/main.js v1.2.0>>>*/
const { Plugin, editorLivePreviewField } = require("obsidian");
const { ViewPlugin, Decoration } = require("@codemirror/view");
const { RangeSetBuilder } = require("@codemirror/state");
const { syntaxTree } = require("@codemirror/language");

/* ============================================================================
   Tufte Inline — inline typography shorthands for the Tufte vault.

   Rendered in BOTH Reading view (a Markdown post-processor) and Live Preview
   (a CodeMirror 6 editor extension). The Markdown source is never modified;
   in strict Source mode the raw delimiters are shown.

     ^^text^^   ->  <span class="newthought">text</span>
                    (small-caps opener for the start of a section)
     &&text&&   ->  <span class="tufte-leadin">text</span>
                    (italic run-in label with a trailing indent; use at the
                    beginning of a paragraph for organization)
     @@字@@     ->  <span class="dropcap-cjk">字</span>
                    (CJK drop cap, 首字下沉 — wrap the FIRST character of a
                    paragraph only; the theme drops it two lines deep in
                    Reading view)

   The span *styling* lives in the Tufte theme's theme.css, alongside
   .newthought, so it stays consistent with the rest of the theme.
   ============================================================================ */

// Each rule requires the inner text to begin and end with a non-space
// character (like Markdown emphasis), so stray operators such as "a && b && c"
// in prose aren't captured. Inner text may not contain the delimiter's char.
const RULES = [
  { re: /\^\^(\S(?:[^^]*?\S)?)\^\^/g, className: "newthought" },
  { re: /&&(\S(?:[^&]*?\S)?)&&/g,     className: "tufte-leadin" },
  { re: /@@(\S(?:[^@]*?\S)?)@@/g,     className: "dropcap-cjk" },
];
const DELIM_LEN = 2;

// Reading view: never transform inside code, math, links, or already-wrapped.
const SKIP_PARENT_SELECTOR =
  "code, pre, .math, mjx-container, a, .newthought, .tufte-leadin, .dropcap-cjk";

// Find non-overlapping matches across all rules, left to right (earlier wins).
function collectMatches(text) {
  const hits = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text))) {
      hits.push({
        start: m.index,
        end: m.index + m[0].length,
        inner: m[1],
        className: rule.className,
      });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const chosen = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue;
    chosen.push(h);
    cursor = h.end;
  }
  return chosen;
}

module.exports = class TufteInlinePlugin extends Plugin {
  async onload() {
    // --- Reading view -----------------------------------------------------
    this.registerMarkdownPostProcessor((el) => {
      if (el.closest(".markdown-source-view.mod-cm6")) return;
      transformInlineSpans(el);
    });

    // --- Live Preview (CodeMirror 6) --------------------------------------
    this.registerEditorExtension(inlineShorthandViewPlugin);

    // --- Optional convenience commands (no default hotkeys) ----------------
    this.addCommand({
      id: "wrap-newthought",
      name: "Wrap selection in New Thought (^^…^^)",
      editorCallback: (editor) => wrapSelection(editor, "^^"),
    });
    this.addCommand({
      id: "wrap-leadin",
      name: "Wrap selection in lead-in (&&…&&)",
      editorCallback: (editor) => wrapSelection(editor, "&&"),
    });
    this.addCommand({
      id: "wrap-dropcap",
      name: "Wrap first character in CJK drop cap (@@…@@)",
      editorCallback: (editor) => wrapDropcap(editor),
    });
  }
};

/* ---- Reading view: replace delimiters with styled spans ------------------ */

function transformInlineSpans(root) {
  const doc = root.ownerDocument || document;
  const candidates = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const v = node.nodeValue;
      if (!v || (!v.includes("^^") && !v.includes("&&") && !v.includes("@@"))) {
        return NodeFilter.FILTER_REJECT;
      }
      if (node.parentElement?.closest(SKIP_PARENT_SELECTOR)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node;
  while ((node = walker.nextNode())) candidates.push(node);

  for (const textNode of candidates) {
    const text = textNode.nodeValue;
    const chosen = collectMatches(text);
    if (!chosen.length) continue;

    const doc2 = textNode.ownerDocument;
    const fragment = doc2.createDocumentFragment();
    let lastEnd = 0;
    for (const h of chosen) {
      const before = text.slice(lastEnd, h.start);
      if (before) fragment.appendChild(doc2.createTextNode(before));
      const span = doc2.createElement("span");
      span.className = h.className;
      span.textContent = h.inner;
      fragment.appendChild(span);
      lastEnd = h.end;
    }
    const tail = text.slice(lastEnd);
    if (tail) fragment.appendChild(doc2.createTextNode(tail));
    textNode.parentNode.replaceChild(fragment, textNode);
  }
}

/* ---- Live Preview: conceal delimiters + style inner text ----------------- */

// True if `pos` sits inside a code or math syntax node — leave those raw.
function inSkippedContext(state, pos) {
  let node = syntaxTree(state).resolveInner(pos, 1);
  while (node) {
    if (/code|math/i.test(node.type.name || "")) return true;
    node = node.parent;
  }
  return false;
}

function buildDecorations(view) {
  // Only decorate in Live Preview; Source mode shows the raw delimiters.
  if (!view.state.field(editorLivePreviewField, false)) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder();
  const sel = view.state.selection;
  const conceal = Decoration.replace({});

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const h of collectMatches(text)) {
      const start = from + h.start;
      const end = from + h.end;
      const innerStart = start + DELIM_LEN;
      const innerEnd = end - DELIM_LEN;

      if (inSkippedContext(view.state, start)) continue;

      const mark = Decoration.mark({ class: h.className });
      // Reveal (don't conceal) when the selection touches the match, so the
      // delimiters reappear for editing. The inner text stays styled either way.
      const touched = sel.ranges.some((r) => r.from <= end && r.to >= start);
      if (touched) {
        builder.add(innerStart, innerEnd, mark);
      } else {
        builder.add(start, innerStart, conceal);
        builder.add(innerStart, innerEnd, mark);
        builder.add(innerEnd, end, conceal);
      }
    }
  }
  return builder.finish();
}

const inlineShorthandViewPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view);
    }
    update(u) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

/* ---- Command helper ------------------------------------------------------ */

function wrapSelection(editor, delim) {
  const sel = editor.getSelection();
  if (sel) {
    editor.replaceSelection(delim + sel + delim);
    return;
  }
  const cur = editor.getCursor();
  editor.replaceRange(delim + delim, cur);
  editor.setCursor({ line: cur.line, ch: cur.ch + delim.length });
}

// A drop cap sinks everything inside the delimiters, so wrap only the first
// character of the selection (code-point aware) and leave the rest in place.
function wrapDropcap(editor) {
  const sel = editor.getSelection();
  if (sel) {
    const chars = Array.from(sel);
    editor.replaceSelection("@@" + chars[0] + "@@" + chars.slice(1).join(""));
    return;
  }
  const cur = editor.getCursor();
  editor.replaceRange("@@@@", cur);
  editor.setCursor({ line: cur.line, ch: cur.ch + DELIM_LEN });
}
/*<<<TUFTE-SUITE:END tufte-inline/main.js>>>*/
});

defineSubmodule({
  key: "sidenotes",
  id: "tufte-sidenotes",
  name: "Tufte Sidenotes",
  version: "1.7.0",
  blurb: "Sidenotes and marginnotes in Reading view."
}, function (module, exports, require) {
/*<<<TUFTE-SUITE:BEGIN tufte-sidenotes/main.js v1.7.0>>>*/
const { MarkdownRenderer, Plugin, TFile } = require("obsidian");

// New recommended syntax:
//   > [!sidenote] 1
//   > body text
// Obsidian renders the "1" into `.callout-title-inner` itself, so the
// label is in the DOM from the moment the widget mounts — no plugin
// write, no flicker, no chance of a wrong number flashing through.
//
// Legacy syntax stays supported:
//   > [!sidenote]
//   > [^N]: body text
// For legacy, the plugin rewrites the auto-fallback title to N and (in
// Reading view) hydrates the body from the footnote definition.
//
// The editor/CodeMirror surface intentionally stays single-column:
// sidenotes and marginnotes are ordinary callouts there. Marginalia
// rendering is reserved for Reading view so the source stays easy to edit.

const SIDENOTE_START_RE = /^\s*>\s*\[!sidenote\][+-]?(?:\s+(.*))?$/i;
const BLOCKQUOTE_LINE_RE = /^\s*>\s?(.*)$/;
const FOOTNOTE_DEF_RE = /^\s*\[\^([^\]]+)\]:\s?(.*)$/;
const FOOTNOTE_REF_RE = /\[\^([^\]\s]+)\]/g;
const FENCE_RE = /^\s*(```|~~~)/;
const AUTO_TITLE_RE = /^sidenote$/i;
const ENABLED_CLASS = "tufte-sidenotes-enabled";
const MARGINNOTE_REVEALED_CLASS = "tufte-marginnote-revealed";
// Mirror the stylesheet's `@container tufte-pane (max-width: 760px)` collapse
// breakpoint. The CSS hides the marginalia and turns the markers into toggles
// at this pane width; the tap handler must agree about when that's in effect.
const COLLAPSE_BREAKPOINT_PX = 760;

module.exports = class TufteSidenotesPlugin extends Plugin {
  async onload() {
    this.pendingHydrates = new WeakMap();
    this.refreshScheduled = false;
    this.syncEnabledClass();
    this.register(() => {
      document.body?.classList.remove(ENABLED_CLASS);
      document.documentElement?.classList.remove(ENABLED_CLASS);
    });

    this.registerMarkdownPostProcessor((el, ctx) => {
      // Synchronous work first: inline `[^N]` markers in prose. Doing
      // this in the postprocessor body — not a deferred RAF — means the
      // wrapped <sup> is in place before Obsidian hands the section
      // back to its renderer, so it always paints with the styling.
      if (this.syncEnabledClass() && isReadingViewContent(el)) {
        labelReadingViewInlineRefsFromBrackets(el);
        wrapLiteralFootnoteRefsAsSup(el);
        // Obsidian's renderer silently strips `[^N]` (no matching
        // `[^N]:` definition) to bare lowercased text — no <sup>, no
        // class — leaving CSS nothing to target. Use the section's
        // source markdown to find each ref's position and wrap the
        // corresponding stripped text into a <sup class="tufte-sidenote-ref">.
        const sectionInfo = getSectionInfo(ctx, el);
        if (sectionInfo?.text) {
          wrapStrippedFootnoteRefsFromSource(el, sectionInfo.text);
        } else {
          this.queueStrippedWrap(el, ctx);
        }
        // Defer legacy [^N]:-body callout hydration: it needs an async
        // source read and a render-markdown round-trip.
        this.queueHydrate(el, ctx);
      }
    });

    this.registerLivePreviewObserver();
    this.registerCollapsedNoteReveal();
    this.registerMarginaliaCommands();
  }

  registerMarginaliaCommands() {
    this.addCommand({
      id: "insert-sidenote",
      name: "Insert sidenote at cursor",
      editorCallback: (editor) => insertSidenoteAtCursor(editor)
    });
    this.addCommand({
      id: "insert-marginnote",
      name: "Insert marginnote after paragraph",
      editorCallback: (editor) => insertMarginnoteAtCursor(editor)
    });
    this.addCommand({
      id: "insert-epigraph",
      name: "Insert epigraph after paragraph",
      editorCallback: (editor) => insertEpigraphAtCursor(editor)
    });
  }

  syncEnabledClass() {
    const enabled = this.isTufteThemeActive();
    document.body?.classList.toggle(ENABLED_CLASS, enabled);
    document.documentElement?.classList.toggle(ENABLED_CLASS, enabled);
    return enabled;
  }

  registerCollapsedNoteReveal() {
    // When the PANE is narrow (≤760px — sidebars open, a split, or a real
    // phone), sidenote callouts are hidden by the stylesheet's
    // `@container tufte-pane (max-width: 760px)` rule, exactly like tufte-css
    // on a small screen. Clicking the matching `[^N]` marker — the numeric
    // superscript, which we deliberately keep visible — toggles
    // `tufte-sidenote-revealed` on the callout so it drops into the flow next
    // to its caller. Clicking the revealed callout (or its number again)
    // dismisses it.
    //
    // Marginnotes have no number, so they collapse to a ⊕ glyph (the callout
    // title) that toggles the body, following tufte-css's marginnote toggle.
    //
    // The handler runs in the CAPTURE phase so it can intercept the
    // click before CodeMirror moves the cursor into the callout source.
    const handler = (event) => {
      if (!this.syncEnabledClass()) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".markdown-source-view.mod-cm6")) return;
      if (!isCollapsedPane(target)) return;

      const marginnoteTitle = target.closest(
        '.markdown-preview-view .callout[data-callout="marginnote"] .callout-title'
      );
      if (marginnoteTitle) {
        const marginnote = marginnoteTitle.closest(
          '.callout[data-callout="marginnote"]'
        );
        if (marginnote) {
          toggleMarginnote(marginnote);
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      // Tapped a revealed sidenote itself → dismiss it.
      const revealedCallout = target.closest(
        '.callout[data-callout="sidenote"].tufte-sidenote-revealed'
      );
      if (revealedCallout) {
        revealedCallout.classList.remove("tufte-sidenote-revealed");
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      // Tapped an inline marker → toggle the matching sidenote.
      const marker = target.closest(
        ".markdown-preview-view sup.tufte-sidenote-ref, .markdown-preview-view sup.footnote-ref"
      );
      if (!marker) return;

      const label = readMarkerLabel(marker);
      if (!label) return;

      const view = marker.closest(".markdown-preview-view");
      if (!view) return;

      const callouts = Array.from(
        view.querySelectorAll('.callout[data-callout="sidenote"]')
      );
      const match = callouts.find((callout) => {
        const title = callout
          .querySelector(".callout-title-inner")
          ?.textContent?.trim();
        return title && title === label;
      });
      if (!match) return;

      // Hide any other open sidenotes in the same view so only one is
      // revealed at a time — keeps the flow scannable on a small screen.
      for (const other of callouts) {
        if (other !== match) other.classList.remove("tufte-sidenote-revealed");
      }
      match.classList.toggle("tufte-sidenote-revealed");

      // Scroll the freshly-revealed note into view. Skip on dismiss.
      if (match.classList.contains("tufte-sidenote-revealed")) {
        match.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }

      event.preventDefault();
      event.stopPropagation();
    };

    // Capture phase so we beat CodeMirror's own click handler.
    this.registerDomEvent(document, "click", handler, { capture: true });

    const keyHandler = (event) => {
      if (!this.syncEnabledClass()) return;
      if (event.key !== "Enter" && event.key !== " ") return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".markdown-source-view.mod-cm6")) return;
      if (!isCollapsedPane(target)) return;
      const marginnoteTitle = target.closest(
        '.markdown-preview-view .callout[data-callout="marginnote"] .callout-title'
      );
      if (!marginnoteTitle) return;

      const marginnote = marginnoteTitle.closest(
        '.callout[data-callout="marginnote"]'
      );
      if (!marginnote) return;

      toggleMarginnote(marginnote);
      event.preventDefault();
      event.stopPropagation();
    };
    this.registerDomEvent(document, "keydown", keyHandler, { capture: true });
  }

  registerLivePreviewObserver() {
    const refresh = () => this.scheduleRefresh();
    // childList only — attribute changes (the plugin's own dataset writes,
    // cursor blink class toggles) and characterData (live word counts) would
    // otherwise re-enter and amplify any flicker.
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });

    const themeObserver = new MutationObserver(refresh);
    themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "style"]
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"]
    });

    this.register(() => {
      observer.disconnect();
      themeObserver.disconnect();
    });
    this.registerEvent(this.app.workspace.on("file-open", refresh));
    this.registerEvent(this.app.workspace.on("active-leaf-change", refresh));
    this.registerEvent(this.app.workspace.on("layout-change", refresh));
    refresh();
  }

  scheduleRefresh() {
    if (this.refreshScheduled) return;
    this.refreshScheduled = true;
    window.requestAnimationFrame(() => {
      this.refreshScheduled = false;
      this.refreshLivePreview();
    });
  }

  refreshLivePreview() {
    if (!this.syncEnabledClass()) return;

    document.querySelectorAll(".markdown-preview-view").forEach((root) => {
      // Title-based labelling for every visible sidenote callout. New
      // syntax callouts already have the right title — we just clear the
      // "untitled" class if it was set on a previous pass. Legacy callouts
      // need their auto-fallback title rewritten to the [^N]:-derived label.
      root
        .querySelectorAll('.callout[data-callout="sidenote"]')
        .forEach((callout) => ensureSidenoteTitleLabel(callout));

      root
        .querySelectorAll('.callout[data-callout="marginnote"]')
        .forEach((callout) => ensureMarginnoteToggle(callout));

      // Reading view: wrap any literal [^N] markers and relabel existing
      // `sup.footnote-ref` nodes. The markdown postprocessor handles this
      // too on desktop, but Obsidian Mobile occasionally renders sections
      // without firing the postprocessor for our plugin in time — running
      // it from the observer as well is harmless (idempotent) and rescues
      // those cases. The walker skips already-wrapped elements.
      labelReadingViewInlineRefsFromBrackets(root);
      wrapLiteralFootnoteRefsAsSup(root);
    });

    // Stripped-ref wrap needs the source markdown (Obsidian's renderer
    // drops `[^N]` chars from the DOM). Per markdown leaf, read the
    // current source via the view, then wrap. This is what catches
    // file switches and re-renders that the per-section postprocessor
    // missed — the postprocessor only fires for *new* sections, so
    // anything Obsidian served from cache stays unwrapped without this
    // observer-side pass.
    const leaves = this.app.workspace.getLeavesOfType?.("markdown") || [];
    for (const leaf of leaves) {
      const view = leaf.view;
      if (!view) continue;
      const root = view.containerEl?.querySelector(".markdown-preview-view");
      if (!root) continue;
      let source = "";
      try {
        if (typeof view.getViewData === "function") {
          source = view.getViewData() || "";
        }
      } catch {}
      if (source) {
        wrapStrippedFootnoteRefsFromSource(root, source);
      }
    }
  }

  queueHydrate(el, ctx) {
    const win = el.ownerDocument?.defaultView || window;
    const sectionInfo = getSectionInfo(ctx, el);
    const sourcePath = ctx.sourcePath;
    const ticket = Symbol(sourcePath);

    this.pendingHydrates.set(el, ticket);
    win.requestAnimationFrame(() => {
      if (this.pendingHydrates.get(el) === ticket) {
        this.hydrate(el, sourcePath, ticket, sectionInfo);
      }
    });
  }

  async queueStrippedWrap(el, ctx) {
    // Async fallback when ctx.getSectionInfo(el).text isn't available.
    // Read the source file, slice the section's line range, and wrap.
    const sectionInfo = getSectionInfo(ctx, el);
    if (!sectionInfo || !ctx.sourcePath) return;
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;
    const source = await this.app.vault.cachedRead(file);
    const sectionSource = getSectionSource(source, sectionInfo);
    if (sectionSource) {
      wrapStrippedFootnoteRefsFromSource(el, sectionSource);
    }
  }

  async hydrate(root, sourcePath, ticket, sectionInfo) {
    if (!this.syncEnabledClass()) return;

    // Inline-ref wrapping/relabelling already happened synchronously in
    // the postprocessor body. This deferred phase only handles legacy
    // `[^N]:`-body callouts that need an async source read.

    const callouts = Array.from(
      root.querySelectorAll('.callout[data-callout="sidenote"]')
    );
    if (!callouts.length) {
      removeFootnoteTail(root);
      removeFootnoteTail(getDocumentRoot(root));
      return;
    }

    // For each callout, first try to read the new-syntax title. If the
    // title is the auto-fallback "Sidenote", we're looking at the legacy
    // syntax and need to hydrate the body from source.
    let source = null;
    let legacySidenotes = null;

    for (const callout of callouts) {
      const titleLabel = readExplicitTitleLabel(callout);
      if (titleLabel != null) {
        // New syntax: the title is the label and the body is whatever
        // Obsidian already rendered. Nothing to do.
        callout.classList.remove("tufte-sidenote-untitled");
        callout.dataset.tufteFootnoteId = titleLabel;
        continue;
      }

      // Legacy syntax — need source to find the [^N]: body for this
      // callout. Read it once per hydrate call.
      if (source === null) {
        const file = this.app.vault.getAbstractFileByPath(sourcePath);
        if (!(file instanceof TFile)) break;
        source = await this.app.vault.cachedRead(file);
        if (this.pendingHydrates.get(root) !== ticket) return;
      }
      if (legacySidenotes === null) {
        const refs = parseFootnoteReferences(source);
        legacySidenotes = parseSidenoteDefinitions(source, refs).filter(Boolean);
      }

      const sectionSource = getSectionSource(source, sectionInfo);
      const localSidenotes = sectionSource
        ? parseSidenoteDefinitions(
            sectionSource,
            parseFootnoteReferences(source)
          ).filter(Boolean)
        : filterSidenotesBySection(legacySidenotes, sectionInfo);

      // Match this callout to a legacy sidenote: prefer the section-local
      // list (DOM order = source order inside one rendered section), fall
      // back to text-content match against the full list.
      const sidenote =
        localSidenotes[callouts.indexOf(callout) % localSidenotes.length] ||
        findLegacySidenoteByText(callout, legacySidenotes);
      if (!sidenote) {
        callout.classList.add("tufte-sidenote-untitled");
        continue;
      }
      callout.classList.remove("tufte-sidenote-untitled");
      await this.hydrateLegacyCallout(callout, sidenote, sourcePath);
    }

    removeFootnoteTail(root);
    removeFootnoteTail(getDocumentRoot(root));
  }

  isTufteThemeActive() {
    // Desktop: vault config exposes the active CSS theme name.
    try {
      if (this.app.vault.getConfig?.("cssTheme") === "Tufte") return true;
    } catch {}
    // Mobile / fallback: vault.getConfig may be unavailable. Detect the
    // theme by probing for a CSS variable it defines (--tufte-accent).
    // Try every plausible anchor — body, documentElement, and the
    // active markdown view — because Obsidian's mobile build sometimes
    // sets the theme classes on `<html>` rather than `<body>`.
    try {
      const targets = [
        document.body,
        document.documentElement,
        document.querySelector(".workspace-leaf.mod-active") ||
          document.querySelector(".markdown-source-view, .markdown-preview-view")
      ].filter(Boolean);
      for (const target of targets) {
        const probe = getComputedStyle(target)
          .getPropertyValue("--tufte-accent")
          .trim();
        if (probe.length > 0) return true;
      }
    } catch {}
    return false;
  }

  async hydrateLegacyCallout(callout, sidenote, sourcePath) {
    const content = callout.querySelector(".callout-content");
    if (!content) return;

    const signature = hashText(
      `${sidenote.id}\n${sidenote.label}\n${sidenote.markdown}`
    );
    if (
      callout.dataset.tufteSidenoteHash === signature &&
      callout.dataset.tufteFootnoteId === sidenote.id
    ) {
      // Already rendered with the same source — but the title may have
      // been re-mounted, so re-stamp that.
      writeTitleLabel(callout, sidenote.label);
      return;
    }

    callout.dataset.tufteFootnoteId = sidenote.id;
    callout.dataset.tufteSidenoteHash = signature;

    while (content.firstChild) content.removeChild(content.firstChild);
    await renderMarkdown(this.app, sidenote.markdown, content, sourcePath, this);
    writeTitleLabel(callout, sidenote.label);
  }
};

function isReadingViewContent(el) {
  if (!el?.closest) return false;
  if (el.closest(".markdown-source-view.mod-cm6")) return false;
  return Boolean(el.closest(".markdown-preview-view"));
}

function isCollapsedPane(el) {
  // Marginalia collapse is driven by the stylesheet's
  // `@container tufte-pane (max-width: 760px)` rule, which measures the
  // reading-view PANE — not the window. Mirror that here so clicks toggle
  // exactly when the CSS has collapsed the notes (e.g. a narrow pane inside a
  // wide window with the sidebars open). `.markdown-reading-view` is the
  // theme's `tufte-pane` container; its clientWidth is the content-box inline
  // size the container query compares against.
  const pane = el?.closest?.(".markdown-reading-view");
  if (!pane) return false;
  return pane.clientWidth <= COLLAPSE_BREAKPOINT_PX;
}

function readMarkerLabel(marker) {
  // Trust an explicit label first; older plugin versions and some DOM
  // shapes may still expose one.
  if (marker.dataset?.tufteLabel) return marker.dataset.tufteLabel.trim();

  const text = (marker.textContent || "").trim();

  // Literal [^N] text — strip the caret-bracket.
  const bracketedWithCaret = extractBracketedFootnoteRefLabel(text);
  if (bracketedWithCaret) return bracketedWithCaret;

  // Plain [N] (some Obsidian skins render sup.footnote-ref this way).
  const bracketedPlain = text.match(/^\[(.+)\]$/);
  if (bracketedPlain) return bracketedPlain[1].trim();

  // Legacy DOM (sup.footnote-ref > a.footnote-link): the anchor inside
  // carries the visible label.
  const link = marker.querySelector?.("a.footnote-link");
  if (link) return (link.textContent || "").trim();

  return text || null;
}

function ensureSidenoteTitleLabel(callout) {
  const titleInner = callout.querySelector(".callout-title-inner");
  if (!titleInner) return;

  const currentText = (titleInner.textContent || "").trim();

  if (currentText && !AUTO_TITLE_RE.test(currentText)) {
    // New-syntax callout: Obsidian rendered the user's title verbatim.
    // Nothing to write, just clear the untitled flag if it lingers.
    if (callout.classList.contains("tufte-sidenote-untitled")) {
      callout.classList.remove("tufte-sidenote-untitled");
    }
    if (callout.dataset.tufteFootnoteId !== currentText) {
      callout.dataset.tufteFootnoteId = currentText;
    }
    return;
  }

  // Legacy / unlabelled: look for `[^N]:` in the body and use N.
  const content = callout.querySelector(".callout-content");
  const legacyId = extractFootnoteIdFromText(content?.textContent || "");
  if (legacyId) {
    writeTitleLabel(callout, legacyId);
    return;
  }

  // No recoverable label — collapse the title block.
  if (!callout.classList.contains("tufte-sidenote-untitled")) {
    callout.classList.add("tufte-sidenote-untitled");
  }
}

function readExplicitTitleLabel(callout) {
  const titleInner = callout.querySelector(".callout-title-inner");
  if (!titleInner) return null;
  const text = (titleInner.textContent || "").trim();
  if (!text || AUTO_TITLE_RE.test(text)) return null;
  return text;
}

function writeTitleLabel(callout, label) {
  if (!callout) return;
  const titleInner = callout.querySelector(".callout-title-inner");
  if (titleInner && titleInner.textContent !== label) {
    titleInner.textContent = label;
  }
  if (callout.classList.contains("tufte-sidenote-untitled")) {
    callout.classList.remove("tufte-sidenote-untitled");
  }
  if (callout.dataset.tufteFootnoteId !== label) {
    callout.dataset.tufteFootnoteId = label;
  }
}

function ensureMarginnoteToggle(callout) {
  const title = callout.querySelector(".callout-title");
  if (!title) return;

  title.setAttribute("role", "button");
  title.setAttribute("tabindex", "0");
  title.setAttribute("aria-label", "Toggle margin note");
  title.setAttribute(
    "aria-expanded",
    callout.classList.contains(MARGINNOTE_REVEALED_CLASS) ? "true" : "false"
  );
}

function toggleMarginnote(callout) {
  const expanded = !callout.classList.contains(MARGINNOTE_REVEALED_CLASS);
  callout.classList.toggle(MARGINNOTE_REVEALED_CLASS, expanded);
  ensureMarginnoteToggle(callout);
}

// --- inline marker handling ---------------------------------------------

function labelReadingViewInlineRefsFromBrackets(root) {
  root.querySelectorAll("sup.footnote-ref > a.footnote-link").forEach((link) => {
    // The href Obsidian writes encodes the source label after `fn-`,
    // e.g. <a href="#fn-1-..."> or <a href="#fn-demo-...">.
    const label =
      labelFromHref(link.getAttribute("href")) ||
      labelFromHref(link.id) ||
      extractVisibleFootnoteLabel(link);
    if (!label) return;
    if (link.textContent !== label) {
      link.textContent = label;
    }
    const aria = `Sidenote ${label}`;
    if (link.getAttribute("aria-label") !== aria) {
      link.setAttribute("aria-label", aria);
    }
  });
}

function wrapStrippedFootnoteRefsFromSource(root, sectionSource) {
  // Obsidian's renderer drops `[^N]` when no `[^N]:` definition exists,
  // emitting the label as bare lowercased text concatenated into the
  // surrounding paragraph. To restore a styleable marker we have to use
  // the *source* markdown (where `[^N]` is still intact) to find each
  // ref's location, then locate the corresponding stripped label in the
  // rendered DOM and wrap it in <sup class="tufte-sidenote-ref">N</sup>.
  if (!sectionSource) return;

  try {
    // Skip refs inside fenced code blocks — those are documentation of
    // the syntax, not actual references. The same code-fence tracking
    // the legacy `parseSidenoteDefinitions` uses.
    const lines = sectionSource.split(/\r?\n/);
    let inFence = false;
    const lineStartIdx = [];
    let cursor = 0;
    for (let i = 0; i < lines.length; i++) {
      lineStartIdx[i] = cursor;
      cursor += lines[i].length + 1; // +1 for the \n that was removed
    }
    const fencedRanges = [];
    let fenceStart = -1;
    for (let i = 0; i < lines.length; i++) {
      if (FENCE_RE.test(lines[i])) {
        if (inFence) {
          fencedRanges.push([fenceStart, lineStartIdx[i] + lines[i].length]);
          inFence = false;
        } else {
          fenceStart = lineStartIdx[i];
          inFence = true;
        }
      }
    }
    const isInFence = (idx) =>
      fencedRanges.some(([s, e]) => idx >= s && idx < e);

    const refRe = /\[\^([^\]\s]+)\]/g;
    const refs = [];
    let m;
    while ((m = refRe.exec(sectionSource))) {
      // Skip definitions (`[^N]:`).
      if (sectionSource[m.index + m[0].length] === ":") continue;
      // Skip refs inside fenced code blocks.
      if (isInFence(m.index)) continue;
      // Skip refs inside inline code spans on the same line. Walk
      // backtick runs: each *run* of one or more backticks toggles the
      // in-code state. (The old per-character toggle missed the case
      // where `[^N]` followed a closing backtick at the end of the
      // scan window, leaving state stuck as "in code".)
      const lineStart = sectionSource.lastIndexOf("\n", m.index) + 1;
      const lineEnd = sectionSource.indexOf("\n", m.index);
      const line = sectionSource.slice(
        lineStart,
        lineEnd === -1 ? sectionSource.length : lineEnd
      );
      const offsetInLine = m.index - lineStart;
      let inInlineCode = false;
      let i = 0;
      while (i < offsetInLine) {
        if (line[i] === "`") {
          while (i < offsetInLine && line[i] === "`") i++;
          inInlineCode = !inInlineCode;
        } else {
          i++;
        }
      }
      if (inInlineCode) continue;

      refs.push({ label: m[1], sourceIndex: m.index });
    }
    if (!refs.length) return;

    for (const ref of refs) {
      wrapOneStrippedRef(root, ref, sectionSource);
    }
  } catch (e) {
    // Never let a wrap error break the rendered page.
    console.error("tufte-sidenotes: wrapStrippedFootnoteRefsFromSource", e);
  }
}

function wrapOneStrippedRef(root, ref, sectionSource) {
  // Build a prefix from the ~30 source chars before `[^N]`. Strip the
  // markdown that becomes its own DOM element in the rendered output:
  //   - whole inline-code spans `…`     (Obsidian wraps in <code>, which
  //                                       the walker skips entirely)
  //   - link syntax [text](url)         (we keep the text, drop the URL)
  //   - emphasis chars * and _          (Obsidian wraps in <em>/<strong>
  //                                       but those wrappers don't break
  //                                       the surrounding text node)
  // Keep whitespace as-is — Obsidian preserves the space between
  // surrounding text and the stripped label, so the prefix must too.
  let prefixSource = sectionSource.slice(
    Math.max(0, ref.sourceIndex - 30),
    ref.sourceIndex
  );
  prefixSource = prefixSource.replace(/`+[^`]*`+/g, "");
  prefixSource = prefixSource.replace(/\[([^\]]*)\]\([^\)]*\)/g, "$1");
  prefixSource = prefixSource.replace(/[\*_]/g, "");
  prefixSource = prefixSource.replace(/\s+/g, " ");
  const prefix = prefixSource.slice(-12);
  if (prefix.replace(/\s/g, "").length < 2) return false;

  const renderedLabel = ref.label.toLowerCase();
  const target = prefix + renderedLabel;

  // Walk the rendered DOM, collect every accepted text node, and search
  // their concatenation. A per-node search would miss matches whose
  // prefix straddles a skipped element like <code>…</code> — e.g.
  // source `and \`demo\`[^2]` renders as text(", and "), <code>demo</code>,
  // text("2."), and the prefix "and " ends in one node while the label
  // is in another.
  const skipParentSelector =
    "code, pre, .callout-title, .tufte-sidenote-ref, sup, .footnote-link, .footnote-ref, a";
  const textNodes = [];
  const walker = (root.ownerDocument || document).createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest(skipParentSelector)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);
  if (!textNodes.length) return false;

  const offsets = new Array(textNodes.length);
  let total = 0;
  for (let i = 0; i < textNodes.length; i++) {
    offsets[i] = total;
    total += textNodes[i].nodeValue.length;
  }
  const concat = textNodes.map((t) => t.nodeValue).join("");

  const idx = concat.indexOf(target);
  if (idx === -1) return false;

  const labelStartGlobal = idx + prefix.length;
  let nodeIdx = 0;
  while (
    nodeIdx < textNodes.length - 1 &&
    offsets[nodeIdx + 1] <= labelStartGlobal
  ) {
    nodeIdx++;
  }
  const node = textNodes[nodeIdx];
  const localOffset = labelStartGlobal - offsets[nodeIdx];
  if (
    localOffset < 0 ||
    localOffset + ref.label.length > node.nodeValue.length
  ) {
    return false;
  }

  const labelNode = node.splitText(localOffset);
  labelNode.splitText(ref.label.length);

  const sup = (root.ownerDocument || document).createElement("sup");
  sup.className = "tufte-sidenote-ref";
  sup.textContent = ref.label;
  sup.setAttribute("aria-label", `Sidenote ${ref.label}`);
  labelNode.parentNode.replaceChild(sup, labelNode);
  return true;
}

function wrapLiteralFootnoteRefsAsSup(root) {
  // Without a `[^N]:` definition, Obsidian's Reading-view renderer leaves
  // `[^N]` as literal text inside a paragraph. Walk those text nodes and
  // replace each match with a <sup class="tufte-sidenote-ref">N</sup>.
  // Skip code, pre, links, the callout title (which we use as the margin
  // label) and any text we've already wrapped on a previous pass.
  const skipParentSelector =
    'code, pre, a, .callout-title, .tufte-sidenote-ref, sup.footnote-ref';
  const candidates = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.includes("[^")) {
        return NodeFilter.FILTER_REJECT;
      }
      if (node.parentElement?.closest(skipParentSelector)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let node;
  while ((node = walker.nextNode())) candidates.push(node);

  for (const textNode of candidates) {
    const text = textNode.nodeValue;
    const matches = Array.from(text.matchAll(/\[\^([^\]\s]+)\]/g));
    // Skip definitions: `[^N]:` is a footnote DEFINITION, not a call site.
    const refMatches = matches.filter(
      (m) => text[m.index + m[0].length] !== ":"
    );
    if (!refMatches.length) continue;

    const doc = textNode.ownerDocument;
    const fragment = doc.createDocumentFragment();
    let lastEnd = 0;
    for (const m of refMatches) {
      const before = text.slice(lastEnd, m.index);
      if (before) fragment.appendChild(doc.createTextNode(before));
      const sup = doc.createElement("sup");
      sup.className = "tufte-sidenote-ref";
      sup.textContent = m[1];
      sup.setAttribute("aria-label", `Sidenote ${m[1]}`);
      fragment.appendChild(sup);
      lastEnd = m.index + m[0].length;
    }
    const tail = text.slice(lastEnd);
    if (tail) fragment.appendChild(doc.createTextNode(tail));
    textNode.parentNode.replaceChild(fragment, textNode);
  }
}

function labelFromHref(value) {
  if (!value) return null;
  const hashIndex = value.indexOf("#");
  const raw = hashIndex === -1 ? value : value.slice(hashIndex + 1);
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const m = decoded.match(/^fn(?:ref)?-(.+?)(?:-[A-Za-z0-9]+)?$/i);
  if (m) return m[1];
  return null;
}

// --- legacy parsers (unchanged shape) -----------------------------------

function parseSidenoteDefinitions(source, references = parseFootnoteReferences(source)) {
  const lines = source.split(/\r?\n/);
  const sidenotes = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }

    if (inFence || !SIDENOTE_START_RE.test(lines[i])) continue;

    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const match = lines[j].match(BLOCKQUOTE_LINE_RE);
      if (!match) break;
      body.push(match[1]);
    }

    const definition = extractFirstFootnoteDefinition(body);
    if (!definition) {
      sidenotes.push(null);
      continue;
    }

    const key = normalizeFootnoteId(definition.id);
    sidenotes.push({
      id: definition.id,
      lineStart: i,
      lineEnd: definition.lineEnd + i + 1,
      markdown: definition.markdown,
      label: references.byKey.get(key) || definition.id.trim()
    });
  }

  return sidenotes;
}

function extractFirstFootnoteDefinition(lines) {
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(FOOTNOTE_DEF_RE);
    if (!match) continue;

    const body = [match[2]];
    for (let j = i + 1; j < lines.length; j++) {
      if (FOOTNOTE_DEF_RE.test(lines[j])) break;
      body.push(lines[j].replace(/^\s{2,4}/, ""));
    }

    return {
      id: match[1],
      lineEnd: i + body.length - 1,
      markdown: body.join("\n").trim()
    };
  }

  return null;
}

function parseFootnoteReferences(source) {
  const lines = source.split(/\r?\n/);
  const ordered = [];
  const byKey = new Map();
  let inFence = false;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const rawLine = lines[lineNumber];

    if (FENCE_RE.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const line = stripInlineCode(rawLine);

    FOOTNOTE_REF_RE.lastIndex = 0;
    let match;
    while ((match = FOOTNOTE_REF_RE.exec(line))) {
      const nextChar = line[match.index + match[0].length];
      if (nextChar === ":") continue;

      const label = match[1].trim();
      const key = normalizeFootnoteId(label);
      ordered.push({
        key,
        label,
        line: lineNumber
      });
      if (!byKey.has(key)) {
        byKey.set(key, label);
      }
    }
  }

  return { ordered, byKey };
}

function findLegacySidenoteByText(callout, sidenotes) {
  const text = normalizeRenderedText(callout.textContent);
  if (!text) return null;
  for (const sidenote of sidenotes) {
    if (!sidenote?.markdown) continue;
    const md = normalizeRenderedText(sidenote.markdown);
    if (md && (text.includes(md) || md.includes(text))) {
      return sidenote;
    }
  }
  return null;
}

function getSectionInfo(ctx, el) {
  try {
    return ctx.getSectionInfo?.(el) || null;
  } catch {
    return null;
  }
}

function getSectionSource(source, sectionInfo) {
  if (typeof sectionInfo?.text === "string") {
    return sectionInfo.text;
  }

  if (!hasLineRange(sectionInfo)) return null;

  return source
    .split(/\r?\n/)
    .slice(sectionInfo.lineStart, sectionInfo.lineEnd + 1)
    .join("\n");
}

function filterSidenotesBySection(sidenotes, sectionInfo) {
  if (!hasLineRange(sectionInfo)) return sidenotes;

  return sidenotes.filter(
    (sidenote) =>
      sidenote &&
      isLineInSection(sidenote.lineStart, sectionInfo) &&
      isLineInSection(sidenote.lineEnd, sectionInfo)
  );
}

function hasLineRange(sectionInfo) {
  return (
    sectionInfo &&
    Number.isFinite(sectionInfo.lineStart) &&
    Number.isFinite(sectionInfo.lineEnd)
  );
}

function isLineInSection(line, sectionInfo) {
  return line >= sectionInfo.lineStart && line <= sectionInfo.lineEnd;
}

function extractFootnoteIdFromText(text) {
  const match = String(text || "").match(/\[\^([^\]]+)\]:/);
  return match?.[1]?.trim() || "";
}

function extractBracketedFootnoteRefLabel(text) {
  const match = String(text || "").match(/\[\^([^\]\s]+)\]/);
  return match?.[1]?.trim() || "";
}

function extractVisibleFootnoteLabel(link) {
  const text = (link.textContent || "").trim();
  const match = text.match(/^\[(.+)\]$/);
  return match ? match[1] : text;
}

function normalizeRenderedText(text) {
  return String(text || "")
    .replace(/\[\^[^\]]+\]:/g, "")
    .replace(/[`*_~\[\]()#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function removeFootnoteTail(root) {
  if (!root) return;
  root
    .querySelectorAll(
      '.footnotes, ol:has(> li[data-footnote-id^="fn-"]), ol:has(> li[id^="fn-"])'
    )
    .forEach((node) => node.remove());
}

function getDocumentRoot(root) {
  return (
    root.closest?.(".markdown-preview-view") ||
    root.closest?.(".markdown-rendered") ||
    root
  );
}

async function renderMarkdown(app, markdown, el, sourcePath, component) {
  if (MarkdownRenderer.render) {
    await MarkdownRenderer.render(app, markdown || " ", el, sourcePath, component);
    return;
  }

  await MarkdownRenderer.renderMarkdown(markdown || " ", el, sourcePath, component);
}

function normalizeFootnoteId(id) {
  return String(id).trim().toLowerCase();
}

function stripInlineCode(line) {
  return line.replace(/`+[^`]*`+/g, "");
}

function uniqueElements(nodes) {
  return Array.from(new Set(Array.from(nodes)));
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return String(hash);
}

// --- editor commands: insert marginalia at cursor ----------------------

function insertSidenoteAtCursor(editor) {
  const cursor = editor.getCursor();
  const source = editor.getValue();
  const label = String(nextNumericFootnoteLabel(source));

  // Insert [^N] at the cursor (or replace selection).
  editor.replaceRange(`[^${label}]`, cursor);

  // Insert the callout block after the current paragraph, separated by a
  // blank line. Place the cursor inside the callout body so the user can
  // type immediately.
  const paragraphEndLine = findParagraphEndLine(editor, cursor.line);
  insertCalloutBlock(editor, paragraphEndLine, `[!sidenote] ${label}`);
}

function insertMarginnoteAtCursor(editor) {
  const cursor = editor.getCursor();
  const paragraphEndLine = findParagraphEndLine(editor, cursor.line);
  insertCalloutBlock(editor, paragraphEndLine, "[!marginnote]");
}

function insertEpigraphAtCursor(editor) {
  const cursor = editor.getCursor();
  const paragraphEndLine = findParagraphEndLine(editor, cursor.line);
  insertCalloutBlock(editor, paragraphEndLine, "[!epigraph]");
}

function insertCalloutBlock(editor, paragraphEndLine, headerSpec) {
  const lineText = editor.getLine(paragraphEndLine) || "";
  const endCh = lineText.length;
  const isEmpty = /^\s*$/.test(lineText);

  // No blank line between the prose and the callout — the callout sits
  // immediately on the line below the paragraph for tighter typography.
  // If the paragraph-end line itself is already blank (rare — only the
  // cursor-on-trailing-blank case), write the header onto it directly.
  const insertion = isEmpty
    ? `> ${headerSpec}\n> `
    : `\n> ${headerSpec}\n> `;

  editor.replaceRange(insertion, { line: paragraphEndLine, ch: endCh });

  // Body line offset: 2 newlines before the body when prepending "\n",
  // 1 newline when written onto an existing blank line.
  const bodyLine = paragraphEndLine + (isEmpty ? 1 : 2);
  editor.setCursor({ line: bodyLine, ch: 2 });
  editor.focus?.();
}

function findParagraphEndLine(editor, fromLine) {
  const last = editor.lineCount() - 1;
  let i = Math.min(Math.max(fromLine, 0), last);
  while (i < last) {
    const next = editor.getLine(i + 1) || "";
    // Stop on blank line, heading boundary, or block boundary so the
    // callout lands at the end of the prose paragraph (or current
    // block), not several paragraphs down.
    if (/^\s*$/.test(next)) break;
    if (/^\s*#{1,6}\s/.test(next)) break;
    if (/^\s*(```|~~~)/.test(next)) break;
    i++;
  }
  return i;
}

function nextNumericFootnoteLabel(source) {
  const lines = source.split(/\r?\n/);
  let max = 0;
  let inFence = false;
  for (const rawLine of lines) {
    if (FENCE_RE.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const line = stripInlineCode(rawLine);
    let m;
    const re = /\[\^(\d+)\]/g;
    while ((m = re.exec(line))) {
      const next = line[m.index + m[0].length];
      if (next === ":") continue; // definition, not a ref
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max + 1;
}
/*<<<TUFTE-SUITE:END tufte-sidenotes/main.js>>>*/
});

/* ────────────────────────── Tufte Suite runtime ────────────────────────── */

const MODULES_KEY = "__modules";

class TufteSuiteSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const containerEl = this.containerEl;
    containerEl.empty();

    new obsidian.Setting(containerEl).setName("Bundled plugins").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Tufte Suite bundles the four standalone Tufte plugins as switchable modules. " +
        "Keep the standalone plugins disabled while Tufte Suite is enabled, or " +
        "everything renders twice. Toggling a module applies immediately."
    });

    for (const def of SUBMODULES) {
      new obsidian.Setting(containerEl)
        .setName(def.name)
        .setDesc(def.blurb)
        .addToggle((t) =>
          t.setValue(this.plugin.isModuleEnabled(def.key)).onChange(async (v) => {
            await this.plugin.setModuleEnabled(def.key, v);
            this.display();
          })
        );
    }

    // Per-module settings captured from the sub-plugins (today: Tufte Figures).
    for (const section of this.plugin.settingSections) {
      new obsidian.Setting(containerEl).setName(section.def.name).setHeading();
      section.tab.containerEl = containerEl.createDiv();
      section.tab.display();
    }
  }

  hide() {
    for (const section of this.plugin.settingSections) {
      if (typeof section.tab.hide === "function") {
        try {
          section.tab.hide();
        } catch (e) {
          console.error("Tufte Suite: sub-plugin settings hide() failed", e);
        }
      }
    }
    return super.hide();
  }
}

module.exports = class TufteSuitePlugin extends obsidian.Plugin {
  async onload() {
    this.loadedSubs = [];
    this.settingSections = [];

    // Namespaced storage: one section per module inside the suite's own
    // data.json ({ __modules: {...}, backlinks: ..., figures: ..., ... }).
    // First run imports each standalone plugin's data.json (read-only).
    this.suiteData = await this.loadData();
    const firstRun = !this.suiteData || typeof this.suiteData !== "object";
    if (firstRun) {
      this.suiteData = {};
      await this.importStandaloneSettings();
    }
    if (!this.suiteData[MODULES_KEY] || typeof this.suiteData[MODULES_KEY] !== "object") {
      this.suiteData[MODULES_KEY] = {};
    }
    if (firstRun) await this.saveData(this.suiteData);

    // One-time copy of the figures quilt store into the suite's folder
    // (matches the patched quiltDir() path). Never writes to the source.
    await this.importQuiltStore();

    await this.loadEnabledModules();

    this.addSettingTab(new TufteSuiteSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => this.warnAboutStandalonePlugins());
  }

  isModuleEnabled(key) {
    const m = this.suiteData && this.suiteData[MODULES_KEY];
    return !m || m[key] !== false;
  }

  async setModuleEnabled(key, enabled) {
    this.suiteData[MODULES_KEY][key] = !!enabled;
    await this.saveData(this.suiteData);
    await this.queueReloadModules();
  }

  // Serialize reloads: a second toggle clicked while a reload is mid-flight
  // must queue behind it, not tear down the same loadedSubs array twice
  // (concurrent passes would leave every module instantiated twice).
  queueReloadModules() {
    const run = () => this.reloadModules();
    this._reloadChain = (this._reloadChain || Promise.resolve()).then(run, (e) => {
      console.error("Tufte Suite: previous module reload failed", e);
      return run();
    });
    return this._reloadChain;
  }

  // Unload everything, then reload the enabled modules in canonical order, so
  // registration order after a toggle matches a fresh plugin load.
  async reloadModules() {
    for (const sub of this.loadedSubs.slice().reverse()) {
      this.removeChild(sub);
    }
    this.loadedSubs = [];
    this.settingSections = [];
    await this.loadEnabledModules();
  }

  async loadEnabledModules() {
    for (const def of SUBMODULES) {
      if (!this.isModuleEnabled(def.key)) continue;
      try {
        await this.loadSubPlugin(def);
      } catch (e) {
        console.error("Tufte Suite: failed to load module " + def.id, e);
        new obsidian.Notice(
          'Tufte Suite: module "' + def.name + '" failed to load - see developer console.'
        );
      }
    }
  }

  async loadSubPlugin(def) {
    const manifest = Object.assign({}, this.manifest, {
      id: def.id,
      name: def.name,
      version: def.version,
      description: def.name + " " + def.version + ", bundled in " + this.manifest.name + "."
    });
    const sub = new def.cls(this.app, manifest);
    const suite = this;

    // Persistence shims: the sub-plugin reads/writes its namespaced section of
    // the suite's data.json. Copies mimic Obsidian's fresh-parse semantics.
    sub.loadData = async function () {
      const d = suite.suiteData[def.key];
      return d === undefined || d === null ? null : JSON.parse(JSON.stringify(d));
    };
    sub.saveData = async function (data) {
      suite.suiteData[def.key] = data === undefined ? null : JSON.parse(JSON.stringify(data));
      await suite.saveData(suite.suiteData);
    };

    // Setting tabs are collected into the suite's single tab instead of
    // adding sidebar entries for plugins that aren't installed standalone.
    sub.addSettingTab = function (tab) {
      suite.settingSections.push({ def: def, tab: tab });
    };

    // Load with the semantics Obsidian gives real plugins: sequential, with
    // each module's async onload() awaited before the next module starts.
    // addChild() ties the unload cascade; whether it also load()s the child
    // immediately depends on the parent's internal loaded flag, so call
    // load() as well - Component.load() is a no-op on a loaded component.
    let invoked = false;
    let onloadResult;
    const originalOnload = sub.onload;
    sub.onload = function () {
      invoked = true;
      onloadResult = originalOnload.apply(this, arguments);
      return onloadResult;
    };
    try {
      try {
        this.addChild(sub);
        if (!invoked) sub.load();
      } finally {
        sub.onload = originalOnload;
      }
      if (onloadResult && typeof onloadResult.then === "function") await onloadResult;
    } catch (e) {
      // Detach a half-loaded module so its partial registrations unwind and
      // repeated toggle cycles cannot accumulate dead children.
      this.removeChild(sub);
      throw e;
    }

    this.loadedSubs.push(sub);
    return sub;
  }

  async importStandaloneSettings() {
    const adapter = this.app.vault.adapter;
    for (const def of SUBMODULES) {
      const p = this.app.vault.configDir + "/plugins/" + def.id + "/data.json";
      try {
        if (await adapter.exists(p)) {
          this.suiteData[def.key] = JSON.parse(await adapter.read(p));
        }
      } catch (e) {
        console.warn("Tufte Suite: could not import settings from " + def.id, e);
      }
    }
  }

  async importQuiltStore() {
    const adapter = this.app.vault.adapter;
    // Source and destination deliberately mirror quiltDir()'s literals: the
    // original in tufte-figures and the patched copy embedded above.
    const src = this.app.vault.configDir + "/plugins/tufte-figures/quilts";
    const dst = this.app.vault.configDir + "/plugins/tufte-suite/quilts";
    try {
      if (!(await adapter.exists(src))) return;
      if (await adapter.exists(dst)) return;
      await this.copyFolder(adapter, src, dst);
    } catch (e) {
      console.warn("Tufte Suite: quilt store import failed", e);
    }
  }

  async copyFolder(adapter, src, dst) {
    await adapter.mkdir(dst);
    const listing = await adapter.list(src);
    for (const file of listing.files) {
      const name = file.slice(file.lastIndexOf("/") + 1);
      await adapter.writeBinary(dst + "/" + name, await adapter.readBinary(file));
    }
    for (const folder of listing.folders) {
      const name = folder.slice(folder.lastIndexOf("/") + 1);
      await this.copyFolder(adapter, folder, dst + "/" + name);
    }
  }

  warnAboutStandalonePlugins() {
    try {
      const enabled = this.app.plugins && this.app.plugins.enabledPlugins;
      if (!enabled || typeof enabled.has !== "function") return;
      const dupes = SUBMODULES.filter((d) => enabled.has(d.id)).map((d) => d.name);
      if (dupes.length) {
        new obsidian.Notice(
          "Tufte Suite: " +
            dupes.join(", ") +
            (dupes.length > 1 ? " are" : " is") +
            " also enabled standalone. Disable the standalone version" +
            (dupes.length > 1 ? "s" : "") +
            " to avoid double rendering.",
          10000
        );
      }
    } catch (e) {
      /* advisory only */
    }
  }
};
