"use strict";

// Obsidian's DOM sugar, polyfilled onto a jsdom window's prototypes.
// Only the members the four plugin sources actually reference are real
// behaviour; the rest are minimal but correct.

function applyOptions(el, o) {
  if (o == null) return;
  if (typeof o === "string") o = { cls: o };
  if (o.cls != null) {
    el.className = Array.isArray(o.cls) ? o.cls.filter(Boolean).join(" ") : String(o.cls);
  }
  if (o.text != null) el.textContent = String(o.text);
  if (o.attr) {
    for (const k of Object.keys(o.attr)) {
      const v = o.attr[k];
      if (v == null || v === false) continue;
      el.setAttribute(k, String(v));
    }
  }
  if (o.title != null) el.setAttribute("title", String(o.title));
  if (o.href != null) el.setAttribute("href", String(o.href));
  if (o.type != null) el.setAttribute("type", String(o.type));
  if (o.placeholder != null) el.setAttribute("placeholder", String(o.placeholder));
  if (o.value != null) el.value = o.value;
}

function docOf(node) {
  return node.ownerDocument || node;
}

function installSugar(window) {
  const targets = [
    window.HTMLElement.prototype,
    window.Document.prototype,
    window.DocumentFragment.prototype,
    window.SVGElement && window.SVGElement.prototype
  ].filter(Boolean);

  const methods = {
    createEl(tag, o, cb) {
      const el = docOf(this).createElement(tag);
      applyOptions(el, o);
      this.appendChild(el);
      if (typeof cb === "function") cb(el);
      return el;
    },
    createDiv(o, cb) {
      return this.createEl("div", o, cb);
    },
    createSpan(o, cb) {
      return this.createEl("span", o, cb);
    },
    empty() {
      while (this.firstChild) this.removeChild(this.firstChild);
      return this;
    },
    setText(t) {
      this.textContent = t == null ? "" : String(t);
      return this;
    },
    appendText(t) {
      this.appendChild(docOf(this).createTextNode(String(t)));
      return this;
    }
  };

  for (const proto of targets) {
    for (const name of Object.keys(methods)) {
      if (!Object.prototype.hasOwnProperty.call(proto, name)) {
        Object.defineProperty(proto, name, {
          value: methods[name],
          writable: true,
          configurable: true,
          enumerable: false
        });
      }
    }
  }

  // Element-only sugar (classList based).
  const elMethods = {
    addClass(...cls) {
      for (const c of cls) {
        if (Array.isArray(c)) this.classList.add(...c.filter(Boolean));
        else if (c) this.classList.add(c);
      }
      return this;
    },
    removeClass(...cls) {
      for (const c of cls) {
        if (Array.isArray(c)) this.classList.remove(...c.filter(Boolean));
        else if (c) this.classList.remove(c);
      }
      return this;
    },
    toggleClass(cls, on) {
      const list = Array.isArray(cls) ? cls : [cls];
      for (const c of list) if (c) this.classList.toggle(c, !!on);
      return this;
    },
    hasClass(c) {
      return this.classList.contains(c);
    },
    detach() {
      if (this.parentNode) this.parentNode.removeChild(this);
      return this;
    },
    onClickEvent(fn, options) {
      this.addEventListener("click", fn, options);
      return this;
    },
    isShown() {
      return true;
    },
    instanceOf(type) {
      return this instanceof type;
    }
  };
  const elProto = window.HTMLElement.prototype;
  for (const name of Object.keys(elMethods)) {
    if (!Object.prototype.hasOwnProperty.call(elProto, name)) {
      Object.defineProperty(elProto, name, {
        value: elMethods[name],
        writable: true,
        configurable: true,
        enumerable: false
      });
    }
  }

  for (const [name, get] of [
    ["win", function () { return docOf(this).defaultView; }],
    ["doc", function () { return docOf(this); }]
  ]) {
    if (!Object.prototype.hasOwnProperty.call(elProto, name)) {
      Object.defineProperty(elProto, name, { get, configurable: true });
    }
  }
}

module.exports = { installSugar };
