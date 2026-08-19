const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const query = require("../dist/index.js");
const { encodeParseTree } = require("../dist/proto.js");

// For each statement below, the exact protobuf bytes the encoder is expected
// to produce, recorded as base64.
const expectedBytes = require("./fixtures/encoded-parse-trees.json");
const statements = require("./fixtures/statements.js");

// Where those expected bytes came from, and why comparing against them is worth
// anything:
//
// The encoder maps libpg_query's json_name-keyed JSON onto proto fields by hand,
// because protobufjs's own converters ignore json_name. @bufbuild/protobuf
// honours json_name natively and was the previous implementation here, so these
// bytes were recorded from it — a second, independently written encoder. Any
// disagreement between the two shows up as a failure below.
//
// So re-recording them to make a failure go away throws that away. A statement
// that stops matching means the encoder changed what it sends to libpg_query,
// which can change the SQL that comes back out. See scripts/generate-fixtures.mjs.
const PARSE_VERSION = query.parseSync("SELECT 1").version;

describe("Protobuf encoding", () => {
  describe("Encoded output matches what was recorded", () => {
    for (const sql of statements) {
      it(`should encode identically: ${sql.slice(0, 60)}`, () => {
        const expected = expectedBytes[sql];
        assert.ok(
          expected,
          "this statement has no recorded bytes — re-record them with scripts/generate-fixtures.mjs"
        );
        const actual = Buffer.from(encodeParseTree(query.parseSync(sql)));
        assert.equal(actual.toString("base64"), expected);
      });
    }

    it("should have recorded bytes for every statement, and no extras", () => {
      assert.deepEqual(Object.keys(expectedBytes).sort(), [...statements].sort());
    });
  });

  // protobufjs is permissive by default: fromObject() silently drops unknown
  // keys and turns an unrecognised enum name into 0. Both would produce SQL
  // that doesn't match the tree the caller passed, with nothing raised. The
  // remap enforces these instead.
  describe("Strictness", () => {
    const version = query.parseSync("SELECT 1").version;

    it("should reject an unknown key rather than dropping it", () => {
      const tree = query.parseSync("SELECT 1");
      tree.stmts[0].stmt.SelectStmt.notAField = true;
      assert.throws(() => encodeParseTree(tree), /key "notAField" is unknown/);
    });

    it("should name the message type in the error", () => {
      const tree = query.parseSync("SELECT 1");
      tree.stmts[0].stmt.SelectStmt.notAField = true;
      assert.throws(() => encodeParseTree(tree), /pg_query\.SelectStmt/);
    });

    it("should reject an unknown enum name rather than defaulting to 0", () => {
      const tree = query.parseSync("SELECT 1");
      tree.stmts[0].stmt.SelectStmt.op = "NOT_A_REAL_SETOP";
      assert.throws(() => encodeParseTree(tree), /value "NOT_A_REAL_SETOP" is unknown/);
    });

    it("should reject an unknown node type", () => {
      assert.throws(
        () => encodeParseTree({ version, stmts: [{ stmt: { NoSuchNode: {} } }] }),
        /key "NoSuchNode" is unknown/
      );
    });

    it("should still accept a valid enum by name", () => {
      const tree = query.parseSync("SELECT a UNION SELECT b");
      assert.equal(tree.stmts[0].stmt.SelectStmt.op, "SETOP_UNION");
      assert.ok(encodeParseTree(tree).length > 0);
    });

    it("should accept an enum given as its wire number", () => {
      const byName = query.parseSync("SELECT a UNION SELECT b");
      const byNumber = query.parseSync("SELECT a UNION SELECT b");
      byNumber.stmts[0].stmt.SelectStmt.op = 2; // SETOP_UNION
      assert.deepEqual(encodeParseTree(byNumber), encodeParseTree(byName));
    });

    // Numbers have to be validated as strictly as names. An unmapped value is
    // not a harmless passthrough: libpg_query's deparser takes its default
    // branch and silently drops the construct — `SELECT a UNION SELECT b` came
    // back as `"SELECT"`, losing the set operation and both arms.
    for (const bogus of [999, -5, 1.5, NaN, Infinity]) {
      it(`should reject the unmapped wire number ${bogus}`, () => {
        const tree = query.parseSync("SELECT a UNION SELECT b");
        tree.stmts[0].stmt.SelectStmt.op = bogus;
        assert.throws(() => encodeParseTree(tree), /pg_query\.SetOperation/);
      });
    }

    // protobufjs builds Enum#values as Object.create(valuesById), so the reverse
    // mapping is inherited: values["2"] resolves to the name "SETOP_UNION"
    // rather than being absent. A numeric *string* therefore used to bypass
    // validation — "0" and "1" deparsed `SELECT a UNION SELECT b` down to
    // "SELECT", and "2" only worked by accident.
    for (const numericString of ["0", "1", "2"]) {
      it(`should reject the numeric string ${JSON.stringify(numericString)}`, () => {
        const tree = query.parseSync("SELECT a UNION SELECT b");
        tree.stmts[0].stmt.SelectStmt.op = numericString;
        assert.throws(() => encodeParseTree(tree), /pg_query\.SetOperation/);
      });
    }

    it("should reject a string naming an Enum prototype member", () => {
      const tree = query.parseSync("SELECT 1");
      tree.stmts[0].stmt.SelectStmt.op = "toString";
      assert.throws(() => encodeParseTree(tree), /pg_query\.SetOperation/);
    });

    it("should reject an enum given as a non-string, non-number", () => {
      const tree = query.parseSync("SELECT 1");
      tree.stmts[0].stmt.SelectStmt.op = { nope: true };
      assert.throws(() => encodeParseTree(tree), /pg_query\.SetOperation/);
    });
  });

  // The remap walks with for..in to avoid allocating a key array per node, which
  // means it also sees inherited enumerable properties. Parse trees come from
  // JSON.parse, so every node inherits from Object.prototype — without an
  // own-property guard a single polluted key breaks every deparse.
  describe("Prototype pollution", () => {
    it("should ignore inherited enumerable properties", () => {
      const tree = query.parseSync("SELECT 1, 'x' FROM t WHERE a = 2");
      const expected = Buffer.from(encodeParseTree(tree)).toString("base64");

      Object.prototype.pollutedKey = "surprise";
      try {
        assert.equal(
          Buffer.from(encodeParseTree(tree)).toString("base64"),
          expected,
          "a polluted prototype changed the encoding"
        );
      } finally {
        delete Object.prototype.pollutedKey;
      }
    });

    it("should still reject an own property that is unknown", () => {
      const tree = query.parseSync("SELECT 1");
      Object.prototype.pollutedKey = "surprise";
      try {
        // Same key, but set directly on the node: that is a real unknown field
        // and must still throw rather than being skipped along with the
        // inherited one.
        tree.stmts[0].stmt.SelectStmt.pollutedKey = "surprise";
        assert.throws(() => encodeParseTree(tree), /key "pollutedKey" is unknown/);
      } finally {
        delete Object.prototype.pollutedKey;
      }
    });
  });

  // 64-bit fields split by signedness. JSON.parse rounds both boundary values
  // to the same doubles, but what the rounding means differs: on a signed field
  // 2^63 can only be INT64_MAX, while on an unsigned field 2^63 is a legitimate
  // exact value — bit 63 of a bitmapset — and clamping it flips every bit of
  // the mask. That clamp shipped in all three encoder generations before being
  // caught, because parse() never emits the planner-only unsigned fields.
  describe("64-bit signedness", () => {
    const protobuf = require("protobufjs");
    const root = protobuf.Root.fromJSON(require("../src/gen/pg_query.json"));
    const ParseResult = root.lookupType("pg_query.ParseResult");
    const decode = (bytes) =>
      ParseResult.toObject(ParseResult.decode(bytes), { longs: String });

    const withNotnulls = (notnulls) => ({
      version: PARSE_VERSION,
      stmts: [{ stmt: { SelectStmt: {
        fromClause: [{ TableFunc: { notnulls } }],
        op: "SETOP_NONE", limitOption: "LIMIT_OPTION_DEFAULT",
      } } }],
    });

    it("should keep 2^63 exact in an unsigned bitmapset", () => {
      const decoded = decode(encodeParseTree(withNotnulls([9223372036854775808])));
      assert.deepEqual(
        decoded.stmts[0].stmt.selectStmt.fromClause[0].tableFunc.notnulls,
        ["9223372036854775808"]
      );
    });

    it("should clamp 2^64 to UINT64_MAX in an unsigned field", () => {
      const decoded = decode(encodeParseTree(withNotnulls([18446744073709551616])));
      assert.deepEqual(
        decoded.stmts[0].stmt.selectStmt.fromClause[0].tableFunc.notnulls,
        ["18446744073709551615"]
      );
    });

    it("should still clamp 2^63 to INT64_MAX in a signed field", () => {
      // FetchStmt.howMany is int64; this is the FETCH ALL repair.
      const tree = {
        version: PARSE_VERSION,
        stmts: [{ stmt: { FetchStmt: {
          direction: "FETCH_FORWARD", howMany: 9223372036854775808, portalname: "cur",
        } } }],
      };
      const decoded = decode(encodeParseTree(tree));
      assert.equal(decoded.stmts[0].stmt.fetchStmt.howMany, "9223372036854775807");
    });
  });

  // A nulled field must mean "absent", not a present-but-empty submessage.
  // Setting a clause to null is the natural way to delete it from a tree being
  // edited, and an empty Node on the wire is a different statement.
  describe("Null means absent", () => {
    it("should encode a nulled message field identically to a deleted one", () => {
      const nulled = query.parseSync("SELECT a FROM t WHERE b = 1");
      nulled.stmts[0].stmt.SelectStmt.whereClause = null;
      const deleted = query.parseSync("SELECT a FROM t WHERE b = 1");
      delete deleted.stmts[0].stmt.SelectStmt.whereClause;
      assert.deepEqual(encodeParseTree(nulled), encodeParseTree(deleted));
    });

    it("should treat undefined the same way", () => {
      const tree = query.parseSync("SELECT a FROM t WHERE b = 1");
      tree.stmts[0].stmt.SelectStmt.whereClause = undefined;
      const deleted = query.parseSync("SELECT a FROM t WHERE b = 1");
      delete deleted.stmts[0].stmt.SelectStmt.whereClause;
      assert.deepEqual(encodeParseTree(tree), encodeParseTree(deleted));
    });

    it("should still write an empty object as a present submessage", () => {
      // {"Integer":{}} is the integer zero — presence is meaningful.
      const withEmpty = { version: PARSE_VERSION, stmts: [{ stmt: { SelectStmt: {
        targetList: [{ ResTarget: { val: { A_Const: { ival: {} } } } }],
        op: "SETOP_NONE", limitOption: "LIMIT_OPTION_DEFAULT",
      } } }] };
      const without = { version: PARSE_VERSION, stmts: [{ stmt: { SelectStmt: {
        targetList: [{ ResTarget: { val: { A_Const: {} } } }],
        op: "SETOP_NONE", limitOption: "LIMIT_OPTION_DEFAULT",
      } } }] };
      assert.notDeepEqual(encodeParseTree(withEmpty), encodeParseTree(without));
    });
  });

  // json_name is explicit for 1,683 of the 1,713 fields; the other 30 fall back
  // to the proto3 lowerCamelCase default. Both paths have to resolve, or whole
  // node types silently fail to encode.
  describe("json_name resolution", () => {
    it("should map an explicit json_name (Node oneof members)", () => {
      // `SelectStmt` in the JSON is the proto field `select_stmt`.
      assert.ok(encodeParseTree(query.parseSync("SELECT 1")).length > 0);
    });

    it("should map fields relying on the lowerCamelCase default", () => {
      // Integer.ival / String.sval / A_Const.location carry no json_name option.
      const tree = query.parseSync("SELECT 1, 'x'");
      const targets = tree.stmts[0].stmt.SelectStmt.targetList;
      assert.equal(targets[0].ResTarget.val.A_Const.ival.ival, 1);
      assert.equal(targets[1].ResTarget.val.A_Const.sval.sval, "x");
      assert.ok(encodeParseTree(tree).length > 0);
    });
  });
});
