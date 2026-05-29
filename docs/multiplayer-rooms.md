# Multiplayer Spectator Rooms

Milestone 2 adds a minimal local room server for AI Battle Arena matches.

## Runtime

- HTTP health check: `http://127.0.0.1:3001/healthz`
- WebSocket endpoint: `ws://127.0.0.1:3001/ws`
- Frontend default endpoint: `ws://127.0.0.1:3001/ws`

Override the frontend endpoint with:

```bash
VITE_BATTLE_SERVER_URL=ws://127.0.0.1:3001/ws
```

## Commands

```bash
npm run dev:server
npm run dev
```

Or run both together:

```bash
npm run dev:all
```

Server typecheck:

```bash
npm run build:server
```

Full frontend build:

```bash
npm run build
```

## Flow

1. Open the app and choose `ONLINE ROOM`.
2. Create a room or join with a room code.
3. Each participant selects a bot.
4. Each participant marks ready.
5. The host starts the match.
6. The server runs the authoritative battle simulation and broadcasts snapshots.
7. Clients render snapshots and show the final report.

## Design Notes

- The client never reports winners or scores.
- The server owns the room state, battle simulation, state snapshots, and match report.
- There is no account system, database, payment flow, gambling mechanic, or real-money wagering.
- The server is intentionally dependency-free for the first multiplayer milestone.
