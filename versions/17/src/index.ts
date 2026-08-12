/**
 * DO NOT MODIFY MANUALLY — this is generated from the templates dir
 * 
 * To make changes, edit the files in the templates/ directory and run:
 * npm run copy:templates
 */

import { ParseResult } from "@pgsql/types";
export * from "@pgsql/types";

import { encodeParseTree } from '@ashbyhq/pgsql-proto/v17';

// @ts-ignore
import PgQueryModule from './libpg-query.js';

let wasmModule: any;

// SQL error details interface
export interface SqlErrorDetails {
  message: string;
  cursorPosition: number;  // 0-based position in the query
  fileName?: string;       // Source file where error occurred (e.g., 'scan.l', 'gram.y')
  functionName?: string;   // Internal function name
  lineNumber?: number;     // Line number in source file
  context?: string;        // Additional context
}

// Options for formatting SQL errors
export interface SqlErrorFormatOptions {
  showPosition?: boolean;  // Show the error position marker (default: true)
  showQuery?: boolean;     // Show the query text (default: true)
  color?: boolean;         // Use ANSI colors (default: false)
  maxQueryLength?: number; // Max query length to display (default: no limit)
}

export class SqlError extends Error {
  sqlDetails?: SqlErrorDetails;

  constructor(message: string, details?: SqlErrorDetails) {
    super(message);
    this.name = 'SqlError';
    this.sqlDetails = details;
  }
}



// Helper function to classify error source
function getErrorSource(filename: string | null): string {
  if (!filename) return 'unknown';
  if (filename === 'scan.l') return 'lexer';      // Lexical analysis errors
  if (filename === 'gram.y') return 'parser';     // Grammar/parsing errors  
  return filename;
}

// Format SQL error with visual position indicator
export function formatSqlError(
  error: Error & { sqlDetails?: SqlErrorDetails },
  query: string,
  options: SqlErrorFormatOptions = {}
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
      
      // Truncate if needed
      if (maxQueryLength && query.length > maxQueryLength) {
        const start = Math.max(0, cursorPosition - Math.floor(maxQueryLength / 2));
        const end = Math.min(query.length, start + maxQueryLength);
        displayQuery = (start > 0 ? '...' : '') + 
                      query.substring(start, end) + 
                      (end < query.length ? '...' : '');
        // Adjust cursor position for truncation
        const adjustedPosition = cursorPosition - start + (start > 0 ? 3 : 0);
        lines.push(displayQuery);
        lines.push(' '.repeat(adjustedPosition) + `${yellow}^${reset}`);
      } else {
        lines.push(displayQuery);
        lines.push(' '.repeat(cursorPosition) + `${yellow}^${reset}`);
      }
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

// Check if an error has SQL details
export function hasSqlDetails(error: any): error is Error & { sqlDetails: SqlErrorDetails } {
  return error instanceof Error && 
         'sqlDetails' in error &&
         typeof (error as any).sqlDetails === 'object' && 
         (error as any).sqlDetails !== null &&
         'message' in (error as any).sqlDetails &&
         'cursorPosition' in (error as any).sqlDetails;
}

const initPromise = PgQueryModule().then((module: any) => {
  wasmModule = module;
});

function ensureLoaded() {
  if (!wasmModule) throw new Error("WASM module not initialized. Call `loadModule()` first.");
}

export async function loadModule() {
  if (!wasmModule) {
    await initPromise;
  }
}

function awaitInit<T extends (...args: any[]) => any>(fn: T): T {
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

export const parse = awaitInit(async (query: string) => {
  // Pre-validation
  if (query === null || query === undefined) {
    throw new Error('Query cannot be null or undefined');
  }
  if (typeof query !== 'string') {
    throw new Error(`Query must be a string, got ${typeof query}`);
  }
  if (query.trim() === '') {
    throw new Error('Query cannot be empty');
  }
  
  const queryPtr = stringToPtr(query);
  let resultPtr = 0;
  
  try {
    // Call the raw function that returns a struct pointer
    resultPtr = wasmModule._wasm_parse_query_raw(queryPtr);
    if (!resultPtr) {
      throw new Error('Failed to allocate memory for parse result');
    }
    
    // Read the PgQueryParseResult struct fields
    // struct { char* parse_tree; char* stderr_buffer; PgQueryError* error; }
    const parseTreePtr = wasmModule.getValue(resultPtr, 'i32');      // offset 0
    const stderrBufferPtr = wasmModule.getValue(resultPtr + 4, 'i32'); // offset 4
    const errorPtr = wasmModule.getValue(resultPtr + 8, 'i32');        // offset 8
    
    // Check for error
    if (errorPtr) {
      throw readSqlError(errorPtr);
    }
    
    if (!parseTreePtr) {
      throw new Error('Parse result is null');
    }
    
    const parseTree = wasmModule.UTF8ToString(parseTreePtr);
    return JSON.parse(parseTree);
  }
  finally {
    wasmModule._free(queryPtr);
    if (resultPtr) {
      wasmModule._wasm_free_parse_result(resultPtr);
    }
  }
});

export function parseSync(query: string) {
  // Pre-validation
  if (query === null || query === undefined) {
    throw new Error('Query cannot be null or undefined');
  }
  if (typeof query !== 'string') {
    throw new Error(`Query must be a string, got ${typeof query}`);
  }
  if (query.trim() === '') {
    throw new Error('Query cannot be empty');
  }
  
  const queryPtr = stringToPtr(query);
  let resultPtr = 0;
  
  try {
    // Call the raw function that returns a struct pointer
    resultPtr = wasmModule._wasm_parse_query_raw(queryPtr);
    if (!resultPtr) {
      throw new Error('Failed to allocate memory for parse result');
    }
    
    // Read the PgQueryParseResult struct fields
    // struct { char* parse_tree; char* stderr_buffer; PgQueryError* error; }
    const parseTreePtr = wasmModule.getValue(resultPtr, 'i32');      // offset 0
    const stderrBufferPtr = wasmModule.getValue(resultPtr + 4, 'i32'); // offset 4
    const errorPtr = wasmModule.getValue(resultPtr + 8, 'i32');        // offset 8
    
    // Check for error
    if (errorPtr) {
      throw readSqlError(errorPtr);
    }
    
    if (!parseTreePtr) {
      throw new Error('Parse result is null');
    }
    
    const parseTree = wasmModule.UTF8ToString(parseTreePtr);
    return JSON.parse(parseTree);
  }
  finally {
    wasmModule._free(queryPtr);
    if (resultPtr) {
      wasmModule._wasm_free_parse_result(resultPtr);
    }
  }
}
/**
 * A comment lifted out of a source query, positioned so it can be re-inserted
 * when deparsing an edited tree.
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
 * Formatting options for `deparse`.
 *
 * libpg_query only grew `pg_query_deparse_protobuf_opts` in its 18 line, so on
 * PostgreSQL 17 every option here is accepted and ignored — the same
 * call works across versions. Pretty-printing needs `libpg-query@pg18`.
 */
export interface DeparseOptions {
  prettyPrint?: boolean;
  indentSize?: number;
  maxLineLength?: number;
  trailingNewline?: boolean;
  commasStartOfLine?: boolean;
  comments?: DeparseComment[];
}

/**
 * Turn a parse tree back into SQL using PostgreSQL's own deparser.
 *
 * The tree is encoded to protobuf and handed to `pg_query_deparse_protobuf` —
 * the same code path pg_query uses internally — so the output tracks the
 * server's grammar rather than a reimplementation of it.
 */
function deparseImpl(parseTree: ParseResult, _options?: DeparseOptions): string {
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

  let resultPtr = 0;
  try {
    wasmModule.HEAPU8.set(bytes, dataPtr);

    resultPtr = wasmModule._wasm_deparse_protobuf_raw(dataPtr, bytes.length);
    if (!resultPtr) {
      throw new Error('Failed to deparse parse tree: memory allocation failed');
    }

    // Read the PgQueryDeparseResult struct fields
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
    if (resultPtr) {
      wasmModule._wasm_free_deparse_result(resultPtr);
    }
  }
}

export const deparse = awaitInit(async (parseTree: ParseResult, options?: DeparseOptions): Promise<string> =>
  deparseImpl(parseTree, options)
);

export function deparseSync(parseTree: ParseResult, options?: DeparseOptions): string {
  ensureLoaded();
  return deparseImpl(parseTree, options);
}
