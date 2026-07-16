# Implement Compact OpenCode Quota Bars

## Executive Summary

Replace the current text-heavy Claude/Codex quota reading with a compact, right-aligned, click-only control in the existing global `app_bottom` slot. Each usable quota window becomes one row containing the provider name on the first row only, a 13-cell bar whose filled cells represent remaining quota, an integer percentage, and a compact reset value. Remove the complete `Ctrl+Shift+Q` command path.

This is a visual and interaction refinement of the installed OpenCode `1.18.2` TUI plugin. Preserve the plugin path and ID, global persisted provider selection, independent Claude/Codex refresh, canonical source metadata, collector safety boundaries, startup isolation, pinned dependencies, and global `tui.json`.

## Exact Visual Contract

### Fresh Codex, Current Live Shape

Current verified Codex app-server data exposes one current window with `durationMinutes: 10080` (7 days), not a monthly window. With 72% remaining and reset in 2 hours 15 minutes, render exactly this visible text structure:

```text
Codex  █████████░░░░  72% 2h 15m
```

There are 9 filled cells because `roundHalfUp(13 * 0.72) = 9`. The duration is used only for deterministic classification and ordering; `7d`, `weekly`, `monthly`, and `session` are not shown. Never call this current Codex window monthly and never infer user-facing copy from its duration.

### Fresh Claude, Normal Two-Window Shape

With `five_hour` at 62% remaining/reset in 2 hours 15 minutes and `seven_day` at 85% remaining/reset in 5 days 8 hours, render:

```text
Claude ████████░░░░░  62% 2h 15m
       ███████████░░  85% 5d 8h
```

The first bar is `five_hour`; the second is `seven_day`. The seven leading spaces on the continuation row equal the fixed six-cell provider column plus one separator cell, so both bars start at the same horizontal coordinate. Neither semantic ID is visible.

### Stale, Unknown, Past, and Unavailable Examples

```text
Claude ████████░░░░░  62% ~2h 15m
       ███████████░░  85% ~5d 8h

Codex  █████████░░░░  72% —

Codex  █████████░░░░  72% now

Claude — n/a
Codex — n/a
```

`~` prefixes a known stale reset token, including `~now`. An unknown reset remains exactly `—` because there is no duration to qualify. Do not append stale age or any stale word.

### Forbidden Visible Copy

The TUI control must not render any of these words or labels in any state:

- `5h`, `7d`, `30d`, `monthly`, `weekly`, or `session` as window labels.
- `quota`, `left`, or `resets in`.
- Semantic IDs such as `five_hour`, `seven_day`, limit IDs, `primary`, or `secondary`.
- `loading`, `unavailable`, `stale`, observed age, collector errors, source names, plan names, or shortcut hints.

When no usable row exists, including initial loading and unavailable/error snapshots, the exact visible fallback is `<Provider> — n/a`.

## Acceptance Criteria

- The existing global `app_bottom` registration remains full width and right aligned.
- Exactly one selected provider is visible at a time; the complete visible content is one content-width click target.
- A complete left-button press and release on that visible target toggles provider exactly once and persists the next provider globally.
- Right-click, middle-click, wheel events, hover, focus, mouse-down alone, and a left press followed by pointer exit do not toggle.
- No keyboard path toggles provider. `Ctrl+Shift+Q`, its command, keymap layer, layer disposer, tests, and README mention are removed.
- No `Enter`, `Space`, broad key listener, or replacement shortcut is added.
- Every usable row contains, in order: provider column, one separator, exactly 13 bar cells, one separator, a right-aligned integer percent column, one separator, and compact reset text.
- The provider label appears on the first rendered row only. Continuation rows align beneath the first bar.
- Filled bar cells represent remaining quota; empty cells represent consumed/unavailable capacity.
- Claude renders recognized usable windows by semantic ID, ordered `five_hour` then `seven_day`, independently of object order.
- With both standard Claude windows usable, exactly two rows render. If only one is usable, render that row honestly as the first visible row; if neither is usable, render `<Provider> — n/a`.
- Claude ignores unrelated/unknown limit IDs in this compact view rather than inventing semantics or extra rows.
- Current Codex live data renders exactly one row for the one app-server window. The verified `10080`-minute window is not described as monthly.
- Future Codex windows render generically without visible labels, ordered from payload duration and deterministic tie-breakers rather than object order.
- Percentages are clamped to `[0, 100]`, displayed as rounded integers, and converted to filled cells with the specified half-up algorithm.
- First/session bars use the exact green-to-red ramp. Claude's second/weekly bar and Codex's second and later generic bars use the exact existing blue-purple-to-red ramp.
- Empty cells use `theme.current.textMuted`; no hardcoded empty-cell RGB is introduced.
- Stale usable data retains bars and percentages and prefixes known reset text with `~`; no additional stale copy appears.
- Past reset timestamps render `now`; unknown/invalid/missing reset timestamps render `—`.
- No usable data renders exactly `Claude — n/a` or `Codex — n/a`.
- Provider selection hydration, validation, Codex default, global KV key, immediate writes, and write-failure isolation remain unchanged.
- Claude and Codex retain separate scanners, signals, in-flight guards, initial refreshes, and timers.
- Collector failures remain provider-scoped; neither collector blocks startup or the other provider.
- Canonical `source.kind`, `source.official`, `source.observedAt`, and `source.stale` remain authoritative and are not rewritten by presentation code.
- The plugin remains target-exclusive with ID `claude-usage.codex-quota` at `opencode/tui/codex-quota-indicator.tsx`.
- `C:\Users\ivans\.config\opencode\tui.json` remains byte-for-byte unchanged.
- No package, dependency, lockfile, or version changes occur.

## Verified Baseline

- OpenCode/plugin SDK: `1.18.2`.
- OpenTUI core/Solid/keymap: `0.4.3`; Solid: `1.9.12`.
- Current global entrypoint: `file:///C:/Users/ivans/.claude/tools/claude-usage/opencode/tui/codex-quota-indicator.tsx`.
- Current plugin already has global KV selection, dual independent refresh, right-aligned `app_bottom` geometry, click filtering, hover/focus/pressed styling, and startup/disposal isolation.
- Current display formatting is a single string with textual window labels, `quota`, `left`, `resets in`, stale age, and severity tone. That presentation contract is replaced.
- Current keyboard behavior is implemented by one `api.keymap.registerLayer(...)` call and one returned disposer. Both are removed completely.
- Canonical Claude windows retain semantic IDs as `limits.five_hour.primary` and `limits.seven_day.primary`.
- Canonical Codex windows are normalized under arbitrary limit IDs with `primary`/`secondary`, `durationMinutes`, `remainingPercent`, and `resetAt`.
- The authoritative shell statusline uses 13 cells, remaining-capacity fill, half-up segment rounding, and one flat RGB color per filled portion based on total usage.

## Architecture

### Boundaries

1. **Canonical collectors remain unchanged.** `collectClaudeQuota()` and `collectCodexQuota()` continue producing provider-neutral canonical snapshots with honest source metadata.
2. **Pure presentation becomes row-based.** `opencode/quota-display.mjs` classifies provider windows, orders them deterministically, computes compact reset text, percentage text, fill count, and gradient role without importing Solid or OpenTUI.
3. **The TUI renders styled spans.** A pure `quotaBarRgb(gradient, remainingPercent)` helper returns the authoritative RGB tuple; the TSX plugin converts it with `RGBA.fromInts(r, g, b, 255)` and renders provider text, 13 bar cells, percent text, and reset text. Theme-muted empty cells remain a renderer concern.
4. **Selection remains click-only and global.** Existing KV hydration and persistence stay in the TUI. The mouse interaction helper remains the sole activation path.
5. **Refresh remains dual and independent.** Existing provider runtimes, per-provider overlap guards, two initial scans, two intervals, and late-result suppression remain intact.

### Data Flow

```text
canonical Claude snapshot
  -> select limits.five_hour.primary and limits.seven_day.primary by semantic ID
  -> omit unusable recognized rows
  -> fixed semantic order: five_hour, seven_day

canonical Codex snapshot
  -> flatten usable primary/secondary windows from every payload limit ID
  -> sort by finite duration, then limit ID, then window name
  -> current payload: one 10080-minute row
  -> future payload: one row per usable window without labels

ordered usable windows + canonical source.stale
  -> QuotaDisplayModel.rows[]
  -> app_bottom content-width vertical control
  -> provider text only on rows[0]
  -> colored filled cells + muted empty cells + integer percent + reset token

left press/release inside control
  -> toggleSelectedProvider()
  -> synchronous signal update
  -> global api.kv.set("claude-usage.quota.selected-provider.v1", next)

plugin disposal
  -> disposed = true
  -> clear both provider intervals
  -> ignore late collector results
```

There is no keymap registration or keymap disposal branch in the resulting flow.

## Display Data Model

Replace text/tone-centric output with renderer-ready semantic rows:

```ts
type QuotaProvider = 'claude' | 'codex';
type QuotaGradient = 'green-red' | 'blue-red';

type QuotaDisplayRow = {
  remainingPercent: number; // finite and clamped to [0, 100]
  percentText: string;      // rounded integer, including "%"
  filledCells: number;      // integer from 0 through 13
  resetText: string;        // compact duration, "~...", "now", "~now", or "—"
  gradient: QuotaGradient;
};

type QuotaDisplayModel = {
  provider: QuotaProvider;
  state: 'loading' | 'fresh' | 'stale' | 'unavailable';
  rows: QuotaDisplayRow[];
};
```

Remove `QuotaDisplayTone` and `text`. The canonical snapshot declarations remain provider-neutral and keep `source.stale`/`source.observedAt`; presentation no longer exposes observed age. Loading and unavailable models have `rows: []`, allowing one renderer fallback without synthetic percentages.

### Model Invariants

- `provider` is validated as exactly `claude` or `codex`.
- Every row has a finite clamped percentage, exactly one gradient role, `0..13` filled cells, and non-empty reset text.
- `state === 'fresh'` or `'stale'` only when `rows.length > 0`.
- `state === 'loading'` or `'unavailable'` has `rows.length === 0`.
- Selection changes never mutate rows or trigger collection.
- Unknown percentages do not become `0`; their windows are omitted.
- Snapshot source metadata is read to determine stale state but never modified or replaced.

## Window Classification and Ordering

### Claude

Use semantic IDs, never object order and never duration guesses:

```text
limits.five_hour.primary -> green-red
limits.seven_day.primary -> blue-red
```

Evaluate those IDs in that fixed order. A recognized window is usable only when it exists and has a finite `remainingPercent`. Ignore `secondary` under these IDs and ignore every unrelated Claude limit ID for this compact two-semantic-window contract. Missing recognized rows degrade independently.

### Codex

Flatten all payload `limits` entries and each `primary`/`secondary` member with a finite `remainingPercent`. Sort with these keys:

1. Windows with a finite positive `durationMinutes` before unknown durations.
2. Ascending `durationMinutes`.
3. Sanitized `limitId` ascending.
4. `windowName` ascending, with `primary` before `secondary`.

Assign `green-red` to sorted row index `0`; assign `blue-red` to row indexes `1+`. This preserves the approved first/second visual roles without claiming semantic names for Codex. Duration is classification metadata only and never appears as copy. Do not special-case `43200` as monthly or map any duration to visible text.

## Bar and Color Algorithms

### Percentage and Segment Rounding

For each finite raw remaining percentage:

```text
remaining = clamp(rawRemaining, 0, 100)
percentText = Math.round(remaining) + "%"
filledCells = Math.floor((remaining / 100) * 13 + 0.5)
emptyCells = 13 - filledCells
```

This is explicit round-half-up for non-negative segment counts and reproduces `int(rem/100*seg + 0.5)` from the authoritative shell script. Do not derive `filledCells` from the already rounded integer percentage. Render `filledCells` copies of `█` followed by `emptyCells` copies of `░`; the sequence is always exactly 13 terminal cells.

Required segment examples:

| Remaining | Filled | Empty |
|---:|---:|---:|
| `0` | `0` | `13` |
| `3.84` | `0` | `13` |
| `50` | `7` | `6` |
| `72` | `9` | `4` |
| `100` | `13` | `0` |

### Filled-Cell Color

Compute one RGB value per row from the unrounded clamped remaining percentage. All filled cells in that row use that color. Let:

```text
usage = 1 - remaining / 100
```

For `green-red` (Claude `five_hour`, Claude's first semantic bar, and Codex's first sorted bar):

```text
R = floor(220 * usage)
G = floor(255 * (1 - usage))
B = floor(80 * (1 - usage))
```

Endpoints are exactly remaining 100% = `(0,255,80)` and remaining 0% = `(220,0,0)`.

For `blue-red` (Claude `seven_day` and Codex's second/later sorted bars):

```text
R = floor(30 + 190 * usage)
G = floor(90 * (1 - usage))
B = floor(230 * (1 - usage))
```

Endpoints are exactly remaining 100% = `(30,90,230)` and remaining 0% = `(220,0,0)`. Preserve this established saturated blue-purple start exactly; do not shift it toward a different purple because the approved wording permits the existing ramp.

Export the interpolation as the pure `quotaBarRgb(gradient, remainingPercent)` helper returning `[r, g, b]`. In TSX, use the verified OpenTUI `RGBA.fromInts(r, g, b, 255)` constructor exported by `@opentui/core`. Do not emit ANSI escape strings. Empty `░` cells use `api.theme.current.textMuted`. Provider, percent, reset, and unavailable text use `api.theme.current.text` except interaction backgrounds, which remain theme-token based. Stale rows keep the same value-derived bar color; `~` is the non-color stale signal.

## Reset Formatting

Normalize `resetAt` as the current formatter does: accept finite epoch milliseconds or parseable timestamp strings. Then:

- Invalid, missing, or unparseable: `—`.
- `resetAt <= now`: `now`.
- Future difference under one minute: `<1m`.
- Future difference under one day: floor to total minutes, render `Hh Mm`, omitting zero units (`2h 15m`, `2h`, `15m`).
- Future difference of at least one day: floor to total minutes, render `Dd Hh`, omitting zero hours and all remaining minutes (`5d 8h`, `5d`).
- Stale usable snapshot: prefix a known token with `~` (`~2h 15m`, `~now`, `~<1m`). Unknown remains `—`.

Do not render absolute timestamps, seconds, commas, parentheses, reset labels, or observed age.

## Layout Geometry

Keep the existing full-width outer slot row:

```ts
{ width: '100%', flexDirection: 'row', justifyContent: 'flex-end' }
```

The inner interactive control remains `width: 'auto'` and focusable, but becomes a vertical box containing one horizontal box per display row. Attach all mouse/focus handlers only to this inner control.

Each usable row has these terminal columns:

| Region | Width | Rule |
|---|---:|---|
| Provider | `6` | `Claude`; `Codex` padded right by one; continuation is six spaces |
| Separator | `1` | one space |
| Bar | `13` | exactly 13 `█`/`░` cells |
| Separator | `1` | one space |
| Percent | `4` | right aligned: `  7%`, ` 72%`, `100%` |
| Separator | `1` | one space |
| Reset | variable | compact token only |

The fixed prefix through the percent column is 25 cells; reset text begins at column offset 25. The control width is the longest rendered row. The outer row right-aligns that control as a unit; every inner row starts at control-relative column zero, so continuation bars align even when reset strings differ. The unavailable form is a single unpadded text row (`Claude — n/a` or `Codex — n/a`).

At narrow terminal widths, preserve the same row model and let OpenTUI clip at the outer boundary. Do not remove semantic data selectively, wrap one logical quota row into multiple rows, or enlarge the click target to the full terminal width.

## Interaction and Persistence

Retain the existing mouse state machine and styling precedence:

- Pressed: `theme.current.backgroundMenu`.
- Focused: `theme.current.backgroundPanel`.
- Hovered: `theme.current.backgroundElement`.
- Idle: no forced background.
- Toggle only after left `MouseButton.LEFT` down and left up on the control.
- Clear pressed state on pointer exit and every mouse-up.

Retain the versioned global KV key `claude-usage.quota.selected-provider.v1`, exact-value validation, default to Codex, invalid-value normalization, immediate signal update before KV write, and isolation of KV read/write failures.

Delete the `api.keymap.registerLayer(...)` call. Do not retain an empty layer, command declaration, binding, keyboard handler, or unregister callback.

## Refresh and Lifecycle Preservation

- Keep `REFRESH_MS = 60_000` and existing scanner cache behavior.
- Keep one Claude scanner using `collectClaudeQuota()` and one Codex scanner using the default canonical collector.
- Start both initial refreshes without awaiting either.
- Keep one in-flight guard and one interval per provider.
- A provider refresh writes only its own display signal.
- A provider rejection publishes that provider's rowless unavailable model only.
- Selection never launches or waits for a refresh.
- Disposal still sets `disposed`, clears both intervals, and suppresses late publications.
- Disposal no longer invokes a keymap disposer because no layer is registered.

## File-by-File Changes

### `opencode/quota-display.mjs` - Modify

- Remove textual duration labels, label disambiguation, observed-age copy, severity tone calculation, and string assembly.
- Keep provider validation, selection defaulting, toggle logic, finite-number handling, identifier sanitization, and deterministic generic flattening where still useful.
- Add pure helpers for clamping, integer percent text, half-up 13-cell count, compact reset token, stale reset prefix, Claude semantic selection, and Codex payload ordering.
- Export `quotaBarRgb()` with the exact floor-based interpolation formulas so color behavior is directly unit tested without OpenTUI.
- Make `loadingQuotaDisplay`, `unavailableQuotaDisplay`, and `quotaDisplay` return the row-based model.
- Ensure Claude classification uses exact IDs and Codex classification uses payload windows/durations.
- Export only helpers required by tests or TSX; avoid a new general formatting subsystem.

### `opencode/quota-display.d.mts` - Modify

- Add `QuotaGradient` and `QuotaDisplayRow`.
- Replace `text` and `tone` on `QuotaDisplayModel` with `rows`.
- Update `formatReset` to return a visible token rather than nullable label text.
- Declare `quotaBarRgb(gradient, remainingPercent): [number, number, number]`.
- Keep canonical window/snapshot declarations and provider helper signatures aligned with runtime exports.

### `opencode/tui/codex-quota-indicator.tsx` - Modify

- Preserve the path, default export, plugin ID, global KV behavior, dual runtimes, refresh code, slot order, and startup isolation.
- Import the verified OpenTUI RGB constructor and render bar sections as styled spans inside one `<text>` per row, or the smallest equivalent supported by OpenTUI Solid `0.4.3`.
- Replace `display().text` and tone-to-theme mapping with row rendering.
- Render provider label only for row index zero; pad the six-cell provider column and four-cell percentage column exactly.
- Render rowless models as `<Provider> — n/a`.
- Keep the inner content-width control and all current mouse/focus handlers.
- Remove `api.keymap.registerLayer(...)`, command/binding definitions, `unregisterKeymap`, and its disposal call.

### `opencode/tui/quota-control.mjs` - Unchanged

- Keep click filtering and interaction styling unchanged.
- Keep full-width right-aligned outer layout and content-width focusable control.
- Define the fixed provider/bar/percent widths locally in the TSX renderer; do not move quota classification, formatting, or color logic into this interaction helper.

### `test/opencode-quota-indicator.test.mjs` - Modify

- Replace text/tone assertions with exact row-model assertions.
- Add exact Claude semantic-ID ordering tests with reversed object insertion order.
- Add Codex current one-window `10080`-minute test proving one generic row and no monthly inference.
- Add future multi-window Codex ordering tests using shuffled limit IDs, primary/secondary windows, known and unknown durations.
- Add half-up segment boundary, clamping, integer percentage, reset formatting, stale prefix, unavailable, partial Claude, unknown percentage, and secret-field regressions.
- Add exact `quotaBarRgb()` endpoint and midpoint tests for both gradients.

### `opencode/tui/quota-control.test.mjs` - Modify

- Remove the fake `api.keymap`, captured layer, command execution, keybinding assertions, and unregister count assertions.
- Toggle through the real mouse interaction path in persistence and refresh-isolation tests.
- Assert initialization never calls `api.keymap.registerLayer`; preferably omit `keymap` from the fake API so accidental registration fails immediately.
- Keep KV hydration/default/write-failure tests, dual refresh concurrency, overlap isolation, disposal, geometry, left-only activation, and theme interaction tests.
- Add render-model or transpiled TSX assertions for exact row spacing, 13 cells, provider-on-first-row behavior, continuation indentation, muted empty cells, and the two RGB ramps without introducing native FFI or dependencies.

### `README.md` - Modify

- Update only the global TUI quota indicator section to describe compact remaining-quota bars and click-only switching.
- Remove the `Ctrl+Shift+Q` mention completely; do not advertise another keyboard path.
- State that window labels are intentionally omitted, Claude can show two rows, and current Codex app-server data may show one row without assigning it a monthly label.
- Document `Provider — n/a` and `~` stale reset notation concisely.
- Preserve install commands, global `tui.json` example, pinned-dependency context, persistence, independent refresh, privacy/source boundaries, restart guidance, and `OPENCODE_PURE=1` recovery.
- Do not rewrite CLI examples outside the OpenCode TUI section; their textual CLI contract is not this refinement's scope.

### Explicitly Unchanged

- `C:\Users\ivans\.config\opencode\tui.json`.
- `opencode/tui/package.json`, `package-lock.json`, and `tsconfig.json`.
- `opencode/usage-metrics.mjs` and all canonical collector/cache/schema modules.
- Root CLI behavior in `usage.mjs` and its tests.
- OpenCode source, global packages, authentication, credentials, and unrelated plugins.

## Removal Scope

Delete all runtime and documentation traces of the keyboard toggle:

- The `api.keymap.registerLayer(...)` block.
- Command name `claude-usage.quota.toggle-provider` and its description.
- `{ name: 'q', ctrl: true, shift: true }` binding.
- `unregisterKeymap` variable and disposal invocation.
- Fake keymap layer, command invocation, and disposer counters in TUI tests.
- Assertions covering exact `Ctrl+Shift+Q`, Enter/Space non-binding, and command disposal.
- `Ctrl+Shift+Q` wording in `README.md`.

Keep `toggleQuotaProvider()` and `toggleSelectedProvider()` because the visible click control still needs them. Keep lifecycle disposal for timers and late-result suppression.

## Edge Cases

| Scenario | Required result |
|---|---|
| KV absent, invalid, unreadable | Select Codex; startup continues; normalize invalid stored value when possible. |
| KV write fails after click | Keep immediate in-process selection; do not roll back UI. |
| Initial scan pending | Selected provider shows `<Provider> — n/a`; other provider still scans independently. |
| Claude has both semantic IDs in reverse object order | Render `five_hour`, then `seven_day`. |
| Claude has only `seven_day` | Render one first row labeled `Claude`, using blue-red gradient. |
| Claude has only unknown IDs | Render `Claude — n/a`. |
| Claude recognized window lacks finite remaining percent | Omit that row; never fabricate `0%`. |
| Codex current `10080`-minute window | Render one unlabeled green-red row. |
| Codex gains extra windows | Sort by duration/tie-breakers and render all usable rows; first green-red, later blue-red. |
| Codex windows have equal/unknown durations | Deterministic limit-ID/window-name tie-breakers; never object order. |
| Remaining below 0 or above 100 | Clamp before display, fill count, and color interpolation. |
| Fractional percentage | Preserve raw value for cells/color; display `Math.round` integer. |
| Reset elapsed | `now`; stale elapsed is `~now`. |
| Reset unknown/invalid | `—`, including stale snapshots. |
| Future reset under one minute | `<1m`; stale is `~<1m`. |
| Stale snapshot with usable rows | Preserve values/colors and prefix known reset tokens with `~`. |
| Stale snapshot without usable rows | `<Provider> — n/a`; no stale word or age. |
| One collector hangs/fails | Other collector, provider switching, and host remain responsive. |
| Both collectors fail | Selected provider remains selected and shows n/a. |
| Refresh tick overlaps same provider | Skip only that provider's tick. |
| Plugin disposed during scan | Clear both intervals and ignore late result; no keymap disposal exists. |
| Left press exits control before release | Clear pressed state; no toggle. |
| Right/middle/wheel input | No toggle or KV write. |
| Keyboard input including `Ctrl+Shift+Q` | No provider change; host behavior is untouched. |
| Narrow terminal | Outer right alignment and content target remain; renderer clipping does not alter model semantics. |

## Test Plan

### Pure Display Tests

- Claude exact semantic selection and fixed order independent of insertion order.
- Claude partial recognized data, unknown IDs, unknown percentages, and no-usable fallback.
- Codex one live-style `10080`-minute window with no monthly/window-label field in output.
- Codex generic extra-window ordering by duration, limit ID, and primary/secondary tie-breaker.
- Percentage clamp and integer display at negative, fractional, midpoint, and over-100 inputs.
- Segment half-up boundaries and exact 13-cell totals, including `0`, `50`, `72`, and `100`.
- Reset output for `2h 15m`, `5d 8h`, `<1m`, `now`, and `—`.
- Stale output for `~2h 15m`, `~5d 8h`, `~now`, and unknown `—`.
- Rowless loading/unavailable/error snapshots.
- Secret-bearing unrelated fields remain absent from display models.

### Color Tests

- Green-red endpoints: remaining `100 -> (0,255,80)`, remaining `0 -> (220,0,0)`.
- Blue-red endpoints: remaining `100 -> (30,90,230)`, remaining `0 -> (220,0,0)`.
- Midpoint floor behavior for both formulas, calculated from raw remaining percent.
- Claude `five_hour` selects green-red and `seven_day` selects blue-red even when only one row exists.
- Codex first sorted row selects green-red; every later row selects blue-red.
- Filled spans receive the computed RGB; empty spans receive `theme.current.textMuted`.

### TUI and Lifecycle Tests

- Right-aligned full-width outer geometry and content-width inner target remain exact.
- One-row Codex and two-row Claude spacing matches the exact examples.
- Every bar contains exactly 13 cells; continuation row begins with seven spaces and no provider text.
- Left press/release toggles once and writes the exact KV key/value.
- Right, middle, wheel, release-only, and press-exit-release paths do not toggle.
- Hover, focus, and pressed states remain distinct and do not toggle.
- Valid/invalid/absent/unreadable KV behavior remains correct.
- Both initial scans start independently; same-provider overlap is blocked; cross-provider overlap is allowed.
- One provider failure does not mutate the other; disposal clears both timers and ignores late results.
- The fake API exposes no usable keymap registration path, proving the plugin is click-only.

### Removal Regression Tests

- Source scan finds no `Ctrl+Shift+Q`, toggle command name, `registerLayer`, modified-Q binding, or keymap disposer in the TUI implementation/tests/README.
- Manual keyboard check confirms `Ctrl+Shift+Q`, Enter, Space, and plain Q do not toggle the visible provider.

## Ordered Implementation Steps

1. Replace the pure display model and declarations with ordered rows, provider-specific classification, compact reset formatting, and half-up cell counts.
2. Update pure tests for bars, percentages, reset states, stale behavior, unavailable fallback, and deterministic window ordering.
3. Add the exact RGB interpolation at the smallest renderer-aware boundary and render row spans in the existing TSX control.
4. Verify one-row/two-row geometry, fixed columns, continuation indentation, and theme-muted empty cells.
5. Remove the complete keymap command/layer/disposer path from runtime code.
6. Update TUI tests to use click activation and delete all keyboard-command fixtures/assertions.
7. Update only the README's global TUI section with click-only compact-bar behavior.
8. Run automated checks, perform prohibited-copy/removal scans, inspect the exact diff, and complete host smoke verification.

## Verification Checklist

### Automated

- [ ] Run the complete root suite:

  ```powershell
  Set-Location "C:\Users\ivans\.claude\tools\claude-usage"
  npm test
  ```

- [ ] Run isolated TUI tests:

  ```powershell
  Set-Location "C:\Users\ivans\.claude\tools\claude-usage"
  node --test ".\opencode\tui\quota-control.test.mjs"
  ```

- [ ] Run isolated TUI typecheck:

  ```powershell
  Set-Location "C:\Users\ivans\.claude\tools\claude-usage\opencode\tui"
  npm run typecheck
  ```

- [ ] Confirm green-red and blue-red endpoint/intermediate RGB tests pass.
- [ ] Confirm half-up filled-cell tests and exact 13-cell row tests pass.
- [ ] Confirm Claude semantic ordering and Codex duration ordering tests pass with shuffled object insertion.
- [ ] Confirm stale, past reset, unknown reset, partial data, and n/a tests pass.
- [ ] Search TUI implementation/tests and the OpenCode README section for removed keyboard artifacts and prohibited visible copy.
- [ ] Confirm no package or lockfile diff and no generated test-runtime file remains.
- [ ] Confirm plugin ID/path and global `tui.json` are unchanged.

### Manual Host

- [ ] Launch `opencode --auto --print-logs --log-level DEBUG`; verify neither collector delays startup.
- [ ] Confirm the selected control remains at the right edge of global `app_bottom` on home and session routes.
- [ ] Confirm current Codex displays one unlabeled 13-cell bar and does not say monthly.
- [ ] Confirm Claude with both windows displays two aligned rows in session-then-weekly semantic order without labels.
- [ ] Confirm exact examples at representative values, including integer percent spacing.
- [ ] Confirm filled cells visually represent remaining, not consumed, quota.
- [ ] Confirm first/session and second/weekly gradients match the authoritative shell statusline.
- [ ] Confirm empty cells use the active theme's muted color.
- [ ] Left-click the visible control and verify one immediate provider switch and restart persistence.
- [ ] Verify right/middle/wheel/drag-out interactions do not switch.
- [ ] Press `Ctrl+Shift+Q`; verify it no longer switches. Verify Enter, Space, and normal typing remain unaffected.
- [ ] Exercise stale usable, elapsed reset, unknown reset, missing Claude file, and unavailable Codex states.
- [ ] Confirm an unavailable selected provider remains selected as `<Provider> — n/a`.
- [ ] Confirm switching stays immediate while the other collector is slow or unavailable.
- [ ] Resize narrow/wide and verify right alignment, continuation alignment, clipping safety, and hit targeting.
- [ ] Verify coexistence with `opencode-subagent-statusline` and `OPENCODE_PURE=1` recovery.
- [ ] Inspect logs for plugin, renderer, KV, interval, and unhandled-promise errors.

### Scope Audit

- [ ] Runtime changes are limited to the planned display/TUI files; tests and README change only as listed.
- [ ] `C:\Users\ivans\.config\opencode\tui.json` is byte-for-byte unchanged.
- [ ] Collector, schema, cache, CLI, config, dependency, and lock files are unchanged.
- [ ] No credentials, usage payloads, cache data, logs, or persisted KV values enter the diff.

## Estimated Change Size

| File | Estimated changed lines | Review focus |
|---|---:|---|
| `opencode/quota-display.mjs` | `90-135` | row model, classification, resets, rounding |
| `opencode/quota-display.d.mts` | `20-35` | exact row/gradient contracts |
| `opencode/tui/codex-quota-indicator.tsx` | `55-90` | span rendering, RGB, keymap removal |
| `opencode/tui/quota-control.mjs` | `0` | explicitly unchanged |
| `test/opencode-quota-indicator.test.mjs` | `90-145` | ordering, bars, reset/stale/unavailable |
| `opencode/tui/quota-control.test.mjs` | `70-120` | click-only lifecycle and visual geometry |
| `README.md` | `12-24` | click-only compact indicator docs |
| **Expected total** | **337-559** | additions/deletions combined; no generated files |

The upper bound includes detailed visual span assertions. The net runtime code should remain near neutral because text-label/tone/keymap logic is removed while row/color logic is added.

## Review Forecast

- **Primary review: 35-50 minutes.** Start with `quota-display.mjs`: semantic classification, ordering, rounding, and stale/reset invariants carry the main correctness risk.
- **Renderer review: 20-30 minutes.** Verify exact cell counts, RGB formulas, theme-muted empties, fixed columns, and right-aligned multi-row geometry.
- **Interaction/lifecycle review: 15-20 minutes.** Confirm the keyboard path is truly gone while click filtering, persistence, dual refresh, and disposal remain intact.
- **Tests/docs review: 15-25 minutes.** Check edge coverage and ensure README describes only the TUI behavior without changing CLI contracts.
- **Manual verification: 20-30 minutes plus two restarts.** Real terminal RGB, slot composition, click hit testing, and persistence require host checks.
- If implementation exceeds roughly 500 changed lines, split review into two logical slices within the same cohesive change: presentation/model/tests first, then TUI interaction/lifecycle/docs. Do not split collectors because they are unchanged.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Codex's 10080-minute live window is mislabeled monthly | Render no window labels and test the exact current duration as one generic row. |
| Claude rows depend on object insertion | Address exact semantic IDs in fixed order. |
| Future Codex windows reorder nondeterministically | Sort by duration, sanitized ID, and explicit primary/secondary tie-breaker. |
| Bar visual disagrees with authoritative statusline | Reproduce 13-cell half-up rounding and exact floor-based RGB formulas. |
| Integer percent changes bar/color precision | Compute fill and RGB from raw clamped percentage; round only visible percent text. |
| Stale values appear fresh | Preserve canonical stale state and prefix known reset tokens with `~`. |
| Unknown stale reset produces misleading approximation | Render exact `—`; never fabricate a duration. |
| Multi-row control loses right alignment | Right-align one content-width vertical control; give every row identical fixed prefix geometry. |
| Entire empty app row becomes clickable | Keep handlers only on the inner content-width control. |
| Keyboard command survives indirectly | Remove layer, command, binding, disposer, fixture, tests, and docs; add source scan. |
| One collector blocks the other or startup | Preserve separate scanners, guards, initial promises, timers, and failure state. |
| Hardcoded empty color conflicts with themes | Use `theme.current.textMuted`; hardcode only authoritative filled RGB ramps. |
| OpenTUI span/RGBA API differs at runtime | Typecheck against pinned `0.4.3` and verify real host output before completion. |

## Rollback

Revert the implementation files and README to the pre-refinement state. The plugin path, ID, dependencies, KV key/value shape, and `tui.json` do not change, so rollback needs no configuration or persisted-state migration.

For immediate runtime recovery before a code revert:

```powershell
$env:OPENCODE_PURE = "1"
opencode --auto
Remove-Item Env:OPENCODE_PURE
```

If selective emergency recovery is required, temporarily remove only the existing quota plugin line from global `tui.json`, preserve `opencode-subagent-statusline`, and restart. That is an operational rollback action, not part of implementation.

## Non-Goals

- No implementation during this planning task.
- No changes to runtime code, tests, config, dependencies, or lockfiles while producing this plan.
- No textual window labels or inferred monthly/weekly/session copy in the TUI.
- No separate tabs, segmented selector, menu, second provider control, combined-provider view, or automatic fallback.
- No keyboard shortcut, command-palette action, Enter/Space activation, or replacement key binding.
- No configurable colors, bar width, refresh interval, default provider, or KV scope.
- No workspace-, route-, session-, model-, or project-specific selection.
- No collector, schema, cache, source freshness policy, authentication, rollout parser, or app-server protocol changes.
- No Claude network call and no change to how `~/.claude/usage.json` is produced.
- No changes to the server `usage_metrics` plugin or CLI output examples/contracts.
- No global `tui.json`, `opencode.json`, OpenCode binary/source, VS Code keybinding, or unrelated plugin changes.
- No dependency additions, updates, installation, or generated assets.
- No visible stale age, source metadata, errors, plan names, absolute reset timestamps, toast, sound, or notification.
