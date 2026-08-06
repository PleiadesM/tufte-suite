"use strict";

const TESTS = [
  ["t1-smoke", "./t1-smoke"],
  ["t2-golden-processors", "./t2-golden-processors"],
  ["t3-event-order", "./t3-event-order"],
  ["t4-persistence", "./t4-persistence"],
  ["t5-settings-tab", "./t5-settings-tab"],
  ["t6-toggles", "./t6-toggles"],
  ["t7-unload", "./t7-unload"],
  ["t8-baseline", "./t8-baseline"],
  ["t9-reload-race", "./t9-reload-race"]
];

const only = process.argv[2];

(async () => {
  let failures = 0;
  const started = Date.now();
  for (const [name, mod] of TESTS) {
    if (only && !name.includes(only)) continue;
    let fn;
    try {
      fn = require(mod);
    } catch (e) {
      failures++;
      console.log("FAIL " + name + " (could not load: " + e.message + ")");
      continue;
    }
    try {
      const notes = await fn();
      console.log("PASS " + name + (notes ? "  — " + notes : ""));
    } catch (e) {
      failures++;
      console.log("FAIL " + name);
      console.log(
        "  " + String(e && e.stack ? e.stack : e).split("\n").join("\n  ")
      );
    }
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log("");
  console.log(
    failures === 0
      ? "All tests passed (" + secs + "s)"
      : failures + " test(s) failed (" + secs + "s)"
  );
  process.exit(failures === 0 ? 0 : 1);
})();
