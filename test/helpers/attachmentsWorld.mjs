/**
 * A household world for the B14 attachment suites: the B11 workspace world
 * (test/helpers/workspaceWorld.mjs: the real routes on the isolated route
 * harness, the real 0017 ledger and 0026 functions on PGlite) plus migration
 * 0028's REAL functions, called as the service role as PostgREST would, and a
 * fake Storage client in place of `supabaseAdmin.storage` (no network).
 *
 * The CLIENT is the frontend's own runtime and home adapter, compiled from
 * this tree, with a fetcher that hands a multipart body to the route exactly
 * as a browser would (its own boundary). What the screens then do is
 * test/helpers/frontendB11.mjs (the provider) and frontendB14.mjs (the upload
 * hook, report save and removal, observation and note photos).
 */
import { rpcError } from './routeHarness.mjs';
import { createWorld as createWorkspaceWorld } from './workspaceWorld.mjs';
import { loadFrontend } from '../frontend-test-loader.mjs';
import { homeWorkspace } from './frontendB11.mjs';

const { createProductionRuntime } = await loadFrontend('production/runtime');
const { createHomeAdapter } = await loadFrontend('production/adapters');

export const ON = Object.freeze({ HALO_FEATURE_WORKSPACE: 'on', HALO_FEATURE_ATTACHMENTS: 'on' });
export const BUCKET = 'household-attachments';

const asRpcError = (error) => rpcError(error?.code ?? '', error?.message ?? String(error), error?.detail ?? null, error?.hint ?? null);

/** Each 0028 function: its parameters in order, and the casts PostgREST would apply. */
const FUNCTIONS = Object.freeze({
  read_household_attachment: [['p_profile_id', 'uuid'], ['p_attachment_id', 'uuid']],
  household_attachment_usage: [['p_profile_id', 'uuid'], ['p_collection', 'text'], ['p_record_id', 'text']],
  check_attachment_references: [['p_profile_id', 'uuid'], ['p_collection', 'text'], ['p_record_id', 'text'], ['p_ids', 'text[]']],
  reserve_attachment_object: [['p_profile_id', 'uuid'], ['p_operation_id', 'uuid'], ['p_attachment_id', 'uuid']],
  commit_household_attachment: [['p_profile_id', 'uuid'], ['p_operation_id', 'uuid'], ['p_file', 'jsonb']],
  remove_household_attachment: [['p_profile_id', 'uuid'], ['p_operation_id', 'uuid'], ['p_attachment_id', 'uuid'], ['p_expected_revision', 'integer']],
  expire_staged_attachments: [['p_limit', 'integer']],
  due_attachment_objects: [['p_profile_id', 'uuid'], ['p_limit', 'integer']],
  forget_attachment_objects: [['p_paths', 'text[]']],
  attachment_privacy_counts: [['p_profile_id', 'uuid']],
});

/**
 * The Storage API's shape (`storage.from(bucket).upload|download|remove`),
 * in memory. `fail.upload|download|remove = true` makes that call answer an
 * error the way the Storage API does; `calls` lists every call.
 */
export function fakeStorage() {
  const objects = new Map();
  const calls = [];
  const fail = { upload: false, download: false, remove: false };
  const error = (status, message) => ({ data: null, error: { name: 'StorageApiError', statusCode: String(status), status, message } });
  return {
    objects, calls, fail,
    from(bucket) {
      return {
        async upload(path, body, options = {}) {
          calls.push({ op: 'upload', bucket, path, options });
          if (fail.upload) return error(500, 'Internal Server Error');
          const key = `${bucket}/${path}`;
          if (objects.has(key) && !options.upsert) return error(409, 'The resource already exists');
          objects.set(key, { bytes: Buffer.from(body), contentType: options.contentType });
          return { data: { path, id: crypto.randomUUID(), fullPath: key }, error: null };
        },
        async download(path) {
          calls.push({ op: 'download', bucket, path });
          if (fail.download) return error(500, 'Internal Server Error');
          const found = objects.get(`${bucket}/${path}`);
          if (!found) return error(404, 'Object not found');
          return { data: new Blob([found.bytes], { type: found.contentType }), error: null };
        },
        async remove(paths) {
          calls.push({ op: 'remove', bucket, paths: [...paths] });
          if (fail.remove) return error(500, 'Internal Server Error');
          const removed = paths.filter((path) => objects.delete(`${bucket}/${path}`));
          return { data: removed.map((name) => ({ name })), error: null };
        },
      };
    },
  };
}

/** Registers the 0028 functions on the harness's fake client, against PGlite. */
export function registerAttachmentFunctions(h, db, { wrap = {} } = {}) {
  for (const [name, params] of Object.entries(FUNCTIONS)) {
    const call = async (args) => {
      const sql = `select public.${name}(${params.map(([, type], at) => `$${at + 1}::${type}`).join(', ')}) as result`;
      const values = params.map(([param, type]) => (type === 'jsonb' ? JSON.stringify(args[param]) : args[param]));
      try {
        return await db.asService(async (tx) => (await tx.query(sql, values)).rows[0].result, { commit: true });
      } catch (error) {
        throw asRpcError(error);
      }
    };
    h.db.registerRpc(name, (args) => (wrap[name] ? wrap[name](args, () => call(args)) : call(args)), { args: params.map(([param]) => param) });
  }
}

export async function createWorld(db, { env = ON, migrated = true, wrap = {}, ...options } = {}) {
  const w = await createWorkspaceWorld(db, { env, ...options });
  const storage = fakeStorage();
  w.h.db.storage = storage;
  if (migrated) registerAttachmentFunctions(w.h, db, { wrap });

  /** The frontend's own runtime; a FormData body travels as the browser would send it. */
  function runtime(who = 'alice', { lose = () => false, env: callEnv } = {}) {
    const fetcher = async (path, init) => {
      const url = new URL(path, 'http://halo.test');
      const headers = { ...init.headers };
      let rawBody = init.body;
      if (typeof FormData !== 'undefined' && rawBody instanceof FormData) {
        const encoded = new Request('http://halo.test/encode', { method: 'POST', body: rawBody });
        headers['content-type'] = encoded.headers.get('content-type');
        rawBody = Buffer.from(await encoded.arrayBuffer());
      }
      const response = await w.h.call(url.pathname, init.method, { as: who, url: `${url.pathname}${url.search}`, headers, rawBody, env: callEnv });
      if (lose(url.pathname, init)) throw new TypeError('fetch failed');
      return response;
    };
    return createProductionRuntime({
      identityId: w.ids[who],
      homeContextId: w.home[who],
      contextRevision: 1,
      credential: async () => ({ identityId: w.ids[who], accessToken: w.h.identities[who].token }),
      fetcher,
    });
  }

  return Object.assign(w, {
    storage,
    adapter(who = 'alice', options2 = {}) {
      return createHomeAdapter(runtime(who, options2), { currentHomeId: w.home[who], homes: [{ id: w.home[who], label: 'Current home', state: 'current', revision: 1 }] });
    },
    workspace(who = 'alice', options2 = {}) {
      return homeWorkspace(w.adapter(who, options2));
    },
    /** A multipart upload sent straight to the route, for wire-level checks. */
    async upload(fields, { as = 'alice', key = fields.operationId, headers = {}, env: callEnv } = {}) {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) {
        if (name === 'file') form.set('file', value.blob, value.name);
        else if (name !== 'operationId' || value !== undefined) form.set(name, value);
      }
      const encoded = new Request('http://halo.test/encode', { method: 'POST', body: form });
      return w.h.call('/api/attachments', 'POST', {
        as,
        rawBody: Buffer.from(await encoded.arrayBuffer()),
        headers: { 'content-type': encoded.headers.get('content-type'), ...(key ? { 'idempotency-key': key } : {}), ...headers },
        env: callEnv,
      });
    },
    inspect: (id, { as = 'alice', env: callEnv } = {}) => w.h.call('/api/attachments/inspect', 'GET', { as, url: `/api/attachments/inspect?id=${encodeURIComponent(id)}`, env: callEnv }),
    download: (id, revision, { as = 'alice', env: callEnv } = {}) =>
      w.h.call('/api/attachments/download', 'GET', { as, url: `/api/attachments/download?id=${encodeURIComponent(id)}&revision=${revision}`, env: callEnv }),
    remove(body, { as = 'alice', key = body?.operationId, headers = {}, env: callEnv } = {}) {
      return w.h.call('/api/attachments/remove', 'POST', {
        as,
        rawBody: JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}), ...headers },
        env: callEnv,
      });
    },
    reconcileFiles: (operationId, { as = 'alice', env: callEnv } = {}) =>
      w.h.call('/api/operations', 'GET', { as, url: `/api/operations?operationId=${operationId}&domain=attachments`, env: callEnv }),
    /** The household's file rows, as 0028 holds them. */
    async files(who = 'alice') {
      return (await db.query(
        `select attachment_id::text as id, collection, record_id, revision, name, mime, bytes, linked, object_path
           from public.household_attachments where profile_id = $1 order by created_at, attachment_id`, [w.ids[who] ?? who])).rows;
    },
    /** This world's queued object paths (the queue has no owner column; its paths start with one). */
    async queued() {
      const prefixes = Object.values(w.ids).map((id) => `${id}/`);
      return (await db.query('select object_path from public.attachment_object_sweep order by object_path')).rows
        .map((row) => row.object_path).filter((objectPath) => prefixes.some((prefix) => objectPath.startsWith(prefix)));
    },
    /** The stored object for a file, or undefined. */
    object: (file) => storage.objects.get(`${BUCKET}/${file.object_path}`),
  });
}
