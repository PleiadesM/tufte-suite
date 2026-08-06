"use strict";

// In-memory vault adapter. Every file is stored as bytes; read()/write()
// encode/decode UTF-8 so a text-seeded file can still be read binary (which
// is exactly what the suite's quilt copy does).

const enc = new TextEncoder();
const dec = new TextDecoder();

function toU8(data) {
  if (data instanceof Uint8Array) return new Uint8Array(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  return enc.encode(String(data));
}

function parentOf(p) {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function makeAdapter() {
  const files = new Map(); // path -> Uint8Array
  const folders = new Set();
  const writeLog = [];

  function ensureParents(p) {
    let dir = parentOf(p);
    while (dir) {
      folders.add(dir);
      dir = parentOf(dir);
    }
  }

  const adapter = {
    async exists(p) {
      return files.has(p) || folders.has(p);
    },
    async read(p) {
      if (!files.has(p)) throw new Error("ENOENT: " + p);
      return dec.decode(files.get(p));
    },
    async readBinary(p) {
      if (!files.has(p)) throw new Error("ENOENT: " + p);
      const u8 = files.get(p);
      return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    },
    async write(p, data) {
      writeLog.push({ op: "write", path: p });
      ensureParents(p);
      files.set(p, toU8(data));
    },
    async writeBinary(p, data) {
      writeLog.push({ op: "writeBinary", path: p });
      ensureParents(p);
      files.set(p, toU8(data));
    },
    async mkdir(p) {
      writeLog.push({ op: "mkdir", path: p });
      folders.add(p);
      ensureParents(p);
    },
    async list(p) {
      const prefix = p ? p + "/" : "";
      const outFiles = new Set();
      const outFolders = new Set();
      for (const f of files.keys()) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        if (!rest) continue;
        const slash = rest.indexOf("/");
        if (slash === -1) outFiles.add(f);
        else outFolders.add(prefix + rest.slice(0, slash));
      }
      for (const d of folders) {
        if (!d.startsWith(prefix)) continue;
        const rest = d.slice(prefix.length);
        if (!rest) continue;
        const slash = rest.indexOf("/");
        outFolders.add(prefix + (slash === -1 ? rest : rest.slice(0, slash)));
      }
      return { files: [...outFiles].sort(), folders: [...outFolders].sort() };
    },
    async remove(p) {
      writeLog.push({ op: "remove", path: p });
      files.delete(p);
    },
    async rmdir(p) {
      writeLog.push({ op: "rmdir", path: p });
      folders.delete(p);
      for (const f of [...files.keys()]) if (f.startsWith(p + "/")) files.delete(f);
    },
    getResourcePath(p) {
      return "app://res/" + p;
    },

    // ---- harness-only helpers (never logged) ----
    __writeLog: writeLog,
    __seed(p, data) {
      ensureParents(p);
      files.set(p, toU8(data));
    },
    __seedFolder(p) {
      folders.add(p);
      ensureParents(p);
    },
    __bytes(p) {
      return files.has(p) ? Array.from(files.get(p)) : null;
    },
    __text(p) {
      return files.has(p) ? dec.decode(files.get(p)) : null;
    },
    __has(p) {
      return files.has(p);
    },
    __paths() {
      return [...files.keys()].sort();
    }
  };

  return adapter;
}

module.exports = { makeAdapter };
