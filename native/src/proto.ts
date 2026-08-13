import protobuf from "protobufjs";

import descriptor from "./gen/pg_query.json";

/**
 * Nesting depth allowed when encoding a parse tree.
 *
 * Encoding recurses once per nested message, and nesting grows about one level
 * per set operation — so a chain of `SELECT ... UNION ALL ...` is what reaches
 * this first.
 *
 * The bound is a safety property, not a quota. Past it the JS stack gives out
 * with a bare RangeError; and if the stack is enlarged so JS survives,
 * `deparseRawStmt` on the C side has no depth guard of its own and segfaults.
 * Measured on darwin-arm64 / Node 24: the JS stack runs out around 2050 levels
 * and the C deparser dies around 8000. This sits under both, so deep input
 * fails with a message that says what happened.
 */
const RECURSION_LIMIT = 2000;

// protobufjs enforces its own depth cap, separately, in fromObject() and
// encode() — and it defaults to 100, the same too-low value @bufbuild/protobuf
// used. It lives on a module-global rather than per-Root, so it has to be set
// here. Raising it only relaxes a bound, so it cannot break another protobufjs
// user in the process; leaving it at the default would cap us at ~92 set
// operations no matter what RECURSION_LIMIT says.
protobuf.util.recursionLimit = RECURSION_LIMIT;

// The schema is loaded from a pre-parsed descriptor rather than the .proto
// text: Root.fromJSON is ~9 ms, parsing 123 KB of .proto is not, and this cost
// is paid on every process start.
const root = protobuf.Root.fromJSON(descriptor as protobuf.INamespace);
const ParseResult = root.lookupType("pg_query.ParseResult");

// ---------------------------------------------------------------------------
// Why there is a hand-written remap here at all
//
// libpg_query's parse() emits JSON keyed by `json_name`: `SelectStmt`,
// `targetList`, `A_Const`. The proto fields behind those are `select_stmt`,
// `target_list`, `a_const`. pg_query.proto carries 1,683 `json_name`
// annotations to bridge the two.
//
// protobufjs's own converters (fromObject/toObject) key off proto field names
// and ignore `json_name` — which is what made protobufjs a dead end for this
// in the past, and why the earlier attempt upstream vendored a fork.
//
// But protobufjs only ignores json_name in its *converters*. Its parser keeps
// it, exposed as `Field.jsonName` (which returns the explicit annotation when
// present and the proto3 lowerCamelCase default otherwise — 30 of the 1,713
// fields, e.g. `Integer.ival`, rely on that default). So the bridge is a key
// rename driven off the descriptor, not a fork.
//
// The alternative, @bufbuild/protobuf, honours json_name directly and needs no
// remap. It was measured at ~10x slower on a 26 MB parse tree (2571 ms vs
// 241 ms) because it is reflection-driven and allocates two arrays per nested
// message — and pg_query trees are pathologically nested, ~1.44M messages for
// that tree. test/proto.test.js compares this encoder's output byte-for-byte
// against bytes recorded from @bufbuild/protobuf, so the speed is not bought
// with a change in what libpg_query receives.
// ---------------------------------------------------------------------------

/**
 * json_name -> Field, per message type. Built on first use and cached: the
 * lookup is the hot path (every node in the tree is a `Node` oneof wrapper, so
 * this map is consulted once per node).
 */
const fieldsByJsonName = new Map<protobuf.Type, Map<string, protobuf.Field>>();

function jsonNameLookup(type: protobuf.Type): Map<string, protobuf.Field> {
  let byName = fieldsByJsonName.get(type);
  if (byName === undefined) {
    byName = new Map();
    for (const field of type.fieldsArray) {
      field.resolve();
      byName.set(field.jsonName, field);
    }
    fieldsByJsonName.set(type, byName);
  }
  return byName;
}

// ---------------------------------------------------------------------------
// Strictness
//
// protobufjs is deliberately permissive: fromObject() drops keys it doesn't
// recognise and turns an unknown enum name into 0. Both are silent. For a
// deparser that is the worst failure mode available — a dropped clause or a
// defaulted enum produces valid-looking SQL that doesn't match the tree the
// caller handed us, with nothing raised anywhere.
//
// @bufbuild/protobuf rejects both by default, and that strictness is a
// documented property of this API, so it has to survive the switch. It is
// enforced here rather than by calling protobufjs's verify(), which would be a
// second full traversal of the tree; the remap already visits every key with
// the field descriptor in hand, so checking costs nothing extra.
// ---------------------------------------------------------------------------

function unknownFieldError(type: protobuf.Type, key: string): Error {
  return new Error(
    `cannot encode message ${type.fullName.replace(/^\./, "")} from JSON: ` +
      `key "${key}" is unknown`
  );
}

function unknownEnumError(enumType: protobuf.Enum, value: string): Error {
  return new Error(
    `cannot encode enum ${enumType.fullName.replace(/^\./, "")} from JSON: ` +
      `value "${value}" is unknown`
  );
}

/**
 * Convert an enum value to its wire number.
 *
 * The JSON carries enum values as their names (`"SETOP_NONE"`). Numbers are
 * also accepted, since a caller building a tree by hand may use them — but they
 * are validated just as strictly, because an unmapped value is not a harmless
 * passthrough here. libpg_query's deparser falls through to its default branch
 * on one, and the result is silent: `SELECT a UNION SELECT b` with a bogus
 * `SelectStmt.op` deparses to `"SELECT"`, dropping the set operation and both
 * arms without raising anything.
 *
 * `valuesById` is keyed by wire number, so a single lookup rejects unmapped
 * values, non-integers and NaN alike — and unlike scanning `Object.values()` it
 * neither allocates nor walks every member on a path that runs once per enum in
 * the tree.
 */
function encodeEnum(enumType: protobuf.Enum, value: unknown): number {
  if (typeof value === "number") {
    if (enumType.valuesById[value] === undefined) {
      throw unknownEnumError(enumType, String(value));
    }
    return value;
  }
  if (typeof value === "string") {
    // Own property required: protobufjs builds `values` as
    // Object.create(valuesById), so the reverse mapping is inherited and
    // `values["2"]` resolves to the *name* "SETOP_UNION" rather than being
    // absent. Without this check a numeric string bypasses validation and
    // returns a string from a function declared to return a number — `"0"` and
    // `"1"` deparsed `SELECT a UNION SELECT b` down to `"SELECT"`, silently
    // dropping the set operation and both arms.
    if (!Object.prototype.hasOwnProperty.call(enumType.values, value)) {
      throw unknownEnumError(enumType, value);
    }
    return enumType.values[value];
  }
  throw unknownEnumError(enumType, String(value));
}

// ---------------------------------------------------------------------------
// 64-bit repair
//
// JSON.parse() has no int64, so libpg_query's 64-bit fields arrive as doubles
// that already lost precision. The one that shows up in a real parse tree is
// FetchStmt.howMany: `FETCH ALL` is LONG_MAX, and
// JSON.parse("9223372036854775807") yields 2^63 — one past the int64 ceiling.
//
// Both LONG_MAX and 2^63 round to the same double so they cannot be told
// apart; a value landing exactly on 2^63 can only have arrived by rounding,
// and int64 is the only field type it could belong to in a parse tree.
//
// This used to be a separate pass over the whole tree. It now happens inline
// during the remap, which is visiting every scalar anyway.
// ---------------------------------------------------------------------------

const INT64_MAX = 9223372036854775807n;
const INT64_MIN = -9223372036854775808n;
const UINT64_MAX = 18446744073709551615n;
const TWO_POW_63 = 9223372036854775808n;

function repair64Bit(value: number): string | number {
  if (Number.isSafeInteger(value) || !Number.isInteger(value)) {
    return value;
  }

  const exact = BigInt(value);
  if (exact > UINT64_MAX || exact < INT64_MIN) {
    // Too large to be a 64-bit integer field — a genuine double (SubPlan costs,
    // RangeTblEntry.enrtuples). Leave it alone.
    return value;
  }

  return (exact === TWO_POW_63 ? INT64_MAX : exact).toString();
}

/** Proto types that need the 64-bit repair; everything else passes through. */
const SIXTY_FOUR_BIT = new Set(["int64", "uint64", "sint64", "fixed64", "sfixed64"]);

/**
 * Rewrite one JSON value into the shape protobufjs encodes from: proto field
 * names as keys, enums as numbers, 64-bit values repaired.
 */
function encodeValue(value: unknown, field: protobuf.Field, depth: number): unknown {
  if (field.resolvedType instanceof protobuf.Type) {
    return remapMessage(value, field.resolvedType, depth);
  }
  if (field.resolvedType instanceof protobuf.Enum) {
    return encodeEnum(field.resolvedType, value);
  }
  if (typeof value === "number" && SIXTY_FOUR_BIT.has(field.type)) {
    return repair64Bit(value);
  }
  return value;
}

function remapMessage(value: unknown, type: protobuf.Type, depth: number): unknown {
  // Checked here rather than in a pre-pass: this is the only recursion, so it
  // is also the only place depth can be measured without a second traversal.
  if (depth > RECURSION_LIMIT) {
    throw new RangeError(`nesting exceeds ${RECURSION_LIMIT}`);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const node = value as Record<string, unknown>;
  const byName = jsonNameLookup(type);
  const out: Record<string, unknown> = {};

  // for..in rather than Object.keys/entries: this walks every node of the tree,
  // and those allocate an array per node just to iterate it. The tradeoff is
  // that for..in also yields inherited enumerable properties, and parse trees
  // come from JSON.parse so every node inherits from Object.prototype — a
  // polluted prototype would otherwise make every deparse fail the unknown-key
  // check below. hasOwnProperty is called off Object.prototype because the tree
  // is caller-supplied and may shadow it.
  for (const key in node) {
    if (!Object.prototype.hasOwnProperty.call(node, key)) continue;

    const field = byName.get(key);
    if (field === undefined) throw unknownFieldError(type, key);

    const raw = node[key];
    out[field.name] = field.repeated && Array.isArray(raw)
      ? raw.map((element) => encodeValue(element, field, depth + 1))
      : encodeValue(raw, field, depth + 1);
  }

  return out;
}

/**
 * Encode a parse tree — the JSON that `parse()` returns — into the protobuf
 * bytes `pg_query_deparse_protobuf()` expects.
 *
 * Strict by design: a misspelled field or a bogus enum value throws here rather
 * than being dropped on the floor and deparsed into quietly wrong SQL.
 *
 * @throws if `tree` doesn't match the schema of the pinned libpg_query
 * @throws {RangeError} if the tree nests deeper than {@link RECURSION_LIMIT}
 */
export function encodeParseTree(tree: unknown): Uint8Array {
  try {
    const remapped = remapMessage(tree, ParseResult, 0) as Record<string, unknown>;
    return ParseResult.encode(ParseResult.fromObject(remapped)).finish();
  } catch (error) {
    // Either RECURSION_LIMIT tripped, or the JS stack gave out first inside the
    // remap. Same thing to a caller, so report them the same way.
    if (error instanceof RangeError) {
      const wrapped = new RangeError(
        `Parse tree nests too deeply to deparse (limit ${RECURSION_LIMIT}). ` +
          "This usually means a very long chain of set operations (UNION/INTERSECT/EXCEPT)."
      );
      // Assigned rather than passed to the constructor: the `cause` option needs
      // lib ES2022 and this package targets ES2020. Node supports it at runtime.
      (wrapped as { cause?: unknown }).cause = error;
      throw wrapped;
    }
    throw error;
  }
}
