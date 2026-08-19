#!/usr/bin/env node
//
// Re-records test/fixtures/encoded-parse-trees.json: for every statement in
// test/fixtures/statements.js, the exact protobuf bytes the encoder should produce.
// test/proto.test.js compares against that file, so it is what stops the
// encoder silently changing what libpg_query receives.
//
// WHERE THE COMMITTED BYTES CAME FROM. They were recorded from
// @bufbuild/protobuf, which handles json_name natively and was this package's
// original encoder. The current encoder maps json_name by hand, because
// protobufjs ignores it. Comparing the two is only meaningful because they were
// written independently.
//
// WHAT THIS SCRIPT DOES INSTEAD. It re-records from the *current* encoder, so
// running it accepts whatever that encoder does today as correct. That is right
// for the one case it exists for — the libpg_query pin moving to a new
// PostgreSQL major, where parse trees legitimately change shape — and wrong as
// a way to make a failing test pass. A statement that stops matching while the
// pin has not moved means the encoder changed its output, which can change the
// SQL deparse returns. Find out why before re-recording.
//
// To restore the independent comparison after a pin bump:
//
//   npm i --no-save @bufbuild/protobuf @bufbuild/protoc-gen-es @bufbuild/buf
//   # generate the protobuf-es schema, encode the statements with it, diff the
//   # base64 against this file, then drop the dev dependencies again.
//
// Usage:
//   node scripts/generate-fixtures.mjs --confirm

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nativeDir = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!process.argv.includes("--confirm")) {
  console.error(
    "Refusing to run without --confirm.\n\n" +
      "This rewrites the wire-format fixtures from the current encoder, which\n" +
      "makes any encoder change self-approving. Only do this when the\n" +
      "libpg_query pin has moved. See the header of this file."
  );
  process.exit(1);
}

const { encodeParseTree } = require(join(nativeDir, "dist", "proto.js"));
const { parseSync } = require(join(nativeDir, "dist", "index.js"));
const statements = require(join(nativeDir, "test", "fixtures", "statements.js"));

const encoded = {};
for (const sql of statements) {
  encoded[sql] = Buffer.from(encodeParseTree(parseSync(sql))).toString("base64");
}

const out = join(nativeDir, "test", "fixtures", "encoded-parse-trees.json");
writeFileSync(out, `${JSON.stringify(encoded, null, 2)}\n`);
console.log(`Wrote ${statements.length} encodings to ${out}`);
