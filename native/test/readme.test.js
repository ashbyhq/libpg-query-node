const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// Every ```js block in the README is executed here, and the `// output` comments
// following a call are asserted against what the call actually returns.
//
// Two separate review rounds caught examples that didn't run — one missing its
// imports, one referencing a `tree` defined in an earlier block and showing
// output for a different query. Both are the kind of thing that only surfaces
// when someone copies the snippet and it throws, so it is checked mechanically
// rather than by reading.

const README = join(__dirname, "..", "README.md");
const LOCAL_PACKAGE = JSON.stringify(join(__dirname, "..", "dist", "index.js"));

function extractJsBlocks(markdown) {
  return [...markdown.matchAll(/```js\n([\s\S]*?)```/g)].map((match) => match[1]);
}

/**
 * Rewrite `someCall(...);` followed by `// expected` lines into an assertion,
 * so the documented output is checked rather than just the code running.
 */
function instrument(source) {
  const lines = source.split("\n");
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const call = lines[i].match(/^([a-zA-Z_$][\w$]*\(.*\));$/);
    const expected = [];

    if (call) {
      let j = i + 1;
      while (j < lines.length && lines[j].startsWith("// ")) {
        expected.push(lines[j].slice(3)); // keep any further leading spaces
        j++;
      }
      if (expected.length > 0) {
        out.push(`__check(${call[1]}, ${JSON.stringify(expected.join("\n"))});`);
        i = j - 1;
        continue;
      }
    }
    out.push(lines[i]);
  }

  return out.join("\n");
}

describe("README examples", () => {
  const blocks = extractJsBlocks(readFileSync(README, "utf8"));

  it("should find the documented examples", () => {
    assert.ok(blocks.length >= 4, `expected at least 4 js blocks, found ${blocks.length}`);
  });

  blocks.forEach((block, index) => {
    const firstLine = block.trim().split("\n")[0].slice(0, 60);

    it(`block ${index} should be self-contained: ${firstLine}`, () => {
      // A block that calls the API but never imports it cannot be copied out.
      if (/\b(parse|deparse|extractComments)\w*\s*\(/.test(block)) {
        assert.match(block, /require\(/, "example calls the API without importing it");
      }
    });

    it(`block ${index} should run and match its documented output`, async () => {
      const source = instrument(block).replace(
        /'@ashbyhq\/libpg-query-native'/g,
        LOCAL_PACKAGE
      );

      const mismatches = [];
      const check = (actual, expected) => {
        if (actual !== expected) {
          mismatches.push({ actual, expected });
        }
      };

      // Async wrapper: block 0 uses top-level await.
      const run = new Function(
        "__check",
        "require",
        `return (async () => {\n${source}\n})();`
      );
      await run(check, require);

      assert.deepEqual(
        mismatches,
        [],
        mismatches
          .map((m) => `documented ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`)
          .join("\n")
      );
    });
  });
});
