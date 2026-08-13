/**
 * Smoke test for the packaged native addon.
 * Verifies that the platform package loads and all APIs work.
 *
 * Usage (from a temp directory with the packages installed):
 *   node smoke.mjs
 *
 * Or from the native/ directory with prebuilds in place:
 *   node test/smoke.mjs
 */

import { createRequire } from "module";

const require = createRequire(import.meta.url);

let exitCode = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    exitCode = 1;
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL  ${name}: ${e.message}`);
    exitCode = 1;
  }
}

const lib = require("@ashbyhq/libpg-query-native");

console.log(`Platform: ${process.platform}-${process.arch}`);
console.log(`Node: ${process.version}`);
console.log("");

await test("parseSync returns parse tree", () => {
  const result = lib.parseSync("SELECT 1");
  assert(result.version > 0, "version should be positive");
  assert(result.stmts.length === 1, "should have 1 statement");
  assert(result.stmts[0].stmt.SelectStmt, "should have SelectStmt");
});

await test("parse (async) works", async () => {
  const result = await lib.parse("SELECT 1");
  assert(result.stmts.length === 1, "should have 1 statement");
});

await test("fingerprintSync returns hex string", () => {
  const fp = lib.fingerprintSync("SELECT 1");
  assert(typeof fp === "string", "should be string");
  assert(fp.length === 16, "should be 16 chars");
  assert(/^[0-9a-f]+$/.test(fp), "should be hex");
});

await test("normalizeSync replaces constants", () => {
  const result = lib.normalizeSync("SELECT 1, 'hello'");
  assert(result.includes("$1"), "should have $1");
  assert(!result.includes("hello"), "should not have literal");
});

await test("scanSync returns tokens", () => {
  const result = lib.scanSync("SELECT id FROM users");
  assert(result.tokens.length > 0, "should have tokens");
  assert(result.tokens[0].text === "SELECT", "first token should be SELECT");
});

await test("parsePlPgSQLSync works", () => {
  const result = lib.parsePlPgSQLSync(
    "CREATE FUNCTION test() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql"
  );
  assert(result.plpgsql_funcs, "should have plpgsql_funcs");
});

await test("parseSync throws SqlError on bad SQL", () => {
  try {
    lib.parseSync("SELECTT");
    assert(false, "should have thrown");
  } catch (e) {
    assert(e.name === "SqlError", `error name should be SqlError, got ${e.name}`);
    assert(e.sqlDetails, "should have sqlDetails");
    assert(typeof e.sqlDetails.message === "string", "should have message");
  }
});

await test("loadModule is a no-op", async () => {
  await lib.loadModule();
});

// Deparse is the only API whose correctness depends on JS-side work (encoding
// the tree to protobuf) as well as the addon, so it is worth smoke-testing on
// every platform rather than trusting a single dev machine.
await test("deparseSync round-trips a statement", async () => {
  const sql = "select a,b   from   t where x = 1";
  const out = lib.deparseSync(lib.parseSync(sql));
  assert(out === "SELECT a, b FROM t WHERE x = 1", `unexpected deparse output: ${out}`);
});

await test("deparseSync rejects an unknown field", async () => {
  const tree = lib.parseSync("SELECT 1");
  tree.stmts[0].stmt.SelectStmt.notAField = true;
  try {
    lib.deparseSync(tree);
    assert(false, "should have thrown");
  } catch (e) {
    assert(/notAField/.test(e.message), `expected an unknown-field error, got ${e.message}`);
  }
});

await test("extractCommentsSync finds a comment", async () => {
  const comments = lib.extractCommentsSync("-- hi\nSELECT 1");
  assert(comments.length === 1, `expected 1 comment, got ${comments.length}`);
  assert(comments[0].text === "-- hi", `unexpected comment text: ${comments[0].text}`);
});

console.log("");
if (exitCode === 0) {
  console.log("All smoke tests passed.");
} else {
  console.error("Some smoke tests failed.");
}
process.exit(exitCode);
