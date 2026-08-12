# @ashbyhq/pgsql-proto

Protobuf codecs for the libpg_query parse tree, one per PostgreSQL major version.

`libpg-query`'s `parse()` returns JSON, but `pg_query_deparse_protobuf()` — the
function that turns a tree back into SQL — takes protobuf. This package bridges
the two.

That bridge is the whole reason the package exists. `pg_query.proto` leans on
`json_name` annotations (1,683 of them in the PG 18 schema) to map JSON keys like
`SelectStmt`, `targetList`, and `A_Const` onto snake_case proto fields
(`select_stmt`, `target_list`, `a_const`). `protobufjs` [ignores
`json_name`](https://github.com/protobufjs/protobuf.js/pull/1825), so it can't
encode a parse tree at all. [`@bufbuild/protobuf`](https://github.com/bufbuild/protobuf-es)
honours it, so that's what these codecs are generated against.

## Usage

```typescript
import { encodeParseTree, decodeParseTree } from '@ashbyhq/pgsql-proto/v18';

const bytes = encodeParseTree(parseTree);   // Uint8Array, protobuf wire format
const tree = decodeParseTree(bytes);        // back to the JSON parse() shape
```

Subpaths `./v13` through `./v18` are available. Import the one matching the
parser that produced the tree — each carries its own file descriptor, so
importing a single version doesn't pull in the other five.

Most people don't need this directly: `libpg-query`'s `deparse()` and
`@pgsql/parser`'s `Parser#deparse()` use it under the hood.

## Strictness

Decoding is strict. A misspelled field or a bogus enum value throws rather than
being silently dropped — a dropped field deparses into quietly wrong SQL, which
is worse than a hard failure.

```typescript
encodeParseTree({ version: 180004, stmts: [{ stmt: { NoSuchNode: {} } }] });
// Error: cannot decode message pg_query.Node from JSON: key "NoSuchNode" is unknown
```

## Regenerating

The generated schemas under `src/vNN/gen/` are committed, so neither CI nor
consumers need a protobuf toolchain. After `pnpm run fetch:protos` picks up a new
libpg_query release:

```sh
pnpm --filter @ashbyhq/pgsql-proto generate
pnpm --filter @ashbyhq/pgsql-proto build
```

`generate` reads `protos/NN/pg_query.proto` from the repo root — the same files
the WASM builds link against — and runs `buf generate` with
[`protoc-gen-es`](https://github.com/bufbuild/protobuf-es) over each one.

## License

MIT
