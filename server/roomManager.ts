import { randomUUID } from 'node:crypto';
import type { CreateRoomRequest, JoinRoomRequest } from '../src/game/multiplayer/protocol.ts';
import type { BotSelection, PlayerId } from '../src/game/multiplayer/protocol.ts';
import { BattleRoom } from './battleRoom.ts';
import type { WebSocketConnection } from './websocket.ts';

export class RoomManager {
  private readonly roomsById = new Map<string, BattleRoom>();
  private readonly roomsByCode = new Map<string, BattleRoom>();

  createRoom(request: CreateRoomRequest, connection: WebSocketConnection): BattleRoom {
    const roomId = randomUUID();
    const code = this.createRoomCode();
    const room = new BattleRoom({
      roomId,
      code,
      hostId: request.playerId,
      displayName: request.displayName,
      maxPlayers: request.maxPlayers ?? 5,
    });

    this.roomsById.set(roomId, room);
    this.roomsByCode.set(code, room);
    room.attachConnection(request.playerId, connection);
    return room;
  }

  joinRoom(request: JoinRoomRequest, connection: WebSocketConnection): BattleRoom {
    const room = this.getRoomByCode(request.roomCode);
    if (!room) {
      throw new Error(`Room code ${request.roomCode} was not found.`);
    }

    if (!room.hasPlayer(request.playerId)) {
      room.addParticipant(request.playerId, request.displayName);
    }

    room.attachConnection(request.playerId, connection);
    room.sendRoomUpdate();
    return room;
  }

  getRoom(roomId: string): BattleRoom | undefined {
    return this.roomsById.get(roomId);
  }

  getRoomByCode(code: string): BattleRoom | undefined {
    return this.roomsByCode.get(code.toUpperCase());
  }

  getRoomByPlayer(playerId: PlayerId): BattleRoom | undefined {
    for (const room of this.roomsById.values()) {
      if (room.hasPlayer(playerId)) {
        return room;
      }
    }

    return undefined;
  }

  selectBot(roomId: string, playerId: PlayerId, bot: BotSelection | null) {
    const room = this.requireRoom(roomId);
    const participant = room.selectBot(playerId, bot);
    room.sendRoomUpdate();
    return participant;
  }

  setReady(roomId: string, playerId: PlayerId, ready: boolean) {
    const room = this.requireRoom(roomId);
    const participant = room.setReady(playerId, ready);
    room.sendRoomUpdate();
    return participant;
  }

  startMatch(roomId: string, playerId: PlayerId) {
    const room = this.requireRoom(roomId);
    return room.startMatch(playerId);
  }

  disconnect(connection: WebSocketConnection): void {
    if (!connection.roomId || !connection.playerId) return;

    const room = this.roomsById.get(connection.roomId);
    if (!room) return;

    if (connection.isAgent) {
      room.detachAgentConnection(connection.playerId, connection.id);
    } else {
      room.detachConnection(connection.playerId, connection.id);
    }
  }

  private requireRoom(roomId: string): BattleRoom {
    const room = this.roomsById.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} was not found.`);
    }

    return room;
  }

  private createRoomCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomUUID().replace(/-/g, '');
    let code = '';

    for (let index = 0; index < 6; index += 1) {
      const value = bytes.charCodeAt(index % bytes.length);
      code += alphabet[value % alphabet.length];
    }

    return code;
  }
}
