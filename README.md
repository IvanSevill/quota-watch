# claude-usage

**Dependency-free quota snapshots for Claude Code, Codex, and OpenCode agents.**

> Zero dependencies. Just Node.

## The problem

Claude Code knows your rate limits — the 5-hour session window and the 7-day weekly
window — but it exposes them in exactly **one** place: the JSON it pipes to your
**status line** command.

An agent running *inside* Claude Code can't read that. So it works blind: it has no idea
whether it has 90% of its budget left or is about to hit the wall mid-task.

## The fix

`claude-usage` tees that payload to a file the agent *can* read, and gives it a CLI to
ask a simple question: **how much do I have left?** It also collects Codex limits without
changing the established Claude CLI contract.

```
$ claude-usage
Claude Code quota
  session    ████████░░░░░░░░░░░░   41% left   resets in 3h 44m
  week       ██████████████████░░   90% left   resets in 6d 18h
```

```
$ claude-usage --json          # for the agent
{
  "ok": true,
  "stale": false,
  "session": { "used": 59, "left": 41, "resetsAt": 1783840000000, "resetsIn": 13440000 },
  "week":    { "used": 10, "left": 90, "resetsAt": 1784420000000, "resetsIn": 585000000 }
}
```

## Install

```sh
git clone https://github.com/IvanSevill/claude-usage.git
```

Then wire it into your Claude Code status line. It **passes stdin straight through**,
so it chains in front of whatever status line you already have:

```jsonc
// ~/.claude/settings.json
{
  "statusLine": {
    "type": "command",
    "command": "node \"/path/to/claude-usage/usage.mjs\" dump | sh ~/.claude/statusline-command.sh"
  }
}
```

No status line yet? Use this tool as one — it renders a compact usage bar:

```jsonc
{
  "statusLine": {
    "type": "command",
    "command": "node \"/path/to/claude-usage/usage.mjs\" statusline"
  }
}
```

The data lands in `~/.claude/usage.json` (override with `CLAUDE_USAGE_FILE`).

## CLI Usage

| Command | What it does |
|---|---|
| `usage.mjs` | Human-readable report |
| `usage.mjs --json` | Machine-readable — **this is what an agent calls** |
| `usage.mjs --schema` | Canonical provider-neutral Claude snapshot |
| `usage.mjs --provider codex --json` | Canonical Codex snapshot; app-server first, rollout fallback |
| `usage.mjs --provider codex --source app-server` | Use only Codex's official local app-server API |
| `usage.mjs --provider codex --source rollout` | Use only allow-listed rate-limit data in local rollouts |
| `usage.mjs --quiet --min 10` | No output; exits `1` if the tightest window is below 10% left |
| `usage.mjs dump` | Save stdin's rate limits, pass stdin through (for the status line) |
| `usage.mjs statusline` | Same, plus render a usage bar (use it *as* your status line) |

`--json` with the default Claude provider intentionally retains the original
`{ ok, ageSeconds, stale, session, week }` shape. Use `--schema` when a caller wants the
canonical `{ provider, status, limits, source, plan, credits, reached, errors }` shape.
Codex always uses the canonical shape. Canonical guard exits are `0` for usable, `1` for
exhausted/below `--min`, and `2` for unavailable, stale, or unknown data.

## Codex collection

`auto` starts `codex app-server`, performs the documented initialize handshake, and calls
`account/rateLimits/read`. This is the preferred, official local source and preserves every
limit ID plus plan, credit, spend-control, reset-credit, and reached metadata.

If unavailable, `auto` scans recent `~/.codex/sessions/**/rollout-*.jsonl` files. The
fallback accepts only `event_msg` / `token_count` records and extracts only `rate_limits`;
prompt text, raw responses, and unrelated events are never returned.

Successful snapshots are cached at `~/.claude/quota-cache.json` as last-known-good data.
Cache readings retain their original source and are marked stale after 15 minutes.

### What Codex exposes

The official `codex app-server` rateLimits endpoint returns structured data including:

- **Limit windows** with `primary`/`secondary` members, `durationMinutes`, `remainingPercent`, and `resetAt`
- **Plan type** (pro, plus, etc.)
- **Credit balance**, `hasCredits`, and `unlimited` flags
- **Spend control** with per-person limits and resets
- **Rate limit reset credits** with available counts
- **Reached status** (e.g. `rate_limit`, `spend_control`)

This metadata is preserved in the canonical snapshot schema and available through
`--schema` or `--json` output.

## OpenCode integrations

### Server tool plugin

`opencode/usage-metrics.mjs` is the canonical dependency-free OpenCode plugin. It exposes
the `usage_metrics` tool with separate `codex` quota and `context` occupancy objects.

It observes all matching quota-header families from the ChatGPT Codex responses endpoint,
including non-2xx responses, while using app-server then rollout collection when no headers
have been observed.

Install a loader under `~/.config/opencode/plugins`, using the clone's absolute path:

```js
export { default } from "file:///path/to/claude-usage/opencode/usage-metrics.mjs";
```

### Global TUI quota indicator

The TUI plugin renders compact, right-aligned Claude or Codex remaining-capacity bars in
OpenCode's global `app_bottom` slot.

**Each usable row contains:**
- Provider name (first row only; continuation rows align beneath)
- 13-cell colored bar (filled = remaining quota)
- Integer percentage
- Compact reset value

**What it looks like:**

```
Codex  █████████░░░░  72% 2h 15m
```

```
Claude ████████░░░░░  62% 2h 15m
       ███████████░░  85% 5d 8h
```

Window labels are intentionally omitted. Claude can show two aligned rows (session + weekly);
current Codex app-server data may show one unlabeled row. A leading `~` marks stale data;
unknown reset is `—`.

**Click-only control:** Left-click the visible control to switch providers. The global
selection persists across OpenCode restarts and defaults to Codex when no valid preference
exists. It does not require the server tool plugin.

**Install dependencies** (pinned, no lifecycle scripts):

```powershell
Set-Location "$HOME\.claude\tools\claude-usage\opencode\tui"
npm install --ignore-scripts
```

**Load the plugin** from global `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "opencode-subagent-statusline",
    "file:///C:/Users/ivans/.claude/tools/claude-usage/opencode/tui/codex-quota-indicator.tsx"
  ]
}
```

Quit and restart OpenCode after changing TUI configuration.

### TUI details

- **Claude and Codex refresh independently** in the background; switching is immediate
- A selected provider without usable rows shows `Claude — n/a` or `Codex — n/a`
- Claude freshness comes from the status-line usage file
- Codex uses the credential-free canonical collector (app-server → rollout → cache)
- **Recovery:** If an external plugin prevents launch, start with `$env:OPENCODE_PURE = "1"; opencode --auto`

## Guarding a long job

```sh
claude-usage --quiet --min 15 || { echo "Not enough quota; try after the reset."; exit 1; }
```

## Telling an agent about it

Put this in your `CLAUDE.md` so the model checks its own budget before committing to
long work:

> Before starting a long task, run `node /path/to/claude-usage/usage.mjs --json` to see
> how much quota is left. If `session.left` is low, prefer to finish and checkpoint
> rather than start something you can't complete.

## Canonical snapshot schema

The provider-neutral schema (via `--schema`) produces:

```jsonc
{
  "provider": "codex",
  "status": "available",
  "limits": {
    "codex": {
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

## Caveats

- The data is only as fresh as your **last status-line render**. If the machine slept,
  the file goes stale — the tool tells you (`stale: true`, and a warning in the report).
- `rate_limits` only appears for **Claude.ai subscribers** (Pro/Max) and only **after the
  first API response** in a session. Before that, there's simply nothing to report.
- Codex app-server behavior follows the installed Codex version. The rollout source is a
  local, best-effort fallback and is identified as unofficial in `source.official`.

## Privacy

The tool never reads API keys, browser cookies, tokens, or credential files.
- Claude data comes from the status-line usage file
- Codex app-server uses the already authenticated `codex` executable
- Codex rollout reads only allow-listed rate-limit events from local session files
- No network calls are made by the tool itself

## See also

[**promptheus**](https://github.com/IvanSevill/promptheus) — queue and schedule prompts for
Claude Code so they run unattended. It uses this tool to know when its quota comes back, so a
launch cut short by the limit is resumed instead of lost.

## Tests

```sh
npm test        # or: node --test test/*.test.mjs
```

The isolated TUI interaction suite runs with
`node --test opencode/tui/quota-control.test.mjs`. OpenTUI `0.4.3` does not expose its native
FFI to the installed Windows Node runtime, so this suite transpiles the real TSX entrypoint
and tests its fake-host lifecycle plus the minimally extracted control geometry, mouse
filtering, and theme-token state machine. Final frame composition remains a manual OpenCode
host check.

## License

MIT
