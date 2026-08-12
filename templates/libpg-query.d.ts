declare module './libpg-query.js' {
  interface WasmModule {
    _malloc: (size: number) => number;
    _free: (ptr: number) => void;
    _wasm_parse_query_raw: (queryPtr: number) => number;
    _wasm_free_parse_result: (ptr: number) => void;
    _wasm_deparse_protobuf_raw: (dataPtr: number, len: number) => number;
    _wasm_free_deparse_result: (ptr: number) => void;
    lengthBytesUTF8: (str: string) => number;
    stringToUTF8: (str: string, ptr: number, len: number) => void;
    UTF8ToString: (ptr: number) => string;
    getValue: (ptr: number, type: string) => number;
    HEAPU8: Uint8Array;
  }

  const PgQueryModule: () => Promise<WasmModule>;
  export default PgQueryModule;
}
