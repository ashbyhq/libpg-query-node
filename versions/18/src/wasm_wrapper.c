/**
 * DO NOT MODIFY MANUALLY — this is generated from the templates dir
 * 
 * To make changes, edit the files in the templates/ directory and run:
 * npm run copy:templates
 */

#include "pg_query.h"
#include "protobuf/pg_query.pb-c.h"
#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

static int validate_input(const char* input) {
    return input != NULL && strlen(input) > 0;
}

static char* safe_strdup(const char* str) {
    if (!str) return NULL;
    char* result = strdup(str);
    if (!result) {
        return NULL;
    }
    return result;
}

static void* safe_malloc(size_t size) {
    void* ptr = malloc(size);
    if (!ptr && size > 0) {
        return NULL;
    }
    return ptr;
}

// Escape `len` bytes of `input` for embedding in a JSON string literal.
// Caller owns the returned buffer. Worst case is six bytes out per byte in
// (\u00XX), which is what the allocation assumes.
static char* json_escape(const char* input, size_t len) {
    char* out = safe_malloc(len * 6 + 1);
    if (!out) return NULL;

    size_t pos = 0;
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char) input[i];
        switch (c) {
            case '"':  out[pos++] = '\\'; out[pos++] = '"';  break;
            case '\\': out[pos++] = '\\'; out[pos++] = '\\'; break;
            case '\n': out[pos++] = '\\'; out[pos++] = 'n';  break;
            case '\r': out[pos++] = '\\'; out[pos++] = 'r';  break;
            case '\t': out[pos++] = '\\'; out[pos++] = 't';  break;
            default:
                if (c < 0x20) {
                    // Other control characters are not legal raw in JSON.
                    pos += snprintf(out + pos, 7, "\\u%04x", c);
                } else {
                    out[pos++] = (char) c;
                }
        }
    }
    out[pos] = '\0';
    return out;
}

EMSCRIPTEN_KEEPALIVE
char* wasm_parse_query(const char* input) {
    if (!validate_input(input)) {
        return safe_strdup("Invalid input: query cannot be null or empty");
    }
    
    PgQueryParseResult result = pg_query_parse(input);
    
    if (result.error) {
        char* error_msg = safe_strdup(result.error->message);
        pg_query_free_parse_result(result);
        return error_msg ? error_msg : safe_strdup("Memory allocation failed");
    }
    
    char* parse_tree = safe_strdup(result.parse_tree);
    pg_query_free_parse_result(result);
    return parse_tree;
}

EMSCRIPTEN_KEEPALIVE
PgQueryParseResult* wasm_parse_query_raw(const char* input) {
    PgQueryParseResult* result = (PgQueryParseResult*)malloc(sizeof(PgQueryParseResult));
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

EMSCRIPTEN_KEEPALIVE
char* wasm_parse_plpgsql(const char* input) {
    if (!validate_input(input)) {
        return safe_strdup("Invalid input: query cannot be null or empty");
    }
    
    PgQueryPlpgsqlParseResult result = pg_query_parse_plpgsql(input);
    
    if (result.error) {
        char* error_msg = safe_strdup(result.error->message);
        pg_query_free_plpgsql_parse_result(result);
        return error_msg ? error_msg : safe_strdup("Memory allocation failed");
    }
    
    if (!result.plpgsql_funcs) {
        pg_query_free_plpgsql_parse_result(result);
        return safe_strdup("{\"plpgsql_funcs\":[]}");
    }
    
    size_t funcs_len = strlen(result.plpgsql_funcs);
    size_t json_len = strlen("{\"plpgsql_funcs\":}") + funcs_len + 1;
    char* wrapped_result = safe_malloc(json_len);
    
    if (!wrapped_result) {
        pg_query_free_plpgsql_parse_result(result);
        return safe_strdup("Memory allocation failed");
    }
    
    int written = snprintf(wrapped_result, json_len, "{\"plpgsql_funcs\":%s}", result.plpgsql_funcs);
    
    if (written >= json_len) {
        free(wrapped_result);
        pg_query_free_plpgsql_parse_result(result);
        return safe_strdup("Buffer overflow prevented");
    }
    
    pg_query_free_plpgsql_parse_result(result);
    return wrapped_result;
}

EMSCRIPTEN_KEEPALIVE
char* wasm_fingerprint(const char* input) {
    if (!validate_input(input)) {
        return safe_strdup("Invalid input: query cannot be null or empty");
    }
    
    PgQueryFingerprintResult result = pg_query_fingerprint(input);
    
    if (result.error) {
        char* error_msg = safe_strdup(result.error->message);
        pg_query_free_fingerprint_result(result);
        return error_msg ? error_msg : safe_strdup("Memory allocation failed");
    }
    
    char* fingerprint_str = safe_strdup(result.fingerprint_str);
    pg_query_free_fingerprint_result(result);
    return fingerprint_str;
}

EMSCRIPTEN_KEEPALIVE
char* wasm_normalize_query(const char* input) {
    if (!validate_input(input)) {
        return safe_strdup("Invalid input: query cannot be null or empty");
    }
    
    PgQueryNormalizeResult result = pg_query_normalize(input);
    
    if (result.error) {
        char* error_msg = safe_strdup(result.error->message);
        pg_query_free_normalize_result(result);
        return error_msg ? error_msg : safe_strdup("Memory allocation failed");
    }
    
    char* normalized = safe_strdup(result.normalized_query);
    pg_query_free_normalize_result(result);
    
    if (!normalized) {
        return safe_strdup("Memory allocation failed");
    }
    
    return normalized;
}





typedef struct {
    int has_error;
    char* message;
    char* funcname;
    char* filename;
    int lineno;
    int cursorpos;
    char* context;
    char* data;
    size_t data_len;
} WasmDetailedResult;

EMSCRIPTEN_KEEPALIVE
WasmDetailedResult* wasm_parse_query_detailed(const char* input) {
    WasmDetailedResult* result = safe_malloc(sizeof(WasmDetailedResult));
    if (!result) {
        return NULL;
    }
    memset(result, 0, sizeof(WasmDetailedResult));
    
    if (!validate_input(input)) {
        result->has_error = 1;
        result->message = safe_strdup("Invalid input: query cannot be null or empty");
        return result;
    }
    
    PgQueryParseResult parse_result = pg_query_parse(input);
    
    if (parse_result.error) {
        result->has_error = 1;
        size_t message_len = strlen("Parse error:  at line , position ") + strlen(parse_result.error->message) + 20;
        char* prefixed_message = safe_malloc(message_len);
        if (!prefixed_message) {
            result->has_error = 1;
            result->message = safe_strdup("Memory allocation failed");
            pg_query_free_parse_result(parse_result);
            return result;
        }
        snprintf(prefixed_message, message_len, 
                "Parse error: %s at line %d, position %d", 
                parse_result.error->message, 
                parse_result.error->lineno, 
                parse_result.error->cursorpos);
        result->message = prefixed_message;
        char* funcname_copy = parse_result.error->funcname ? safe_strdup(parse_result.error->funcname) : NULL;
        char* filename_copy = parse_result.error->filename ? safe_strdup(parse_result.error->filename) : NULL;
        char* context_copy = parse_result.error->context ? safe_strdup(parse_result.error->context) : NULL;
        
        result->funcname = funcname_copy;
        result->filename = filename_copy;
        result->lineno = parse_result.error->lineno;
        result->cursorpos = parse_result.error->cursorpos;
        result->context = context_copy;
    } else {
        result->data = safe_strdup(parse_result.parse_tree);
        if (result->data) {
            result->data_len = strlen(result->data);
        } else {
            result->has_error = 1;
            result->message = safe_strdup("Memory allocation failed");
        }
    }
    
    pg_query_free_parse_result(parse_result);
    return result;
}

EMSCRIPTEN_KEEPALIVE
void wasm_free_detailed_result(WasmDetailedResult* result) {
    if (result) {
        free(result->message);
        free(result->funcname);
        free(result->filename);
        free(result->context);
        free(result->data);
        free(result);
    }
}

static const char* get_token_name(PgQuery__Token token_type) {
    // Map some common token types to readable names
    // Note: This is a simplified mapping - full enum lookup would require more complexity
    switch(token_type) {
        case 258: return "IDENT";
        case 261: return "SCONST"; 
        case 266: return "ICONST";
        case 260: return "FCONST";
        case 267: return "PARAM";
        case 40: return "ASCII_40"; // (
        case 41: return "ASCII_41"; // )
        case 42: return "ASCII_42"; // *
        case 44: return "ASCII_44"; // ,
        case 59: return "ASCII_59"; // ;
        case 61: return "ASCII_61"; // =
        case 268: return "TYPECAST";
        case 272: return "LESS_EQUALS";
        case 273: return "GREATER_EQUALS";
        case 274: return "NOT_EQUALS";
        case 275: return "SQL_COMMENT";
        case 276: return "C_COMMENT";
        default: return "UNKNOWN";
    }
}

static const char* get_keyword_name(PgQuery__KeywordKind keyword_kind) {
    switch(keyword_kind) {
        case 0: return "NO_KEYWORD";
        case 1: return "UNRESERVED_KEYWORD";
        case 2: return "COL_NAME_KEYWORD";
        case 3: return "TYPE_FUNC_NAME_KEYWORD";
        case 4: return "RESERVED_KEYWORD";
        default: return "UNKNOWN_KEYWORD";
    }
}

static char* build_scan_json(PgQuery__ScanResult *scan_result, const char* original_sql) {
    if (!scan_result || !original_sql) {
        return safe_strdup("{\"version\":0,\"tokens\":[]}");
    }
    
    // Calculate rough JSON size estimate
    size_t estimated_size = 1024 + (scan_result->n_tokens * 200);
    char* json = safe_malloc(estimated_size);
    if (!json) {
        return safe_strdup("{\"version\":0,\"tokens\":[]}");
    }
    
    // Start building JSON
    size_t pos = snprintf(json, estimated_size, "{\"version\":%d,\"tokens\":[", scan_result->version);
    
    for (size_t i = 0; i < scan_result->n_tokens; i++) {
        PgQuery__ScanToken *token = scan_result->tokens[i];
        
        // Extract token text from original SQL
        int token_length = token->end - token->start;
        if (token_length < 0) token_length = 0; // Safety check
        
        char* token_text = safe_malloc(token_length + 1);
        if (!token_text) continue;
        
        if (token_length > 0) {
            strncpy(token_text, &original_sql[token->start], token_length);
        }
        token_text[token_length] = '\0';
        
        // Escape token text for JSON
        char* escaped_text = json_escape(token_text, token_length);
        if (!escaped_text) {
            free(token_text);
            continue;
        }

        // Get token type name and keyword kind name
        const char* token_name = get_token_name(token->token);
        const char* keyword_name = get_keyword_name(token->keyword_kind);

        // Grow before writing, not after. snprintf returns the length it
        // *would* have written, so advancing `pos` past the end of a truncated
        // write would leave `json + pos` pointing outside the buffer.
        size_t needed = strlen(escaped_text) + 256;
        while (estimated_size - pos < needed) {
            size_t new_size = estimated_size * 2 + needed;
            char* new_json = realloc(json, new_size);
            if (!new_json) break;
            json = new_json;
            estimated_size = new_size;
        }

        // Add comma if not first token
        if (i > 0) {
            pos += snprintf(json + pos, estimated_size - pos, ",");
        }

        // Add token object to JSON
        pos += snprintf(json + pos, estimated_size - pos,
            "{\"start\":%d,\"end\":%d,\"text\":\"%s\",\"tokenType\":%d,\"tokenName\":\"%s\",\"keywordKind\":%d,\"keywordName\":\"%s\"}",
            token->start, token->end, escaped_text, token->token, token_name, token->keyword_kind, keyword_name);
        
        free(token_text);
        free(escaped_text);
    }

    // Close JSON
    snprintf(json + pos, estimated_size - pos, "]}");
    
    return json;
}

EMSCRIPTEN_KEEPALIVE
char* wasm_scan(const char* input) {
    if (!validate_input(input)) {
        return safe_strdup("Invalid input: query cannot be null or empty");
    }
    
    PgQueryScanResult result = pg_query_scan(input);
    
    if (result.error) {
        char* error_msg = safe_strdup(result.error->message);
        pg_query_free_scan_result(result);
        return error_msg ? error_msg : safe_strdup("Memory allocation failed");
    }
    
    // Unpack protobuf data
    PgQuery__ScanResult *scan_result = pg_query__scan_result__unpack(
        NULL, result.pbuf.len, (void *) result.pbuf.data);
    
    if (!scan_result) {
        pg_query_free_scan_result(result);
        return safe_strdup("Failed to unpack scan result");
    }
    
    // Convert to JSON
    char* json_result = build_scan_json(scan_result, input);
    
    // Clean up
    pg_query__scan_result__free_unpacked(scan_result, NULL);
    pg_query_free_scan_result(result);
    
    return json_result ? json_result : safe_strdup("{\"version\":0,\"tokens\":[]}");
}


// ---------------------------------------------------------------------------
// Deparse
//
// The inverse of pg_query_parse: takes a protobuf-encoded parse tree (the JS
// side encodes the JSON tree with @ashbyhq/pgsql-proto) and returns SQL.
//
// These return the PgQueryDeparseResult struct rather than a bare string so
// the JS side can tell a deparse failure from a query that happens to start
// with the word "error", and can surface the real PgQueryError details.
// ---------------------------------------------------------------------------

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

// Comment lists are built up one entry at a time from JS rather than mirroring
// PostgresDeparseComment's layout into the JS heap, so the struct can change
// shape without silently corrupting what we pass to the deparser.
EMSCRIPTEN_KEEPALIVE
PostgresDeparseComment** wasm_deparse_comments_new(size_t count) {
    if (count == 0) {
        return NULL;
    }
    PostgresDeparseComment** comments = safe_malloc(sizeof(PostgresDeparseComment*) * count);
    if (!comments) {
        return NULL;
    }
    memset(comments, 0, sizeof(PostgresDeparseComment*) * count);
    return comments;
}

EMSCRIPTEN_KEEPALIVE
void wasm_deparse_comments_set(PostgresDeparseComment** comments, size_t index,
                               int match_location, int newlines_before,
                               int newlines_after, const char* str) {
    if (!comments) {
        return;
    }

    PostgresDeparseComment* comment = safe_malloc(sizeof(PostgresDeparseComment));
    if (!comment) {
        return;
    }

    comment->match_location = match_location;
    comment->newlines_before_comment = newlines_before;
    comment->newlines_after_comment = newlines_after;
    comment->str = safe_strdup(str ? str : "");

    free(comments[index]);
    comments[index] = comment;
}

EMSCRIPTEN_KEEPALIVE
void wasm_deparse_comments_free(PostgresDeparseComment** comments, size_t count) {
    if (!comments) {
        return;
    }
    for (size_t i = 0; i < count; i++) {
        if (comments[i]) {
            free(comments[i]->str);
            free(comments[i]);
        }
    }
    free(comments);
}

EMSCRIPTEN_KEEPALIVE
PgQueryDeparseResult* wasm_deparse_protobuf_opts_raw(
    const char* data, size_t len,
    PostgresDeparseComment** comments, size_t comment_count,
    int pretty_print, int indent_size, int max_line_length,
    int trailing_newline, int commas_start_of_line) {

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

    PostgresDeparseOpts opts;
    memset(&opts, 0, sizeof(opts));
    opts.comments = comments;
    opts.comment_count = comment_count;
    opts.pretty_print = pretty_print != 0;
    opts.indent_size = indent_size;
    opts.max_line_length = max_line_length;
    opts.trailing_newline = trailing_newline != 0;
    opts.commas_start_of_line = commas_start_of_line != 0;

    *result = pg_query_deparse_protobuf_opts(parse_tree, opts);
    return result;
}

EMSCRIPTEN_KEEPALIVE
void wasm_free_deparse_result(PgQueryDeparseResult* result) {
    if (result) {
        pg_query_free_deparse_result(*result);
        free(result);
    }
}

// Pull the comments out of a source query so they can be handed back to
// wasm_deparse_protobuf_opts_raw after the tree has been edited. Returned as
// JSON because the alternative — one accessor per struct field — is a lot of
// exported surface for four values.
EMSCRIPTEN_KEEPALIVE
char* wasm_deparse_comments_for_query(const char* input) {
    if (!validate_input(input)) {
        return safe_strdup("{\"comments\":[]}");
    }

    PgQueryDeparseCommentsResult result = pg_query_deparse_comments_for_query(input);

    if (result.error) {
        char* escaped = json_escape(result.error->message, strlen(result.error->message));
        pg_query_free_deparse_comments_result(result);
        if (!escaped) {
            return safe_strdup("{\"error\":\"Memory allocation failed\"}");
        }
        size_t size = strlen(escaped) + 32;
        char* json = safe_malloc(size);
        if (json) {
            snprintf(json, size, "{\"error\":\"%s\"}", escaped);
        }
        free(escaped);
        return json ? json : safe_strdup("{\"error\":\"Memory allocation failed\"}");
    }

    size_t capacity = 1024;
    char* json = safe_malloc(capacity);
    if (!json) {
        pg_query_free_deparse_comments_result(result);
        return safe_strdup("{\"comments\":[]}");
    }

    size_t pos = snprintf(json, capacity, "{\"comments\":[");

    for (size_t i = 0; i < result.comment_count; i++) {
        PostgresDeparseComment* comment = result.comments[i];
        const char* text = comment->str ? comment->str : "";
        char* escaped = json_escape(text, strlen(text));
        if (!escaped) continue;

        size_t needed = strlen(escaped) + 192;
        while (capacity - pos < needed) {
            size_t new_capacity = capacity * 2 + needed;
            char* grown = realloc(json, new_capacity);
            if (!grown) break;
            json = grown;
            capacity = new_capacity;
        }

        pos += snprintf(json + pos, capacity - pos,
            "%s{\"matchLocation\":%d,\"newlinesBefore\":%d,\"newlinesAfter\":%d,\"text\":\"%s\"}",
            i > 0 ? "," : "",
            comment->match_location,
            comment->newlines_before_comment,
            comment->newlines_after_comment,
            escaped);

        free(escaped);
    }

    snprintf(json + pos, capacity - pos, "]}");

    pg_query_free_deparse_comments_result(result);
    return json;
}

EMSCRIPTEN_KEEPALIVE
void wasm_free_string(char* str) {
    free(str);
}
