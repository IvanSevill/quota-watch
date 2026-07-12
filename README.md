# claude-usage

**Let an AI agent see how much Claude Code quota it has left.**

## The problem

Claude Code knows your rate limits — the 5-hour session window and the 7-day weekly
window — but it exposes them in exactly **one** place: the JSON it pipes to your
**status line** command.

An agent running *inside* Claude Code can't read that. So it works blind: it has no idea
whether it has 90% of its budget left or is about to hit the wall mid-task.

## The fix

`claude-usage` tees that payload to a file the agent *can* read, and gives it a CLI to
ask a simple question: **how much do I have left?**

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

Zero dependencies — just Node.

```sh
git clone https://github.com/IvanSevill/claude-usage.git
```

Then make your status line pipe through the dump. It **passes stdin straight through**,
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

## Usage

| Command | What it does |
|---|---|
| `usage.mjs` | Human-readable report |
| `usage.mjs --json` | Machine-readable — **this is what an agent calls** |
| `usage.mjs --quiet --min 10` | No output; exits `1` if the tightest window is below 10% left |
| `usage.mjs dump` | Save stdin's rate limits, pass stdin through (for the status line) |
| `usage.mjs statusline` | Same, plus render a usage bar (use it *as* your status line) |

### Guarding a long job

```sh
claude-usage --quiet --min 15 || { echo "Not enough quota; try after the reset."; exit 1; }
```

### Telling an agent about it

Put this in your `CLAUDE.md` so the model checks its own budget before committing to
long work:

> Before starting a long task, run `node /path/to/claude-usage/usage.mjs --json` to see
> how much quota is left. If `session.left` is low, prefer to finish and checkpoint
> rather than start something you can't complete.

## Caveats

- The data is only as fresh as your **last status-line render**. If the machine slept,
  the file goes stale — the tool tells you (`stale: true`, and a warning in the report).
- `rate_limits` only appears for **Claude.ai subscribers** (Pro/Max) and only **after the
  first API response** in a session. Before that, there's simply nothing to report.

## See also

[**promptheus**](https://github.com/IvanSevill/promptheus) — queue and schedule prompts for
Claude Code so they run unattended. It uses this tool to know when its quota comes back, so a
launch cut short by the limit is resumed instead of lost.

## Tests

```sh
npm test        # or: node --test test/*.test.mjs
```

## License

MIT
