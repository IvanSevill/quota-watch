/** @jsxImportSource @opentui/solid */

import type { TuiPlugin } from '@opencode-ai/plugin/tui';
import { MouseButton, RGBA } from '@opentui/core';
import { createSignal, For, type Accessor, type Setter } from 'solid-js';

import { collectClaudeQuota } from '../../quota/claude.mjs';
import type { QuotaDisplayModel, QuotaDisplayRow, QuotaProvider } from '../quota-display.mjs';
import {
  quotaDisplay,
  loadingQuotaDisplay,
  quotaBarRgb,
  selectedQuotaProvider,
  toggleQuotaProvider,
  unavailableQuotaDisplay,
} from '../quota-display.mjs';
import { createQuotaScanner } from '../usage-metrics.mjs';
import {
  createQuotaControlInteraction,
  quotaControlLayout,
  quotaRowLayout,
} from './quota-control.mjs';

const REFRESH_MS = 60_000;
const PROVIDER_WIDTH = 6;
const BAR_CELLS = 13;
const PERCENT_WIDTH = 4;
export const SELECTED_PROVIDER_KEY = 'quota-watch.provider.selected.v1';

const providerLabel = (provider: QuotaProvider) => provider === 'claude' ? 'Claude' : 'Codex';

export function quotaRowParts(provider: QuotaProvider, row: QuotaDisplayRow, index: number) {
  return {
    provider: (index === 0 ? providerLabel(provider) : '').padEnd(PROVIDER_WIDTH),
    filled: '█'.repeat(row.filledCells),
    empty: '░'.repeat(BAR_CELLS - row.filledCells),
    percent: row.percentText.padStart(PERCENT_WIDTH),
    reset: row.resetText,
  };
}

type Scanner = ReturnType<typeof createQuotaScanner>;

type ProviderRuntime = {
  display: Accessor<QuotaDisplayModel>;
  setDisplay: Setter<QuotaDisplayModel>;
  scanner: Scanner;
  inFlight: boolean;
  interval?: ReturnType<typeof setInterval>;
};

type Dependencies = {
  createScanner: typeof createQuotaScanner;
  collectClaude: typeof collectClaudeQuota;
  createInteraction: typeof createQuotaControlInteraction;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

export function createQuotaTui(overrides: Partial<Dependencies> = {}): TuiPlugin {
  const dependencies: Dependencies = {
    createScanner: createQuotaScanner,
    collectClaude: collectClaudeQuota,
    createInteraction: createQuotaControlInteraction,
    setInterval,
    clearInterval,
    ...overrides,
  };

  return async (api) => {
    let storedProvider: unknown;
    if (api.kv.ready) {
      try {
        storedProvider = api.kv.get<unknown>(SELECTED_PROVIDER_KEY);
      } catch {
        storedProvider = undefined;
      }
    }
    const initialProvider = selectedQuotaProvider(storedProvider);
    if (api.kv.ready && storedProvider !== undefined && storedProvider !== initialProvider) {
      try {
        api.kv.set(SELECTED_PROVIDER_KEY, initialProvider);
      } catch {
        // Host persistence failures must not block plugin startup.
      }
    }

    const [selectedProvider, setSelectedProvider] = createSignal<QuotaProvider>(initialProvider);
    const createRuntime = (provider: QuotaProvider, collectClaude = false): ProviderRuntime => {
      const [display, setDisplay] = createSignal<QuotaDisplayModel>(loadingQuotaDisplay(provider));
      return {
        display,
        setDisplay,
        scanner: dependencies.createScanner({
          cacheMs: REFRESH_MS,
          ...(collectClaude ? { collect: () => dependencies.collectClaude() } : {}),
        }),
        inFlight: false,
      };
    };
    const runtimes: Record<QuotaProvider, ProviderRuntime> = {
      claude: createRuntime('claude', true),
      codex: createRuntime('codex'),
    };
    let disposed = false;

    const toggleSelectedProvider = () => {
      const nextProvider = toggleQuotaProvider(selectedProvider());
      setSelectedProvider(nextProvider);
      try {
        api.kv.set(SELECTED_PROVIDER_KEY, nextProvider);
      } catch {
        // Keep the immediate in-process selection when persistence is unavailable.
      }
    };

    api.slots.register({
      order: 100,
      slots: {
        app_bottom() {
          const [hovered, setHovered] = createSignal(false);
          const [pressed, setPressed] = createSignal(false);
          const [focused, setFocused] = createSignal(false);
          const interaction = dependencies.createInteraction({
            toggle: toggleSelectedProvider,
            hovered,
            pressed,
            focused,
            setHovered,
            setPressed,
            setFocused,
            theme: api.theme.current,
            leftButton: MouseButton.LEFT,
          });
          const display = () => runtimes[selectedProvider()].display();
          return (
            <box {...quotaRowLayout}>
              <box
                {...quotaControlLayout}
                flexDirection="column"
                id="quota-watch-control"
                backgroundColor={interaction.background()}
                on:focused={interaction.onFocus}
                on:blurred={interaction.onBlur}
                onMouseOver={interaction.onMouseOver}
                onMouseOut={interaction.onMouseOut}
                onMouseDown={interaction.onMouseDown}
                onMouseUp={interaction.onMouseUp}
              >
                <For
                  each={display().rows}
                  fallback={<text fg={api.theme.current.text}>{providerLabel(display().provider)} — n/a</text>}
                >
                  {(row, index) => {
                    const parts = quotaRowParts(display().provider, row, index());
                    const [red, green, blue] = quotaBarRgb(row.gradient, row.remainingPercent);
                    const filledColor = RGBA.fromInts(red, green, blue, 255);
                    return (
                      <text>
                        <span style={{ fg: api.theme.current.text }}>{parts.provider} </span>
                        <span style={{ fg: filledColor }}>{parts.filled}</span>
                        <span style={{ fg: api.theme.current.textMuted }}>{parts.empty}</span>
                        <span style={{ fg: api.theme.current.text }}> {parts.percent} {parts.reset}</span>
                      </text>
                    );
                  }}
                </For>
              </box>
            </box>
          );
        },
      },
    });

    const refresh = (provider: QuotaProvider) => {
      const runtime = runtimes[provider];
      if (disposed || runtime.inFlight) return;
      runtime.inFlight = true;
      void runtime.scanner()
        .then((snapshot) => {
          if (!disposed) runtime.setDisplay(quotaDisplay(provider, snapshot));
        })
        .catch(() => {
          if (!disposed) runtime.setDisplay(unavailableQuotaDisplay(provider));
        })
        .finally(() => {
          runtime.inFlight = false;
        });
    };

    for (const provider of ['claude', 'codex'] as const) {
      refresh(provider);
      runtimes[provider].interval = dependencies.setInterval(() => refresh(provider), REFRESH_MS);
    }

    api.lifecycle.onDispose(() => {
      disposed = true;
      for (const runtime of Object.values(runtimes)) {
        if (runtime.interval !== undefined) dependencies.clearInterval(runtime.interval);
      }
    });
  };
}

const tui = createQuotaTui();

export default { id: 'quota-watch.quota-indicator', tui };
