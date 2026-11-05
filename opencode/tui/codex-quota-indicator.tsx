/** @jsxImportSource @opentui/solid */

import { Plugin } from '@opencode/plugin/tui';
import { RGBA } from '@opentui/core';
import { createSignal, For } from 'solid-js';

import { collectClaudeQuota } from '../../quota/claude.mjs';
import type { QuotaDisplayRow } from '../quota-display.mjs';
import { quotaBarRgb, quotaDisplay, loadingQuotaDisplay, unavailableQuotaDisplay } from '../quota-display.mjs';
import { createQuotaScanner } from '../usage-metrics.mjs';

const REFRESH_MS = 60_000;
const BAR_CELLS = 13;

function rowParts(provider: 'codex' | 'claude', row: QuotaDisplayRow, index: number) {
  const label = provider === 'codex' ? 'Codex' : 'Claude';
  return {
    label: (index === 0 ? label : '').padEnd(6),
    filled: '█'.repeat(row.filledCells),
    empty: '░'.repeat(BAR_CELLS - row.filledCells),
    percent: row.percentText.padStart(4),
    reset: row.resetText,
  };
}

export default Plugin.define({
  id: 'quota-watch.quota-indicator',
  setup(context) {
    const [settings, updateSettings] = context.storage.store('selection', {
      initial: { provider: 'codex' as 'codex' | 'claude' },
    });
    const [codex, setCodex] = createSignal(loadingQuotaDisplay('codex'));
    const [claude, setClaude] = createSignal(loadingQuotaDisplay('claude'));
    const scanners = {
      codex: createQuotaScanner({ cacheMs: REFRESH_MS }),
      claude: createQuotaScanner({ cacheMs: REFRESH_MS, collect: () => collectClaudeQuota() }),
    };
    const busy = { codex: false, claude: false };
    let disposed = false;

    function refresh(provider: 'codex' | 'claude') {
      if (disposed || busy[provider]) return;
      busy[provider] = true;
      void scanners[provider]()
        .then((snapshot) => {
          if (disposed) return;
          const display = quotaDisplay(provider, snapshot);
          if (provider === 'codex') setCodex(display);
          else setClaude(display);
        })
        .catch(() => {
          if (disposed) return;
          if (provider === 'codex') setCodex(unavailableQuotaDisplay(provider));
          else setClaude(unavailableQuotaDisplay(provider));
        })
        .finally(() => { busy[provider] = false; });
    }

    function Indicator() {
      const provider = () => settings.provider === 'claude' ? 'claude' : 'codex';
      const display = () => provider() === 'claude' ? claude() : codex();
      const toggle = () => {
        void updateSettings((draft) => {
          draft.provider = provider() === 'codex' ? 'claude' : 'codex';
        });
      };
      return (
        <box width="100%" flexDirection="row" justifyContent="flex-end">
          <box flexDirection="column" onMouseUp={(event) => { if (event.button === 0) toggle(); }}>
            <For each={display().rows} fallback={<text fg={context.theme.text.base}>{provider() === 'codex' ? 'Codex' : 'Claude'} — n/a</text>}>
              {(row, index) => {
                const parts = rowParts(provider(), row, index());
                const [red, green, blue] = quotaBarRgb(row.gradient, row.remainingPercent);
                const color = RGBA.fromInts(red, green, blue, 255);
                return (
                  <text>
                    <span style={{ fg: context.theme.text.base }}>{parts.label} </span>
                    <span style={{ fg: color }}>{parts.filled}</span>
                    <span style={{ fg: context.theme.text.muted }}>{parts.empty}</span>
                    <span style={{ fg: context.theme.text.base }}> {parts.percent} {parts.reset}</span>
                  </text>
                );
              }}
            </For>
          </box>
        </box>
      );
    }

    const removeHome = context.ui.slot({ after: 'home.footer', render: Indicator });
    const removePrompt = context.ui.slot({ after: 'prompt.footer', render: Indicator });
    refresh('codex');
    refresh('claude');
    const timer = setInterval(() => {
      refresh('codex');
      refresh('claude');
    }, REFRESH_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
      removeHome();
      removePrompt();
    };
  },
});
