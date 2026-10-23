/** @import { AnalysisOptions } from '@jky/radar-core' */
/**
 * Positive and negative cases for every rule in the registry.
 * Positive: the rule MUST fire. Negative: a near-miss where the rule MUST NOT fire.
 */

/**
 * @typedef {Object} Side
 * @property {string} a
 * @property {string} b
 * @property {AnalysisOptions} [options]
 * @property {[string, string]} [names]
 */
/**
 * @typedef {Object} RuleCase
 * @property {Side} pos
 * @property {Side} neg
 */

/* ----------------------------- OpenAPI builders ----------------------------- */
/** @typedef {Record<string, unknown>} J */
/**
 * @param {J} paths
 * @param {J} [extra]
 */
const doc = (paths, extra = {}) =>
  JSON.stringify({ openapi: '3.1.0', info: { title: 't', version: '1' }, paths, ...extra });
const ok = { 200: { description: 'ok' } };
/** @param {J} [o] */
const op = (o = {}) => ({ responses: ok, ...o });
/** @param {J} [o] */
const one = (o = {}, path = '/x', method = 'get') => doc({ [path]: { [method]: op(o) } });
/**
 * @param {string} a
 * @param {string} b
 * @param {AnalysisOptions} [options]
 * @returns {Side}
 */
const pair = (a, b, options) => (options ? { a, b, options } : { a, b });
/**
 * @param {string} name
 * @param {J} [schema]
 * @param {J} [extra]
 */
const q = (name, required = false, schema = { type: 'string' }, extra = {}) => ({
  name,
  in: 'query',
  required,
  schema,
  ...extra,
});
/** @param {J} schema */
const reqBody = (schema, required = true) => ({
  requestBody: { required, content: { 'application/json': { schema } } },
});
/** @param {J} schema */
const resBody = (schema) => ({
  responses: { 200: { description: 'ok', content: { 'application/json': { schema } } } },
});
/**
 * @param {J} a
 * @param {J} b
 */
const req = (a, b) => pair(one(reqBody(a), '/x', 'post'), one(reqBody(b), '/x', 'post'));
/**
 * @param {J} a
 * @param {J} b
 */
const res = (a, b) => pair(one(resBody(a)), one(resBody(b)));
/**
 * @param {J} props
 * @param {string[]} [required]
 * @param {J} [extra]
 */
const obj = (props, required = [], extra = {}) => ({
  type: 'object',
  properties: props,
  required,
  ...extra,
});
const S = { type: 'string' };
/**
 * @param {unknown[]} security
 * @param {J} schemes
 */
const secDoc = (security, schemes) =>
  JSON.stringify({
    openapi: '3.1.0',
    info: { title: 't', version: '1' },
    paths: { '/x': { get: { responses: ok, security } } },
    components: { securitySchemes: schemes },
  });
const oauth = {
  type: 'oauth2',
  flows: { clientCredentials: { tokenUrl: 'https://a.example/t', scopes: { read: 'r', write: 'w' } } },
};
const key = (name = 'X-Key') => ({ type: 'apiKey', in: 'header', name });
/**
 * @param {number} n
 * @returns {J}
 */
const deep = (n) => (n === 0 ? S : obj({ n: deep(n - 1) }));

/* ----------------------------- GraphQL builders ----------------------------- */
/**
 * @param {string} a
 * @param {string} b
 * @returns {Side}
 */
const g = (a, b) => ({ a, b, names: ['a.graphql', 'b.graphql'] });

/* ----------------------------- Postman builders ----------------------------- */
/**
 * @typedef {Object} PmReq
 * @property {string} [name]
 * @property {string} [method]
 * @property {string[]} [path]
 * @property {Array<[string, string]>} [query]
 * @property {Array<[string, string]>} [header]
 * @property {J} [body]
 * @property {J} [auth]
 */
/** @param {...PmReq} reqs */
const pm = (...reqs) =>
  JSON.stringify({
    info: { name: 'c', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: reqs.map((r, i) => ({
      name: r.name ?? `r${i}`,
      request: {
        method: r.method ?? 'GET',
        header: (r.header ?? []).map(([k, v]) => ({ key: k, value: v })),
        url: {
          raw: `{{baseUrl}}/${(r.path ?? ['items']).join('/')}`,
          host: ['{{baseUrl}}'],
          path: r.path ?? ['items'],
          query: (r.query ?? []).map(([k, v]) => ({ key: k, value: v })),
        },
        ...(r.body ? { body: r.body } : {}),
        ...(r.auth ? { auth: r.auth } : {}),
      },
    })),
  });
/** @param {J} o */
const raw = (o) => ({ mode: 'raw', raw: JSON.stringify(o), options: { raw: { language: 'json' } } });

/* ----------------------------- Proto builders ----------------------------- */
/** @param {string} body */
const proto = (body, pkg = 'demo.v1', syntax = 'syntax = "proto3";') =>
  `${syntax}\npackage ${pkg};\n${body}\n`;
/**
 * @param {string} a
 * @param {string} b
 * @returns {Side}
 */
const P = (a, b) => ({ a, b, names: ['a.proto', 'b.proto'] });
/** @param {string} rpcs */
const svc = (rpcs) =>
  `service S {\n${rpcs}\n}\nmessage A { string id = 1; }\nmessage B { string id = 1; }\nmessage C { string id = 1; }`;

/* ----------------------------- AsyncAPI builders ----------------------------- */
/**
 * @param {J} channels
 * @param {J} [extra]
 */
const asy = (channels, extra = {}) =>
  JSON.stringify({ asyncapi: '2.6.0', info: { title: 'e', version: '1' }, channels, ...extra });
/**
 * @param {J} [payload]
 * @param {J} [extra]
 */
const msg = (payload = obj({ id: S }, ['id']), extra = {}) => ({
  name: 'M',
  contentType: 'application/json',
  payload,
  ...extra,
});
/**
 * @param {string} id
 * @param {J} [message]
 */
const sub = (id, message = msg()) => ({ subscribe: { operationId: id, message } });

/** @type {Record<string, RuleCase>} */
export const RULE_CASES = {
  /* ============================== HTTP ============================== */
  HTTP_OPERATION_REMOVED: {
    pos: pair(doc({ '/a': { get: op() }, '/b': { get: op() } }), doc({ '/a': { get: op() } })),
    neg: pair(doc({ '/a': { get: op() } }), doc({ '/a': { get: op() }, '/b': { get: op() } })),
  },
  HTTP_OPERATION_ADDED: {
    pos: pair(doc({ '/a': { get: op() } }), doc({ '/a': { get: op() }, '/b': { get: op() } })),
    neg: pair(doc({ '/a': { get: op() }, '/b': { get: op() } }), doc({ '/a': { get: op() } })),
  },
  HTTP_OPERATION_PATH_CHANGED: {
    pos: pair(
      doc({ '/v1/users': { get: op({ operationId: 'listUsers' }) } }),
      doc({ '/users': { get: op({ operationId: 'listUsers' }) } }),
    ),
    neg: pair(
      doc({ '/v1/users': { get: op() }, '/z': { get: op() } }),
      doc({ '/users': { get: op() }, '/z': { get: op() } }),
    ),
  },
  HTTP_OPERATION_METHOD_CHANGED: {
    pos: pair(one({ operationId: 'doX' }, '/x', 'post'), one({ operationId: 'doX' }, '/x', 'put')),
    neg: pair(one({ operationId: 'doX' }, '/x', 'post'), one({ operationId: 'doX' }, '/x', 'post')),
  },
  HTTP_OPERATION_DEPRECATED: {
    pos: pair(one(), one({ deprecated: true })),
    neg: pair(one({ deprecated: true }), one({ deprecated: true })),
  },
  HTTP_OPERATION_ID_CHANGED: {
    pos: pair(one({ operationId: 'a' }), one({ operationId: 'b' })),
    neg: pair(one({ operationId: 'a' }), one({ operationId: 'a' })),
  },
  HTTP_PATH_PARAM_RENAMED: {
    pos: pair(
      doc({
        '/u/{id}': { get: op({ parameters: [{ name: 'id', in: 'path', required: true, schema: S }] }) },
      }),
      doc({
        '/u/{userId}': {
          get: op({ parameters: [{ name: 'userId', in: 'path', required: true, schema: S }] }),
        },
      }),
    ),
    neg: pair(
      doc({
        '/u/{id}': { get: op({ parameters: [{ name: 'id', in: 'path', required: true, schema: S }] }) },
      }),
      doc({
        '/u/{id}': { get: op({ parameters: [{ name: 'id', in: 'path', required: true, schema: S }] }) },
      }),
    ),
  },
  HTTP_PARAM_REQUIRED_ADDED: {
    pos: pair(one(), one({ parameters: [q('currency', true)] })),
    neg: pair(one(), one({ parameters: [q('currency', false)] })),
  },
  HTTP_PARAM_OPTIONAL_ADDED: {
    pos: pair(one(), one({ parameters: [q('page')] })),
    neg: pair(one(), one({ parameters: [q('page', true)] })),
  },
  HTTP_PARAM_REMOVED: {
    pos: pair(one({ parameters: [q('page')] }), one()),
    neg: pair(one({ parameters: [q('page')] }), one({ parameters: [q('page')] })),
  },
  HTTP_PARAM_BECAME_REQUIRED: {
    pos: pair(one({ parameters: [q('p')] }), one({ parameters: [q('p', true)] })),
    neg: pair(one({ parameters: [q('p', true)] }), one({ parameters: [q('p')] })),
  },
  HTTP_PARAM_BECAME_OPTIONAL: {
    pos: pair(one({ parameters: [q('p', true)] }), one({ parameters: [q('p')] })),
    neg: pair(one({ parameters: [q('p')] }), one({ parameters: [q('p', true)] })),
  },
  HTTP_PARAM_STYLE_CHANGED: {
    pos: pair(
      one({ parameters: [q('ids', false, { type: 'array', items: S })] }),
      one({ parameters: [q('ids', false, { type: 'array', items: S }, { explode: false })] }),
    ),
    neg: pair(
      one({ parameters: [q('ids', false, { type: 'array', items: S })] }),
      one({ parameters: [q('ids', false, { type: 'array', items: S }, { style: 'form', explode: true })] }),
    ),
  },
  HTTP_REQUEST_BODY_REQUIRED_ADDED: {
    pos: pair(one({}, '/x', 'post'), one(reqBody(S, true), '/x', 'post')),
    neg: pair(one({}, '/x', 'post'), one(reqBody(S, false), '/x', 'post')),
  },
  HTTP_REQUEST_BODY_OPTIONAL_ADDED: {
    pos: pair(one({}, '/x', 'post'), one(reqBody(S, false), '/x', 'post')),
    neg: pair(one({}, '/x', 'post'), one(reqBody(S, true), '/x', 'post')),
  },
  HTTP_REQUEST_BODY_BECAME_REQUIRED: {
    pos: pair(one(reqBody(S, false), '/x', 'post'), one(reqBody(S, true), '/x', 'post')),
    neg: pair(one(reqBody(S, true), '/x', 'post'), one(reqBody(S, false), '/x', 'post')),
  },
  HTTP_REQUEST_BODY_REMOVED: {
    pos: pair(one(reqBody(S), '/x', 'post'), one({}, '/x', 'post')),
    neg: pair(one({}, '/x', 'post'), one({}, '/x', 'post')),
  },
  HTTP_REQUEST_MEDIA_TYPE_REMOVED: {
    pos: pair(
      one(
        { requestBody: { content: { 'application/json': { schema: S }, 'application/xml': { schema: S } } } },
        '/x',
        'post',
      ),
      one({ requestBody: { content: { 'application/json': { schema: S } } } }, '/x', 'post'),
    ),
    neg: pair(
      one({ requestBody: { content: { 'application/json': { schema: S } } } }, '/x', 'post'),
      one({ requestBody: { content: { 'application/json; charset=utf-8': { schema: S } } } }, '/x', 'post'),
    ),
  },
  HTTP_REQUEST_MEDIA_TYPE_ADDED: {
    pos: pair(
      one({ requestBody: { content: { 'application/json': { schema: S } } } }, '/x', 'post'),
      one(
        { requestBody: { content: { 'application/json': { schema: S }, 'application/xml': { schema: S } } } },
        '/x',
        'post',
      ),
    ),
    neg: pair(
      one(
        { requestBody: { content: { 'application/json': { schema: S }, 'application/xml': { schema: S } } } },
        '/x',
        'post',
      ),
      one({ requestBody: { content: { 'application/json': { schema: S } } } }, '/x', 'post'),
    ),
  },
  HTTP_RESPONSE_SUCCESS_STATUS_REMOVED: {
    pos: pair(
      one({ responses: { 200: { description: 'a' } } }),
      one({ responses: { 201: { description: 'a' } } }),
    ),
    neg: pair(
      one({ responses: { 200: { description: 'a' } } }),
      one({ responses: { '2XX': { description: 'a' } } }),
    ),
  },
  HTTP_RESPONSE_ERROR_STATUS_REMOVED: {
    pos: pair(one({ responses: { ...ok, 404: { description: 'nf' } } }), one()),
    neg: pair(
      one({ responses: { ...ok, 404: { description: 'nf' } } }),
      one({ responses: { ...ok, 404: { description: 'nf' } } }),
    ),
  },
  HTTP_RESPONSE_SUCCESS_STATUS_ADDED: {
    pos: pair(one(), one({ responses: { ...ok, 202: { description: 'accepted' } } })),
    neg: pair(one(), one({ responses: { ...ok, 404: { description: 'nf' } } })),
  },
  HTTP_RESPONSE_ERROR_STATUS_ADDED: {
    pos: pair(one(), one({ responses: { ...ok, 404: { description: 'nf' } } })),
    neg: pair(one(), one({ responses: { ...ok, 202: { description: 'accepted' } } })),
  },
  HTTP_RESPONSE_MEDIA_TYPE_REMOVED: {
    pos: pair(
      one({
        responses: {
          200: {
            description: 'a',
            content: { 'application/json': { schema: S }, 'text/csv': { schema: S } },
          },
        },
      }),
      one({ responses: { 200: { description: 'a', content: { 'application/json': { schema: S } } } } }),
    ),
    neg: pair(
      one({ responses: { 200: { description: 'a', content: { 'application/json': { schema: S } } } } }),
      one({
        responses: {
          200: {
            description: 'a',
            content: { 'application/json': { schema: S }, 'text/csv': { schema: S } },
          },
        },
      }),
    ),
  },
  HTTP_RESPONSE_MEDIA_TYPE_ADDED: {
    pos: pair(
      one({ responses: { 200: { description: 'a', content: { 'application/json': { schema: S } } } } }),
      one({
        responses: {
          200: {
            description: 'a',
            content: { 'application/json': { schema: S }, 'text/csv': { schema: S } },
          },
        },
      }),
    ),
    neg: pair(
      one({
        responses: {
          200: {
            description: 'a',
            content: { 'application/json': { schema: S }, 'text/csv': { schema: S } },
          },
        },
      }),
      one({ responses: { 200: { description: 'a', content: { 'application/json': { schema: S } } } } }),
    ),
  },
  HTTP_RESPONSE_HEADER_REMOVED: {
    pos: pair(
      one({
        responses: {
          200: { description: 'a', headers: { 'X-Rate-Limit': { schema: { type: 'integer' } } } },
        },
      }),
      one(),
    ),
    neg: pair(
      one({
        responses: {
          200: { description: 'a', headers: { 'X-Rate-Limit': { schema: { type: 'integer' } } } },
        },
      }),
      one({
        responses: {
          200: { description: 'a', headers: { 'x-rate-limit': { schema: { type: 'integer' } } } },
        },
      }),
    ),
  },
  HTTP_SECURITY_ADDED: {
    pos: pair(secDoc([], { k: key() }), secDoc([{ k: [] }], { k: key() })),
    neg: pair(secDoc([{ k: [] }], { k: key() }), secDoc([{ k: [] }], { k: key() })),
  },
  HTTP_SECURITY_TIGHTENED: {
    pos: pair(
      secDoc([{ a: [] }], { a: key('A'), b: key('B') }),
      secDoc([{ b: [] }], { a: key('A'), b: key('B') }),
    ),
    neg: pair(
      secDoc([{ a: [] }], { a: key('A'), b: key('B') }),
      secDoc([{ a: [] }, { b: [] }], { a: key('A'), b: key('B') }),
    ),
  },
  HTTP_SECURITY_SCOPES_ADDED: {
    pos: pair(secDoc([{ o: ['read'] }], { o: oauth }), secDoc([{ o: ['read', 'write'] }], { o: oauth })),
    neg: pair(secDoc([{ o: ['read', 'write'] }], { o: oauth }), secDoc([{ o: ['read'] }], { o: oauth })),
  },
  HTTP_SECURITY_RELAXED: {
    pos: pair(
      secDoc([{ a: [] }], { a: key('A'), b: key('B') }),
      secDoc([{ a: [] }, { b: [] }], { a: key('A'), b: key('B') }),
    ),
    neg: pair(secDoc([{ a: [] }], { a: key('A') }), secDoc([{ a: [] }], { a: key('A') })),
  },
  HTTP_SECURITY_SCHEME_CHANGED: {
    pos: pair(secDoc([{ k: [] }], { k: key('X-Key') }), secDoc([{ k: [] }], { k: key('X-Api-Key') })),
    neg: pair(secDoc([{ k: [] }], { k: key('X-Key') }), secDoc([{ k: [] }], { k: key('x-key') })),
  },
  HTTP_SERVER_REMOVED: {
    pos: pair(
      doc({}, { servers: [{ url: 'https://a.example' }, { url: 'https://b.example' }] }),
      doc({}, { servers: [{ url: 'https://a.example' }] }),
    ),
    neg: pair(
      doc({}, { servers: [{ url: 'https://a.example' }] }),
      doc({}, { servers: [{ url: 'https://a.example' }, { url: 'https://b.example' }] }),
    ),
  },
  HTTP_SERVER_ADDED: {
    pos: pair(
      doc({}, { servers: [{ url: 'https://a.example' }] }),
      doc({}, { servers: [{ url: 'https://a.example' }, { url: 'https://b.example' }] }),
    ),
    neg: pair(
      doc({}, { servers: [{ url: 'https://a.example' }, { url: 'https://b.example' }] }),
      doc({}, { servers: [{ url: 'https://a.example' }] }),
    ),
  },
  HTTP_DOCS_CHANGED: {
    pos: pair(one({ summary: 'Old' }), one({ summary: 'New' })),
    neg: pair(one({ summary: 'Same' }), one({ summary: 'Same' })),
  },
  HTTP_INFO_VERSION_CHANGED: {
    pos: pair(doc({}), JSON.stringify({ openapi: '3.1.0', info: { title: 't', version: '2' }, paths: {} })),
    neg: pair(doc({}), doc({})),
  },
  XFMT_PROJECTION_LOSSY: {
    pos: {
      a: JSON.stringify({
        swagger: '2.0',
        info: { title: 't', version: '1' },
        paths: { '/x': { get: { responses: { 200: { description: 'ok' } } } } },
      }),
      b: one(),
      options: { allowCrossFormat: true },
    },
    neg: pair(one(), one(), { allowCrossFormat: true }),
  },

  /* ============================== Request schemas ============================== */
  REQ_TYPE_NARROWED: {
    pos: req({ type: ['string', 'integer'] }, S),
    neg: req(S, { type: ['string', 'integer'] }),
  },
  REQ_TYPE_WIDENED: {
    pos: req({ type: 'integer' }, { type: 'number' }),
    neg: req({ type: 'number' }, { type: 'integer' }),
  },
  REQ_NULL_REMOVED: { pos: req({ type: ['string', 'null'] }, S), neg: req(S, { type: ['string', 'null'] }) },
  REQ_PROPERTY_REQUIRED_ADDED: {
    pos: req(obj({ a: S }), obj({ a: S, b: S }, ['b'])),
    neg: req(obj({ a: S }), obj({ a: S, b: S })),
  },
  REQ_PROPERTY_OPTIONAL_ADDED: {
    pos: req(obj({ a: S }), obj({ a: S, b: S })),
    neg: req(obj({ a: S }), obj({ a: S, b: S }, ['b'])),
  },
  REQ_PROPERTY_BECAME_REQUIRED: {
    pos: req(obj({ a: S }), obj({ a: S }, ['a'])),
    neg: req(obj({ a: S }, ['a']), obj({ a: S })),
  },
  REQ_PROPERTY_BECAME_OPTIONAL: {
    pos: req(obj({ a: S }, ['a']), obj({ a: S })),
    neg: req(obj({ a: S }), obj({ a: S }, ['a'])),
  },
  REQ_PROPERTY_REMOVED: {
    pos: req(obj({ a: S, b: S }), obj({ a: S })),
    neg: req(obj({ a: S, b: S }), obj({ a: S }, [], { additionalProperties: false })),
  },
  REQ_PROPERTY_REMOVED_STRICT: {
    pos: req(obj({ a: S, b: S }), obj({ a: S }, [], { additionalProperties: false })),
    neg: req(obj({ a: S, b: S }), obj({ a: S })),
  },
  REQ_ENUM_VALUE_REMOVED: {
    pos: req({ type: 'string', enum: ['x', 'y'] }, { type: 'string', enum: ['x'] }),
    neg: req({ type: 'string', enum: ['x'] }, { type: 'string', enum: ['x', 'y'] }),
  },
  REQ_ENUM_VALUE_ADDED: {
    pos: req({ type: 'string', enum: ['x'] }, { type: 'string', enum: ['x', 'y'] }),
    neg: req({ type: 'string', enum: ['x', 'y'] }, { type: 'string', enum: ['x'] }),
  },
  REQ_CONSTRAINT_TIGHTENED: {
    pos: req({ type: 'string', maxLength: 10 }, { type: 'string', maxLength: 5 }),
    neg: req({ type: 'string', maxLength: 5 }, { type: 'string', maxLength: 10 }),
  },
  REQ_CONSTRAINT_RELAXED: {
    pos: req({ type: 'integer', minimum: 5 }, { type: 'integer', minimum: 1 }),
    neg: req({ type: 'integer', minimum: 1 }, { type: 'integer', minimum: 5 }),
  },
  REQ_PATTERN_CHANGED: {
    pos: req({ type: 'string', pattern: '^a' }, { type: 'string', pattern: '^b' }),
    neg: req({ type: 'string', pattern: '^a' }, S),
  },
  REQ_ADDITIONAL_PROPERTIES_RESTRICTED: {
    pos: req(obj({ a: S }), obj({ a: S }, [], { additionalProperties: false })),
    neg: req(obj({ a: S }, [], { additionalProperties: false }), obj({ a: S })),
  },
  REQ_DEFAULT_CHANGED: {
    pos: req({ type: 'integer', default: 1 }, { type: 'integer', default: 2 }),
    neg: req({ type: 'integer', default: 1 }, { type: 'integer', default: 1 }),
  },

  /* ============================== Response schemas ============================== */
  RES_TYPE_CHANGED: { pos: res(S, { type: 'integer' }), neg: res({ type: ['string', 'integer'] }, S) },
  RES_TYPE_NARROWED: {
    pos: res({ type: ['string', 'integer'] }, S),
    neg: res(S, { type: ['string', 'integer'] }),
  },
  RES_NULL_ADDED: { pos: res(S, { type: ['string', 'null'] }), neg: res({ type: ['string', 'null'] }, S) },
  RES_PROPERTY_REMOVED: {
    pos: res(obj({ a: S, b: S }, ['a', 'b']), obj({ a: S }, ['a'])),
    neg: res(obj({ a: S, b: S }, ['a']), obj({ a: S }, ['a'])),
  },
  RES_OPTIONAL_PROPERTY_REMOVED: {
    pos: res(obj({ a: S, b: S }, ['a']), obj({ a: S }, ['a'])),
    neg: res(obj({ a: S, b: S }, ['a', 'b']), obj({ a: S }, ['a'])),
  },
  RES_PROPERTY_BECAME_OPTIONAL: {
    pos: res(obj({ a: S }, ['a']), obj({ a: S })),
    neg: res(obj({ a: S }), obj({ a: S }, ['a'])),
  },
  RES_PROPERTY_BECAME_REQUIRED: {
    pos: res(obj({ a: S }), obj({ a: S }, ['a'])),
    neg: res(obj({ a: S }, ['a']), obj({ a: S })),
  },
  RES_PROPERTY_ADDED: {
    pos: res(obj({ a: S }), obj({ a: S, b: S })),
    neg: res(obj({ a: S, b: S }), obj({ a: S, b: S })),
  },
  RES_ENUM_VALUE_ADDED: {
    pos: res({ type: 'string', enum: ['x'] }, { type: 'string', enum: ['x', 'y'] }),
    neg: res({ type: 'string', enum: ['x', 'y'] }, { type: 'string', enum: ['x'] }),
  },
  RES_ENUM_VALUE_REMOVED: {
    pos: res({ type: 'string', enum: ['x', 'y'] }, { type: 'string', enum: ['x'] }),
    neg: res({ type: 'string', enum: ['x'] }, { type: 'string', enum: ['x', 'y'] }),
  },
  RES_CONSTRAINT_RELAXED: {
    pos: res({ type: 'string', maxLength: 5 }, { type: 'string', maxLength: 10 }),
    neg: res({ type: 'string', maxLength: 10 }, { type: 'string', maxLength: 5 }),
  },
  RES_CONSTRAINT_TIGHTENED: {
    pos: res({ type: 'string', maxLength: 10 }, { type: 'string', maxLength: 5 }),
    neg: res({ type: 'string', maxLength: 5 }, { type: 'string', maxLength: 10 }),
  },
  RES_PATTERN_CHANGED: {
    pos: res({ type: 'string', pattern: '^a' }, { type: 'string', pattern: '^b' }),
    neg: res(S, { type: 'string', pattern: '^a' }),
  },

  /* ============================== Shared schema ============================== */
  SCHEMA_FORMAT_CHANGED: {
    pos: res({ type: 'string', format: 'date' }, { type: 'string', format: 'date-time' }),
    neg: res({ type: 'string', format: 'date' }, { type: 'string', format: 'date' }),
  },
  SCHEMA_COMBINATOR_CHANGED: {
    pos: res({ oneOf: [S, { type: 'integer' }] }, { oneOf: [S, { type: 'integer' }, { type: 'boolean' }] }),
    neg: res({ oneOf: [S, { type: 'integer' }] }, { oneOf: [S, { type: 'integer' }] }),
  },
  SCHEMA_UNSUPPORTED_KEYWORD_CHANGED: {
    pos: res(
      { type: 'object', patternProperties: { '^x-': S } },
      { type: 'object', patternProperties: { '^y-': S } },
    ),
    neg: res(
      { type: 'object', patternProperties: { '^x-': S } },
      { type: 'object', patternProperties: { '^x-': S } },
    ),
  },
  SCHEMA_REF_UNRESOLVED: {
    pos: res({ $ref: 'https://schemas.example.com/a.json' }, { $ref: 'https://schemas.example.com/b.json' }),
    neg: res({ $ref: 'https://schemas.example.com/a.json' }, { $ref: 'https://schemas.example.com/a.json' }),
  },
  SCHEMA_DEPTH_LIMIT: { pos: res(deep(55), deep(55)), neg: res(deep(30), deep(30)) },
  SCHEMA_READ_WRITE_CHANGED: {
    pos: res(obj({ a: S }), obj({ a: { type: 'string', readOnly: true } })),
    neg: res(obj({ a: { type: 'string', readOnly: true } }), obj({ a: { type: 'string', readOnly: true } })),
  },
  SCHEMA_PROPERTY_DEPRECATED: {
    pos: res(S, { type: 'string', deprecated: true }),
    neg: res({ type: 'string', deprecated: true }, S),
  },
  SCHEMA_DOCS_CHANGED: {
    pos: res({ type: 'string', description: 'a' }, { type: 'string', description: 'b' }),
    neg: res({ type: 'string', description: 'a' }, { type: 'string', description: 'a' }),
  },
  JSON_SCHEMA_DIALECT_CHANGED: {
    pos: pair(
      JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' }),
      JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' }),
    ),
    neg: pair(
      JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' }),
      JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' }),
    ),
  },

  /* ============================== GraphQL ============================== */
  GQL_TYPE_REMOVED: {
    pos: g('type Query { a: Int }\ntype A { x: Int }', 'type Query { a: Int }'),
    neg: g('type Query { a: Int }', 'type Query { a: Int }\ntype A { x: Int }'),
  },
  GQL_TYPE_ADDED: {
    pos: g('type Query { a: Int }', 'type Query { a: Int }\ntype A { x: Int }'),
    neg: g('type Query { a: Int }\ntype A { x: Int }', 'type Query { a: Int }'),
  },
  GQL_TYPE_KIND_CHANGED: {
    pos: g('type Query { a: A }\ntype A { x: Int }', 'type Query { a: A }\ninterface A { x: Int }'),
    neg: g('type Query { a: A }\ntype A { x: Int }', 'type Query { a: A }\ntype A { x: Int }'),
  },
  GQL_ROOT_TYPE_CHANGED: {
    pos: g('schema { query: Q }\ntype Q { a: Int }', 'schema { query: Q2 }\ntype Q2 { a: Int }'),
    neg: g('schema { query: Q }\ntype Q { a: Int }', 'schema { query: Q }\ntype Q { a: Int b: Int }'),
  },
  GQL_FIELD_REMOVED: {
    pos: g('type Query { a: Int b: Int }', 'type Query { a: Int }'),
    neg: g('type Query { a: Int b: Int }', 'type Query { a: Int b: Int @deprecated(reason: "x") }'),
  },
  GQL_FIELD_ADDED: {
    pos: g('type Query { a: Int }', 'type Query { a: Int b: Int }'),
    neg: g('type Query { a: Int b: Int }', 'type Query { a: Int }'),
  },
  GQL_FIELD_DEPRECATED: {
    pos: g('type Query { a: Int b: Int }', 'type Query { a: Int b: Int @deprecated(reason: "x") }'),
    neg: g(
      'type Query { a: Int b: Int @deprecated(reason: "x") }',
      'type Query { a: Int b: Int @deprecated(reason: "x") }',
    ),
  },
  GQL_FIELD_TYPE_CHANGED: {
    pos: g('type Query { a: Int }', 'type Query { a: String }'),
    neg: g('type Query { a: Int }', 'type Query { a: Int! }'),
  },
  GQL_OUTPUT_FIELD_BECAME_NULLABLE: {
    pos: g('type Query { a: Int! }', 'type Query { a: Int }'),
    neg: g('type Query { a: Int }', 'type Query { a: Int! }'),
  },
  GQL_FIELD_TYPE_NARROWED: {
    pos: g('type Query { a: Int }', 'type Query { a: Int! }'),
    neg: g('type Query { a: Int! }', 'type Query { a: Int }'),
  },
  GQL_ARG_REMOVED: {
    pos: g('type Query { a(x: Int): Int }', 'type Query { a: Int }'),
    neg: g('type Query { a: Int }', 'type Query { a(x: Int): Int }'),
  },
  GQL_REQUIRED_ARG_ADDED: {
    pos: g('type Query { a: Int }', 'type Query { a(x: Int!): Int }'),
    neg: g('type Query { a: Int }', 'type Query { a(x: Int! = 1): Int }'),
  },
  GQL_OPTIONAL_ARG_ADDED: {
    pos: g('type Query { a: Int }', 'type Query { a(x: Int): Int }'),
    neg: g('type Query { a: Int }', 'type Query { a(x: Int!): Int }'),
  },
  GQL_ARG_TYPE_CHANGED: {
    pos: g('type Query { a(x: Int): Int }', 'type Query { a(x: Int!): Int }'),
    neg: g('type Query { a(x: Int!): Int }', 'type Query { a(x: Int): Int }'),
  },
  GQL_ARG_TYPE_WIDENED: {
    pos: g('type Query { a(x: Int!): Int }', 'type Query { a(x: Int): Int }'),
    neg: g('type Query { a(x: Int): Int }', 'type Query { a(x: Int!): Int }'),
  },
  GQL_ARG_DEFAULT_CHANGED: {
    pos: g('type Query { a(x: Int = 1): Int }', 'type Query { a(x: Int = 2): Int }'),
    neg: g('type Query { a(x: Int = 1): Int }', 'type Query { a(x: Int = 1): Int }'),
  },
  GQL_INPUT_FIELD_REMOVED: {
    pos: g(
      'type Query { f(i: I): Int }\ninput I { a: Int b: Int }',
      'type Query { f(i: I): Int }\ninput I { a: Int }',
    ),
    neg: g(
      'type Query { f(i: I): Int }\ninput I { a: Int }',
      'type Query { f(i: I): Int }\ninput I { a: Int b: Int }',
    ),
  },
  GQL_REQUIRED_INPUT_FIELD_ADDED: {
    pos: g(
      'type Query { f(i: I): Int }\ninput I { a: Int }',
      'type Query { f(i: I): Int }\ninput I { a: Int c: Int! }',
    ),
    neg: g(
      'type Query { f(i: I): Int }\ninput I { a: Int }',
      'type Query { f(i: I): Int }\ninput I { a: Int c: Int }',
    ),
  },
  GQL_OPTIONAL_INPUT_FIELD_ADDED: {
    pos: g(
      'type Query { f(i: I): Int }\ninput I { a: Int }',
      'type Query { f(i: I): Int }\ninput I { a: Int c: Int }',
    ),
    neg: g(
      'type Query { f(i: I): Int }\ninput I { a: Int }',
      'type Query { f(i: I): Int }\ninput I { a: Int c: Int! }',
    ),
  },
  GQL_INPUT_FIELD_TYPE_CHANGED: {
    pos: g(
      'type Query { f(i: I): Int }\ninput I { a: Int }',
      'type Query { f(i: I): Int }\ninput I { a: Int! }',
    ),
    neg: g(
      'type Query { f(i: I): Int }\ninput I { a: Int! }',
      'type Query { f(i: I): Int }\ninput I { a: Int }',
    ),
  },
  GQL_INPUT_FIELD_TYPE_WIDENED: {
    pos: g(
      'type Query { f(i: I): Int }\ninput I { a: Int! }',
      'type Query { f(i: I): Int }\ninput I { a: Int }',
    ),
    neg: g(
      'type Query { f(i: I): Int }\ninput I { a: Int }',
      'type Query { f(i: I): Int }\ninput I { a: Int! }',
    ),
  },
  GQL_ENUM_VALUE_REMOVED: {
    pos: g('type Query { e: E }\nenum E { A B }', 'type Query { e: E }\nenum E { A }'),
    neg: g('type Query { e: E }\nenum E { A }', 'type Query { e: E }\nenum E { A B }'),
  },
  GQL_ENUM_VALUE_ADDED: {
    pos: g('type Query { e: E }\nenum E { A }', 'type Query { e: E }\nenum E { A B }'),
    neg: g('type Query { e: E }\nenum E { A B }', 'type Query { e: E }\nenum E { A }'),
  },
  GQL_ENUM_VALUE_DEPRECATED: {
    pos: g(
      'type Query { e: E }\nenum E { A B }',
      'type Query { e: E }\nenum E { A B @deprecated(reason: "x") }',
    ),
    neg: g('type Query { e: E }\nenum E { A B }', 'type Query { e: E }\nenum E { A B }'),
  },
  GQL_UNION_MEMBER_REMOVED: {
    pos: g(
      'type Query { u: U }\ntype A { x: Int }\ntype B { y: Int }\nunion U = A | B',
      'type Query { u: U }\ntype A { x: Int }\ntype B { y: Int }\nunion U = A',
    ),
    neg: g(
      'type Query { u: U }\ntype A { x: Int }\ntype B { y: Int }\nunion U = A',
      'type Query { u: U }\ntype A { x: Int }\ntype B { y: Int }\nunion U = A | B',
    ),
  },
  GQL_UNION_MEMBER_ADDED: {
    pos: g(
      'type Query { u: U }\ntype A { x: Int }\ntype B { y: Int }\nunion U = A',
      'type Query { u: U }\ntype A { x: Int }\ntype B { y: Int }\nunion U = A | B',
    ),
    neg: g(
      'type Query { u: U }\ntype A { x: Int }\ntype B { y: Int }\nunion U = A | B',
      'type Query { u: U }\ntype A { x: Int }\ntype B { y: Int }\nunion U = A',
    ),
  },
  GQL_INTERFACE_REMOVED: {
    pos: g(
      'type Query { a: A }\ninterface I { x: Int }\ntype A implements I { x: Int }',
      'type Query { a: A }\ninterface I { x: Int }\ntype A { x: Int }',
    ),
    neg: g(
      'type Query { a: A }\ninterface I { x: Int }\ntype A { x: Int }',
      'type Query { a: A }\ninterface I { x: Int }\ntype A implements I { x: Int }',
    ),
  },
  GQL_INTERFACE_ADDED: {
    pos: g(
      'type Query { a: A }\ninterface I { x: Int }\ntype A { x: Int }',
      'type Query { a: A }\ninterface I { x: Int }\ntype A implements I { x: Int }',
    ),
    neg: g(
      'type Query { a: A }\ninterface I { x: Int }\ntype A implements I { x: Int }',
      'type Query { a: A }\ninterface I { x: Int }\ntype A { x: Int }',
    ),
  },
  GQL_DIRECTIVE_REMOVED: {
    pos: g('directive @auth on FIELD_DEFINITION\ntype Query { a: Int }', 'type Query { a: Int }'),
    neg: g('type Query { a: Int }', 'directive @auth on FIELD_DEFINITION\ntype Query { a: Int }'),
  },
  GQL_DIRECTIVE_ADDED: {
    pos: g('type Query { a: Int }', 'directive @auth on FIELD_DEFINITION\ntype Query { a: Int }'),
    neg: g('directive @auth on FIELD_DEFINITION\ntype Query { a: Int }', 'type Query { a: Int }'),
  },
  GQL_DIRECTIVE_CHANGED: {
    pos: g(
      'directive @auth on FIELD_DEFINITION | OBJECT\ntype Query { a: Int }',
      'directive @auth on FIELD_DEFINITION\ntype Query { a: Int }',
    ),
    neg: g(
      'directive @auth on FIELD_DEFINITION\ntype Query { a: Int }',
      'directive @auth on FIELD_DEFINITION | OBJECT\ntype Query { a: Int }',
    ),
  },
  GQL_DESCRIPTION_CHANGED: {
    pos: g('"Old"\ntype Query { a: Int }', '"New"\ntype Query { a: Int }'),
    neg: g('"Same"\ntype Query { a: Int }', '"Same"\ntype Query { a: Int }'),
  },

  /* ============================== Postman ============================== */
  POSTMAN_REQUEST_REMOVED: {
    pos: pair(pm({ name: 'a' }, { name: 'b', path: ['b'] }), pm({ name: 'a' })),
    neg: pair(pm({ name: 'a' }), pm({ name: 'a' })),
  },
  POSTMAN_REQUEST_ADDED: {
    pos: pair(pm({ name: 'a' }), pm({ name: 'a' }, { name: 'b', path: ['b'] })),
    neg: pair(pm({ name: 'a' }, { name: 'b', path: ['b'] }), pm({ name: 'a' })),
  },
  POSTMAN_REQUEST_METHOD_CHANGED: {
    pos: pair(pm({ name: 'a', method: 'POST' }), pm({ name: 'a', method: 'PUT' })),
    neg: pair(pm({ name: 'a', method: 'POST' }), pm({ name: 'a', method: 'POST' })),
  },
  POSTMAN_REQUEST_URL_CHANGED: {
    pos: pair(pm({ name: 'a', path: ['a'] }), pm({ name: 'a', path: ['b'] })),
    neg: pair(pm({ name: 'a', path: ['a'] }), pm({ name: 'a', path: ['a'] })),
  },
  POSTMAN_QUERY_PARAM_REMOVED: {
    pos: pair(pm({ query: [['page', '1']] }), pm({})),
    neg: pair(pm({}), pm({ query: [['page', '1']] })),
  },
  POSTMAN_QUERY_PARAM_ADDED: {
    pos: pair(pm({}), pm({ query: [['page', '1']] })),
    neg: pair(pm({ query: [['page', '1']] }), pm({})),
  },
  POSTMAN_HEADER_REMOVED: {
    pos: pair(pm({ header: [['X-Trace', '1']] }), pm({})),
    neg: pair(pm({}), pm({ header: [['X-Trace', '1']] })),
  },
  POSTMAN_HEADER_ADDED: {
    pos: pair(pm({}), pm({ header: [['X-Trace', '1']] })),
    neg: pair(pm({ header: [['X-Trace', '1']] }), pm({})),
  },
  POSTMAN_BODY_MODE_CHANGED: {
    pos: pair(
      pm({ method: 'POST', body: raw({ a: 1 }) }),
      pm({ method: 'POST', body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1' }] } }),
    ),
    neg: pair(pm({ method: 'POST', body: raw({ a: 1 }) }), pm({ method: 'POST', body: raw({ a: 2 }) })),
  },
  POSTMAN_BODY_FIELDS_CHANGED: {
    pos: pair(pm({ method: 'POST', body: raw({ a: 1 }) }), pm({ method: 'POST', body: raw({ a: 1, b: 2 }) })),
    neg: pair(pm({ method: 'POST', body: raw({ a: 1 }) }), pm({ method: 'POST', body: raw({ a: 5 }) })),
  },
  POSTMAN_VARIABLE_RENAMED: {
    pos: pair(pm({ query: [['size', '{{pageSize}}']] }), pm({ query: [['size', '{{limit}}']] })),
    neg: pair(pm({ query: [['size', '{{pageSize}}']] }), pm({ query: [['size', '{{pageSize}}']] })),
  },
  POSTMAN_AUTH_CHANGED: {
    pos: pair(pm({}), pm({ auth: { type: 'bearer' } })),
    neg: pair(pm({ auth: { type: 'bearer' } }), pm({ auth: { type: 'bearer' } })),
  },

  /* ============================== Protobuf ============================== */
  PROTO_PACKAGE_CHANGED: {
    pos: P(proto('message A { string id = 1; }', 'a.v1'), proto('message A { string id = 1; }', 'a.v2')),
    neg: P(proto('message A { string id = 1; }'), proto('message A { string id = 1; }')),
  },
  PROTO_SERVICE_REMOVED: {
    pos: P(
      proto(svc('rpc M (A) returns (B);')),
      proto('message A { string id = 1; }\nmessage B { string id = 1; }\nmessage C { string id = 1; }'),
    ),
    neg: P(proto(svc('rpc M (A) returns (B);')), proto(svc('rpc M (A) returns (B);'))),
  },
  PROTO_SERVICE_ADDED: {
    pos: P(
      proto('message A { string id = 1; }\nmessage B { string id = 1; }\nmessage C { string id = 1; }'),
      proto(svc('rpc M (A) returns (B);')),
    ),
    neg: P(proto(svc('rpc M (A) returns (B);')), proto(svc('rpc M (A) returns (B);'))),
  },
  PROTO_RPC_REMOVED: {
    pos: P(
      proto(svc('rpc M (A) returns (B);\nrpc N (A) returns (B);')),
      proto(svc('rpc M (A) returns (B);')),
    ),
    neg: P(
      proto(svc('rpc M (A) returns (B);')),
      proto(svc('rpc M (A) returns (B);\nrpc N (A) returns (B);')),
    ),
  },
  PROTO_RPC_ADDED: {
    pos: P(
      proto(svc('rpc M (A) returns (B);')),
      proto(svc('rpc M (A) returns (B);\nrpc N (A) returns (B);')),
    ),
    neg: P(
      proto(svc('rpc M (A) returns (B);\nrpc N (A) returns (B);')),
      proto(svc('rpc M (A) returns (B);')),
    ),
  },
  PROTO_RPC_REQUEST_TYPE_CHANGED: {
    pos: P(proto(svc('rpc M (A) returns (B);')), proto(svc('rpc M (C) returns (B);'))),
    neg: P(proto(svc('rpc M (A) returns (B);')), proto(svc('rpc M (A) returns (C);'))),
  },
  PROTO_RPC_RESPONSE_TYPE_CHANGED: {
    pos: P(proto(svc('rpc M (A) returns (B);')), proto(svc('rpc M (A) returns (C);'))),
    neg: P(proto(svc('rpc M (A) returns (B);')), proto(svc('rpc M (C) returns (B);'))),
  },
  PROTO_RPC_STREAMING_CHANGED: {
    pos: P(proto(svc('rpc M (A) returns (B);')), proto(svc('rpc M (A) returns (stream B);'))),
    neg: P(proto(svc('rpc M (A) returns (stream B);')), proto(svc('rpc M (A) returns (stream B);'))),
  },
  PROTO_MESSAGE_REMOVED: {
    pos: P(
      proto('message A { string id = 1; }\nmessage X { string id = 1; }'),
      proto('message A { string id = 1; }'),
    ),
    neg: P(
      proto('message A { string id = 1; }'),
      proto('message A { string id = 1; }\nmessage X { string id = 1; }'),
    ),
  },
  PROTO_FIELD_ADDED: {
    pos: P(proto('message A { string id = 1; }'), proto('message A { string id = 1; int32 n = 2; }')),
    neg: P(
      proto('message A { reserved 2; string id = 1; }'),
      proto('message A { string id = 1; int32 n = 2; }'),
    ),
  },
  PROTO_FIELD_REMOVED: {
    pos: P(
      proto('message A { string id = 1; int32 n = 2; }'),
      proto('message A { reserved 2; string id = 1; }'),
    ),
    neg: P(proto('message A { string id = 1; int32 n = 2; }'), proto('message A { string id = 1; }')),
  },
  PROTO_FIELD_REMOVED_UNRESERVED: {
    pos: P(proto('message A { string id = 1; int32 n = 2; }'), proto('message A { string id = 1; }')),
    neg: P(
      proto('message A { string id = 1; int32 n = 2; }'),
      proto('message A { reserved 2; string id = 1; }'),
    ),
  },
  PROTO_FIELD_NUMBER_REUSED: {
    pos: P(proto('message A { int32 a = 1; }'), proto('message A { string b = 1; }')),
    neg: P(proto('message A { int32 a = 1; }'), proto('message A { int32 b = 1; }')),
  },
  PROTO_FIELD_RENAMED: {
    pos: P(proto('message A { int32 a = 1; }'), proto('message A { int32 b = 1; }')),
    neg: P(proto('message A { int32 a = 1; }'), proto('message A { string b = 1; }')),
  },
  PROTO_FIELD_NUMBER_CHANGED: {
    pos: P(proto('message A { int32 a = 1; }'), proto('message A { int32 a = 2; }')),
    neg: P(proto('message A { int32 a = 1; }'), proto('message A { int32 a = 1; }')),
  },
  PROTO_FIELD_WIRE_TYPE_CHANGED: {
    pos: P(proto('message A { int32 a = 1; }'), proto('message A { string a = 1; }')),
    neg: P(proto('message A { int32 a = 1; }'), proto('message A { int64 a = 1; }')),
  },
  PROTO_FIELD_TYPE_CHANGED_COMPATIBLE: {
    pos: P(proto('message A { int32 a = 1; }'), proto('message A { int64 a = 1; }')),
    neg: P(proto('message A { int32 a = 1; }'), proto('message A { string a = 1; }')),
  },
  PROTO_FIELD_MESSAGE_TYPE_CHANGED: {
    pos: P(
      proto('message X { string v = 1; }\nmessage Y { string v = 1; }\nmessage A { X f = 1; }'),
      proto('message X { string v = 1; }\nmessage Y { string v = 1; }\nmessage A { Y f = 1; }'),
    ),
    neg: P(
      proto('message X { string v = 1; }\nmessage A { X f = 1; }'),
      proto('message X { string v = 1; }\nmessage A { X f = 1; }'),
    ),
  },
  PROTO_FIELD_CARDINALITY_CHANGED: {
    pos: P(proto('message A { string a = 1; }'), proto('message A { repeated string a = 1; }')),
    neg: P(proto('message A { repeated string a = 1; }'), proto('message A { repeated string a = 1; }')),
  },
  PROTO_FIELD_REQUIRED_CHANGED: {
    pos: P(
      proto('message A { optional string a = 1; }', 'demo.v1', 'syntax = "proto2";'),
      proto('message A { required string a = 1; }', 'demo.v1', 'syntax = "proto2";'),
    ),
    neg: P(
      proto('message A { optional string a = 1; }', 'demo.v1', 'syntax = "proto2";'),
      proto('message A { optional string a = 1; }', 'demo.v1', 'syntax = "proto2";'),
    ),
  },
  PROTO_ONEOF_CHANGED: {
    pos: P(proto('message A { string a = 1; }'), proto('message A { oneof k { string a = 1; } }')),
    neg: P(
      proto('message A { oneof k { string a = 1; } }'),
      proto('message A { oneof k { string a = 1; } }'),
    ),
  },
  PROTO_ENUM_VALUE_REMOVED: {
    pos: P(proto('enum E { A = 0; B = 1; }'), proto('enum E { A = 0; }')),
    neg: P(proto('enum E { A = 0; }'), proto('enum E { A = 0; B = 1; }')),
  },
  PROTO_ENUM_VALUE_ADDED: {
    pos: P(proto('enum E { A = 0; }'), proto('enum E { A = 0; B = 1; }')),
    neg: P(proto('enum E { A = 0; B = 1; }'), proto('enum E { A = 0; }')),
  },
  PROTO_ENUM_NUMBER_REUSED: {
    pos: P(proto('enum E { A = 0; B = 1; }'), proto('enum E { A = 0; C = 1; }')),
    neg: P(proto('enum E { A = 0; B = 1; }'), proto('enum E { A = 0; B = 1; C = 2; }')),
  },
  PROTO_ENUM_VALUE_NUMBER_CHANGED: {
    pos: P(proto('enum E { A = 0; B = 1; }'), proto('enum E { A = 0; B = 2; }')),
    neg: P(proto('enum E { A = 0; B = 1; }'), proto('enum E { A = 0; B = 1; }')),
  },
  PROTO_RESERVED_REMOVED: {
    pos: P(proto('message A { reserved 5; string a = 1; }'), proto('message A { string a = 1; }')),
    neg: P(
      proto('message A { reserved 5; string a = 1; }'),
      proto('message A { reserved 5, 6; string a = 1; }'),
    ),
  },
  PROTO_SYNTAX_UNSUPPORTED: {
    pos: P(
      proto('message A { string a = 1; }', 'demo.v1', 'edition = "2023";'),
      proto('message A { string a = 1; }', 'demo.v1', 'edition = "2023";'),
    ),
    neg: P(proto('message A { string a = 1; }'), proto('message A { string a = 1; }')),
  },

  /* ============================== AsyncAPI ============================== */
  ASYNC_CHANNEL_REMOVED: {
    pos: pair(asy({ a: sub('pa'), b: sub('pb') }), asy({ a: sub('pa') })),
    neg: pair(asy({ a: sub('pa') }), asy({ a: sub('pa'), b: sub('pb') })),
  },
  ASYNC_CHANNEL_ADDED: {
    pos: pair(asy({ a: sub('pa') }), asy({ a: sub('pa'), b: sub('pb') })),
    neg: pair(asy({ a: sub('pa'), b: sub('pb') }), asy({ a: sub('pa') })),
  },
  ASYNC_OPERATION_REMOVED: {
    pos: pair(
      asy({ a: { ...sub('pa'), publish: { operationId: 'ca', message: msg() } } }),
      asy({ a: sub('pa') }),
    ),
    neg: pair(
      asy({ a: sub('pa') }),
      asy({ a: { ...sub('pa'), publish: { operationId: 'ca', message: msg() } } }),
    ),
  },
  ASYNC_OPERATION_ADDED: {
    pos: pair(
      asy({ a: sub('pa') }),
      asy({ a: { ...sub('pa'), publish: { operationId: 'ca', message: msg() } } }),
    ),
    neg: pair(
      asy({ a: { ...sub('pa'), publish: { operationId: 'ca', message: msg() } } }),
      asy({ a: sub('pa') }),
    ),
  },
  ASYNC_OPERATION_ACTION_CHANGED: {
    pos: pair(asy({ a: sub('op') }), asy({ a: { publish: { operationId: 'op', message: msg() } } })),
    neg: pair(asy({ a: sub('op') }), asy({ a: sub('op') })),
  },
  ASYNC_OPERATION_CHANNEL_CHANGED: {
    pos: pair(asy({ a: sub('op') }), asy({ b: sub('op') })),
    neg: pair(asy({ a: sub('op') }), asy({ a: sub('op'), b: sub('other') })),
  },
  ASYNC_MESSAGE_REMOVED: {
    pos: pair(
      asy({ a: sub('op', { oneOf: [msg(undefined, { name: 'A' }), msg(undefined, { name: 'B' })] }) }),
      asy({ a: sub('op', msg(undefined, { name: 'A' })) }),
    ),
    neg: pair(
      asy({ a: sub('op', msg(undefined, { name: 'A' })) }),
      asy({ a: sub('op', { oneOf: [msg(undefined, { name: 'A' }), msg(undefined, { name: 'B' })] }) }),
    ),
  },
  ASYNC_MESSAGE_ADDED: {
    pos: pair(
      asy({ a: sub('op', msg(undefined, { name: 'A' })) }),
      asy({ a: sub('op', { oneOf: [msg(undefined, { name: 'A' }), msg(undefined, { name: 'B' })] }) }),
    ),
    neg: pair(
      asy({ a: sub('op', { oneOf: [msg(undefined, { name: 'A' }), msg(undefined, { name: 'B' })] }) }),
      asy({ a: sub('op', msg(undefined, { name: 'A' })) }),
    ),
  },
  ASYNC_CONTENT_TYPE_CHANGED: {
    pos: pair(
      asy({ a: sub('op') }),
      asy({ a: sub('op', msg(undefined, { contentType: 'application/avro' })) }),
    ),
    neg: pair(asy({ a: sub('op') }), asy({ a: sub('op') })),
  },
  ASYNC_BINDINGS_CHANGED: {
    pos: pair(
      asy({ a: { ...sub('op'), bindings: { kafka: { partitions: 3 } } } }),
      asy({ a: { ...sub('op'), bindings: { kafka: { partitions: 6 } } } }),
    ),
    neg: pair(
      asy({ a: { ...sub('op'), bindings: { kafka: { partitions: 3 } } } }),
      asy({ a: { ...sub('op'), bindings: { kafka: { partitions: 3 } } } }),
    ),
  },
  ASYNC_SERVER_CHANGED: {
    pos: pair(
      asy({ a: sub('op') }, { servers: { prod: { url: 'a.example:9092', protocol: 'kafka' } } }),
      asy({ a: sub('op') }, { servers: { prod: { url: 'b.example:9092', protocol: 'kafka' } } }),
    ),
    neg: pair(
      asy({ a: sub('op') }, { servers: { prod: { url: 'a.example:9092', protocol: 'kafka' } } }),
      asy({ a: sub('op') }, { servers: { prod: { url: 'a.example:9092', protocol: 'kafka' } } }),
    ),
  },
};
