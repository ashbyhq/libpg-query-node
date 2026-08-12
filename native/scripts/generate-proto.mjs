#!/usr/bin/env node
//
// Regenerates src/gen/pg_query_pb.ts from the pg_query.proto matching the
// pinned libpg_query tag.
//
// deparse() has to hand libpg_query a protobuf-encoded parse tree, but parse()
// returns JSON. pg_query.proto maps between the two with `json_name`
// annotations (1,683 of them), which protobufjs ignores and @bufbuild/protobuf
// honours — hence protobuf-es.
//
// The output is committed, so `npm ci` and the platform builds need no
// protobuf toolchain. Re-run this after the libpg_query pin moves:
//
//   npm run generate:proto
//
// The schema MUST match x-upstream.libpgQueryTag in package.json. A parse tree
// encoded against a different schema will deparse into wrong SQL or fail
// outright, so this script refuses to run if protos/NN is out of sync.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const nativeDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(nativeDir, "..");

const pkg = JSON.parse(readFileSync(join(nativeDir, "package.json"), "utf8"));
const { pgMajor, libpgQueryTag } = pkg["x-upstream"];

const protoDir = join(repoRoot, "protos", pgMajor);
const protoFile = join(protoDir, "pg_query.proto");

if (!existsSync(protoFile)) {
  console.error(`Missing ${protoFile} — run \`pnpm run fetch:protos\` at the repo root.`);
  process.exit(1);
}

// Guard against silently generating from a stale schema.
const upstreamUrl =
  `https://raw.githubusercontent.com/pganalyze/libpg_query/${libpgQueryTag}/protobuf/pg_query.proto`;
const local = readFileSync(protoFile);
const remote = Buffer.from(await (await fetch(upstreamUrl)).arrayBuffer());
const digest = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);

if (!local.equals(remote)) {
  console.error(
    `protos/${pgMajor}/pg_query.proto does not match libpg_query ${libpgQueryTag}.\n` +
      `  local:  ${digest(local)}\n` +
      `  ${libpgQueryTag}: ${digest(remote)}\n` +
      `Run \`pnpm run fetch:protos\` at the repo root, then re-run this.`
  );
  process.exit(1);
}

const binDir = join(nativeDir, "node_modules", ".bin");
execFileSync(join(binDir, "buf"), ["generate", protoDir], {
  cwd: nativeDir,
  stdio: "inherit",
  env: { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH}` },
});

console.log(`✅ Generated src/gen/pg_query_pb.ts from libpg_query ${libpgQueryTag}`);
