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

Tufte Suite is in Obsidian's community plugin directory: Settings → Community plugins → *Browse* → search **Tufte Suite** → Install → Enable. (Or open `obsidian://show-plugin?id=tufte-suite`.) The theme it accompanies is in the community themes directory as **Tufte** (`obsidian://show-theme?name=Tufte`).

Manual install still works: download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest), put all three in `YourVault/.obsidian/plugins/tufte-suite/`, then Settings → Community plugins → enable **Tufte Suite**.

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

- **1.2.0** (2026-08-14)
  - Now, the whole Suite speaks Chinese
  - Unify the figure modal's tabs with the settings tab bar
  - Pair with theme Tufte 1.18.0
- **1.1.0** (2026-08-14)
  - Add the Typefaces settings: Latin and Chinese faces and weights
  - Add pickers for installed system fonts
  - Requires theme Tufte 1.17.0
- **1.0.2** (2026-08-14)
  - Fix figure captions overlapping sidenotes
  - Align the left edges of margin content
- **1.0.1** (2026-08-11)
  - Inline shorthands now survive nested markup
- **1.0.0** (2026-08-05)
  - First release: the four Tufte plugins bundled as switchable modules
