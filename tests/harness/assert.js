"use strict";

const util = require("util");

function fmt(v) {
  return typeof v === "string" ? JSON.stringify(v) : util.inspect(v, { depth: 6 });
}

function ok(cond, msg) {
  if (!cond) throw new Error("Assertion failed: " + msg);
}

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(
      "Assertion failed: " + msg + "\n  expected: " + fmt(expected) + "\n  actual:   " + fmt(actual)
    );
  }
}

function deepEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(
      "Assertion failed: " + msg + "\n  expected: " + b + "\n  actual:   " + a
    );
  }
}

function notEq(actual, unexpected, msg) {
  if (actual === unexpected) {
    throw new Error("Assertion failed: " + msg + "\n  both were: " + fmt(actual));
  }
}

// Byte-equal HTML compare with a readable first-difference report.
function htmlEq(a, b, msg) {
  if (a === b) return;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ctx = 90;
  throw new Error(
    "Assertion failed: " +
      msg +
      "\n  first difference at index " +
      i +
      "\n  A: ..." +
      a.slice(Math.max(0, i - ctx), i + ctx) +
      "...\n  B: ..." +
      b.slice(Math.max(0, i - ctx), i + ctx) +
      "..."
  );
}

module.exports = { ok, eq, deepEq, notEq, htmlEq, fmt };
