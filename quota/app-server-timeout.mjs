export const DEFAULT_APP_SERVER_TIMEOUT_MS = 5000;

export function parseAppServerTimeoutMs(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw Object.assign(new TypeError('--app-server-timeout-ms must be an integer between 1000 and 60000'), {
      exitCode: 64,
    });
  }
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
    throw Object.assign(new TypeError('--app-server-timeout-ms must be an integer between 1000 and 60000'), {
      exitCode: 64,
    });
  }
  return timeoutMs;
}
