const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const query = require("../");

// Deparsed SQL rarely matches the source byte-for-byte — `ARRAY[1,2]` comes
// back as `ARRAY[1, 2]` — so every offset in the tree shifts. Compare trees
// with positions removed; anything left over is a real difference.
const POSITION_KEYS = new Set([
  'location',
  'stmt_len',
  'stmt_location',
  'list_start',
  'list_end',
]);

function removePositions(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(removePositions);
  }

  const result = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key) && !POSITION_KEYS.has(key)) {
      result[key] = removePositions(obj[key]);
    }
  }
  return result;
}

// Valid on every PostgreSQL version this repo builds (13+), so the same corpus
// can be used across all of them.
const ROUND_TRIP_QUERIES = [
  "SELECT 1",
  "SELECT a, b FROM t WHERE x = $1 AND y > 3 ORDER BY a DESC LIMIT 10",
  "INSERT INTO t (a, b) VALUES (1, 'x') RETURNING *",
  "UPDATE t SET a = 1 WHERE b = 2",
  "DELETE FROM t WHERE a IS NULL",
  "CREATE TABLE foo (id serial PRIMARY KEY, name text NOT NULL DEFAULT 'x')",
  "WITH c AS (SELECT 1) SELECT * FROM c JOIN d USING (id)",
  "SELECT 1.5, 'a'::int, ARRAY[1, 2], CASE WHEN a THEN 1 ELSE 2 END",
  "SELECT * FROM generate_series(1, 10) g(i) WHERE i IS NOT NULL",
  "SELECT * FROM t TABLESAMPLE bernoulli (10)",
  "SELECT a FROM t GROUP BY GROUPING SETS ((a), (b))",
  "SELECT count(*) FILTER (WHERE a) OVER (PARTITION BY b ORDER BY c) FROM t",
  "CREATE VIEW v AS SELECT a FROM t WHERE b IN (SELECT c FROM u)",
  "CREATE INDEX ON t USING gin (c jsonb_path_ops)",
  "GRANT SELECT ON t TO r",
  "ALTER TABLE t ADD COLUMN c int",
  "SELECT a UNION SELECT b",
  "SELECT -9223372036854775808",
  "DO $$ BEGIN NULL; END $$",
  "ALTER TABLE t ADD COLUMN c int; DROP TABLE t;",
];

// Pretty-printing and comment preservation need pg_query_deparse_protobuf_opts,
// which only the PostgreSQL 18 build of libpg_query provides.
const supportsFormatting = typeof query.extractComments === 'function';

// Filled in once the module is loaded; the deparser is version-agnostic but a
// tree still has to carry the version the parser stamped on it.
let parseVersion;

function emptyTree(stmts) {
  return { version: parseVersion, stmts };
}

describe("Deparse", () => {
  before(async () => {
    await query.loadModule();
    parseVersion = query.parseSync("SELECT 1").version;
  });

  describe("Round trip", () => {
    it("returns SQL for a parse tree", () => {
      assert.equal(query.deparseSync(query.parseSync("select 1")), "SELECT 1");
    });

    it("normalizes keywords and spacing", () => {
      assert.equal(
        query.deparseSync(query.parseSync("select a,b   from   t")),
        "SELECT a, b FROM t"
      );
    });

    for (const sql of ROUND_TRIP_QUERIES) {
      it(`round-trips: ${sql}`, () => {
        const tree = query.parseSync(sql);
        const deparsed = query.deparseSync(tree);
        assert.deepEqual(
          removePositions(query.parseSync(deparsed)),
          removePositions(tree),
          `deparsed to: ${deparsed}`
        );
      });
    }

    it("round-trips a multi-statement tree", () => {
      const tree = query.parseSync("SELECT 1; SELECT 2;");
      assert.equal(tree.stmts.length, 2);
      assert.equal(query.parseSync(query.deparseSync(tree)).stmts.length, 2);
    });

    // `long` is 32-bit under wasm32, so FETCH_ALL comes through as INT32_MAX
    // rather than overflowing a JS number. Pin that down — if a future build
    // targets wasm64 this is the first thing that breaks.
    it("round-trips FETCH ALL, whose howMany is a 64-bit field", () => {
      const tree = query.parseSync("FETCH ALL FROM cur");
      assert.equal(tree.stmts[0].stmt.FetchStmt.howMany, 2147483647);
      assert.match(query.deparseSync(tree), /^FETCH ALL/);
    });

    it("deparses an empty statement list to an empty string", () => {
      assert.equal(query.deparseSync(emptyTree([])), "");
    });
  });

  describe("Async", () => {
    it("resolves to the same SQL as the sync variant", async () => {
      const tree = await query.parse("select a from t");
      assert.equal(await query.deparse(tree), query.deparseSync(tree));
    });
  });

  describe("Errors", () => {
    it("throws SqlError with source details when the deparser rejects a tree", () => {
      assert.throws(
        () => query.deparseSync(emptyTree([{ stmt: {} }])),
        (error) => {
          assert.equal(error.name, 'SqlError');
          assert.match(error.message, /RawStmt with empty Stmt/);
          // pg_query_deparse.c on older versions, postgres_deparse.c since the
          // file was split out upstream.
          assert.match(error.sqlDetails.fileName, /deparse\.c$/);
          return true;
        }
      );
    });

    it("throws when a node type cannot appear in an expression", () => {
      const tree = query.parseSync("SELECT a FROM t");
      // Var is a planner node — the raw grammar never produces one.
      tree.stmts[0].stmt.SelectStmt.targetList[0].ResTarget.val = {
        Var: { varno: 1, varattno: 1 },
      };
      assert.throws(() => query.deparseSync(tree), /unpermitted node type/);
    });

    // Encoding is strict so a typo fails loudly instead of being dropped and
    // deparsed into quietly wrong SQL.
    it("rejects an unknown node key", () => {
      assert.throws(
        () => query.deparseSync(emptyTree([{ stmt: { NoSuchNode: {} } }])),
        /NoSuchNode/
      );
    });

    it("rejects an unknown enum value", () => {
      const tree = query.parseSync("SELECT 1");
      tree.stmts[0].stmt.SelectStmt.op = 'NOT_A_REAL_SETOP';
      assert.throws(() => query.deparseSync(tree), /NOT_A_REAL_SETOP/);
    });

    it("rejects a null or non-object tree", () => {
      assert.throws(() => query.deparseSync(null), /cannot be null or undefined/);
      assert.throws(() => query.deparseSync('SELECT 1'), /must be an object/);
    });
  });

  describe("Formatting options", { skip: !supportsFormatting }, () => {
    const sql = "select a, b, c from mytable where x = 1 and y = 2 order by a";

    it("emits a single line by default", () => {
      assert.doesNotMatch(query.deparseSync(query.parseSync(sql)), /\n/);
    });

    it("breaks across lines with prettyPrint", () => {
      const pretty = query.deparseSync(query.parseSync(sql), { prettyPrint: true });
      assert.match(pretty, /\n/);
      assert.match(pretty, /^SELECT a, b, c\nFROM mytable\n/);
    });

    it("still round-trips when pretty printed", () => {
      const tree = query.parseSync(sql);
      const pretty = query.deparseSync(tree, { prettyPrint: true });
      assert.deepEqual(removePositions(query.parseSync(pretty)), removePositions(tree));
    });

    it("honours indentSize", () => {
      const tree = query.parseSync(sql);
      const wide = query.deparseSync(tree, { prettyPrint: true, indentSize: 8 });
      const narrow = query.deparseSync(tree, { prettyPrint: true, indentSize: 2 });
      assert.match(wide, /\n {8}x = 1/);
      assert.match(narrow, /\n {2}x = 1/);
    });

    // The formatting options all sit under "Pretty print options" upstream, so
    // they only take effect alongside prettyPrint.
    it("honours trailingNewline when pretty printing", () => {
      const tree = query.parseSync(sql);
      assert.ok(query.deparseSync(tree, { prettyPrint: true, trailingNewline: true }).endsWith('\n'));
      assert.ok(!query.deparseSync(tree, { prettyPrint: true, trailingNewline: false }).endsWith('\n'));
    });

    it("ignores trailingNewline without prettyPrint", () => {
      const tree = query.parseSync(sql);
      assert.ok(!query.deparseSync(tree, { trailingNewline: true }).endsWith('\n'));
    });
  });

  describe("Comments", { skip: !supportsFormatting }, () => {
    const sql = "-- leading comment\nSELECT a FROM t; -- trailing";

    it("extracts comments from a query", () => {
      const comments = query.extractCommentsSync(sql);
      assert.equal(comments.length, 2);
      assert.equal(comments[0].text, '-- leading comment');
      assert.equal(comments[1].text, '-- trailing');
      assert.equal(typeof comments[0].matchLocation, 'number');
    });

    it("returns an empty list for a query with no comments", () => {
      assert.deepEqual(query.extractCommentsSync("SELECT 1"), []);
    });

    it("drops comments when none are supplied", () => {
      assert.doesNotMatch(query.deparseSync(query.parseSync(sql)), /comment/);
    });

    it("weaves comments back into the output", () => {
      const comments = query.extractCommentsSync(sql);
      const deparsed = query.deparseSync(query.parseSync(sql), { comments });
      assert.match(deparsed, /-- leading comment/);
      assert.match(deparsed, /-- trailing/);
    });

    it("accepts hand-built comments", () => {
      const deparsed = query.deparseSync(query.parseSync("SELECT a FROM t"), {
        comments: [
          { matchLocation: 0, newlinesBefore: 0, newlinesAfter: 1, text: '/* hello */' },
        ],
      });
      assert.match(deparsed, /\/\* hello \*\//);
    });

    it("resolves the async variant to the same comments", async () => {
      assert.deepEqual(await query.extractComments(sql), query.extractCommentsSync(sql));
    });
  });
});
