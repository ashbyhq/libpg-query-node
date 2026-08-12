const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { encodeParseTree, decodeParseTree, PG_VERSION } = require('../dist/cjs/v18/index.js');

// A hand-written parse tree for `SELECT 1`, in the JSON shape libpg_query's
// parse() emits. Written out literally so this package can be tested without
// depending on a built WASM module.
const SELECT_ONE = {
  version: 180004,
  stmts: [
    {
      stmt: {
        SelectStmt: {
          targetList: [
            {
              ResTarget: {
                val: { A_Const: { ival: { ival: 1 }, location: 7 } },
                location: 7,
              },
            },
          ],
          limitOption: 'LIMIT_OPTION_DEFAULT',
          op: 'SETOP_NONE',
        },
      },
    },
  ],
};

describe('@ashbyhq/pgsql-proto', () => {
  it('exposes the PostgreSQL major version', () => {
    assert.equal(PG_VERSION, 18);
  });

  it('encodes a parse tree to protobuf bytes', () => {
    const bytes = encodeParseTree(SELECT_ONE);
    assert.ok(bytes instanceof Uint8Array);
    assert.ok(bytes.length > 0);
  });

  it('round-trips a parse tree through the wire format', () => {
    assert.deepEqual(decodeParseTree(encodeParseTree(SELECT_ONE)), SELECT_ONE);
  });

  // This is the whole reason for the package. protobufjs ignores json_name, so
  // `SelectStmt` / `targetList` / `A_Const` would all fail to map onto their
  // snake_case proto fields (`select_stmt`, `target_list`, `a_const`).
  it('honours json_name when mapping the JSON tree onto proto fields', () => {
    const bytes = encodeParseTree(SELECT_ONE);
    // Field 1 (version) as varint, then field 2 (stmts) as a length-delimited
    // submessage — i.e. the tree actually populated fields rather than being
    // silently dropped as unknown.
    assert.equal(bytes[0], 0x08);
    assert.ok(bytes.includes(0x12));
  });

  // Both of these would otherwise be dropped silently and deparsed into
  // quietly wrong SQL, which is worse than a hard failure.
  it('rejects a tree whose enum value is not in the schema', () => {
    const bad = JSON.parse(JSON.stringify(SELECT_ONE));
    bad.stmts[0].stmt.SelectStmt.op = 'NOT_A_REAL_SETOP';
    assert.throws(() => encodeParseTree(bad), /NOT_A_REAL_SETOP/);
  });

  it('rejects a tree with an unknown field', () => {
    const extra = JSON.parse(JSON.stringify(SELECT_ONE));
    extra.stmts[0].stmt.SelectStmt.notAField = true;
    assert.throws(() => encodeParseTree(extra), /notAField/);
  });

  it('ships a codec for every supported PostgreSQL version', () => {
    for (const version of [13, 14, 15, 16, 17, 18]) {
      const mod = require(`../dist/cjs/v${version}/index.js`);
      assert.equal(mod.PG_VERSION, version);
      assert.equal(typeof mod.encodeParseTree, 'function');
    }
  });
});
