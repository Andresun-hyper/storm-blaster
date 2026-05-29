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
