const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Parser, getSupportedVersions } = require('../wasm/index.cjs');

describe('Deparse', () => {
  describe('Every supported version', () => {
    for (const version of getSupportedVersions()) {
      it(`round-trips through v${version}`, async () => {
        const parser = new Parser({ version });
        const tree = await parser.parse('select a,b   from   t where x=1');
        assert.equal(await parser.deparse(tree), 'SELECT a, b FROM t WHERE x = 1');
      });
    }
  });

  describe('Sync API', () => {
    it('deparses once the parser is loaded', async () => {
      const parser = new Parser();
      await parser.loadParser();
      assert.equal(parser.deparseSync(parser.parseSync('select 1')), 'SELECT 1');
    });

    it('refuses to deparse before the parser is loaded', () => {
      const parser = new Parser();
      assert.throws(() => parser.deparseSync({ stmts: [] }), /Parser not loaded/);
    });
  });

  describe('Errors', () => {
    it('preserves SqlError rather than wrapping it', async () => {
      const parser = new Parser();
      const version = (await parser.parse('SELECT 1')).version;
      await assert.rejects(
        () => parser.deparse({ version, stmts: [{ stmt: {} }] }),
        (error) => {
          assert.equal(error.name, 'SqlError');
          assert.match(error.message, /RawStmt with empty Stmt/);
          return true;
        }
      );
    });

    it('reports the version when the failure is not a SqlError', async () => {
      const parser = new Parser();
      await parser.loadParser();
      await assert.rejects(
        () => parser.deparse('not a tree'),
        new RegExp(`Deparse error in PostgreSQL ${parser.version}`)
      );
    });
  });

  // pg_query_deparse_protobuf_opts only exists in PostgreSQL 18's libpg_query
  // build. Elsewhere the options are accepted and ignored so callers don't have
  // to branch on version.
  describe('Formatting options', () => {
    it('pretty prints on v18', async () => {
      const parser = new Parser({ version: 18 });
      const tree = await parser.parse('select a,b from t where x=1');
      assert.match(await parser.deparse(tree, { prettyPrint: true }), /\n/);
    });

    it('ignores them on older versions', async () => {
      const parser = new Parser({ version: 15 });
      const tree = await parser.parse('select a,b from t where x=1');
      assert.equal(
        await parser.deparse(tree, { prettyPrint: true }),
        await parser.deparse(tree)
      );
    });
  });
});
