/**
 * @ashbyhq/pgsql-proto
 *
 * Protobuf codecs for the libpg_query parse tree, one per PostgreSQL major
 * version. Import the version you need directly — the root entrypoint only
 * carries shared types, so you never pay for six file descriptors at once:
 *
 * ```ts
 * import { encodeParseTree } from '@ashbyhq/pgsql-proto/v18';
 * ```
 */
export type { ParseTree } from './types.js';

export const SUPPORTED_VERSIONS = [13, 14, 15, 16, 17, 18] as const;

export type SupportedVersion = (typeof SUPPORTED_VERSIONS)[number];
