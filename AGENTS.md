# AGENTS.md

These instructions were extracted from the shared AI Battle Arena task plan on 2026-05-29. They apply to this repository unless they conflict with higher-priority user, system, or developer instructions.

## Project identity

This repository is Storm Blaster, a React + TypeScript + Vite canvas shoot-em-up game.

The long-term product direction is:
- Preserve the existing vertical shooter feel.
- Add an AI Battle Arena mode where AI-controlled fighters compete automatically.
- Human users configure, spectate, compare, and review AI fighters.
- The design metaphor is "digital cricket fighting", but do not implement real-money betting or gambling mechanics.

## Current architecture assumptions

Important files:
- `src/App.tsx`: root app component.
- `src/pages/Home.tsx`: current main screen, menus, canvas lifecycle, and input forwarding.
- `src/game/engine.ts`: current single-player game engine.
- `src/game/types.ts`: game entities, player, enemy, bullet, collectible, and game state types.
- `src/game/renderer.ts`: canvas rendering.
- `src/game/entities.ts`: entity creation.
- `src/game/levels.ts`: level configuration.
- `src/game/audio.ts`: audio manager.

## Engineering rules

- Do not rewrite the project from scratch.
- Preserve current single-player level mode and endless mode.
- Prefer additive modules over invasive edits.
- Use TypeScript types for new systems.
- Keep runtime AI cheap and deterministic first.
- Do not call external LLM APIs in the first local battle milestone.
- Do not add heavy dependencies unless there is no simple alternative.
- Do not introduce real-money wagering, gambling, or payments.

## Commands

After changing TypeScript or React code, run:
```bash
npm run build
```

## AI Coding Agent Integration & Strategy Gateway Binding

Whenever the Storm Blaster game client is loaded or a match room is joined/created, the server automatically writes the active Match Room, Player ID, and Gateway Key to a file named `agent-gateway.json` in the project root directory.

AI coding agents (like Claude code, codex, kimi code, or Antigravity) can read this file to obtain the Gateway Key and automatically connect and push strategies/modules to the game client!

### Automated Strategy Push CLI Script

You can run the pre-built push script in this repository:
```bash
node scripts/push-strategy.js --target=lowest_hp --skill=aggressive --modules="Wing Swarm-Lv3,Missile Storm-Lv2"
```

Parameters:
- `--target`: lowest_hp, highest_threat, nearest
- `--avoid`: none, or player callsign
- `--betray`: never, final3, target_low40, power_spike
- `--skill`: aggressive, balanced, conservative
- `--survive`: trade, def50, survival_first
- `--promise`: honor, opportunistic, ignore
- `--modules`: comma-separated modules and levels (e.g. "Wing Swarm-Lv3,Missile Storm-Lv2")

### Manual Strategy Push API

Or push directly via HTTP POST:
- **Endpoint**: `http://localhost:3001/api/agent/strategy`
- **Payload**: `{ "key": "<gatewayKey>", "strategyUrl": "<importUrl>" }`
