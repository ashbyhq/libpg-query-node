/**
 * The JSON parse tree produced by libpg_query — `{ version, stmts }`.
 *
 * Deliberately structural rather than imported from `@pgsql/types`: this
 * package ships one codec per PostgreSQL major version, and pinning a single
 * version's `ParseResult` here would make the other five wrong. Callers that
 * want the precise per-version shape already have it from `@pgsql/types`.
 */
export interface ParseTree {
  version?: number;
  stmts?: unknown[];
  [key: string]: unknown;
}
