import { fromJson, toBinary } from "@bufbuild/protobuf";
import { ParseResultSchema } from "./gen/pg_query_pb";

// JSON.parse() has no int64, so libpg_query's 64-bit fields come back as
// doubles that have already lost precision. The one that shows up in a raw
// parse tree is FetchStmt.howMany: `FETCH ALL` is LONG_MAX, and
// JSON.parse("9223372036854775807") yields 2^63 — one past the int64 ceiling,
// which protobuf-es then rejects.
//
// Both LONG_MAX and 2^63 round to the same double, so they can't be told
// apart; a value that lands exactly on 2^63 can only have arrived by rounding,
// and int64 is the only field type it could belong to in a parse tree.
const INT64_MAX = 9223372036854775807n;
const INT64_MIN = -9223372036854775808n;
const UINT64_MAX = 18446744073709551615n;
const TWO_POW_63 = 9223372036854775808n;

/**
 * Rewrite a number that lost precision in JSON.parse into the decimal string
 * form protobuf JSON accepts for 64-bit fields. Returns null to leave the
 * value alone.
 */
function repair64Bit(value: number): string | null {
  if (Number.isSafeInteger(value) || !Number.isInteger(value)) {
    return null;
  }

  const exact = BigInt(value);
  if (exact > UINT64_MAX || exact < INT64_MIN) {
    // Too large to be a 64-bit integer field — a genuine double (SubPlan costs,
    // RangeTblEntry.enrtuples). Leave it.
    return null;
  }

  return (exact === TWO_POW_63 ? INT64_MAX : exact).toString();
}

/**
 * Walk the tree repairing 64-bit values. Returns the input unchanged — same
 * reference, no allocation — when nothing needs repairing, which is every tree
 * that doesn't contain a `FETCH ALL` / `MOVE ALL`.
 */
function repairLostPrecision<T>(node: T): T {
  if (Array.isArray(node)) {
    let copy: unknown[] | null = null;
    for (let i = 0; i < node.length; i++) {
      const repaired = repairLostPrecision(node[i]);
      if (repaired !== node[i] && copy === null) copy = node.slice();
      if (copy !== null) copy[i] = repaired;
    }
    return (copy ?? node) as T;
  }

  if (typeof node === "number") {
    return (repair64Bit(node) ?? node) as T;
  }

  if (node === null || typeof node !== "object") {
    return node;
  }

  let copy: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const repaired = repairLostPrecision(value);
    if (repaired !== value && copy === null) copy = { ...(node as object) };
    if (copy !== null) copy[key] = repaired;
  }
  return (copy ?? node) as T;
}

/**
 * Encode a parse tree — the JSON that `parse()` returns — into the protobuf
 * wire format `pg_query_deparse_protobuf()` expects.
 *
 * The tree's JSON field names (`SelectStmt`, `targetList`, …) are the
 * `json_name` annotations in pg_query.proto. protobufjs ignores those, which
 * is what blocked earlier attempts at this; @bufbuild/protobuf honours them.
 *
 * Decoding is strict on purpose. A misspelled field or a bogus enum value in a
 * hand-edited tree throws here rather than being dropped on the floor and
 * deparsed into quietly wrong SQL.
 *
 * @throws if `tree` doesn't match the schema of the pinned libpg_query
 */
export function encodeParseTree(tree: unknown): Uint8Array {
  const repaired = repairLostPrecision(tree);
  return toBinary(ParseResultSchema, fromJson(ParseResultSchema, repaired as never));
}
