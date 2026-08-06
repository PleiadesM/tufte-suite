# Tufte Suite equivalence harness

A Node + jsdom harness that proves the generated **Tufte Suite** plugin behaves
identically to the four standalone plugins it bundles.

```
npm install              # first run only — jsdom is not vendored into the vault
node run-all.js          # all tests
node run-all.js t2       # substring filter
```

Node v20.19.4, jsdom 29.1.1. No network, no real timers, no wall-clock
dependence. Full run ≈ 0.6 s.

`node_modules/` is deliberately absent — this folder lives inside an
iCloud-synced vault, and a vendored dependency tree would sync thousands of
files. Install locally when you want to run the suite; delete it afterwards.

**The vault is treated as strictly read-only.** Plugin sources are read as text
and evaluated with `new Function(...)`; nothing under the vault is ever written.

---

## Layout

| Path | What |
|---|---|
| `harness/env.js` | `makeEnv(opts)` — one isolated fake Obsidian + jsdom world (the `obsidian` module stub, the `app` object, all registries, deterministic timers/rAF, `settle()`). |
| `harness/sugar.js` | Obsidian's DOM sugar polyfilled onto the env's `HTMLElement`/`Document`/`DocumentFragment` prototypes. |
| `harness/adapter.js` | In-memory vault adapter with a write log. |
| `harness/load.js` | Reads plugin files as text, evaluates them in sloppy mode with the fake `require` and the shadowed globals. |
| `harness/fixtures.js` | The fixture corpus (pure data; each env builds its own identical copy). |
| `harness/assert.js` | Tiny assertion helpers with readable diffs. |
| `t1…t9`, `run-all.js` | The tests. |

---

## How plugin code is loaded

Every source — originals **and** the suite — is compiled with the *same*
parameter list, so the shadowing is invisible and identical on both sides:

```
module, exports, require,
document, window, requestAnimationFrame, getComputedStyle, MutationObserver,
Node, NodeFilter, Image, URL, setTimeout, clearTimeout, navigator, performance,
Element, HTMLElement, HTMLImageElement, Blob
```

`new Function` bodies are sloppy-mode, which the sources rely on. The fake
`require` resolves only `obsidian` and the three CodeMirror stubs; anything else
throws with a clear message. Plugin files are never `require()`d by Node.

`Component.load()` is synchronous while the plugins' `onload()` is `async`, so
`harness/load.js#loadComponent` captures the returned promise exactly the way the
suite runtime does, and awaits it.

### Determinism

* `window.setTimeout`/`clearTimeout` are a sortable virtual queue with a manual
  pump and a virtual clock. No real timers anywhere.
* `window.requestAnimationFrame` is a flushable queue.
* `settle(env)` loops 25×: flush rAF → 4 microtask ticks → pump timers → 4 ticks.
  The identical procedure runs in every environment.
* `MutationObserver` is jsdom's real one (microtask-delivered, so the tick
  drains cover it).
* `MarkdownRenderer.render` is a deterministic stub: it appends
  `<div class="__stub-rendered">` whose `textContent` is the markdown.

### Theme detection

Both `tufte-figures` and `tufte-sidenotes` gate everything on
`isTufteThemeActive()`, which tries `vault.getConfig("cssTheme") === "Tufte"`
first and falls back to probing `--tufte-accent` via `getComputedStyle`. The
stub satisfies **both**: `getConfig` returns `"Tufte"`, and `getComputedStyle` is
wrapped so `getPropertyValue("--tufte-accent")` returns `#b2381f`. Verified
independently — with `cssTheme: "Default"` the `getComputedStyle` fallback alone
still enables the module.

`t2` asserts that after every processor run `document.body` carries
`tufte-figures-enabled` / `tufte-sidenotes-enabled`, so a broken theme stub can
never make the golden comparisons vacuous.

---

## Deviations from the requested stub sketch

Where the sketch and the actual plugin code disagreed, the code won.

1. **`PluginSettingTab` sets `this.plugin`.** The sketch said to leave `plugin`
   to the tab itself. But `TufteSuiteSettingTab.display()` reads `this.plugin`
   and never assigns it, and `FigureSettingTab`'s constructor calls
   `super(app, plugin)`. So the base `SettingTab` constructor assigns both `app`
   and `plugin`, as real Obsidian does. `Plugin.addSettingTab` still only sets
   `tab.app`, per the sketch.
2. **`adapter.readBinary` returns an `ArrayBuffer`** (real Obsidian semantics).
   Everything is stored internally as `Uint8Array`, so a text-seeded file can be
   read binary — which is exactly what the suite's quilt copy does.
3. **Four extra evaluator parameters** (`Element`, `HTMLElement`,
   `HTMLImageElement`, `Blob`) beyond the sketch's list. The sources reference
   these (`target instanceof Element`, `instanceof HTMLImageElement`, …) and
   Node has no such globals. The list is byte-identical for originals and suite,
   which is what the equivalence argument requires.
4. **`Modal`** nests `titleEl`/`contentEl` under a `containerEl` > `modalEl`,
   rather than being three loose divs. Nothing under test depends on the shape.
5. **`window.setInterval`** returns an id and never fires; no code under test
   uses one. `registerInterval` records/clears normally.
6. **`getComputedStyle`** returns a minimal object exposing `getPropertyValue`
   (delegating to jsdom for everything but `--tufte-accent`) rather than a real
   `CSSStyleDeclaration` — jsdom's brand checks make subclassing unsafe, and
   `getPropertyValue` is the only member any source touches.
7. **Harness-only provenance tags.** `registerMarkdownPostProcessor` and
   `registerEditorExtension` records carry a `pluginId` taken from
   `this.manifest.id`. This is the "per-module tagging" t2/t6 need to identify
   which registration belongs to which module; the mechanism is identical in
   every environment and invisible to the plugin sources.

---

## Test-design notes

* **`t2` body-class comparison is a delta.** Comparing absolute
  `document.body.className` between envA and envB would always fail: envB has
  *all four* modules loaded, so it legitimately carries both
  `tufte-figures-enabled` and `tufte-sidenotes-enabled`. The test therefore
  compares the *set of classes added/removed by the processor run*, plus the
  presence of the module's own enabled class in both envs.
* **Fixtures are detached** from `document.body` (t7's backlink pane is the
  deliberate exception). Attaching them would let `tufte-sidenotes`'
  `MutationObserver` fire and let one fixture's processing bleed into the next.
  Detached fixtures behave identically on both sides and keep `settle()`
  convergence trivial. `.closest()` and the tree walkers all work on detached
  trees, so no code path is skipped by this.
* **Processor index mapping** (`figures 0, inline 1, sidenotes 2`) is asserted
  against the `pluginId` tags rather than assumed.
* **Per-fixture fresh environments** in t2 — a new envA *and* envB per fixture,
  so no fixture can be affected by a previous one.

## Coverage limitations

* **`tufte-sidenotes`' `refreshLivePreview` path** (marginnote `role="button"`
  decoration, `ensureSidenoteTitleLabel`) is reached only from the plugin's own
  `MutationObserver` over *attached* `.markdown-preview-view` roots, not from the
  markdown post-processor. The t2 corpus therefore exercises the post-processor
  branches (inline-ref wrapping, callout title/`data-tufte-footnote-id`
  stamping) but not the observer-driven relabelling. Registration/cleanup parity
  for that observer is covered by t3 and t7.
* **`quiltDir()`'s patched literal** is verified statically (t8 diffs the
  embedded source against the original and asserts that this one line is the
  only difference) and by the copy destination in t4. It is not exercised at
  runtime, because it is only reached from the figure modal's quilt tab.
* **`warnAboutStandalonePlugins()`** runs (via `onLayoutReady`) with an empty
  `app.plugins.enabledPlugins`, so it produces no `Notice`. Its message text is
  not asserted.
* `MarkdownRenderer` is stubbed, so nothing proves how real rendered markdown
  would look — only that both sides get *identically* rendered content.

## Negative controls

The harness was validated against deliberately mutated inputs to confirm it has
teeth:

* Reversing the suite's module load order → t1/t3's order assertions fail.
* Renaming one class in the figures source → t2's byte-equal comparison fails.
* Removing `cssTheme` → the `getComputedStyle` fallback still enables the module
  (both theme probes independently verified).

---

## Findings (both found by this harness / the verifier pass, both since fixed)

Fixes were made in `../build-tufte-suite.js` and the bundle regenerated — never
by hand-editing `main.js`. Each finding now has a test pinning the fixed
behaviour, so a regression fails the run.

### Finding 1 — first-run `data.json` omitted `__modules` — FIXED

`onload()` saved the imported settings *before* seeding the `MODULES_KEY` map,
so the file written on first run carried the per-module sections but no
`__modules` key (it only reached disk on the first `setModuleEnabled()`).
Impact was benign — `isModuleEnabled()` treats a missing map as "all enabled" —
but the on-disk shape was inconsistent with the in-memory one.

Fixed by seeding `__modules` before the first-run save (a `firstRun` flag now
orders the two steps). **t4** asserts the first-run file *contains* `__modules`.

### Finding 2 — concurrent module toggles duplicated every module — FIXED

Reported by the independent verifier pass. `setModuleEnabled()` awaited a real
`data.json` write before calling `reloadModules()`, which sets
`this.loadedSubs = []` and then awaits each module's async `onload()`. A second
toggle entering that window tore down only what had been pushed so far, then
pushed its own instances into the same array — leaving **two instances of every
module**: figures' capture-phase `drop`/`dragstart`/`dragend` handlers firing
twice per image drop (double-saving the image), inline's CodeMirror extension
registered twice, and the Figures settings section rendered twice. Reachable
from the plugin's own settings UI by clicking two toggles in quick succession,
and *easier* to hit in Obsidian than here, since the window spans a disk write.

Fixed with a promise-chain queue (`queueReloadModules()`) so reloads serialize;
a failed reload does not poison the chain. **t9** drives the real settings-tab
toggles concurrently — two different modules off, both back on, then one module
off+on with no gap — and asserts one instance per module, canonical order, exact
command/listener/extension counts, and `_children` agreeing with `loadedSubs`.

### No behavioural differences found

Across every comparison performed — rendered DOM for ten fixtures spanning
three modules, command ids and display names, registration counts and ordering,
DOM-listener and workspace-event sequences, the figures settings subtree, and
the unload/restore cascade — the suite is indistinguishable from the four
standalone plugins.
