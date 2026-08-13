#!/usr/bin/env node
//
// Regenerates src/gen/pg_query.json from the pg_query.proto matching the
// pinned libpg_query tag.
//
// deparse() has to hand libpg_query a protobuf-encoded parse tree, but parse()
// returns JSON. pg_query.proto maps between the two with `json_name`
// annotations (1,683 of them). protobufjs's converters ignore those, but its
// parser keeps them, so src/proto.ts drives the mapping itself off this
// descriptor — see the comments there.
//
// A pre-parsed descriptor rather than the .proto text: Root.fromJSON is ~9 ms
// at startup, parsing 123 KB of .proto is not.
//
// The output is committed, so `npm ci` and the platform builds need no
// protobuf toolchain. Re-run this after the libpg_query pin moves:
//
//   npm run generate:proto
//
// The schema MUST match x-upstream.libpgQueryTag in package.json. A parse tree
// encoded against a different schema will deparse into wrong SQL or fail
// outright, so this script refuses to run if protos/NN is out of sync.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import protobuf from "protobufjs";

import { currentPin } from "./upstream.mjs";

const nativeDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(nativeDir, "..");

// Read the pin from the Makefile via currentPin() rather than from
// package.json's x-upstream. x-upstream is *derived* — sync-upstream-metadata.mjs
// writes it — so a Makefile bump that hasn't been synced yet would leave this
// guard comparing against the stale tag and passing, which is the exact failure
// it exists to catch.
const pin = currentPin(join(nativeDir, "Makefile"));
const { tag: libpgQueryTag, repo } = pin;
const pgMajor = String(pin.pgMajor); // currentPin returns a number; paths need a string

const protoDir = join(repoRoot, "protos", pgMajor);
const protoFile = join(protoDir, "pg_query.proto");

if (!existsSync(protoFile)) {
  console.error(`Missing ${protoFile} — run \`pnpm run fetch:protos\` at the repo root.`);
  process.exit(1);
}

// Guard against silently generating from a stale schema.
const repoSlug = repo.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
const upstreamUrl =
  `https://raw.githubusercontent.com/${repoSlug}/${libpgQueryTag}/protobuf/pg_query.proto`;
const local = readFileSync(protoFile);
const remote = Buffer.from(await (await fetch(upstreamUrl)).arrayBuffer());
const digest = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);

if (!local.equals(remote)) {
  console.error(
    `protos/${pgMajor}/pg_query.proto does not match ${repoSlug}@${libpgQueryTag}.\n` +
      `  local:  ${digest(local)}\n` +
      `  ${libpgQueryTag}: ${digest(remote)}\n` +
      `Run \`pnpm run fetch:protos\` at the repo root, then re-run this.`
  );
  process.exit(1);
}

const outFile = join(nativeDir, "src", "gen", "pg_query.json");
mkdirSync(dirname(outFile), { recursive: true });

// toJSON() keeps field options, which is where json_name lives.
const schema = protobuf.loadSync(protoFile).toJSON({ keepComments: false });
writeFileSync(outFile, `${JSON.stringify(schema)}\n`);

console.log(`✅ Generated src/gen/pg_query.json from libpg_query ${libpgQueryTag}`);
