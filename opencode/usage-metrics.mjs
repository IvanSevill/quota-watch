import { collectCodexQuota, normalizeCodexRateLimits, quotaFromHeaders } from '../quota/index.mjs';
import { normalizeWindow, timestamp, withStaleness } from '../quota/schema.mjs';

const FETCH_STATE = Symbol.for('claude-usage.opencode.usage-metrics.fetch');
const SCAN_CACHE_MS = 60_000;

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const stamp = (value) => {
  const iso = timestamp(value);
  return iso === null ? null : Date.parse(iso);
};

export { normalizeWindow, quotaFromHeaders, timestamp };

export function isCodexResponsesURL(input) {
  try {
    const raw = typeof input === 'string' || input instanceof URL ? input : input?.url;
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com' && !url.port
      && url.pathname === '/backend-api/codex/responses';
  } catch { return false; }
}

export function installFetchObserver(target = globalThis) {
  let state = target[FETCH_STATE];
  if (state?.wrapper && target.fetch === state.wrapper) return state;
  if (typeof target.fetch !== 'function') return null;
  const original = target.fetch;
  state = { original, wrapper: null, latest: state?.latest ?? null };
  state.wrapper = async function claudeUsageFetch(...args) {
    const response = await original.apply(this, args);
    if (isCodexResponsesURL(args[0])) {
      const quota = quotaFromHeaders(response.headers, { status: response?.status });
      if (quota) state.latest = quota;
    }
    return response;
  };
  target[FETCH_STATE] = state;
  target.fetch = state.wrapper;
  return state;
}

export function quotaFromRateLimits(rateLimits, observedAt, now = Date.now()) {
  if (!rateLimits) return null;
  return normalizeCodexRateLimits({ rateLimits, observedAt }, { now });
}

export function rateLimitsFromEvent(event, now = Date.now()) {
  if (event?.type !== 'event_msg' || event?.payload?.type !== 'token_count') return null;
  return quotaFromRateLimits(event.payload.rate_limits ?? event.payload.rateLimits, event.timestamp ?? now, now);
}

export function createQuotaScanner({ cacheMs = SCAN_CACHE_MS, collect = collectCodexQuota, ...options } = {}) {
  let cache = { at: -Infinity, value: null };
  return async function scan(now = Date.now()) {
    if (now - cache.at < cacheMs) return cache.value;
    const value = await collect({ source: 'auto', now, ...options });
    cache = { at: now, value };
    return value;
  };
}

const defaultScan = createQuotaScanner();

function modelDetails(input, output) {
  const model = input?.model ?? output?.model ?? {};
  const provider = input?.provider ?? output?.provider ?? {};
  return {
    provider_id: model.providerID ?? model.provider_id ?? provider.id ?? input?.providerID ?? null,
    model_id: model.modelID ?? model.model_id ?? model.id ?? input?.modelID ?? null,
    context_limit: number(model.limit?.context ?? model.contextLimit ?? model.context_limit
      ?? output?.limit?.context ?? input?.contextLimit),
  };
}

export function contextSnapshot(session, message) {
  if (!session || !message) return null;
  const providerID = message.providerID ?? message.provider_id ?? message.provider?.id ?? null;
  const modelID = message.modelID ?? message.model_id ?? message.model?.id ?? null;
  if (session.provider_id && providerID && session.provider_id !== providerID) return null;
  if (session.model_id && modelID && session.model_id !== modelID) return null;
  const input = Math.max(0, number(message.tokens?.input) ?? 0);
  const output = Math.max(0, number(message.tokens?.output) ?? 0);
  const used = Math.max(0, input + output);
  const limit = Math.max(0, session.context_limit ?? 0);
  return {
    provider_id: session.provider_id,
    model_id: session.model_id,
    context_limit: limit || null,
    tokens: { input, output },
    occupancy: {
      tokens: used,
      percent: limit ? Math.min(100, Math.max(0, used / limit * 100)) : null,
      estimated: true,
      basis: 'tokens.input + tokens.output',
    },
    remaining_tokens: limit ? Math.max(0, limit - used) : null,
  };
}

function eventMessage(input) {
  const event = input?.event ?? input;
  if (event?.type !== 'message.updated') return null;
  return event.properties?.info ?? event.properties?.message ?? event.message ?? null;
}

export async function plugin(options = {}) {
  const fetchState = installFetchObserver(options.target ?? globalThis);
  const scan = options.scan ?? defaultScan;
  const sessions = new Map();
  const snapshots = new Map();
  let sequence = 0;
  return {
    'chat.params': async (input, output) => {
      const sessionID = input?.sessionID ?? input?.session_id;
      if (sessionID) sessions.set(sessionID, modelDetails(input, output));
    },
    event: async (input) => {
      const message = eventMessage(input);
      if (!message || message.role !== 'assistant') return;
      const sessionID = message.sessionID ?? message.session_id;
      const snapshot = contextSnapshot(sessions.get(sessionID), message);
      if (!snapshot) return;
      const messageID = message.id ?? `event-${sequence}`;
      const order = stamp(message.time?.created ?? message.createdAt ?? message.created_at) ?? ++sequence;
      let messages = snapshots.get(sessionID);
      if (!messages) snapshots.set(sessionID, messages = new Map());
      messages.set(messageID, { order, sequence: ++sequence, snapshot });
    },
    tool: {
      usage_metrics: {
        description: 'Show current Codex quota windows and OpenCode context occupancy.',
        args: {},
        execute: async (_args, context) => {
          const now = typeof options.now === 'function' ? options.now() : options.now ?? Date.now();
          const captured = fetchState?.latest
            ? withStaleness(fetchState.latest, { now, freshnessMs: options.freshnessMs })
            : null;
          const codex = captured && !captured.source.stale ? captured : await scan(now);
          const messages = snapshots.get(context?.sessionID);
          const latest = messages
            ? [...messages.values()].sort((a, b) => b.order - a.order || b.sequence - a.sequence)[0]
            : null;
          return JSON.stringify({ codex, context: latest?.snapshot ?? null }, null, 2);
        },
      },
    },
  };
}

export default plugin;
