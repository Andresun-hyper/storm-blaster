import http from 'node:http';
import type { Socket } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomManager } from './roomManager.ts';
import { WebSocketConnection } from './websocket.ts';
import type {
  ClientMessage,
  ErrorEvent,
  ServerMessage,
  StartMatchResponse,
  MatchParticipant,
} from '../src/game/multiplayer/protocol.ts';
import type { BattleReport, BattleState } from '../src/game/battle/index.ts';
import type { RoomInfo } from '../src/game/multiplayer/protocol.ts';

type MatchServerMessage = ServerMessage<BattleState, BattleReport>;

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

const roomManager = new RoomManager();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, '../dist');

const server = http.createServer((request, response) => {
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  let filePath = path.join(DIST_DIR, request.url || '/');

  if (!filePath.startsWith(DIST_DIR)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('404 Not Found');
    } else {
      response.writeHead(200, { 'content-type': contentType });
      response.end(content, 'utf-8');
    }
  });
});

server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/ws') {
    socket.destroy();
    return;
  }

  void head;

  let connection: WebSocketConnection;
  try {
    connection = new WebSocketConnection(socket as Socket, request);
  } catch {
    socket.destroy();
    return;
  }

  connection.onMessage((rawMessage) => {
    handleMessage(connection, rawMessage);
  });

  connection.on('close', () => {
    roomManager.disconnect(connection);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Battle room server listening on http://${HOST}:${PORT}`);
  console.log(`WebSocket endpoint ready at ws://${HOST}:${PORT}/ws`);
});

function handleMessage(connection: WebSocketConnection, rawMessage: string): void {
  let message: unknown;

  try {
    message = JSON.parse(rawMessage);
  } catch {
    sendError(connection, 'invalid_json', 'Message body must be valid JSON.', false);
    return;
  }

  if (!isClientMessage(message)) {
    sendError(connection, 'invalid_message', 'Message envelope is not valid.', false);
    return;
  }

  try {
    switch (message.type) {
      case 'room.create': {
        const room = roomManager.createRoom(message.payload, connection);
        send(connection, {
          v: 1,
          type: 'room.created',
          payload: {
            room: room.getRoomInfo(message.payload.playerId),
          },
        });
        return;
      }
      case 'room.join': {
        const room = roomManager.joinRoom(message.payload, connection);
        send(connection, {
          v: 1,
          type: 'room.joined',
          payload: {
            room: room.getRoomInfo(message.payload.playerId),
          },
        });
        return;
      }
      case 'match.bot.select': {
        const room = requireRoom(roomManager, message.payload.roomId);
        roomManager.selectBot(message.payload.roomId, message.payload.playerId, message.payload.bot);
        send(connection, {
          v: 1,
          type: 'match.bot.selected',
          payload: {
            room: room.getRoomInfo(message.payload.playerId),
            participant: toMatchParticipant(room, message.payload.playerId),
          },
        });
        return;
      }
      case 'room.ready': {
        const room = requireRoom(roomManager, message.payload.roomId);
        roomManager.setReady(message.payload.roomId, message.payload.playerId, message.payload.ready);
        send(connection, {
          v: 1,
          type: 'room.readied',
          payload: {
            room: room.getRoomInfo(message.payload.playerId),
            participant: toRoomParticipant(room, message.payload.playerId),
          },
        });
        return;
      }
      case 'match.start': {
        const snapshot = roomManager.startMatch(message.payload.roomId, message.payload.playerId);
        send(connection, {
          v: 1,
          type: 'match.started',
          payload: {
            matchId: snapshot.matchId,
            phase: 'running',
          } satisfies StartMatchResponse,
        });
        return;
      }
    }
  } catch (error) {
    sendError(connection, 'room_error', error instanceof Error ? error.message : 'Room operation failed.', true);
  }
}

function send(connection: WebSocketConnection, message: MatchServerMessage): void {
  connection.sendJson(message);
}

function sendError(connection: WebSocketConnection, code: string, message: string, recoverable: boolean): void {
  const payload: ErrorEvent = {
    error: {
      code,
      message,
      recoverable,
    },
  };

  send(connection, {
    v: 1,
    type: 'error',
    payload,
  });
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.v === 1 && typeof record.type === 'string' && typeof record.payload === 'object' && record.payload !== null;
}

function toMatchParticipant(room: { getRoomInfo: (playerId: string) => RoomInfo }, playerId: string): MatchParticipant {
  const info = room.getRoomInfo(playerId);
  const participant = info.participants.find((entry) => entry.playerId === playerId);
  if (!participant) {
    throw new Error('Participant was not found in room state.');
  }

  return {
    playerId: participant.playerId,
    displayName: participant.displayName,
    bot: participant.bot ?? undefined,
    connected: participant.connected,
  };
}

function toRoomParticipant(room: { getRoomInfo: (playerId: string) => RoomInfo }, playerId: string) {
  const info = room.getRoomInfo(playerId);
  const participant = info.participants.find((entry) => entry.playerId === playerId);
  if (!participant) {
    throw new Error('Participant was not found in room state.');
  }

  return participant;
}

function requireRoom(roomManagerInstance: RoomManager, roomId: string) {
  const room = roomManagerInstance.getRoom(roomId);
  if (!room) {
    throw new Error(`Room ${roomId} was not found.`);
  }

  return room;
}
