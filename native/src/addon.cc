#include <napi.h>
#include <cstdio>
#include <string>
#include <vector>

extern "C" {
#include "pg_query.h"
#include "protobuf/pg_query.pb-c.h"
}

static std::string EscapeJsonString(const std::string &s) {
  std::string out;
  out.reserve(s.size() + 8);
  for (char c : s) {
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      default:
        // Escape any remaining control characters (<0x20) as \u00XX so the
        // payload stays valid JSON for JSON.parse() on the JS side.
        if (static_cast<unsigned char>(c) < 0x20) {
          char buf[7];
          std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned char>(c));
          out += buf;
        } else {
          out += c;
        }
    }
  }
  return out;
}

// Build a JSON object with error details from a PgQueryError.
static std::string BuildErrorJson(PgQueryError *error) {
  std::string msg = error->message ? error->message : "Unknown error";
  std::string json = "{\"message\":\"" + EscapeJsonString(msg) + "\"";
  json += ",\"cursorPosition\":" + std::to_string(error->cursorpos > 0 ? error->cursorpos - 1 : 0);
  if (error->funcname)
    json += ",\"functionName\":\"" + EscapeJsonString(error->funcname) + "\"";
  if (error->filename)
    json += ",\"fileName\":\"" + EscapeJsonString(error->filename) + "\"";
  if (error->lineno > 0)
    json += ",\"lineNumber\":" + std::to_string(error->lineno);
  if (error->context)
    json += ",\"context\":\"" + EscapeJsonString(error->context) + "\"";
  json += "}";
  return json;
}

// Return a {error: json, result: null} object to JS. JS throws from there.
static Napi::Value ReturnError(Napi::Env env, PgQueryError *error) {
  Napi::Object obj = Napi::Object::New(env);
  obj.Set("error", Napi::String::New(env, BuildErrorJson(error)));
  obj.Set("result", env.Null());
  return obj;
}

static Napi::Value ReturnResult(Napi::Env env, const std::string &result) {
  Napi::Object obj = Napi::Object::New(env);
  obj.Set("error", env.Null());
  obj.Set("result", Napi::String::New(env, result));
  return obj;
}

static std::string ValidateQuery(Napi::Env env, const Napi::CallbackInfo &info) {
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected a string argument").ThrowAsJavaScriptException();
    return "";
  }
  std::string query = info[0].As<Napi::String>().Utf8Value();
  if (query.empty()) {
    Napi::Error::New(env, "Query cannot be empty").ThrowAsJavaScriptException();
    return "";
  }
  return query;
}

static Napi::Value ParseSync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::string query = ValidateQuery(env, info);
  if (env.IsExceptionPending()) return env.Undefined();

  PgQueryParseResult result = pg_query_parse(query.c_str());

  if (result.error) {
    Napi::Value ret = ReturnError(env, result.error);
    pg_query_free_parse_result(result);
    return ret;
  }

  std::string json(result.parse_tree);
  pg_query_free_parse_result(result);
  return ReturnResult(env, json);
}

static Napi::Value ParsePlPgSQLSync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::string query = ValidateQuery(env, info);
  if (env.IsExceptionPending()) return env.Undefined();

  PgQueryPlpgsqlParseResult result = pg_query_parse_plpgsql(query.c_str());

  if (result.error) {
    Napi::Value ret = ReturnError(env, result.error);
    pg_query_free_plpgsql_parse_result(result);
    return ret;
  }

  std::string json = std::string("{\"plpgsql_funcs\":") +
                     (result.plpgsql_funcs ? result.plpgsql_funcs : "[]") + "}";
  pg_query_free_plpgsql_parse_result(result);
  return ReturnResult(env, json);
}

static Napi::Value FingerprintSync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::string query = ValidateQuery(env, info);
  if (env.IsExceptionPending()) return env.Undefined();

  PgQueryFingerprintResult result = pg_query_fingerprint(query.c_str());

  if (result.error) {
    Napi::Value ret = ReturnError(env, result.error);
    pg_query_free_fingerprint_result(result);
    return ret;
  }

  std::string fp(result.fingerprint_str);
  pg_query_free_fingerprint_result(result);
  return ReturnResult(env, fp);
}

static Napi::Value NormalizeSync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::string query = ValidateQuery(env, info);
  if (env.IsExceptionPending()) return env.Undefined();

  PgQueryNormalizeResult result = pg_query_normalize(query.c_str());

  if (result.error) {
    Napi::Value ret = ReturnError(env, result.error);
    pg_query_free_normalize_result(result);
    return ret;
  }

  std::string normalized(result.normalized_query);
  pg_query_free_normalize_result(result);
  return ReturnResult(env, normalized);
}

static std::string GetTokenName(int token_type) {
  switch (token_type) {
    case 258: return "IDENT";
    case 261: return "SCONST";
    case 266: return "ICONST";
    case 260: return "FCONST";
    case 267: return "PARAM";
    case 40:  return "ASCII_40";
    case 41:  return "ASCII_41";
    case 42:  return "ASCII_42";
    case 44:  return "ASCII_44";
    case 59:  return "ASCII_59";
    case 61:  return "ASCII_61";
    case 268: return "TYPECAST";
    case 272: return "LESS_EQUALS";
    case 273: return "GREATER_EQUALS";
    case 274: return "NOT_EQUALS";
    case 275: return "SQL_COMMENT";
    case 276: return "C_COMMENT";
    default:  return "UNKNOWN";
  }
}

static std::string GetKeywordName(int kind) {
  switch (kind) {
    case 0: return "NO_KEYWORD";
    case 1: return "UNRESERVED_KEYWORD";
    case 2: return "COL_NAME_KEYWORD";
    case 3: return "TYPE_FUNC_NAME_KEYWORD";
    case 4: return "RESERVED_KEYWORD";
    default: return "UNKNOWN_KEYWORD";
  }
}

static Napi::Value ScanSync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::string query = ValidateQuery(env, info);
  if (env.IsExceptionPending()) return env.Undefined();

  PgQueryScanResult result = pg_query_scan(query.c_str());

  if (result.error) {
    Napi::Value ret = ReturnError(env, result.error);
    pg_query_free_scan_result(result);
    return ret;
  }

  PgQuery__ScanResult *scan_result = pg_query__scan_result__unpack(
      NULL, result.pbuf.len, (const uint8_t *)result.pbuf.data);

  if (!scan_result) {
    pg_query_free_scan_result(result);
    Napi::Error::New(env, "Failed to unpack scan result").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Object scan_obj = Napi::Object::New(env);
  scan_obj.Set("version", Napi::Number::New(env, scan_result->version));

  Napi::Array tokens = Napi::Array::New(env, scan_result->n_tokens);
  for (size_t i = 0; i < scan_result->n_tokens; i++) {
    PgQuery__ScanToken *token = scan_result->tokens[i];
    Napi::Object tok = Napi::Object::New(env);
    tok.Set("start", Napi::Number::New(env, token->start));
    tok.Set("end", Napi::Number::New(env, token->end));
    tok.Set("text", Napi::String::New(env, query.substr(token->start, token->end - token->start)));
    tok.Set("tokenType", Napi::Number::New(env, token->token));
    tok.Set("tokenName", Napi::String::New(env, GetTokenName(token->token)));
    tok.Set("keywordKind", Napi::Number::New(env, token->keyword_kind));
    tok.Set("keywordName", Napi::String::New(env, GetKeywordName(token->keyword_kind)));
    tokens[i] = tok;
  }
  scan_obj.Set("tokens", tokens);

  pg_query__scan_result__free_unpacked(scan_result, NULL);
  pg_query_free_scan_result(result);

  Napi::Object obj = Napi::Object::New(env);
  obj.Set("error", env.Null());
  obj.Set("result", scan_obj);
  return obj;
}

// The inverse of pg_query_parse. Takes the protobuf encoding of a parse tree
// (JS encodes the JSON tree with protobuf-es — see src/proto.ts) and returns
// SQL. Options mirror PostgresDeparseOpts; everything except `comments` is a
// pretty-print option upstream, so it only applies alongside prettyPrint.
static Napi::Value DeparseSync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsTypedArray()) {
    Napi::TypeError::New(env, "Expected a Uint8Array of protobuf-encoded parse tree")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Uint8Array buf = info[0].As<Napi::Uint8Array>();
  if (buf.ByteLength() == 0) {
    Napi::Error::New(env, "Parse tree cannot be empty").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  PgQueryProtobuf parse_tree;
  parse_tree.data = reinterpret_cast<char *>(buf.Data());
  parse_tree.len = buf.ByteLength();

  const bool has_opts = info.Length() > 1 && info[1].IsObject();

  // Owns the comment strings for the duration of the deparse call.
  std::vector<std::string> comment_texts;
  std::vector<PostgresDeparseComment> comment_storage;
  std::vector<PostgresDeparseComment *> comment_ptrs;

  PostgresDeparseOpts opts = {};

  if (has_opts) {
    Napi::Object o = info[1].As<Napi::Object>();

    auto boolOpt = [&](const char *key) -> bool {
      return o.Has(key) && o.Get(key).ToBoolean().Value();
    };
    auto intOpt = [&](const char *key, int fallback) -> int {
      return o.Has(key) && o.Get(key).IsNumber()
                 ? o.Get(key).As<Napi::Number>().Int32Value()
                 : fallback;
    };

    opts.pretty_print = boolOpt("prettyPrint");
    opts.indent_size = intOpt("indentSize", 4);
    opts.max_line_length = intOpt("maxLineLength", 80);
    opts.trailing_newline = boolOpt("trailingNewline");
    opts.commas_start_of_line = boolOpt("commasStartOfLine");

    if (o.Has("comments") && o.Get("comments").IsArray()) {
      Napi::Array arr = o.Get("comments").As<Napi::Array>();
      const uint32_t n = arr.Length();

      // Reserve up front: comment_storage must not reallocate while
      // comment_ptrs holds pointers into it.
      comment_texts.reserve(n);
      comment_storage.reserve(n);
      comment_ptrs.reserve(n);

      for (uint32_t i = 0; i < n; i++) {
        if (!arr.Get(i).IsObject()) continue;
        Napi::Object c = arr.Get(i).As<Napi::Object>();

        comment_texts.push_back(
            c.Has("text") ? c.Get("text").ToString().Utf8Value() : std::string());

        PostgresDeparseComment entry = {};
        entry.match_location =
            c.Has("matchLocation") ? c.Get("matchLocation").ToNumber().Int32Value() : 0;
        entry.newlines_before_comment =
            c.Has("newlinesBefore") ? c.Get("newlinesBefore").ToNumber().Int32Value() : 0;
        entry.newlines_after_comment =
            c.Has("newlinesAfter") ? c.Get("newlinesAfter").ToNumber().Int32Value() : 0;
        entry.str = const_cast<char *>(comment_texts.back().c_str());
        comment_storage.push_back(entry);
      }

      for (auto &entry : comment_storage) comment_ptrs.push_back(&entry);

      opts.comments = comment_ptrs.data();
      opts.comment_count = comment_ptrs.size();
    }
  }

  PgQueryDeparseResult result = has_opts
                                    ? pg_query_deparse_protobuf_opts(parse_tree, opts)
                                    : pg_query_deparse_protobuf(parse_tree);

  if (result.error) {
    Napi::Value ret = ReturnError(env, result.error);
    pg_query_free_deparse_result(result);
    return ret;
  }

  std::string sql(result.query ? result.query : "");
  pg_query_free_deparse_result(result);
  return ReturnResult(env, sql);
}

// Parse trees don't carry comments, so a parse/deparse round trip drops them.
// Pull them off the source here so they can be handed back to DeparseSync.
static Napi::Value ExtractCommentsSync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::string query = ValidateQuery(env, info);
  if (env.IsExceptionPending()) return env.Undefined();

  PgQueryDeparseCommentsResult result = pg_query_deparse_comments_for_query(query.c_str());

  if (result.error) {
    Napi::Value ret = ReturnError(env, result.error);
    pg_query_free_deparse_comments_result(result);
    return ret;
  }

  Napi::Array comments = Napi::Array::New(env, result.comment_count);
  for (size_t i = 0; i < result.comment_count; i++) {
    PostgresDeparseComment *c = result.comments[i];
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("matchLocation", Napi::Number::New(env, c->match_location));
    obj.Set("newlinesBefore", Napi::Number::New(env, c->newlines_before_comment));
    obj.Set("newlinesAfter", Napi::Number::New(env, c->newlines_after_comment));
    obj.Set("text", Napi::String::New(env, c->str ? c->str : ""));
    comments[i] = obj;
  }

  pg_query_free_deparse_comments_result(result);

  Napi::Object obj = Napi::Object::New(env);
  obj.Set("error", env.Null());
  obj.Set("result", comments);
  return obj;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("parseSync", Napi::Function::New(env, ParseSync));
  exports.Set("parsePlPgSQLSync", Napi::Function::New(env, ParsePlPgSQLSync));
  exports.Set("fingerprintSync", Napi::Function::New(env, FingerprintSync));
  exports.Set("normalizeSync", Napi::Function::New(env, NormalizeSync));
  exports.Set("scanSync", Napi::Function::New(env, ScanSync));
  exports.Set("deparseSync", Napi::Function::New(env, DeparseSync));
  exports.Set("extractCommentsSync", Napi::Function::New(env, ExtractCommentsSync));
  return exports;
}

NODE_API_MODULE(libpg_query_native, Init)
