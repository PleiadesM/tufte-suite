const { Plugin, editorLivePreviewField } = require("obsidian");
const { ViewPlugin, Decoration, WidgetType } = require("@codemirror/view");
const { RangeSetBuilder } = require("@codemirror/state");
const { syntaxTree } = require("@codemirror/language");

// --- Simplified Chinese UI strings ------------------------------------------
// Keyed by the exact English literal; tzh() falls back to its input, so the
// English behaviour is byte-identical by construction. The lookup is lazy
// (localStorage is read per call) so a language change takes effect without a
// reload of the module.
var TUFTE_ZH = {
  "Wrap selection in New Thought (^^…^^)": "将选区包裹为新思路（^^…^^）",
  "Wrap selection in lead-in (&&…&&)": "将选区包裹为引导词（&&…&&）",
  "Wrap first character in CJK drop cap (@@…@@)": "将首字包裹为中文首字下沉（@@…@@）"
};
function tzh(s) {
  try {
    var l = window.localStorage.getItem("language");
    if (l && String(l).toLowerCase().indexOf("zh") === 0) return TUFTE_ZH[s] || s;
  } catch (e) {}
  return s;
}

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
      name: tzh("Wrap selection in New Thought (^^…^^)"),
      editorCallback: (editor) => wrapSelection(editor, "^^"),
    });
    this.addCommand({
      id: "wrap-leadin",
      name: tzh("Wrap selection in lead-in (&&…&&)"),
      editorCallback: (editor) => wrapSelection(editor, "&&"),
    });
    this.addCommand({
      id: "wrap-dropcap",
      name: tzh("Wrap first character in CJK drop cap (@@…@@)"),
      editorCallback: (editor) => wrapDropcap(editor),
    });
  }
};

/* ---- Reading view: replace delimiters with styled spans ------------------ */

// Obsidian renders nested markup (links, bold, italics, …) into elements
// before this post-processor runs, so a shorthand such as "&&a [[b]] c&&"
// arrives split across several sibling nodes. Matching therefore runs per
// parent element over a virtual string of its direct children: text nodes
// contribute their text, element children collapse to one placeholder
// character — so delimiters inside a child element can never open or close a
// match here (they are handled when that element is processed as a parent).
const CHILD_PLACEHOLDER = "￼"; // OBJECT REPLACEMENT CHARACTER

function transformInlineSpans(root) {
  const doc = root.ownerDocument || document;
  const parents = [];
  const seen = new Set();
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
  while ((node = walker.nextNode())) {
    const parent = node.parentNode;
    if (parent && !seen.has(parent)) {
      seen.add(parent);
      parents.push(parent);
    }
  }
  for (const parent of parents) transformWithinParent(parent, doc);
}

function transformWithinParent(parent, doc) {
  const segments = [];
  let virtual = "";
  for (const child of parent.childNodes) {
    const isText = child.nodeType === 3; // Node.TEXT_NODE
    const piece = isText ? child.nodeValue : CHILD_PLACEHOLDER;
    segments.push({
      node: child,
      isText,
      start: virtual.length,
      end: virtual.length + piece.length,
    });
    virtual += piece;
  }

  const locate = (pos) => segments.find((s) => pos >= s.start && pos < s.end);

  // Wrap right-to-left: a wrap splits or moves nodes only at or after its own
  // match, so earlier matches' segment references and offsets stay valid.
  const chosen = collectMatches(virtual);
  for (let i = chosen.length - 1; i >= 0; i--) {
    const h = chosen[i];
    const startSeg = locate(h.start);
    const endSeg = locate(h.end - 1);
    // Each delimiter must sit whole inside a text-node child of this parent;
    // a match whose boundary falls inside an element child is left raw.
    if (!startSeg || !startSeg.isText || h.start + DELIM_LEN > startSeg.end) continue;
    if (!endSeg || !endSeg.isText || h.end - DELIM_LEN < endSeg.start) continue;

    const range = doc.createRange();
    range.setStart(startSeg.node, h.start - startSeg.start);
    range.setEnd(endSeg.node, h.end - endSeg.start);
    const frag = range.extractContents();
    frag.firstChild.nodeValue = frag.firstChild.nodeValue.slice(DELIM_LEN);
    frag.lastChild.nodeValue = frag.lastChild.nodeValue.slice(0, -DELIM_LEN);
    const span = doc.createElement("span");
    span.className = h.className;
    span.appendChild(frag);
    range.insertNode(span);
  }
}

/* ---- Live Preview: conceal delimiters + style inner text ----------------- */

// The lead-in's tab-like indent (margin-right in the theme) cannot live on the
// marked text here: CodeMirror splits a mark decoration at every nested-
// decoration boundary (links, bold, italics), and a per-fragment margin would
// open gaps inside the label. The theme zeroes the margin on
// .cm-line .tufte-leadin, and this widget — rendered in place of the concealed
// closing && — carries the indent instead.
class LeadinIndentWidget extends WidgetType {
  toDOM(view) {
    const span = view.dom.ownerDocument.createElement("span");
    span.className = "tufte-leadin-indent";
    return span;
  }
  eq() {
    return true;
  }
}
const leadinIndentConceal = Decoration.replace({
  widget: new LeadinIndentWidget(),
});

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
        builder.add(
          innerEnd,
          end,
          h.className === "tufte-leadin" ? leadinIndentConceal : conceal
        );
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
