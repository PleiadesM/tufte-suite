"use strict";

// Golden test: for every fixture, the ORIGINAL plugin's markdown post-processor
// and the SUITE's corresponding post-processor must produce byte-identical DOM.

const { loadSuite, loadOriginal, assert, fixtures } = require("./harness");
const { ok, eq, deepEq, htmlEq, notEq } = assert;
const { FIXTURES, build } = fixtures;

const MODULE_ID = {
  figures: "tufte-figures",
  inline: "tufte-inline",
  sidenotes: "tufte-sidenotes"
};

const ENABLED_CLASS = {
  figures: "tufte-figures-enabled",
  sidenotes: "tufte-sidenotes-enabled"
};

function seed(env) {
  env.fixtures.files.add("Test.md");
  env.fixtures.fileText.set("Test.md", require("./harness/fixtures").SIDENOTE_MD);
  env.fixtures.activeFile = null;
}

function classSet(env) {
  return [...env.document.body.classList].sort();
}

function delta(before, after) {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: after.filter((c) => !b.has(c)).sort(),
    removed: before.filter((c) => !a.has(c)).sort()
  };
}

async function runProcessor(env, record, fixture) {
  const built = build(env, fixture);
  const ctx = fixture.ctx();
  const before = classSet(env);
  const result = record.fn(built.el, ctx);
  if (result && typeof result.then === "function") await result;
  await env.settle();
  const after = classSet(env);
  return { html: built.root.outerHTML, bodyDelta: delta(before, after), bodyAfter: after };
}

module.exports = async function t2() {
  const notes = [];

  for (const moduleKey of ["figures", "inline", "sidenotes"]) {
    const moduleFixtures = FIXTURES.filter((f) => f.module === moduleKey);
    ok(moduleFixtures.length > 0, "fixtures exist for " + moduleKey);
    let sawChange = false;

    for (const fixture of moduleFixtures) {
      // --- env A: the original plugin alone
      const a = await loadOriginal(moduleKey, { seed });
      const procsA = a.env.registries.markdownPostProcessors;
      eq(procsA.length, 1, fixture.name + ": original registers exactly one processor");
      eq(procsA[0].pluginId, MODULE_ID[moduleKey], fixture.name + ": processor owner (A)");

      // --- env B: the suite
      const b = await loadSuite({ seed });
      const procsB = b.env.registries.markdownPostProcessors;
      eq(procsB.length, 3, fixture.name + ": suite registers three processors");
      const idxB = procsB.findIndex((p) => p.pluginId === MODULE_ID[moduleKey]);
      ok(idxB >= 0, fixture.name + ": suite exposes a processor for " + moduleKey);
      // Index mapping is the documented one: figures 0, inline 1, sidenotes 2.
      eq(
        idxB,
        { figures: 0, inline: 1, sidenotes: 2 }[moduleKey],
        fixture.name + ": suite processor index mapping"
      );

      const ra = await runProcessor(a.env, procsA[0], fixture);
      const rb = await runProcessor(b.env, procsB[idxB], fixture);

      htmlEq(ra.html, rb.html, fixture.name + ": original vs suite DOM must be byte-equal");

      deepEq(
        ra.bodyDelta,
        rb.bodyDelta,
        fixture.name + ": body class delta caused by the processor must match"
      );

      const changed = ra.html !== fixture.html;
      if (fixture.expectChange) {
        notEq(ra.html, fixture.html, fixture.name + ": transform must actually run (A)");
        notEq(rb.html, fixture.html, fixture.name + ": transform must actually run (B)");
        sawChange = true;
      } else {
        eq(ra.html, fixture.html, fixture.name + ": fixture must be left untouched (A)");
        eq(rb.html, fixture.html, fixture.name + ": fixture must be left untouched (B)");
      }

      // Theme-stub sanity: the module's enabled class must be on <body> in both
      // envs after a processor run (if the stub's theme probe were wrong the
      // processors would silently no-op and every comparison would be vacuous).
      const cls = ENABLED_CLASS[moduleKey];
      if (cls) {
        ok(ra.bodyAfter.includes(cls), fixture.name + ": body." + cls + " present (A)");
        ok(rb.bodyAfter.includes(cls), fixture.name + ": body." + cls + " present (B)");
      }

      if (changed) {
        // A cheap structural spot-check that the change is the expected kind.
        if (moduleKey === "inline") {
          ok(/class="newthought"/.test(ra.html), fixture.name + ": inline produced a newthought span");
        } else if (moduleKey === "sidenotes") {
          ok(
            /tufte-sidenote-ref|tufte-footnote-id/.test(ra.html),
            fixture.name + ": sidenotes produced a ref/marker artefact"
          );
        } else if (moduleKey === "figures") {
          ok(
            /tufte-fig-label|tufte-figure-decorated/.test(ra.html),
            fixture.name + ": figures produced its decorated structure"
          );
        }
      }
    }

    ok(sawChange, moduleKey + ": at least one fixture must be non-vacuously transformed");
    notes.push(moduleKey + " " + moduleFixtures.length + " fixtures");
  }

  return notes.join(", ");
};
