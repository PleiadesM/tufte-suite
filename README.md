# Tufte Suite

![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-7B2FBF) ![license MIT](https://img.shields.io/badge/license-MIT-4C9A2A) ![Dark & Light Supported](https://img.shields.io/badge/Dark_%26_Light-Supported-C9A227) ![Mobile Supported](https://img.shields.io/badge/Mobile-Supported-1E88C7)

The companion plugin for the [**Tufte for Obsidian**](https://github.com/PleiadesM/TufteObsidian) theme — sidenotes, figures, inline typography, and rendered backlinks in a single install, each switchable on its own.

This replaces the four separate plugins (Tufte Sidenotes, Tufte Figures, Tufte Inline, Tufte Backlinks). Their code lives on here as the Suite's four modules; the standalone repositories are archived and no longer updated.

## The four modules

| Module | What it does |
|---|---|
| **Tufte Sidenotes** | Renders `[^…]` footnotes and `[!sidenote]` / `[!marginnote]` callouts as true sidenotes in the margin gutter (Reading view), keeping the editor single-column. Marginalia collapse to tap-to-reveal on narrow panes. |
| **Tufte Figures** | Drop or paste an image to compose column, full-width, and margin figures with proper captions; multi-image rows; an image-quilt generator; click-to-enlarge; auto-numbered clickable references. |
| **Tufte Inline** | Inline shorthands, in Reading view *and* Live Preview: `^^text^^` small-caps openers, `&&text&&` italic run-ins, `@@字@@` two-line CJK drop caps. |
| **Tufte Backlinks** | Renders Linked and Unlinked mention snippets as formatted Markdown — headings at body size, the backlink reference itself bold, underlined, accent red. Search is left untouched. |

Every module can be turned off individually in **Settings → Tufte Suite**, so installing the Suite never forces a feature on you. Tufte Figures' own settings (drop interception, label prefix, quilt output folder) live in that same tab.

The plugin renders the structure; the [Tufte theme](https://github.com/PleiadesM/TufteObsidian) supplies the typography. The modules stay dormant unless the Tufte theme is active.

## Install

**Manual (until it reaches the community directory):**

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest).
2. Put all three in `YourVault/.obsidian/plugins/tufte-suite/`.
3. Settings → Community plugins → enable **Tufte Suite**.

### Coming from the four standalone plugins

**Disable Tufte Sidenotes, Tufte Figures, Tufte Inline, and Tufte Backlinks before enabling the Suite** — running both renders everything twice. The Suite shows a notice if it detects one still enabled.

Nothing else is required. On first load the Suite imports each standalone plugin's settings and copies your existing image-quilt store into its own folder, reading the old folders without writing to them, so uninstalling the four is safe afterwards. Command IDs are unchanged (`tufte-figures:insert-figure` and friends), so hotkeys you had bound keep working.

## Requirements

- Obsidian 1.4.0 or newer.
- Desktop and mobile. No network access, no telemetry, no build step to install.

## How this plugin is built

`main.js` is **generated**, and the four modules are kept as real, separate sources under [`src/modules/`](src/modules). The build embeds each module's `main.js` byte-for-byte inside a CommonJS factory wrapper, then appends the Suite runtime that loads them as sub-plugins:

```bash
node build-tufte-suite.js
```

Do not hand-edit `main.js` — edit the module under `src/modules/<id>/` and rebuild. The build refuses to run if the embedded bytes would not match their source, so the bundle can never silently drift from the modules it claims to contain. There is exactly one deliberate deviation from verbatim embedding: Tufte Figures' quilt-store path, rewritten to live under the Suite's own folder. `styles.css` is the modules' stylesheets concatenated in load order (Tufte Inline has none — its styling belongs to the theme).

Module load order — backlinks, figures, inline, sidenotes — is load-bearing rather than cosmetic: sidenotes and figures both register capture-phase document handlers and both claim `marginnote` callouts, and this order reproduces the behavior the four standalone plugins had.

### Tests

An equivalence harness runs each module twice — once standalone, once through the Suite — in two isolated fake-Obsidian environments built on jsdom, and requires the rendered DOM to come out byte-identical:

```bash
cd tests
npm install
node run-all.js
```

Nine groups cover rendered output, command identity, registration and event ordering, settings import and persistence, the settings tab, module toggles, and the unload cascade. See [`tests/README.md`](tests/README.md) for what the harness stubs and what it deliberately cannot reach (CodeMirror Live Preview decorations, canvas quilt generation, and real drag-and-drop need a human in Obsidian).

## Credits

Built alongside the [Tufte for Obsidian](https://github.com/PleiadesM/TufteObsidian) theme, adapted from [Tufte CSS](https://edwardtufte.github.io/tufte-css/) and Edward Tufte's book design.

## License

[MIT](LICENSE) © 2026 Daocheng Lin.

## Changelog

- **1.2.0** (2026-08-14) — the Suite speaks Chinese, and one tab design rules everywhere. When Obsidian's language is Chinese (`zh` / `zh-CN` / `zh-TW`), the entire UI renders in Simplified Chinese — the settings tab with the whole Typefaces console, both figure modals, all commands, and every notice (~150 strings) — via per-module translation tables keyed by the exact English literals, so the English surface is **byte-identical** under any other locale; the four module display names stay English as product names, and nothing the plugins write into notes (the `Fig.` label, callout syntax) ever translates. The figure modal's Basic / Multiple images / Image quilt tabs adopt the Suite settings' own tab grammar — native buttons, the active one on a 2px accent underline — one tab design across the Suite. New test group `t11-i18n` (the harness is now 11 groups): zh rendering, English byte-identity, locale-prefix cases, and standalone-vs-Suite parity. Modules: figures **1.8.0**, sidenotes **1.8.0**, inline **1.3.0** (backlinks stays 1.0.1). Pairs with theme [Tufte 1.18.0](https://github.com/PleiadesM/TufteObsidian/releases/tag/1.18.0), whose Properties polish and Style Settings 中文 land the same day.
- **1.1.0** (2026-08-14) — the suite becomes the Tufte theme's typeface console: a new **Typefaces (Tufte theme)** settings section, split into Latin/Chinese in-page tabs, drives the theme's `--tufte-*` knobs as inline body styles (persisted under a reserved `__typefaces` key; theme defaults restored the moment the Suite is disabled). Latin: serif and sans faces (Monotype-leaning recommendations; the theme-bundled Cabin) with all nine weights each. Chinese: 宋体/黑体 companions with Source Han presets and LXGW WenKai, plus **fixed Chinese weights** — implemented as synthesized `@font-face` remap families over named local cuts, so Chinese can hold a weight independent of the Latin around it while bold keeps its +200 step. Every face row ends in an "Other…" picker of the system's installed fonts (the same list as Settings → Appearance → Font, via Obsidian's own `get-fonts` module with `queryLocalFonts` and a typed-name fallback); the Chinese pickers filter that list through a 636-byte embedded blank-font glyph probe, so only fonts that can actually set Chinese appear. New test group `t10-typefaces` (the harness is now 10 groups). Requires theme [Tufte 1.17.0](https://github.com/PleiadesM/TufteObsidian/releases/tag/1.17.0) for the knobs to have effect; modules unchanged (backlinks 1.0.1, figures 1.7.3, inline 1.2.1, sidenotes 1.7.0).
- **1.0.2** (2026-08-14) — tufte-figures 1.7.3: the default figure's margin caption becomes a float using the sidenotes' exact recipe, so captions and sidenotes stack in one `clear:right` queue — a sidenote near a figure can no longer overlap the caption — and both share the same left edge (the old grid column sat 2cqi further left). The caption still starts level with its image; Live Preview and panes under 760px keep image-above-caption. Pair with theme [Tufte 1.16.3](https://github.com/PleiadesM/TufteObsidian/releases/tag/1.16.3) for the print-side geometry. Other modules unchanged.
- **1.0.1** (2026-08-11) — tufte-inline 1.2.1: the `&&…&&` / `^^…^^` / `@@…@@` shorthands survive nested markup (`[[links]]`, bold, italic) in Reading view, and the Live Preview lead-in indent rides a concealed-delimiter widget. Ships with theme Tufte 1.16.1.
- **1.0.0** (2026-08-05) — first release: the four standalone Tufte plugins (backlinks 1.0.1, figures 1.7.2, inline 1.2.0, sidenotes 1.7.0) bundled as switchable modules with namespaced settings, a single settings tab, and one-time import of standalone settings and the quilt store.
