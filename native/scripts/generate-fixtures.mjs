#!/usr/bin/env node
//
// Regenerates test/fixtures/encoded-parse-trees.json — the expected protobuf
// wire bytes for every statement in test/fixtures/corpus.js.
//
// PROVENANCE. The committed fixtures were captured from @bufbuild/protobuf,
// which honours json_name natively and was this package's original encoder.
// They exist so the current encoder — which maps json_name by hand, because
// protobufjs ignores it in its converters — is pinned against an independent
// implementation rather than against itself.
//
// THIS SCRIPT REGENERATES FROM THE CURRENT ENCODER, so running it blesses
// whatever that encoder does today. That is fine for the case it exists for —
// the libpg_query pin moving to a new PG major, where the parse trees
// legitimately change — and wrong as a way to make a failing test pass. A
// fixture that starts failing without the pin moving means the encoder changed
// what it puts on the wire, which changes deparse output. Investigate that
// rather than re-recording it.
//
// To re-establish the independent cross-check after a pin bump:
//
//   npm i --no-save @bufbuild/protobuf @bufbuild/protoc-gen-es @bufbuild/buf
//   # generate the protobuf-es schema, encode the corpus with it, diff the
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
const corpus = require(join(nativeDir, "test", "fixtures", "corpus.js"));

const encoded = {};
for (const sql of corpus) {
  encoded[sql] = Buffer.from(encodeParseTree(parseSync(sql))).toString("base64");
}

const out = join(nativeDir, "test", "fixtures", "encoded-parse-trees.json");
writeFileSync(out, `${JSON.stringify(encoded, null, 2)}\n`);
console.log(`Wrote ${corpus.length} encodings to ${out}`);
