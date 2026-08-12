/**
 * DO NOT MODIFY MANUALLY — this is generated from the templates dir
 * 
 * To make changes, edit the files in the templates/ directory and run:
 * npm run copy:templates
 */

#include <emscripten.h>
#include <pg_query.h>
#include <stdlib.h>
#include <string.h>

static int validate_input(const char* input) {
    return input != NULL && strlen(input) > 0;
}

static void* safe_malloc(size_t size) {
    void* ptr = malloc(size);
    if (!ptr && size > 0) {
        return NULL;
    }
    return ptr;
}

// Raw struct access functions for parse
EMSCRIPTEN_KEEPALIVE
PgQueryParseResult* wasm_parse_query_raw(const char* input) {
    if (!validate_input(input)) {
        return NULL;
    }
    
    PgQueryParseResult* result = (PgQueryParseResult*)safe_malloc(sizeof(PgQueryParseResult));
    if (!result) {
        return NULL;
    }
    
    *result = pg_query_parse(input);
    return result;
}

EMSCRIPTEN_KEEPALIVE
void wasm_free_parse_result(PgQueryParseResult* result) {
    if (result) {
        pg_query_free_parse_result(*result);
        free(result);
    }
}

// Deparse — the inverse of pg_query_parse. Takes a protobuf-encoded parse tree
// (the JS side encodes the JSON tree with @ashbyhq/pgsql-proto) and returns SQL.
//
// Returns the PgQueryDeparseResult struct rather than a bare string so the JS
// side can tell a deparse failure from a query that happens to start with the
// word "error", and can surface the real PgQueryError details.
EMSCRIPTEN_KEEPALIVE
PgQueryDeparseResult* wasm_deparse_protobuf_raw(const char* data, size_t len) {
    if (!data || len == 0) {
        return NULL;
    }

    PgQueryDeparseResult* result = (PgQueryDeparseResult*)safe_malloc(sizeof(PgQueryDeparseResult));
    if (!result) {
        return NULL;
    }

    PgQueryProtobuf parse_tree;
    parse_tree.data = (char*) data;
    parse_tree.len = len;

    *result = pg_query_deparse_protobuf(parse_tree);
    return result;
}

EMSCRIPTEN_KEEPALIVE
void wasm_free_deparse_result(PgQueryDeparseResult* result) {
    if (result) {
        pg_query_free_deparse_result(*result);
        free(result);
    }
}