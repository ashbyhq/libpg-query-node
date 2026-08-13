const query = require("../dist/index.js");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// Deparsed SQL rarely matches the source byte-for-byte — `ARRAY[1,2]` comes
// back as `ARRAY[1, 2]` — so every offset in the tree shifts. Compare trees
// with positions removed; anything left over is a real difference.
const POSITION_KEYS = new Set([
  "location",
  "stmt_len",
  "stmt_location",
  "list_start",
  "list_end",
]);

function removePositions(obj) {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(removePositions);

  const result = {};
  for (const key of Object.keys(obj)) {
    if (!POSITION_KEYS.has(key)) result[key] = removePositions(obj[key]);
  }
  return result;
}

// Shared with proto.test.js, which checks the exact bytes these encode to.
// Using one list means a statement added for either check is covered by both.
const ROUND_TRIP_QUERIES = require("./fixtures/statements.js");

const PARSE_VERSION = query.parseSync("SELECT 1").version;

function tree(stmts) {
  return { version: PARSE_VERSION, stmts };
}

describe("Deparsing", () => {
  describe("Round trip", () => {
    it("should return SQL for a parse tree", () => {
      assert.equal(query.deparseSync(query.parseSync("select 1")), "SELECT 1");
    });

    it("should normalize keywords and spacing", () => {
      assert.equal(
        query.deparseSync(query.parseSync("select a,b   from   t")),
        "SELECT a, b FROM t"
      );
    });

    for (const sql of ROUND_TRIP_QUERIES) {
      it(`should round-trip: ${sql}`, () => {
        const parsed = query.parseSync(sql);
        const deparsed = query.deparseSync(parsed);
        assert.deepEqual(
          removePositions(query.parseSync(deparsed)),
          removePositions(parsed),
          `deparsed to: ${deparsed}`
        );
      });
    }

    it("should round-trip a multi-statement tree", () => {
      const parsed = query.parseSync("SELECT 1; SELECT 2;");
      assert.equal(parsed.stmts.length, 2);
      assert.equal(query.parseSync(query.deparseSync(parsed)).stmts.length, 2);
    });

    it("should deparse an empty statement list to an empty string", () => {
      assert.equal(query.deparseSync(tree([])), "");
    });

    it("should reflect an edit to the tree", () => {
      const parsed = query.parseSync("SELECT a FROM t");
      parsed.stmts[0].stmt.SelectStmt.fromClause[0].RangeVar.relname = "other";
      assert.equal(query.deparseSync(parsed), "SELECT a FROM other");
    });
  });

  // FETCH_ALL is LONG_MAX, and JSON.parse() rounds that to 2^63 — one past the
  // int64 ceiling protobuf accepts. src/proto.ts puts it back; without that
  // repair every one of these throws before reaching the deparser.
  describe("64-bit fields", () => {
    for (const sql of ["FETCH ALL FROM cur", "MOVE ALL IN cur", "FETCH BACKWARD ALL FROM cur"]) {
      it(`should preserve ALL in: ${sql}`, () => {
        const parsed = query.parseSync(sql);
        assert.ok(!Number.isSafeInteger(parsed.stmts[0].stmt.FetchStmt.howMany));
        assert.match(query.deparseSync(parsed), /ALL/);
      });
    }

    it("should preserve a plain fetch count", () => {
      assert.match(query.deparseSync(query.parseSync("FETCH 10 FROM cur")), /\b10\b/);
    });

    it("should leave non-integer values alone", () => {
      assert.equal(query.deparseSync(query.parseSync("SELECT 1.5")), "SELECT 1.5");
    });
  });

  // protobufjs defaults its recursion limit to 100, which caps out around 92
  // set operations — well inside what generated SQL produces. src/proto.ts
  // raises it to 2000, under both the JS stack ceiling and the C deparser's
  // (which has no depth guard and segfaults if JS is enlarged past it).
  describe("Deep nesting", () => {
    const unionChain = (n) =>
      Array.from({ length: n }, (_, i) => `SELECT ${i}`).join(" UNION ALL ");

    for (const n of [50, 100, 500, 1500]) {
      it(`should deparse a ${n}-way UNION chain`, () => {
        const parsed = query.parseSync(unionChain(n));
        const deparsed = query.deparseSync(parsed);
        assert.equal((deparsed.match(/UNION ALL/g) || []).length, n - 1);
      });
    }

    it("should fail with an actionable message rather than a bare RangeError", () => {
      assert.throws(
        () => query.deparseSync(query.parseSync(unionChain(5000))),
        (error) => {
          assert.ok(error instanceof RangeError);
          assert.match(error.message, /nests too deeply/);
          return true;
        }
      );
    });
  });

  // A JS array reports `length` up to 2^32-1 no matter how many elements it
  // holds. That length drove the native reserve() calls and the read loop, so a
  // sparse array used to balloon RSS into the tens of GB and wedge the thread.
  describe("Comment list bounds", () => {
    it("should reject a sparse array with an absurd length", () => {
      const comments = [];
      comments.length = 2 ** 32 - 1;
      assert.throws(
        () => query.deparseSync(query.parseSync("SELECT 1"), { comments }),
        (error) => {
          assert.ok(error instanceof RangeError);
          assert.match(error.message, /Too many comments/);
          return true;
        }
      );
    });

    it("should still accept a normal comment list", () => {
      const sql = "-- hi\nSELECT 1";
      assert.match(
        query.deparseSync(query.parseSync(sql), { comments: query.extractCommentsSync(sql) }),
        /-- hi/
      );
    });
  });

  describe("Async Deparsing", () => {
    it("should resolve to the same SQL as the sync variant", async () => {
      const parsed = await query.parse("select a from t");
      assert.equal(await query.deparse(parsed), query.deparseSync(parsed));
    });
  });

  describe("Error Handling", () => {
    it("should throw SqlError with source details when the deparser rejects a tree", () => {
      assert.throws(
        () => query.deparseSync(tree([{ stmt: {} }])),
        (error) => {
          assert.equal(error.name, "SqlError");
          assert.match(error.message, /RawStmt with empty Stmt/);
          assert.match(error.sqlDetails.fileName, /deparse\.c$/);
          assert.ok(query.hasSqlDetails(error));
          return true;
        }
      );
    });

    it("should throw when a node type cannot appear in an expression", () => {
      const parsed = query.parseSync("SELECT a FROM t");
      // Var is a planner node — the raw grammar never produces one.
      parsed.stmts[0].stmt.SelectStmt.targetList[0].ResTarget.val = {
        Var: { varno: 1, varattno: 1 },
      };
      assert.throws(() => query.deparseSync(parsed), /unpermitted node type/);
    });

    // Encoding is strict so a typo fails loudly instead of being dropped and
    // deparsed into quietly wrong SQL.
    it("should reject an unknown node key", () => {
      assert.throws(
        () => query.deparseSync(tree([{ stmt: { NoSuchNode: {} } }])),
        /NoSuchNode/
      );
    });

    it("should reject an unknown enum value", () => {
      const parsed = query.parseSync("SELECT 1");
      parsed.stmts[0].stmt.SelectStmt.op = "NOT_A_REAL_SETOP";
      assert.throws(() => query.deparseSync(parsed), /NOT_A_REAL_SETOP/);
    });

    it("should reject a null or non-object tree", () => {
      assert.throws(() => query.deparseSync(null), /cannot be null or undefined/);
      assert.throws(() => query.deparseSync("SELECT 1"), /must be an object/);
    });
  });

  describe("Formatting options", () => {
    const sql = "select a, b, c from mytable where x = 1 and y = 2 order by a";

    it("should emit a single line by default", () => {
      assert.doesNotMatch(query.deparseSync(query.parseSync(sql)), /\n/);
    });

    it("should break across lines with prettyPrint", () => {
      const pretty = query.deparseSync(query.parseSync(sql), { prettyPrint: true });
      assert.match(pretty, /^SELECT a, b, c\nFROM mytable\n/);
    });

    it("should still round-trip when pretty printed", () => {
      const parsed = query.parseSync(sql);
      const pretty = query.deparseSync(parsed, { prettyPrint: true });
      assert.deepEqual(removePositions(query.parseSync(pretty)), removePositions(parsed));
    });

    it("should honour indentSize", () => {
      const parsed = query.parseSync(sql);
      assert.match(query.deparseSync(parsed, { prettyPrint: true, indentSize: 8 }), /\n {8}x = 1/);
      assert.match(query.deparseSync(parsed, { prettyPrint: true, indentSize: 2 }), /\n {2}x = 1/);
    });

    // The layout options all sit under "Pretty print options" upstream, so they
    // only take effect alongside prettyPrint.
    it("should honour trailingNewline when pretty printing", () => {
      const parsed = query.parseSync(sql);
      assert.ok(query.deparseSync(parsed, { prettyPrint: true, trailingNewline: true }).endsWith("\n"));
      assert.ok(!query.deparseSync(parsed, { prettyPrint: true, trailingNewline: false }).endsWith("\n"));
    });

    it("should ignore trailingNewline without prettyPrint", () => {
      assert.ok(!query.deparseSync(query.parseSync(sql), { trailingNewline: true }).endsWith("\n"));
    });

    it("should accept an empty options object", () => {
      assert.equal(query.deparseSync(query.parseSync("select 1"), {}), "SELECT 1");
    });
  });

  describe("Comments", () => {
    const sql = "-- leading comment\nSELECT a FROM t; -- trailing";

    it("should extract comments from a query", () => {
      const comments = query.extractCommentsSync(sql);
      assert.equal(comments.length, 2);
      assert.equal(comments[0].text, "-- leading comment");
      assert.equal(comments[1].text, "-- trailing");
      assert.equal(typeof comments[0].matchLocation, "number");
      assert.equal(typeof comments[0].newlinesBefore, "number");
      assert.equal(typeof comments[0].newlinesAfter, "number");
    });

    it("should return an empty list for a query with no comments", () => {
      assert.deepEqual(query.extractCommentsSync("SELECT 1"), []);
    });

    it("should extract block comments", () => {
      const comments = query.extractCommentsSync("/* hello */ SELECT 1");
      assert.equal(comments.length, 1);
      assert.equal(comments[0].text, "/* hello */");
    });

    it("should drop comments when none are supplied", () => {
      assert.doesNotMatch(query.deparseSync(query.parseSync(sql)), /comment/);
    });

    it("should weave comments back into the output", () => {
      const comments = query.extractCommentsSync(sql);
      const deparsed = query.deparseSync(query.parseSync(sql), { comments });
      assert.match(deparsed, /-- leading comment/);
      assert.match(deparsed, /-- trailing/);
    });

    it("should accept hand-built comments", () => {
      const deparsed = query.deparseSync(query.parseSync("SELECT a FROM t"), {
        comments: [
          { matchLocation: 0, newlinesBefore: 0, newlinesAfter: 1, text: "/* hello */" },
        ],
      });
      assert.match(deparsed, /\/\* hello \*\//);
    });

    it("should accept an empty comment list", () => {
      assert.equal(query.deparseSync(query.parseSync("select 1"), { comments: [] }), "SELECT 1");
    });

    it("should resolve the async variant to the same comments", async () => {
      assert.deepEqual(await query.extractComments(sql), query.extractCommentsSync(sql));
    });
  });
});
