# LLM Strategy Layer

This repository now includes a local-only strategy layer for AI fighters.

## What it does

- `BotPolicy` holds a compact high-level style profile.
- `StrategyPlanner` turns a compressed observation digest into a cached `BotPolicy`.
- `MockStrategyPlanner` provides an offline implementation with no network calls.
- `LLMStrategyBot` consumes the cached policy locally and only refreshes it at low frequency.

## Offline guarantees

- No API keys are required.
- No external LLM calls are made at runtime.
- The planner only receives `CompressedObservation` data, not full game state, image data, or canvas pixels.
- The bot keeps the last policy cached and reuses it between refreshes.

## Token and payload safeguards

The planner input is intentionally small:

- `createStrategyObservationDigest()` trims the observation to a few opponents, threats, and pickups.
- `createStrategyPrompt()` serializes only the digest and a small planning context.
- Default limits cap the prompt length and the number of entities considered per refresh.
- The bot refreshes on match start, phase change, or a coarse periodic interval instead of every frame.

Recommended defaults:

- `maxPromptChars: 1400`
- `maxPromptTokens: 350`
- `maxOpponents: 4`
- `maxThreats: 6`
- `maxPickups: 6`
- `refreshIntervalMs: 12000`
- `maxRefreshesPerMatch: 10`

## Hooking up a real LLM later

Implement the `StrategyPlanner` interface and return a `BotPolicy` from the compressed digest.

Keep the same constraints:

1. Use only the digest, not the full state.
2. Keep refreshes sparse.
3. Cache the resulting policy.
4. Fall back to the mock planner or a default policy when the provider is unavailable.

Example:

```ts
import { LLMStrategyBot, type StrategyPlanner } from './src/game/bots';

const planner: StrategyPlanner = {
  kind: 'future-provider',
  name: 'FutureProvider',
  tokenBudget: {
    maxPromptChars: 1400,
    maxPromptTokens: 350,
    maxOpponents: 4,
    maxThreats: 6,
    maxPickups: 6,
  },
  planStrategy(request) {
    // Call your provider here with request.prompt or request.digest.
    // Return a compact BotPolicy.
    return {
      ...request.context.previousPolicy!,
      persona: 'provider-planned',
      risk: 0.6,
      aggression: 0.7,
      collectBias: 0.4,
      dodgeBias: 0.6,
      retreatBias: 0.3,
      engagementRange: 220,
      targetPriority: 'opportunity',
      dodgeStyle: 'wide',
      formation: 'center-lane',
      powerupPriority: ['shield', 'rage', 'missile'],
      fireMode: 'auto',
      refreshIntervalMs: 12000,
      maxRefreshesPerMatch: 10,
      cacheTtlMs: 15000,
      schemaVersion: 1,
    };
  },
};

const bot = new LLMStrategyBot({ planner });
```

The runtime should still work if that planner is replaced by `MockStrategyPlanner` or omitted entirely.
