import { ParseResult } from "@pgsql/types";
export * from "@pgsql/types";

import { encodeParseTree } from '@ashbyhq/pgsql-proto/v{{PG_VERSION}}';

export interface ScanToken {
  start: number;
  end: number;
  text: string;
  tokenType: number;
  tokenName: string;
  keywordKind: number;
  keywordName: string;
}

export interface ScanResult {
  version: number;
  tokens: ScanToken[];
}

export interface SqlErrorDetails {
  message: string;
  cursorPosition: number;
  fileName?: string;
  functionName?: string;
  lineNumber?: number;
  context?: string;
}

export class SqlError extends Error {
  sqlDetails?: SqlErrorDetails;
  
  constructor(message: string, details?: SqlErrorDetails) {
    super(message);
    this.name = 'SqlError';
    this.sqlDetails = details;
  }
}

export function hasSqlDetails(error: unknown): error is SqlError {
  return error instanceof SqlError && error.sqlDetails !== undefined;
}

export function formatSqlError(
  error: SqlError,
  query: string,
  options: {
    showPosition?: boolean;
    showQuery?: boolean;
    color?: boolean;
    maxQueryLength?: number;
  } = {}
): string {
  const {
    showPosition = true,
    showQuery = true,
    color = false,
    maxQueryLength
  } = options;

  const lines: string[] = [];

  // ANSI color codes
  const red = color ? '\x1b[31m' : '';
  const yellow = color ? '\x1b[33m' : '';
  const reset = color ? '\x1b[0m' : '';

  // Add error message
  lines.push(`${red}Error: ${error.message}${reset}`);

  // Add SQL details if available
  if (error.sqlDetails) {
    const { cursorPosition, fileName, functionName, lineNumber } = error.sqlDetails;

    if (cursorPosition !== undefined && cursorPosition >= 0) {
      lines.push(`Position: ${cursorPosition}`);
    }

    if (fileName || functionName || lineNumber) {
      const details = [];
      if (fileName) details.push(`file: ${fileName}`);
      if (functionName) details.push(`function: ${functionName}`);
      if (lineNumber) details.push(`line: ${lineNumber}`);
      lines.push(`Source: ${details.join(', ')}`);
    }

    // Show query with position marker
    if (showQuery && showPosition && cursorPosition !== undefined && cursorPosition >= 0) {
      let displayQuery = query;
      let adjustedPosition = cursorPosition;

      // Truncate if needed
      if (maxQueryLength && query.length > maxQueryLength) {
        const start = Math.max(0, cursorPosition - Math.floor(maxQueryLength / 2));
        const end = Math.min(query.length, start + maxQueryLength);
        displayQuery = (start > 0 ? '...' : '') +
                      query.substring(start, end) +
                      (end < query.length ? '...' : '');
        // Adjust cursor position for truncation
        adjustedPosition = cursorPosition - start + (start > 0 ? 3 : 0);
      }

      lines.push(displayQuery);
      lines.push(' '.repeat(adjustedPosition) + `${yellow}^${reset}`);
    }
  } else if (showQuery) {
    // No SQL details, just show the query if requested
    let displayQuery = query;
    if (maxQueryLength && query.length > maxQueryLength) {
      displayQuery = query.substring(0, maxQueryLength) + '...';
    }
    lines.push(`Query: ${displayQuery}`);
  }

  return lines.join('\n');
}

// @ts-ignore
import PgQueryModule from './libpg-query.js';

interface WasmModule {
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  _wasm_free_string: (ptr: number) => void;
  _wasm_parse_query: (queryPtr: number) => number;
  _wasm_parse_query_raw: (queryPtr: number) => number;
  _wasm_free_parse_result: (ptr: number) => void;
  _wasm_parse_plpgsql: (queryPtr: number) => number;
  _wasm_fingerprint: (queryPtr: number) => number;
  _wasm_normalize_query: (queryPtr: number) => number;
  _wasm_scan: (queryPtr: number) => number;
  _wasm_deparse_protobuf_raw: (dataPtr: number, len: number) => number;
  _wasm_deparse_protobuf_opts_raw: (
    dataPtr: number,
    len: number,
    commentsPtr: number,
    commentCount: number,
    prettyPrint: number,
    indentSize: number,
    maxLineLength: number,
    trailingNewline: number,
    commasStartOfLine: number
  ) => number;
  _wasm_free_deparse_result: (ptr: number) => void;
  _wasm_deparse_comments_new: (count: number) => number;
  _wasm_deparse_comments_set: (
    commentsPtr: number,
    index: number,
    matchLocation: number,
    newlinesBefore: number,
    newlinesAfter: number,
    textPtr: number
  ) => void;
  _wasm_deparse_comments_free: (commentsPtr: number, count: number) => void;
  _wasm_deparse_comments_for_query: (queryPtr: number) => number;
  lengthBytesUTF8: (str: string) => number;
  stringToUTF8: (str: string, ptr: number, len: number) => void;
  UTF8ToString: (ptr: number) => string;
  getValue: (ptr: number, type: string) => number;
  HEAPU8: Uint8Array;
}

let wasmModule: WasmModule;

const initPromise = PgQueryModule().then((module: WasmModule) => {
  wasmModule = module;
});

function ensureLoaded() {
  if (!wasmModule) throw new Error("WASM module not initialized. Call `loadModule()` first.");
}

export async function loadModule(): Promise<void> {
  if (!wasmModule) {
    await initPromise;
  }
}

function awaitInit<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    await initPromise;
    return fn(...args);
  }) as T;
}

function stringToPtr(str: string): number {
  ensureLoaded();
  if (typeof str !== 'string') {
    throw new TypeError(`Expected a string, got ${typeof str}`);
  }
  const len = wasmModule.lengthBytesUTF8(str) + 1;
  const ptr = wasmModule._malloc(len);
  try {
    wasmModule.stringToUTF8(str, ptr, len);
    return ptr;
  } catch (error) {
    wasmModule._free(ptr);
    throw error;
  }
}

function ptrToString(ptr: number): string {
  ensureLoaded();
  if (typeof ptr !== 'number') {
    throw new TypeError(`Expected a number, got ${typeof ptr}`);
  }
  return wasmModule.UTF8ToString(ptr);
}

/**
 * Read a PgQueryError struct out of the WASM heap.
 *
 * struct { char* message; char* funcname; char* filename; int lineno; int cursorpos; char* context; }
 */
function readSqlError(errorPtr: number): SqlError {
  const messagePtr = wasmModule.getValue(errorPtr, 'i32');       // offset 0
  const funcnamePtr = wasmModule.getValue(errorPtr + 4, 'i32');  // offset 4
  const filenamePtr = wasmModule.getValue(errorPtr + 8, 'i32');  // offset 8
  const lineno = wasmModule.getValue(errorPtr + 12, 'i32');      // offset 12
  const cursorpos = wasmModule.getValue(errorPtr + 16, 'i32');   // offset 16
  const contextPtr = wasmModule.getValue(errorPtr + 20, 'i32');  // offset 20

  const message = messagePtr ? wasmModule.UTF8ToString(messagePtr) : 'Unknown error';

  return new SqlError(message, {
    message,
    cursorPosition: cursorpos > 0 ? cursorpos - 1 : 0, // Convert to 0-based
    fileName: filenamePtr ? wasmModule.UTF8ToString(filenamePtr) : undefined,
    functionName: funcnamePtr ? wasmModule.UTF8ToString(funcnamePtr) : undefined,
    lineNumber: lineno > 0 ? lineno : undefined,
    context: contextPtr ? wasmModule.UTF8ToString(contextPtr) : undefined
  });
}

export const parse = awaitInit(async (query: string): Promise<ParseResult> => {
  // Input validation
  if (query === null || query === undefined) {
    throw new Error('Query cannot be null or undefined');
  }
  
  if (query === '') {
    throw new Error('Query cannot be empty');
  }

  const queryPtr = stringToPtr(query);
  let resultPtr = 0;
  
  try {
    resultPtr = wasmModule._wasm_parse_query_raw(queryPtr);
    if (!resultPtr) {
      throw new Error('Failed to parse query: memory allocation failed');
    }
    
    // Read the PgQueryParseResult struct
    const parseTreePtr = wasmModule.getValue(resultPtr, 'i32');
    const stderrBufferPtr = wasmModule.getValue(resultPtr + 4, 'i32');
    const errorPtr = wasmModule.getValue(resultPtr + 8, 'i32');
    
    if (errorPtr) {
      throw readSqlError(errorPtr);
    }
    
    if (!parseTreePtr) {
      throw new Error('No parse tree generated');
    }
    
    const parseTreeStr = wasmModule.UTF8ToString(parseTreePtr);
    return JSON.parse(parseTreeStr);
  } finally {
    wasmModule._free(queryPtr);
    if (resultPtr) {
      wasmModule._wasm_free_parse_result(resultPtr);
    }
  }
});

export const parsePlPgSQL = awaitInit(async (query: string): Promise<ParseResult> => {
  const queryPtr = stringToPtr(query);
  let resultPtr = 0;
  
  try {
    resultPtr = wasmModule._wasm_parse_plpgsql(queryPtr);
    const resultStr = ptrToString(resultPtr);
    
    // Success is always a JSON object; anything else is an error message
    if (!resultStr.startsWith('{')) {
      throw new Error(resultStr);
    }
    
    return JSON.parse(resultStr);
  } finally {
    wasmModule._free(queryPtr);
    if (resultPtr) {
      wasmModule._wasm_free_string(resultPtr);
    }
  }
});

export const fingerprint = awaitInit(async (query: string): Promise<string> => {
  const queryPtr = stringToPtr(query);
  let resultPtr = 0;
  
  try {
    resultPtr = wasmModule._wasm_fingerprint(queryPtr);
    const resultStr = ptrToString(resultPtr);
    
    if (resultStr.startsWith('syntax error') || resultStr.startsWith('deparse error') || resultStr.startsWith('ERROR')) {
      throw new Error(resultStr);
    }
    
    return resultStr;
  } finally {
    wasmModule._free(queryPtr);
    if (resultPtr) {
      wasmModule._wasm_free_string(resultPtr);
    }
  }
});

export const normalize = awaitInit(async (query: string): Promise<string> => {
  const queryPtr = stringToPtr(query);
  let resultPtr = 0;
  
  try {
    resultPtr = wasmModule._wasm_normalize_query(queryPtr);
    const resultStr = ptrToString(resultPtr);
    
    if (resultStr.startsWith('syntax error') || resultStr.startsWith('deparse error') || resultStr.startsWith('ERROR')) {
      throw new Error(resultStr);
    }
    
    return resultStr;
  } finally {
    wasmModule._free(queryPtr);
    if (resultPtr) {
      wasmModule._wasm_free_string(resultPtr);
    }
  }
});

// Sync versions
export function parseSync(query: string): ParseResult {
  if (!wasmModule) {
    throw new Error('WASM module not initialized. Call loadModule() first.');
  }
  
  // Input validation
  if (query === null || query === undefined) {
    throw new Error('Query cannot be null or undefined');
  }
  
  if (query === '') {
    throw new Error('Query cannot be empty');
  }

  const queryPtr = stringToPtr(query);
  let resultPtr = 0;
  
  try {
    resultPtr = wasmModule._wasm_parse_query_raw(queryPtr);
    if (!resultPtr) {
      throw new Error('Failed to parse query: memory allocation failed');
    }
    
    // Read the PgQueryParseResult struct
    const parseTreePtr = wasmModule.getValue(resultPtr, 'i32');
    const stderrBufferPtr = wasmModule.getValue(resultPtr + 4, 'i32');
    const errorPtr = wasmModule.getValue(resultPtr + 8, 'i32');
    
    if (errorPtr) {
      throw readSqlError(errorPtr);
    }
    
    if (!parseTreePtr) {
      throw new Error('No parse tree generated');
    }
    
    const parseTreeStr = wasmModule.UTF8ToString(parseTreePtr);
    return JSON.parse(parseTreeStr);
  } finally {
    wasmModule._free(queryPtr);
    if (resultPtr) {
      wasmModule._wasm_free_parse_result(resultPtr);
    }
  }
}

export function parsePlPgSQLSync(query: string): ParseResult {
  if (!wasmModule) {
    throw new Error('WASM module not initialized. Call loadModule() first.');
  }
  const queryPtr = stringToPtr(query);
  let resultPtr = 0;
  
  try {
    resultPtr = wasmModule._wasm_parse_plpgsql(queryPtr);
    const resultStr = ptrToString(resultPtr);
    
    // Success is always a JSON object; anything else is an error message
    if (!resultStr.startsWith('{')) {
      throw new Error(resultStr);
    }
    
    return JSON.parse(resultStr);
  } finally {
    wasmModule._free(queryPtr);
    if (resultPtr) {
      wasmModule._wasm_free_string(resultPtr);
    }
  }
}

export function fingerprintSync(query: string): string {
  if (!wasmModule) {
    throw new Error('WASM module not initialized. Call loadModule() first.');
  }
  const queryPtr = stringToPtr(query);
  let resultPtr = 0;
  
  try {
    resultPtr = wasmModule._wasm_fingerprint(queryPtr);
    const resultStr = ptrToString(resultPtr);
    
    if (resultStr.startsWith('syntax error') || resultStr.startsWith('deparse error') || resultStr.startsWith('ERROR')) {
      throw new Error(resultStr);
    }
    
    return resultStr;
  } finally {
    wasmModule._free(queryPtr);
    if (resultPtr) {
      wasmModule._wasm_free_string(resultPtr);
    }
  }
}

export function normalizeSync(query: string): string {
  if (!wasmModule) {
    throw new Error('WASM module not initialized. Call loadModule() first.');
  }
  const queryPtr = stringToPtr(query);
  let resultPtr = 0;
  
  try {
    resultPtr = wasmModule._wasm_normalize_query(queryPtr);
    const resultStr = ptrToString(resultPtr);
    
    if (resultStr.startsWith('syntax error') || resultStr.startsWith('deparse error') || resultStr.startsWith('ERROR')) {
      throw new Error(resultStr);
    }
    
    return resultStr;
  } finally {
    wasmModule._free(queryPtr);
    if (resultPtr) {
      wasmModule._wasm_free_string(resultPtr);
    }
  }
}

export const scan = awaitInit(async (query: string): Promise<ScanResult> => {
  const queryPtr = stringToPtr(query);
  let resultPtr = 0;
  
  try {
    resultPtr = wasmModule._wasm_scan(queryPtr);
    const resultStr = ptrToString(resultPtr);
    
    if (resultStr.startsWith('syntax error') || resultStr.startsWith('deparse error') || resultStr.startsWith('ERROR')) {
      throw new Error(resultStr);
    }
    
    return JSON.parse(resultStr);
  } finally {
    wasmModule._free(queryPtr);
    if (resultPtr) {
      wasmModule._wasm_free_string(resultPtr);
    }
  }
});

export function scanSync(query: string): ScanResult {
  if (!wasmModule) {
    throw new Error('WASM module not initialized. Call loadModule() first.');
  }
  const queryPtr = stringToPtr(query);
  let resultPtr = 0;
  
  try {
    resultPtr = wasmModule._wasm_scan(queryPtr);
    const resultStr = ptrToString(resultPtr);
    
    if (resultStr.startsWith('syntax error') || resultStr.startsWith('deparse error') || resultStr.startsWith('ERROR')) {
      throw new Error(resultStr);
    }
    
    return JSON.parse(resultStr);
  } finally {
    wasmModule._free(queryPtr);
    if (resultPtr) {
      wasmModule._wasm_free_string(resultPtr);
    }
  }
} 
// ---------------------------------------------------------------------------
// Deparse
// ---------------------------------------------------------------------------

/**
 * A comment lifted out of a source query, positioned so it can be re-inserted
 * when deparsing an edited tree. Produced by {@link extractComments}.
 */
export interface DeparseComment {
  /** Insert before the first node whose `location` is at or past this offset. */
  matchLocation: number;
  /** Newlines to emit before the comment. */
  newlinesBefore: number;
  /** Newlines to emit after the comment. */
  newlinesAfter: number;
  /** The comment text, including its delimiters. */
  text: string;
}

/**
 * Formatting options for {@link deparse}.
 *
 * Everything except `comments` is a pretty-print option upstream, so it only
 * takes effect alongside `prettyPrint: true`.
 */
export interface DeparseOptions {
  /** Break the statement across lines instead of emitting it on one. */
  prettyPrint?: boolean;
  /** Spaces per indent level. Defaults to 4. Requires `prettyPrint`. */
  indentSize?: number;
  /** Soft wrap width for lists of items. Defaults to 80. Requires `prettyPrint`. */
  maxLineLength?: number;
  /** Append a newline after the statement. Requires `prettyPrint`. */
  trailingNewline?: boolean;
  /** Put separating commas at the start of the line. Requires `prettyPrint`. */
  commasStartOfLine?: boolean;
  /** Comments to weave back in, typically from {@link extractComments}. */
  comments?: DeparseComment[];
}

function hasDeparseOptions(options?: DeparseOptions): boolean {
  if (!options) return false;
  return (
    options.prettyPrint !== undefined ||
    options.indentSize !== undefined ||
    options.maxLineLength !== undefined ||
    options.trailingNewline !== undefined ||
    options.commasStartOfLine !== undefined ||
    (options.comments !== undefined && options.comments.length > 0)
  );
}

/**
 * Copy comments into WASM memory as a PostgresDeparseComment* array.
 * Returns 0 for an empty list; the caller must free anything non-zero with
 * `_wasm_deparse_comments_free`.
 */
function allocComments(comments: DeparseComment[]): number {
  if (comments.length === 0) return 0;

  const arrayPtr = wasmModule._wasm_deparse_comments_new(comments.length);
  if (!arrayPtr) {
    throw new Error('Failed to allocate memory for deparse comments');
  }

  comments.forEach((comment, index) => {
    const textPtr = stringToPtr(comment.text ?? '');
    try {
      wasmModule._wasm_deparse_comments_set(
        arrayPtr,
        index,
        comment.matchLocation ?? 0,
        comment.newlinesBefore ?? 0,
        comment.newlinesAfter ?? 0,
        textPtr
      );
    } finally {
      // wasm_deparse_comments_set strdups the text, so this copy is done.
      wasmModule._free(textPtr);
    }
  });

  return arrayPtr;
}

/**
 * Turn a parse tree back into SQL using PostgreSQL's own deparser.
 *
 * The tree is encoded to protobuf and handed to `pg_query_deparse_protobuf` —
 * the same code path pg_query uses internally — so the output tracks the
 * server's grammar rather than a reimplementation of it.
 */
function deparseImpl(parseTree: ParseResult, options?: DeparseOptions): string {
  if (parseTree === null || parseTree === undefined) {
    throw new Error('Parse tree cannot be null or undefined');
  }
  if (typeof parseTree !== 'object') {
    throw new Error(`Parse tree must be an object, got ${typeof parseTree}`);
  }

  const bytes = encodeParseTree(parseTree as any);

  const dataPtr = wasmModule._malloc(bytes.length);
  if (!dataPtr) {
    throw new Error('Failed to allocate memory for parse tree');
  }

  let commentsPtr = 0;
  const comments = options?.comments ?? [];
  let resultPtr = 0;

  try {
    wasmModule.HEAPU8.set(bytes, dataPtr);

    if (hasDeparseOptions(options)) {
      commentsPtr = allocComments(comments);
      resultPtr = wasmModule._wasm_deparse_protobuf_opts_raw(
        dataPtr,
        bytes.length,
        commentsPtr,
        comments.length,
        options!.prettyPrint ? 1 : 0,
        options!.indentSize ?? 4,
        options!.maxLineLength ?? 80,
        options!.trailingNewline ? 1 : 0,
        options!.commasStartOfLine ? 1 : 0
      );
    } else {
      resultPtr = wasmModule._wasm_deparse_protobuf_raw(dataPtr, bytes.length);
    }

    if (!resultPtr) {
      throw new Error('Failed to deparse parse tree: memory allocation failed');
    }

    // Read the PgQueryDeparseResult struct
    // struct { char* query; PgQueryError* error; }
    const queryPtr = wasmModule.getValue(resultPtr, 'i32');     // offset 0
    const errorPtr = wasmModule.getValue(resultPtr + 4, 'i32'); // offset 4

    if (errorPtr) {
      throw readSqlError(errorPtr);
    }

    if (!queryPtr) {
      throw new Error('Deparse produced no output');
    }

    return wasmModule.UTF8ToString(queryPtr);
  }
  finally {
    wasmModule._free(dataPtr);
    if (commentsPtr) {
      wasmModule._wasm_deparse_comments_free(commentsPtr, comments.length);
    }
    if (resultPtr) {
      wasmModule._wasm_free_deparse_result(resultPtr);
    }
  }
}

export const deparse = awaitInit(async (parseTree: ParseResult, options?: DeparseOptions): Promise<string> =>
  deparseImpl(parseTree, options)
);

export function deparseSync(parseTree: ParseResult, options?: DeparseOptions): string {
  if (!wasmModule) {
    throw new Error('WASM module not initialized. Call loadModule() first.');
  }
  return deparseImpl(parseTree, options);
}

/**
 * Pull the comments out of a SQL string.
 *
 * The parse tree doesn't carry comments, so a parse/deparse round trip drops
 * them. Capture them here, then pass them back through
 * `deparse(tree, { comments })` to put them back.
 */
function extractCommentsImpl(query: string): DeparseComment[] {
  const queryPtr = stringToPtr(query);
  let resultPtr = 0;

  try {
    resultPtr = wasmModule._wasm_deparse_comments_for_query(queryPtr);
    const parsed = JSON.parse(ptrToString(resultPtr)) as
      { comments?: DeparseComment[]; error?: string };

    if (parsed.error) {
      throw new Error(parsed.error);
    }

    return parsed.comments ?? [];
  }
  finally {
    wasmModule._free(queryPtr);
    if (resultPtr) {
      wasmModule._wasm_free_string(resultPtr);
    }
  }
}

export const extractComments = awaitInit(async (query: string): Promise<DeparseComment[]> =>
  extractCommentsImpl(query)
);

export function extractCommentsSync(query: string): DeparseComment[] {
  if (!wasmModule) {
    throw new Error('WASM module not initialized. Call loadModule() first.');
  }
  return extractCommentsImpl(query);
}
