// The SQL corpus shared by the deparse round-trip suite and the wire-format
// fixtures. One list rather than two: the suites assert different properties
// (structural parse->deparse->parse equality vs exact protobuf bytes) over the
// same statements, and maintaining two hand-written lists let them drift.
//
// test/fixtures/encoded-parse-trees.json is keyed by these strings, so adding
// one here without regenerating the fixture will fail the wire-format test.
module.exports = [
  "SELECT 1",
  "SELECT a, b FROM t WHERE x = $1 AND y > 3 ORDER BY a DESC LIMIT 10",
  "INSERT INTO t (a,b) VALUES (1,'x') RETURNING *",
  "UPDATE t SET a=1 WHERE b=2",
  "DELETE FROM t WHERE a IS NULL",
  "CREATE TABLE foo (id serial PRIMARY KEY, name text NOT NULL DEFAULT 'x')",
  "WITH c AS (SELECT 1) SELECT * FROM c JOIN d USING (id)",
  "SELECT 1.5, 'a'::int, ARRAY[1,2], CASE WHEN a THEN 1 ELSE 2 END",
  "FETCH ALL FROM cur",
  "MOVE ALL IN cur",
  "FETCH BACKWARD ALL FROM cur",
  "FETCH 10 FROM cur",
  "SELECT * FROM t TABLESAMPLE bernoulli (10)",
  "SELECT a FROM t GROUP BY GROUPING SETS ((a),(b))",
  "SELECT count(*) FILTER (WHERE a) OVER (PARTITION BY b ORDER BY c) FROM t",
  "CREATE INDEX ON t USING gin (c jsonb_path_ops)",
  "GRANT SELECT ON t TO r",
  "SELECT a UNION SELECT b",
  "SELECT a INTERSECT SELECT b",
  "SELECT a EXCEPT ALL SELECT b",
  "SELECT -9223372036854775808",
  "MERGE INTO t USING s ON t.id=s.id WHEN MATCHED THEN UPDATE SET a=1",
  "SELECT json_object('a': 1)",
  "DO $$ BEGIN NULL; END $$",
  "ALTER TABLE t ADD COLUMN c int; DROP TABLE t;",
  "CREATE TABLE t (id int, valid_at daterange, PRIMARY KEY (id, valid_at WITHOUT OVERLAPS))",
  "UPDATE t SET x = 1 RETURNING OLD.x, NEW.x",
  "CREATE TABLE t (a int, b int GENERATED ALWAYS AS (a*2) VIRTUAL)",
  "SELECT * FROM t FOR UPDATE OF t NOWAIT",
  "COPY t FROM STDIN WITH (FORMAT csv)",
  "CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END $$ LANGUAGE plpgsql",
  "SELECT x'deadbeef'::bytea, B'1010'",
  "SELECT INTERVAL '1 day' + now() AT TIME ZONE 'UTC'",
  "SELECT a UNION ALL SELECT b UNION ALL SELECT c UNION ALL SELECT d",
  "CREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f()",
  "SELECT ROW(1,2) IS NOT DISTINCT FROM ROW(3,4)",
  "SELECT * FROM xmltable('/a' PASSING x COLUMNS c text PATH '@c')"
];
