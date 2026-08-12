/**
 * DO NOT MODIFY MANUALLY — this is generated from the templates dir
 * 
 * To make changes, edit the files in the templates/ directory and run:
 * npm run copy:templates
 */

declare module './libpg-query.js' {
  interface WasmModule {
    _malloc: (size: number) => number;
    _free: (ptr: number) => void;
    _wasm_free_string: (ptr: number) => void;
    _wasm_parse_query: (queryPtr: number) => number;
    _wasm_parse_query_raw: (queryPtr: number) => number;
    _wasm_free_parse_result: (ptr: number) => void;
    _wasm_parse_query_detailed: (queryPtr: number) => number;
    _wasm_free_detailed_result: (ptr: number) => void;
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

  const PgQueryModule: () => Promise<WasmModule>;
  export default PgQueryModule;
}
