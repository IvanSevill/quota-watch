# quota-watch guide

Reference material for the [README](../README.md). Commands assume you are in the clone; replace `usage.mjs` with `quota-watch` if you installed it globally.

## CLI reference

| Command | What it does |
|---|---|
| `usage.mjs` | Human-readable Claude report |
| `usage.mjs --json` | Machine-readable Claude values |
| `usage.mjs --schema` | Canonical provider-neutral snapshot |
| `usage.mjs --provider codex --json` | Canonical Codex snapshot; app-server first, session-file fallback |
| `usage.mjs --provider codex --source app-server` | Use only Codex's local app-server API |
| `usage.mjs --provider codex --source rollout` | Use only allow-listed rate-limit data in local session files |
| `usage.mjs --provider codex --app-server-timeout-ms 15000` | Allow up to 15 seconds for the Codex app-server handshake |
| `usage.mjs remaining <claude\|codex>` | Stable remaining-quota result |
| `usage.mjs --quiet --min 10` | No output; exits `1` if the tightest Claude window is below 10% left |
| `usage.mjs dump` | Save stdin's rate limits, pass stdin through (for the status line) |
| `usage.mjs statusline` | Save stdin's rate limits and render a usage bar |

`remaining` also accepts `--json`, `--min <n>` (default `0`), `--no-cache`, `--source`, and `--app-server-timeout-ms`.

`--app-server-timeout-ms` accepts integers from `1000` to `60000` and defaults to `5000`. It changes only Codex app-server waits, not the session-file or cache fallback. `--source` and `--app-server-timeout-ms` apply only to Codex.

### Output shapes

- `--json` with the default Claude provider keeps the original `{ ok, ageSeconds, stale, session, week }` shape.
- `--schema` gives the canonical `{ provider, status, limits, source, plan, credits, reached, errors }` shape.
- Codex always uses the canonical shape.
- `remaining --json` gives `{ schemaVersion, provider, result, status, stale, thresholdPercent, minimumRemainingPercent, windows, reached, source, errorCodes }`.

### Exit codes

| Command | `0` | `1` | `2` | Other |
|---|---|---|---|---|
| `remaining` | usable | low or exhausted | unavailable, stale, or unknown | `64` bad arguments, `70` internal error |
| `--schema`, `--provider`, `--source` | usable | exhausted or below `--min` | unavailable, stale, unknown, or bad arguments | `64` invalid timeout |
| Plain report, `--json`, `--quiet` | at or above `--min` (default 10), **and also when data is missing or stale** | below `--min` | | |

The last row is the original Claude interface. It fails open, so prefer `remaining` for guards.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_USAGE_FILE` | `~/.claude/usage.json` | Status-line data file |
| `CLAUDE_USAGE_CACHE_FILE` | `<home>/quota-cache.json` | Last-known-good cache file |
| `CLAUDE_USAGE_HOME` | `~/.claude` | `<home>` for the cache |
| `CODEX_HOME` | `~/.codex` | Where Codex session files are read from |

## Provider collection

### Claude

Reads the usage file written by `dump` or `statusline` from the JSON Claude Code pipes to your status-line command. The `five_hour` window is reported as `session` and `seven_day` as `week`.

### Codex

`auto` starts `codex app-server`, performs the initialize handshake, and calls `account/rateLimits/read`. The snapshot keeps limit IDs plus plan, credit, spend-control, reset-credit, and reached metadata.

If that is unavailable, `auto` scans recent `~/.codex/sessions/**/rollout-*.jsonl` files. It accepts only `event_msg` / `token_count` records and extracts only `rate_limits`; prompt text, raw responses, and unrelated events are not returned.

Successful snapshots are cached at `~/.claude/quota-cache.json` as last-known-good data. Cache readings are labelled `cache:<source>` and are marked stale after 15 minutes.

### Gemini and OpenAI

Not implemented. The canonical schema does not depend on a specific provider, but `--provider` accepts only `claude` and `codex`.

## Canonical snapshot schema

An illustrative `--schema` result with sample values:

```jsonc
{
  "provider": "codex",
  "status": "available",
  "limits": {
    "codex": {
      "id": "codex",
      "primary": {
        "usedPercent": 28,
        "remainingPercent": 72,
        "durationMinutes": 10080,
        "resetAt": "2026-07-18T12:00:00.000Z"
      },
      "secondary": null
    }
  },
  "source": {
    "kind": "app-server",
    "official": true,
    "observedAt": "2026-07-16T10:30:00.000Z",
    "stale": false
  },
  "plan": "pro",
  "credits": {
    "balance": 500,
    "hasCredits": true,
    "unlimited": false,
    "spendControl": { "limit": 1000, "used": 500, "remainingPercent": 50 },
    "resetCredits": { "availableCount": 3 }
  },
  "reached": null,
  "errors": []
}
```

`source.official` is `false` for session files and for the Claude usage file.

## Telling an agent about it

Put this in your `CLAUDE.md` so the model checks its budget before committing to long work:

> Before starting a long task, run `node /path/to/quota-watch/usage.mjs remaining claude --json`. If `result` is not `ok` or `minimumRemainingPercent` is low, finish and checkpoint rather than start something you can't complete.

## OpenCode integrations

These target the OpenCode plugin API pinned in `opencode/tui/package.json` (`@opencode-ai/plugin` 1.18.2). Their tests use fake hosts; check them in a real OpenCode session.

### Server tool plugin

`opencode/usage-metrics.mjs` has no external dependencies and exposes a `usage_metrics` tool with separate `codex` quota and `context` occupancy objects.

It reads quota headers from ChatGPT Codex responses, including non-2xx responses, and falls back to app-server then session-file collection when no fresh headers have been observed. It does not inspect credentials or bodies.

Install a loader under `~/.config/opencode/plugins`, using the clone's absolute path:

```js
export { default } from "file:///path/to/quota-watch/opencode/usage-metrics.mjs";
```

### Project-scoped Python PATH

`opencode/project-python-path.mjs` is a configurable `shell.env` plugin for projects whose Python virtual environment must precede the global `PATH`. It is unrelated to quota reporting. The implementation stays in this repository; the global plugin file holds only the machine-specific mapping.

Create a loader such as `~/.config/opencode/plugins/quota-watch-python.js`:

```js
import { createProjectPythonPathPlugin } from "file:///C:/path/to/quota-watch/opencode/project-python-path.mjs";

export default createProjectPythonPathPlugin({
  projects: [
    { root: "C:\\path\\to\\python-project", pythonDirectory: "backend\\.venv\\Scripts" },
  ],
});
```

- A mapping applies only when OpenCode's shell working directory is the configured root or a descendant.
- `pythonDirectory` must be relative and stay inside that root.
- The plugin preserves the existing `PATH` key casing and does not add the directory twice.
- If OpenCode supplies no non-empty `PATH`, the plugin leaves the environment untouched.

### Global TUI quota indicator

The TUI plugin renders compact, right-aligned Claude or Codex remaining-capacity bars in OpenCode's global `app_bottom` slot. It does not require the server tool plugin.

```text
Codex  █████████░░░░  72% 2h 15m
```

```text
Claude ████████░░░░░  62% 2h 15m
       ███████████░░  85% 5d 8h
```

Each row has the provider name (first row only), a 13-cell bar where filled means remaining, an integer percentage, and a compact reset value.

- Window labels are intentionally omitted. Claude can show two rows (session and weekly); Codex may show one.
- A leading `~` marks stale data. An unknown reset shows `—`.
- A provider without usable rows shows `Claude — n/a` or `Codex — n/a`.
- Left-click the control to switch providers. The choice persists across restarts and defaults to Codex.
- Claude and Codex refresh independently in the background, so switching is immediate.

The Codex bar is the rate-limit percentage Codex exposes, not a remaining token count. The `usage_metrics` tool can estimate context occupancy separately, but that is not the quota shown here.

**Install dependencies** (pinned, no lifecycle scripts):

```sh
cd /path/to/quota-watch/opencode/tui
npm install --ignore-scripts
```

**Load the plugin** from the global `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "file:///path/to/quota-watch/opencode/tui/codex-quota-indicator.tsx"
  ]
}
```

Quit and restart OpenCode after changing TUI configuration or a global plugin loader.

**Recovery:** if an external plugin prevents launch, the previous documentation suggests starting with `OPENCODE_PURE=1 opencode --auto` (PowerShell: `$env:OPENCODE_PURE = "1"; opencode --auto`). This is OpenCode behaviour and is not checked by this repository.

## Caveats

- If the machine slept, the usage file goes stale. The report warns you and `--json` sets `stale: true`.
- `rate_limits` appears only after the first API response in a session. The previous documentation also says it appears only for Claude.ai subscribers (Pro/Max); nothing in this repository can confirm that.
- Codex app-server behaviour follows the installed Codex version. Session files are a local best-effort fallback, identified as unofficial in `source.official`.

## Tests

```sh
npm test        # or: node --test test/*.test.mjs
```

The TUI interaction suite is separate and needs the dependencies in `opencode/tui`:

```sh
node --test opencode/tui/quota-control.test.mjs
```

It transpiles the real TSX entrypoint and tests its fake-host lifecycle plus the extracted control geometry, mouse filtering, and theme-token state machine. Final frame composition remains a manual check in OpenCode. The previous documentation gives the reason as OpenTUI `0.4.3` not exposing its native FFI to the Windows Node runtime; that was not reproduced here.

## Demo

`docs/assets/demo.gif` is generated from `docs/demo.tape` with [vhs](https://github.com/charmbracelet/vhs). Run `vhs docs/demo.tape` from the repository root. The tape writes fictional data to a temp directory and points the data and cache variables there.

## Related

[kaiprompt](https://github.com/IvanSevill/kaiprompt) (formerly promptheus) is a local launch queue for coding agents that resumes jobs after quota limits.
