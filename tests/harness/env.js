"use strict";

const { JSDOM } = require("jsdom");
const { installSugar } = require("./sugar");
const { makeAdapter } = require("./adapter");

const TUFTE_ACCENT = "#b2381f";

// ---------------------------------------------------------------------------
// makeEnv(): one fully isolated fake Obsidian + jsdom world.
// ---------------------------------------------------------------------------
function makeEnv(opts = {}) {
  const addChildAutoloads = opts.addChildAutoloads !== false;
  const cssTheme = opts.cssTheme === undefined ? "Tufte" : opts.cssTheme;

  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true
  });
  const window = dom.window;
  const document = window.document;
  installSugar(window);

  // ---- deterministic timers -------------------------------------------
  const timers = { queue: [], seq: 0, now: 0 };
  window.setTimeout = function (fn, delay, ...args) {
    const id = ++timers.seq;
    timers.queue.push({ id, fn, args, time: timers.now + (Number(delay) || 0), seq: id });
    return id;
  };
  window.clearTimeout = function (id) {
    const i = timers.queue.findIndex((t) => t.id === id);
    if (i >= 0) timers.queue.splice(i, 1);
  };
  window.setInterval = function (fn, delay, ...args) {
    // Intervals are recorded, never fired (nothing under test uses one).
    return ++timers.seq;
  };
  window.clearInterval = window.clearTimeout;

  const rafState = { queue: [], seq: 0 };
  window.requestAnimationFrame = function (fn) {
    const id = ++rafState.seq;
    rafState.queue.push({ id, fn });
    return id;
  };
  window.cancelAnimationFrame = function (id) {
    const i = rafState.queue.findIndex((f) => f.id === id);
    if (i >= 0) rafState.queue.splice(i, 1);
  };

  // ---- theme probe -----------------------------------------------------
  const realGetComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = function (el, pseudo) {
    let raw = null;
    try {
      raw = realGetComputedStyle(el, pseudo);
    } catch (e) {
      raw = null;
    }
    return {
      __raw: raw,
      getPropertyValue(name) {
        if (String(name).trim() === "--tufte-accent") return TUFTE_ACCENT;
        if (!raw) return "";
        try {
          return raw.getPropertyValue(name);
        } catch (e) {
          return "";
        }
      }
    };
  };

  // ---- registries ------------------------------------------------------
  const registries = {
    markdownPostProcessors: [],
    editorExtensions: [],
    commands: new Map(),
    settingTabs: [],
    domListeners: [],
    workspaceEvents: [],
    intervals: [],
    notices: [],
    ribbonIcons: [],
    statusBarItems: [],
    settings: [], // every Setting instance built, in construction order
    icons: []
  };

  const fixtures = {
    files: new Set(),
    fileText: new Map(),
    links: new Map(),
    leaves: new Map(),
    activeFile: null
  };

  const adapter = makeAdapter();

  // ---- obsidian module -------------------------------------------------
  class Component {
    constructor() {
      this._loaded = false;
      this._children = [];
      this._cleanups = [];
    }
    load() {
      if (this._loaded) return;
      this._loaded = true;
      this.onload();
      for (const child of this._children.slice()) child.load();
    }
    onload() {}
    onunload() {}
    addChild(child) {
      this._children.push(child);
      if (this._loaded && addChildAutoloads) child.load();
      return child;
    }
    removeChild(child) {
      const i = this._children.indexOf(child);
      if (i >= 0) this._children.splice(i, 1);
      child.unload();
      return child;
    }
    register(cb) {
      this._cleanups.push(cb);
    }
    registerEvent(ref) {
      this.register(() => {
        if (ref && typeof ref.off === "function") ref.off();
      });
      return ref;
    }
    registerDomEvent(target, type, fn, options) {
      target.addEventListener(type, fn, options);
      const capture = options === true || !!(options && options.capture);
      const record = { target, type, capture, fn, targetName: describeTarget(target) };
      registries.domListeners.push(record);
      this.register(() => {
        target.removeEventListener(type, fn, options);
        const i = registries.domListeners.indexOf(record);
        if (i >= 0) registries.domListeners.splice(i, 1);
      });
      return fn;
    }
    registerInterval(id) {
      registries.intervals.push(id);
      this.register(() => {
        const i = registries.intervals.indexOf(id);
        if (i >= 0) registries.intervals.splice(i, 1);
      });
      return id;
    }
    unload() {
      if (!this._loaded) return;
      this._loaded = false;
      for (const child of this._children.slice().reverse()) child.unload();
      const cleanups = this._cleanups.slice().reverse();
      this._cleanups.length = 0;
      for (const cb of cleanups) {
        try {
          cb();
        } catch (e) {
          /* mirror Obsidian: a failing cleanup must not stop the rest */
        }
      }
      this.onunload();
    }
  }

  function describeTarget(target) {
    if (target === document) return "document";
    if (target === window) return "window";
    if (target === document.body) return "body";
    return target && target.tagName ? target.tagName.toLowerCase() : String(target);
  }

  function dataPathFor(manifest) {
    return app.vault.configDir + "/plugins/" + manifest.id + "/data.json";
  }

  class Plugin extends Component {
    constructor(app_, manifest) {
      super();
      this.app = app_;
      this.manifest = manifest;
    }
    addCommand(cmd) {
      const fullId = this.manifest.id + ":" + cmd.id;
      const record = { fullId, name: this.manifest.name + ": " + cmd.name, cmd };
      registries.commands.set(fullId, record);
      this.register(() => registries.commands.delete(fullId));
      return cmd;
    }
    registerMarkdownPostProcessor(fn, sortOrder) {
      const record = {
        fn,
        sortOrder: sortOrder == null ? 0 : sortOrder,
        // harness-only provenance tag, identical mechanism in every env
        pluginId: this.manifest.id
      };
      registries.markdownPostProcessors.push(record);
      this.register(() => {
        const i = registries.markdownPostProcessors.indexOf(record);
        if (i >= 0) registries.markdownPostProcessors.splice(i, 1);
      });
      return fn;
    }
    registerEditorExtension(ext) {
      const record = { ext, pluginId: this.manifest.id };
      registries.editorExtensions.push(record);
      this.register(() => {
        const i = registries.editorExtensions.indexOf(record);
        if (i >= 0) registries.editorExtensions.splice(i, 1);
      });
      return ext;
    }
    addSettingTab(tab) {
      tab.app = this.app;
      registries.settingTabs.push(tab);
      this.register(() => {
        const i = registries.settingTabs.indexOf(tab);
        if (i >= 0) registries.settingTabs.splice(i, 1);
      });
      return tab;
    }
    addRibbonIcon(icon, title, cb) {
      const el = document.createElement("div");
      registries.ribbonIcons.push({ icon, title, cb, el });
      return el;
    }
    addStatusBarItem() {
      const el = document.createElement("div");
      registries.statusBarItems.push({ el });
      return el;
    }
    async loadData() {
      const p = dataPathFor(this.manifest);
      try {
        if (!(await adapter.exists(p))) return null;
        return JSON.parse(await adapter.read(p));
      } catch (e) {
        return null;
      }
    }
    async saveData(data) {
      const p = dataPathFor(this.manifest);
      await adapter.mkdir(app.vault.configDir + "/plugins/" + this.manifest.id);
      await adapter.write(p, JSON.stringify(data));
    }
  }

  class SettingTab {
    constructor(app_, plugin) {
      this.app = app_;
      this.plugin = plugin;
      this.containerEl = document.createElement("div");
    }
    display() {}
    hide() {
      this.containerEl.empty();
    }
  }
  class PluginSettingTab extends SettingTab {}

  // ---- Setting + controls (real DOM) -----------------------------------
  class BaseComponent {
    constructor(setting) {
      this.setting = setting;
      this.changeCb = null;
      this.disabled = false;
    }
    onChange(cb) {
      this.changeCb = cb;
      return this;
    }
    setDisabled(v) {
      this.disabled = !!v;
      if (this.inputEl) this.inputEl.disabled = !!v;
      if (this.buttonEl) this.buttonEl.disabled = !!v;
      return this;
    }
    getValue() {
      return this.value;
    }
    async fireChange(v) {
      this.setValue(v);
      if (this.changeCb) return this.changeCb(v);
    }
  }

  class ToggleComponent extends BaseComponent {
    constructor(setting) {
      super(setting);
      this.kind = "toggle";
      this.toggleEl = setting.controlEl.createDiv({ cls: "checkbox-container" });
      this.inputEl = this.toggleEl.createEl("input", { type: "checkbox" });
      this.value = false;
    }
    setValue(v) {
      this.value = !!v;
      this.inputEl.checked = !!v;
      this.toggleEl.classList.toggle("is-enabled", !!v);
      return this;
    }
    setTooltip(t) {
      this.toggleEl.setAttribute("aria-label", t);
      return this;
    }
  }

  class TextComponent extends BaseComponent {
    constructor(setting, tag, cls) {
      super(setting);
      this.kind = tag === "textarea" ? "textarea" : "text";
      this.inputEl =
        tag === "textarea"
          ? setting.controlEl.createEl("textarea")
          : setting.controlEl.createEl("input", { type: "text" });
      this.value = "";
    }
    setValue(v) {
      this.value = v == null ? "" : String(v);
      this.inputEl.value = this.value;
      return this;
    }
    setPlaceholder(p) {
      this.inputEl.setAttribute("placeholder", String(p));
      return this;
    }
  }

  class DropdownComponent extends BaseComponent {
    constructor(setting) {
      super(setting);
      this.kind = "dropdown";
      this.selectEl = setting.controlEl.createEl("select");
      this.inputEl = this.selectEl;
      this.value = "";
    }
    addOption(value, display) {
      this.selectEl.createEl("option", { text: display, attr: { value } });
      return this;
    }
    addOptions(map) {
      for (const k of Object.keys(map)) this.addOption(k, map[k]);
      return this;
    }
    setValue(v) {
      this.value = v;
      this.selectEl.value = v;
      return this;
    }
  }

  class SliderComponent extends BaseComponent {
    constructor(setting) {
      super(setting);
      this.kind = "slider";
      this.sliderEl = setting.controlEl.createEl("input", { type: "range" });
      this.inputEl = this.sliderEl;
      this.value = 0;
    }
    setLimits(min, max, step) {
      this.sliderEl.setAttribute("min", String(min));
      this.sliderEl.setAttribute("max", String(max));
      this.sliderEl.setAttribute("step", String(step));
      return this;
    }
    setDynamicTooltip() {
      return this;
    }
    setValue(v) {
      this.value = v;
      this.sliderEl.value = String(v);
      return this;
    }
  }

  class ButtonComponent extends BaseComponent {
    constructor(setting) {
      super(setting);
      this.kind = "button";
      this.buttonEl = setting.controlEl.createEl("button");
      this.clickCb = null;
    }
    setValue(v) {
      this.value = v;
      return this;
    }
    setButtonText(t) {
      this.buttonEl.textContent = t;
      return this;
    }
    setIcon(icon) {
      this.buttonEl.setAttribute("data-icon", icon);
      return this;
    }
    setCta() {
      this.buttonEl.classList.add("mod-cta");
      return this;
    }
    setWarning() {
      this.buttonEl.classList.add("mod-warning");
      return this;
    }
    setTooltip(t) {
      this.buttonEl.setAttribute("aria-label", t);
      return this;
    }
    onClick(cb) {
      this.clickCb = cb;
      this.buttonEl.addEventListener("click", cb);
      return this;
    }
  }

  class ExtraButtonComponent extends ButtonComponent {
    constructor(setting) {
      super(setting);
      this.kind = "extra-button";
      this.buttonEl.classList.add("clickable-icon", "extra-setting-button");
    }
  }

  class Setting {
    constructor(containerEl) {
      this.containerEl = containerEl;
      this.settingEl = containerEl.createDiv({ cls: "setting-item" });
      this.infoEl = this.settingEl.createDiv({ cls: "setting-item-info" });
      this.nameEl = this.infoEl.createDiv({ cls: "setting-item-name" });
      this.descEl = this.infoEl.createDiv({ cls: "setting-item-description" });
      this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
      this.components = [];
      registries.settings.push(this);
    }
    setName(n) {
      this.nameEl.textContent = n == null ? "" : String(n);
      this.name = this.nameEl.textContent;
      return this;
    }
    setDesc(d) {
      this.descEl.textContent = d == null ? "" : String(d);
      this.desc = this.descEl.textContent;
      return this;
    }
    setHeading() {
      this.settingEl.classList.add("setting-item-heading");
      this.isHeading = true;
      return this;
    }
    setClass(c) {
      this.settingEl.classList.add(c);
      return this;
    }
    setTooltip(t) {
      this.settingEl.setAttribute("aria-label", String(t));
      return this;
    }
    setDisabled(v) {
      this.settingEl.classList.toggle("is-disabled", !!v);
      return this;
    }
    _add(comp, cb) {
      this.components.push(comp);
      if (typeof cb === "function") cb(comp);
      return this;
    }
    addToggle(cb) { return this._add(new ToggleComponent(this), cb); }
    addText(cb) { return this._add(new TextComponent(this, "input"), cb); }
    addTextArea(cb) { return this._add(new TextComponent(this, "textarea"), cb); }
    addDropdown(cb) { return this._add(new DropdownComponent(this), cb); }
    addSlider(cb) { return this._add(new SliderComponent(this), cb); }
    addButton(cb) { return this._add(new ButtonComponent(this), cb); }
    addExtraButton(cb) { return this._add(new ExtraButtonComponent(this), cb); }
  }

  class Notice {
    constructor(message, timeout) {
      this.message = message;
      this.timeout = timeout;
      registries.notices.push({ message, timeout });
    }
    hide() {}
    setMessage(m) {
      this.message = m;
      return this;
    }
  }

  class Modal {
    constructor(app_) {
      this.app = app_;
      this.containerEl = document.createElement("div");
      this.modalEl = this.containerEl.createDiv({ cls: "modal" });
      this.titleEl = this.modalEl.createDiv({ cls: "modal-title" });
      this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
      this.scope = { register() {} };
    }
    open() {
      if (typeof this.onOpen === "function") return this.onOpen();
    }
    close() {
      if (typeof this.onClose === "function") return this.onClose();
    }
    setTitle(t) {
      this.titleEl.textContent = t;
      return this;
    }
  }

  class MarkdownView {}

  class TFile {
    constructor(path) {
      this.path = String(path);
      const base = this.path.slice(this.path.lastIndexOf("/") + 1);
      const dot = base.lastIndexOf(".");
      this.name = base;
      this.basename = dot === -1 ? base : base.slice(0, dot);
      this.extension = dot === -1 ? "" : base.slice(dot + 1);
    }
  }
  class TFolder {
    constructor(path) {
      this.path = String(path);
      this.children = [];
    }
  }

  const MarkdownRenderer = {
    async render(app_, markdown, el, sourcePath, component) {
      const d = (el.ownerDocument || document).createElement("div");
      d.className = "__stub-rendered";
      d.textContent = markdown == null ? "" : String(markdown);
      el.appendChild(d);
    },
    async renderMarkdown(markdown, el, sourcePath, component) {
      return MarkdownRenderer.render(null, markdown, el, sourcePath, component);
    }
  };

  const obsidian = {
    Component,
    Plugin,
    PluginSettingTab,
    SettingTab,
    Setting,
    Notice,
    Modal,
    MarkdownRenderer,
    MarkdownView,
    TFile,
    TFolder,
    editorLivePreviewField: {},
    addIcon: (name, svg) => registries.icons.push({ op: "addIcon", name }),
    setIcon: (el, name) => registries.icons.push({ op: "setIcon", name }),
    Platform: { isDesktop: true, isMobile: false },
    normalizePath: (p) => String(p).replace(/\\+/g, "/"),
    debounce: (fn, wait) => fn,
    requestUrl: async () => {
      throw new Error("Harness: network access is not available");
    }
  };

  // ---- app -------------------------------------------------------------
  const workspaceHandlers = new Map();

  const app = {
    vault: {
      configDir: ".obsidian",
      adapter,
      getConfig: (k) => (k === "cssTheme" ? cssTheme : undefined),
      getAbstractFileByPath: (p) => (fixtures.files.has(p) ? new TFile(p) : null),
      cachedRead: async (f) => fixtures.fileText.get(f && f.path) || "",
      read: async (f) => fixtures.fileText.get(f && f.path) || "",
      getResourcePath: (f) => "app://res/" + (f && f.path ? f.path : f),
      createBinary: async (p, buf) => {
        await adapter.writeBinary(p, buf);
        return new TFile(p);
      },
      modifyBinary: async (f, buf) => adapter.writeBinary(f.path, buf),
      createFolder: async (p) => adapter.mkdir(p),
      on: () => ({ off() {} })
    },
    metadataCache: {
      getFirstLinkpathDest: (link, from) =>
        fixtures.links.has(link) ? new TFile(fixtures.links.get(link)) : null,
      getFileCache: () => null,
      on: () => ({ off() {} })
    },
    workspace: {
      on(name, fn) {
        if (!workspaceHandlers.has(name)) workspaceHandlers.set(name, []);
        workspaceHandlers.get(name).push(fn);
        const record = { name, fn };
        registries.workspaceEvents.push(record);
        return {
          off() {
            const list = workspaceHandlers.get(name) || [];
            const i = list.indexOf(fn);
            if (i >= 0) list.splice(i, 1);
            const j = registries.workspaceEvents.indexOf(record);
            if (j >= 0) registries.workspaceEvents.splice(j, 1);
          }
        };
      },
      trigger(name, ...args) {
        for (const fn of (workspaceHandlers.get(name) || []).slice()) fn(...args);
      },
      onLayoutReady(cb) {
        cb();
      },
      getLeavesOfType: (t) => fixtures.leaves.get(t) || [],
      getActiveFile: () => fixtures.activeFile || null,
      getActiveViewOfType: () => null,
      iterateAllLeaves: (cb) => {
        for (const list of fixtures.leaves.values()) for (const leaf of list) cb(leaf);
      },
      updateOptions: () => {},
      requestSaveLayout: () => {}
    },
    fileManager: {
      getAvailablePathForAttachment: async (n) => "attachments/" + n,
      generateMarkdownLink: (f, from) => "![[" + (f.basename || f.path) + "]]"
    },
    dragManager: { draggable: null },
    plugins: { enabledPlugins: new Set(), plugins: {} },
    setting: {},
    commands: registries.commands,
    lastEvent: null
  };

  // ---- settle ----------------------------------------------------------
  function flushRaf() {
    let ran = 0;
    for (let guard = 0; guard < 50; guard++) {
      const batch = rafState.queue.splice(0, rafState.queue.length);
      if (!batch.length) break;
      for (const f of batch) {
        ran++;
        try {
          f.fn(timers.now);
        } catch (e) {
          throw e;
        }
      }
    }
    return ran;
  }

  function pumpTimers() {
    let ran = 0;
    for (let guard = 0; guard < 500; guard++) {
      if (!timers.queue.length) break;
      timers.queue.sort((a, b) => a.time - b.time || a.seq - b.seq);
      const t = timers.queue.shift();
      timers.now = Math.max(timers.now, t.time);
      ran++;
      t.fn(...t.args);
    }
    return ran;
  }

  async function ticks(n) {
    for (let i = 0; i < n; i++) await Promise.resolve();
  }

  async function settle() {
    for (let i = 0; i < 25; i++) {
      flushRaf();
      await ticks(4);
      pumpTimers();
      await ticks(4);
    }
  }

  const env = {
    obsidian,
    app,
    registries,
    dom,
    window,
    document,
    adapter,
    fixtures,
    settle,
    flushRaf,
    pumpTimers,
    addChildAutoloads,
    timers,
    rafState
  };

  return env;
}

module.exports = { makeEnv, TUFTE_ACCENT };
