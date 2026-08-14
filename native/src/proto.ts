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
 * Everything needed to write one field, resolved once per message type.
 *
 * The tag is the protobuf key: `(fieldNumber << 3) | wireType`. Caching it
 * rather than recomputing per value is most of why this exists — a large parse
 * tree writes millions of them.
 */
interface FieldPlan {
  field: protobuf.Field;
  tag: number;
  /** `(id << 3) | 2`, used for a packed repeated scalar run. */
  packedTag: number;
  messageType: protobuf.Type | null;
  enumType: protobuf.Enum | null;
  /** Proto scalar name (`string`, `int32`, …); selects the Writer method. */
  scalar: string;
  repeated: boolean;
  /** Repeated scalars go out as one length-delimited run; messages do not. */
  packed: boolean;
  /** The proto3 default for this field. Values equal to it are not written. */
  defaultValue: unknown;
}

const plans = new Map<protobuf.Type, Map<string, FieldPlan>>();

const LENGTH_DELIMITED = new Set(["string", "bytes"]);
const WIRE_64 = new Set(["double", "fixed64", "sfixed64"]);
const WIRE_32 = new Set(["float", "fixed32", "sfixed32"]);

function wireTypeOf(field: protobuf.Field): number {
  if (field.resolvedType instanceof protobuf.Type) return 2;
  if (field.resolvedType instanceof protobuf.Enum) return 0;
  if (LENGTH_DELIMITED.has(field.type)) return 2;
  if (WIRE_64.has(field.type)) return 1;
  if (WIRE_32.has(field.type)) return 5;
  return 0;
}

/**
 * proto3 omits fields equal to their type's default, and reproducing that
 * exactly is what keeps the output byte-identical to protobufjs's encoder.
 *
 * Per field type rather than one shared predicate: `""` is the default for a
 * string but `0` is not, and 64-bit fields can arrive as the *string* `"0"`.
 * Treating `"0"` as a default everywhere silently drops `SELECT '0'`, whose
 * `String.sval` is the one-character string `"0"`.
 */
function defaultFor(field: protobuf.Field): unknown {
  if (field.resolvedType instanceof protobuf.Enum) return 0;
  if (field.type === "string") return "";
  if (field.type === "bool") return false;
  if (field.type === "bytes") return undefined;
  return 0;
}

function planFor(type: protobuf.Type): Map<string, FieldPlan> {
  let plan = plans.get(type);
  if (plan !== undefined) return plan;

  plan = new Map();
  for (const field of type.fieldsArray) {
    field.resolve();
    const wire = wireTypeOf(field);
    plan.set(field.jsonName, {
      field,
      tag: (field.id << 3) | wire,
      packedTag: (field.id << 3) | 2,
      messageType: field.resolvedType instanceof protobuf.Type ? field.resolvedType : null,
      enumType: field.resolvedType instanceof protobuf.Enum ? field.resolvedType : null,
      scalar: field.type,
      repeated: field.repeated,
      packed: field.repeated && wire !== 2,
      defaultValue: defaultFor(field),
    });
  }
  plans.set(type, plan);
  return plan;
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
const TWO_POW_64 = 18446744073709551616n;

function repair64Bit(value: number, unsigned: boolean): string | number {
  if (Number.isSafeInteger(value) || !Number.isInteger(value)) {
    return value;
  }

  const exact = BigInt(value);

  // The rounded-boundary clamps are signedness-specific, because the boundary
  // itself is. For a signed field, 2^63 is out of range and can only be
  // INT64_MAX after rounding. For an unsigned field, 2^63 is a legitimate
  // exact value — bit 63 of a bitmapset, i.e. attno 64 in Var.varnullingrels
  // or TableFunc.notnulls — and clamping it to 2^63-1 would flip every bit of
  // the mask. There the rounded boundary is 2^64, which can only be
  // UINT64_MAX.
  if (unsigned) {
    if (exact === TWO_POW_64) return UINT64_MAX.toString();
    if (exact > UINT64_MAX || exact < 0n) return value;
    return exact.toString();
  }

  if (exact === TWO_POW_63) return INT64_MAX.toString();
  if (exact > UINT64_MAX || exact < INT64_MIN) {
    // Too large to be a 64-bit integer field — a genuine double (SubPlan costs,
    // RangeTblEntry.enrtuples). Leave it alone.
    return value;
  }
  return exact.toString();
}

/** Proto types that need the 64-bit repair; everything else passes through. */
const SIXTY_FOUR_BIT = new Set(["int64", "uint64", "sint64", "fixed64", "sfixed64"]);

/**
 * Write one scalar with the Writer method matching its proto type.
 *
 * The 64-bit repair happens here because this is the only place a 64-bit value
 * is about to be committed to bytes.
 */
function writeScalar(writer: protobuf.Writer, scalar: string, value: unknown): void {
  switch (scalar) {
    case "string": writer.string(value as string); return;
    case "bool": writer.bool(value as boolean); return;
    case "int32": writer.int32(value as number); return;
    case "uint32": writer.uint32(value as number); return;
    case "sint32": writer.sint32(value as number); return;
    case "double": writer.double(value as number); return;
    case "float": writer.float(value as number); return;
    case "fixed32": writer.fixed32(value as number); return;
    case "sfixed32": writer.sfixed32(value as number); return;
    case "bytes": writer.bytes(value as Uint8Array); return;
    case "int64": writer.int64(repair(value, false) as never); return;
    case "uint64": writer.uint64(repair(value, true) as never); return;
    case "sint64": writer.sint64(repair(value, false) as never); return;
    case "fixed64": writer.fixed64(repair(value, true) as never); return;
    case "sfixed64": writer.sfixed64(repair(value, false) as never); return;
    default: throw new Error(`cannot encode unsupported scalar type "${scalar}"`);
  }
}

function repair(value: unknown, unsigned: boolean): unknown {
  return typeof value === "number" ? repair64Bit(value, unsigned) : value;
}

/** Write a single (non-repeated) value, tag included. */
function writeValue(
  writer: protobuf.Writer,
  plan: FieldPlan,
  value: unknown,
  depth: number
): void {
  // Absent before anything else: nulling a field is the natural way to delete
  // a clause from a tree you are editing, and it has to mean "not present" —
  // not a present-but-empty submessage on the wire.
  if (value === null || value === undefined) return;

  if (plan.messageType !== null) {
    // Length-delimited: fork() starts a nested buffer, ldelim() closes it and
    // prefixes the length. A submessage IS written when empty, because its
    // presence is meaningful — `{"Integer":{}}` is the integer zero.
    writer.uint32(plan.tag).fork();
    writeMessage(writer, value, plan.messageType, depth);
    writer.ldelim();
    return;
  }

  if (plan.enumType !== null) {
    const wire = encodeEnum(plan.enumType, value);
    if (wire === 0) return; // proto3 default
    writer.uint32(plan.tag).int32(wire);
    return;
  }

  if (value === plan.defaultValue) return;
  writer.uint32(plan.tag);
  writeScalar(writer, plan.scalar, value);
}

/**
 * Walk one message, writing it straight into `writer`.
 *
 * This replaces two passes — building a renamed copy of the tree, then handing
 * that to protobufjs's generated encoder — with one. The generated encoder is
 * what made that expensive: `Node.encode` is 553 lines with a branch per oneof
 * member, and every value in a pg_query tree is wrapped in a `Node`, so it is
 * the hot path. Writing the one field we know is set skips all of it.
 */
function writeMessage(
  writer: protobuf.Writer,
  value: unknown,
  type: protobuf.Type,
  depth: number
): void {
  // Checked here rather than in a pre-pass: this is the only recursion, so it
  // is also the only place depth can be measured without a second traversal.
  if (depth > RECURSION_LIMIT) {
    throw new RangeError(`nesting exceeds ${RECURSION_LIMIT}`);
  }
  if (value === null || typeof value !== "object") return;

  const node = value as Record<string, unknown>;
  const plan = planFor(type);

  // for..in rather than Object.keys/entries: this walks every node of the tree,
  // and those allocate an array per node just to iterate it. The tradeoff is
  // that for..in also yields inherited enumerable properties, and parse trees
  // come from JSON.parse so every node inherits from Object.prototype — a
  // polluted prototype would otherwise make every deparse fail the unknown-key
  // check below. hasOwnProperty is called off Object.prototype because the tree
  // is caller-supplied and may shadow it.
  for (const key in node) {
    if (!Object.prototype.hasOwnProperty.call(node, key)) continue;

    const entry = plan.get(key);
    if (entry === undefined) throw unknownFieldError(type, key);

    const raw = node[key];

    if (entry.repeated && Array.isArray(raw)) {
      if (entry.packed) {
        // Repeated scalars go out as one length-delimited run, not tag-per-value.
        if (raw.length === 0) continue;
        writer.uint32(entry.packedTag).fork();
        for (const element of raw) writeScalar(writer, entry.scalar, element);
        writer.ldelim();
      } else {
        for (const element of raw) writeValue(writer, entry, element, depth + 1);
      }
      continue;
    }

    writeValue(writer, entry, raw, depth + 1);
  }
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
    const writer = protobuf.Writer.create();
    writeMessage(writer, tree, ParseResult, 0);
    return writer.finish();
  } catch (error) {
    // Either RECURSION_LIMIT tripped, or the JS stack gave out first inside the
    // walk. Same thing to a caller, so report them the same way.
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
