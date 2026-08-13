const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const query = require("../dist/index.js");
const { encodeParseTree } = require("../dist/proto.js");

const golden = require("./fixtures/encoded-parse-trees.json");

// The encoder maps libpg_query's json_name-keyed JSON onto proto fields by hand,
// because protobufjs's own converters ignore json_name. These fixtures are the
// wire bytes @bufbuild/protobuf produced for the same trees — it honours
// json_name natively and was the previous implementation here, so it serves as
// an independent reference.
//
// Regenerating them casually defeats the point: if one of these stops matching,
// the encoder changed what it puts on the wire, which means deparse output can
// change too. Only regenerate against a known-good implementation.
describe("Protobuf encoding", () => {
  describe("Wire-format fixtures", () => {
    for (const [sql, expected] of Object.entries(golden)) {
      it(`should encode identically: ${sql.slice(0, 60)}`, () => {
        const actual = Buffer.from(encodeParseTree(query.parseSync(sql)));
        assert.equal(actual.toString("base64"), expected);
      });
    }

    it("should cover the fixture corpus", () => {
      assert.ok(Object.keys(golden).length >= 35);
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
