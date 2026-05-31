import { randomUUID } from 'node:crypto';
import {
  LocalBattleEngine,
  type BattleReport,
  type BattleState,
  type BattleFighterConfig,
} from '../src/game/battle/index.ts';
import type { BotSelection, MatchReport, MatchStateSnapshot, PlayerId, RoomRole } from '../src/game/multiplayer/protocol.ts';
import type { RoomInfo } from '../src/game/multiplayer/protocol.ts';
import type { RoomParticipantState, RoomState } from '../src/game/multiplayer/roomTypes.ts';
import type { WebSocketConnection } from './websocket.ts';
import type { BotKind } from '../src/game/bots/index.ts';
import { createBotController, getBotMetadata } from '../src/game/bots/index.ts';

type ServerBattleReport = MatchReport<BattleReport>;

const SNAPSHOT_INTERVAL_MS = 1000 / 30;
const MATCH_STEP_SECONDS = 1 / 30;
const SYSTEM_AGENT_TEMPLATES: readonly { callsign: string; bot: BotSelection }[] = [
  {
    callsign: 'NOVA-13',
    bot: {
      botId: 'aggressive',
      label: 'System Agent / Assault',
      difficulty: 'normal',
      modules: ['Wing Swarm Lv2', 'Missile Storm Lv2', 'Overload Lance Lv2'],
    },
  },
  {
    callsign: 'ORBIT-22',
    bot: {
      botId: 'defensive',
      label: 'System Agent / Survival',
      difficulty: 'normal',
      modules: ['Aegis Layer Lv2', 'Repair Wisp Lv2', 'Vector Drive Lv2'],
    },
  },
  {
    callsign: 'VANTA-04',
    bot: {
      botId: 'collector',
      label: 'System Agent / Control',
      difficulty: 'normal',
      modules: ['Blackout Pulse Lv2', 'Wing Swarm Lv2', 'Aegis Layer Lv2'],
    },
  },
  {
    callsign: 'LYRA-31',
    bot: {
      botId: 'llm-strategy',
      label: 'System Agent / Deception',
      difficulty: 'normal',
      modules: ['Ghost Veil Lv2', 'Phantom Echo Lv2', 'Vector Drive Lv2'],
    },
  },
];

export class BattleRoom {
  readonly roomId: string;
  readonly code: string;
  readonly createdAt: number;

  private readonly maxPlayers: number;
  private readonly hostId: PlayerId;
  private readonly participants = new Map<PlayerId, RoomParticipantState>();
  private readonly connections = new Map<PlayerId, WebSocketConnection>();
  private readonly agentConnections = new Map<PlayerId, WebSocketConnection>();
  private readonly roomState: RoomState<BattleState, BattleReport>;
  private engine: LocalBattleEngine | null = null;
  private tickHandle: NodeJS.Timeout | null = null;

  constructor(options: {
    roomId: string;
    code: string;
    hostId: PlayerId;
    displayName: string;
    maxPlayers: number;
    createdAt?: number;
  }) {
    this.roomId = options.roomId;
    this.code = options.code;
    this.createdAt = options.createdAt ?? Date.now();
    this.hostId = options.hostId;
    this.maxPlayers = Math.min(5, Math.max(3, options.maxPlayers));

    const host: RoomParticipantState = {
      playerId: options.hostId,
      displayName: options.displayName,
      connected: true,
      ready: false,
      isHost: true,
      bot: null,
      joinedAt: this.createdAt,
      lastSeenAt: this.createdAt,
    };

    this.participants.set(host.playerId, host);
    this.roomState = {
      roomId: this.roomId,
      code: this.code,
      phase: 'lobby',
      hostId: this.hostId,
      maxPlayers: this.maxPlayers,
      createdAt: this.createdAt,
      updatedAt: this.createdAt,
      participants: [host],
    };
  }

  get hostPlayerId(): PlayerId {
    return this.hostId;
  }

  hasPlayer(playerId: PlayerId): boolean {
    return this.participants.has(playerId);
  }

  addParticipant(playerId: PlayerId, displayName: string): RoomParticipantState {
    if (this.roomState.phase !== 'lobby') {
      throw new Error('Room is already in progress.');
    }

    if (this.participants.size >= this.maxPlayers) {
      throw new Error('Room is full.');
    }

    const existing = this.participants.get(playerId);
    if (existing) {
      existing.displayName = displayName;
      existing.lastSeenAt = Date.now();
      existing.connected = true;
      this.syncRoomState();
      return existing;
    }

    const participant: RoomParticipantState = {
      playerId,
      displayName,
      connected: true,
      ready: false,
      isHost: false,
      bot: null,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
    };

    this.participants.set(playerId, participant);
    this.syncRoomState();
    return participant;
  }

  attachConnection(playerId: PlayerId, connection: WebSocketConnection): void {
    const participant = this.participants.get(playerId);
    if (!participant) {
      throw new Error('Participant is not in this room.');
    }

    const previous = this.connections.get(playerId);
    if (previous && previous !== connection && previous.isOpen()) {
      previous.close(4000, 'replaced-by-new-connection');
    }

    this.connections.set(playerId, connection);
    participant.connected = true;
    participant.lastSeenAt = Date.now();
    connection.roomId = this.roomId;
    connection.playerId = playerId;
    this.syncRoomState();
  }

  detachConnection(playerId: PlayerId, connectionId?: string): void {
    const existing = this.connections.get(playerId);
    if (!existing) return;

    if (connectionId && existing.id !== connectionId) {
      return;
    }

    this.connections.delete(playerId);
    const participant = this.participants.get(playerId);
    if (participant) {
      participant.connected = false;
      participant.lastSeenAt = Date.now();
    }

    this.syncRoomState();
  }

  attachAgentConnection(playerId: PlayerId, connection: WebSocketConnection): void {
    const participant = this.participants.get(playerId);
    if (!participant) {
      throw new Error('Participant is not in this room.');
    }

    const previous = this.agentConnections.get(playerId);
    if (previous && previous !== connection && previous.isOpen()) {
      previous.close(4000, 'replaced-by-new-agent-connection');
    }

    this.agentConnections.set(playerId, connection);
    participant.agentConnected = true;
    participant.lastSeenAt = Date.now();
    connection.roomId = this.roomId;
    connection.playerId = playerId;
    connection.isAgent = true; // Flag connection as an Agent
    this.syncRoomState();
    this.sendRoomUpdate();
  }

  detachAgentConnection(playerId: PlayerId, connectionId?: string): void {
    const existing = this.agentConnections.get(playerId);
    if (!existing) return;

    if (connectionId && existing.id !== connectionId) {
      return;
    }

    this.agentConnections.delete(playerId);
    const participant = this.participants.get(playerId);
    if (participant) {
      participant.agentConnected = false;
      participant.lastSeenAt = Date.now();
    }

    this.syncRoomState();
    this.sendRoomUpdate();
  }

  selectBot(playerId: PlayerId, bot: BotSelection | null): RoomParticipantState {
    const participant = this.requireParticipant(playerId);
    this.assertLobby();

    if (bot !== null) {
      this.validateBotSelection(bot);
    }

    participant.bot = bot;
    participant.lastSeenAt = Date.now();
    this.syncRoomState();
    return participant;
  }

  setReady(playerId: PlayerId, ready: boolean): RoomParticipantState {
    const participant = this.requireParticipant(playerId);
    this.assertLobby();

    participant.ready = ready;
    participant.lastSeenAt = Date.now();
    this.syncRoomState();
    return participant;
  }

  canStartMatch(): boolean {
    return (
      this.roomState.phase === 'lobby' &&
      this.participants.size >= 1 &&
      [...this.participants.values()].every(
        (participant) => participant.connected && participant.ready && participant.bot !== null
      )
    );
  }

  startMatch(playerId: PlayerId): MatchStateSnapshot<BattleState> {
    this.assertHost(playerId);
    this.assertLobby();
    this.ensureSystemAgents(this.maxPlayers);

    if (!this.canStartMatch()) {
      throw new Error('All human participants must select a bot and mark ready before starting.');
    }

    const fighters = this.createFighters();
    const battleId = `battle-${randomUUID()}`;
    this.engine = new LocalBattleEngine({
      fighters,
      simulation: {
        battleId,
        seed: this.createSeed(),
      },
    });

    this.roomState.matchId = battleId;
    this.roomState.phase = 'running';
    this.roomState.updatedAt = Date.now();
    this.roomState.snapshot = this.engine.start();

    this.broadcastRoomUpdate();
    this.broadcastSnapshot();
    this.startTickLoop();

    return this.createSnapshot();
  }

  getRoomInfo(forPlayerId?: PlayerId): RoomInfo {
    const role = this.getRole(forPlayerId);
    const participants = this.participantsList();
    const readyPlayers = participants.filter((participant) => participant.ready).length;

    return {
      roomId: this.roomId,
      code: this.code,
      phase: this.roomState.phase,
      role,
      players: participants.length,
      readyPlayers,
      maxPlayers: this.maxPlayers,
      matchId: this.roomState.matchId,
      participants,
    };
  }

  getSnapshot(): MatchStateSnapshot<BattleState> | null {
    if (!this.roomState.snapshot) return null;
    return this.createSnapshot();
  }

  getReportForPlayer(playerId: PlayerId): ServerBattleReport | null {
    if (!this.roomState.report) return null;
    return this.createPersonalizedReport(playerId);
  }

  sendRoomUpdate(): void {
    this.broadcastRoomUpdate();
  }

  finishRoom(): void {
    this.stopTickLoop();
  }

  private createFighters(): BattleFighterConfig[] {
    return this.participantsList().map((participant) => {
      if (!participant.bot) {
        throw new Error(`Participant ${participant.playerId} has not selected a bot.`);
      }

      let controller;
      if (participant.bot.policy) {
        controller = createBotController('llm-strategy', {
          id: participant.playerId,
          policy: participant.bot.policy,
        });
      } else {
        const botKind = participant.bot.botId as BotKind;
        controller = createBotController(botKind, {
          id: participant.playerId,
        });
      }

      return {
        id: participant.playerId,
        name: participant.displayName,
        bot: controller,
        modules: participant.bot.modules,
        color: undefined,
      };
    });
  }

  private ensureSystemAgents(minPlayers: number): void {
    let nextIndex = 0;
    while (this.participants.size < minPlayers && this.participants.size < this.maxPlayers) {
      const template = SYSTEM_AGENT_TEMPLATES[nextIndex % SYSTEM_AGENT_TEMPLATES.length];
      const playerId = `system-${template.callsign.toLowerCase()}-${this.participants.size + 1}`;
      nextIndex += 1;
      if (this.participants.has(playerId)) continue;

      this.participants.set(playerId, {
        playerId,
        displayName: template.callsign,
        connected: true,
        ready: true,
        isHost: false,
        bot: template.bot,
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
      });
    }
    this.syncRoomState();
  }

  private createSeed(): number {
    const seed = `${this.roomId}:${this.createdAt}`;
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  private startTickLoop(): void {
    if (this.tickHandle) return;

    this.tickHandle = setInterval(() => {
      if (!this.engine) return;

      const state = this.engine.step(MATCH_STEP_SECONDS);
      this.roomState.snapshot = state;
      this.roomState.updatedAt = Date.now();
      this.broadcastSnapshot();

      if (state.phase === 'finished') {
        this.handleFinishedBattle();
      }
    }, SNAPSHOT_INTERVAL_MS);

    this.tickHandle.unref?.();
  }

  private stopTickLoop(): void {
    if (!this.tickHandle) return;
    clearInterval(this.tickHandle);
    this.tickHandle = null;
  }

  private handleFinishedBattle(): void {
    if (!this.engine || this.roomState.phase === 'finished') return;

    const report = this.engine.getReport();
    this.roomState.report = report;
    this.roomState.phase = 'finished';
    this.roomState.updatedAt = Date.now();
    this.stopTickLoop();
    this.broadcastRoomUpdate();
    this.broadcastReports(report);
  }

  private broadcastSnapshot(): void {
    if (!this.roomState.snapshot) return;

    const snapshot = this.createSnapshot();
    this.broadcast(() => ({
      v: 1,
      type: 'match.state',
      payload: {
        snapshot: {
          ...snapshot,
          participants: this.matchParticipants(),
        },
      },
    }));
  }

  private broadcastReports(report: BattleReport): void {
    for (const [playerId, connection] of this.connections.entries()) {
      if (!connection.isOpen()) continue;
      connection.sendJson({
        v: 1,
        type: 'match.report',
        payload: {
          report: this.createPersonalizedReport(playerId, report),
        },
      });
    }
  }

  private createPersonalizedReport(playerId: PlayerId, report: BattleReport = this.roomState.report!): ServerBattleReport {
    const outcome =
      report.finishReason === 'manual'
        ? 'aborted'
        : report.winnerId === undefined
          ? 'draw'
          : report.winnerId === playerId
            ? 'win'
            : 'lose';

    return {
      matchId: report.battleId,
      outcome,
      durationMs: Math.round(report.duration * 1000),
      winnerId: report.winnerId,
      summary: report,
    };
  }

  private matchParticipants() {
    return this.participantsList().map((participant) => ({
      playerId: participant.playerId,
      displayName: participant.displayName,
      bot: participant.bot ?? undefined,
      connected: participant.connected,
    }));
  }

  private broadcastRoomUpdate(): void {
    this.broadcast((playerId) => ({
      v: 1,
      type: 'room.updated',
      payload: {
        room: this.getRoomInfo(playerId),
      },
    }));
  }

  private broadcast(factory: (playerId: PlayerId) => { v: 1; type: string; payload: unknown }): void {
    for (const [playerId, connection] of this.connections.entries()) {
      if (!connection.isOpen()) continue;
      connection.sendJson(factory(playerId));
    }
  }

  private syncRoomState(): void {
    this.roomState.updatedAt = Date.now();
    this.roomState.participants = this.participantsList();
  }

  private participantsList(): RoomParticipantState[] {
    return [...this.participants.values()].map((participant) => ({ ...participant, bot: participant.bot ? { ...participant.bot } : null }));
  }

  private requireParticipant(playerId: PlayerId): RoomParticipantState {
    const participant = this.participants.get(playerId);
    if (!participant) {
      throw new Error('Player is not in this room.');
    }

    return participant;
  }

  private assertLobby(): void {
    if (this.roomState.phase !== 'lobby') {
      throw new Error('Room is already in progress.');
    }
  }

  private assertHost(playerId: PlayerId): void {
    if (playerId !== this.hostId) {
      throw new Error('Only the host can start the match.');
    }
  }

  private validateBotSelection(bot: BotSelection): void {
    getBotMetadata(bot.botId as BotKind);
  }

  private getRole(forPlayerId?: PlayerId): RoomRole {
    if (!forPlayerId) return 'spectator';
    if (forPlayerId === this.hostId) return 'host';
    return this.participants.has(forPlayerId) ? 'guest' : 'spectator';
  }

  private createSnapshot(): MatchStateSnapshot<BattleState> {
    if (!this.roomState.snapshot) {
      throw new Error('Battle snapshot is not available yet.');
    }

    return {
      matchId: this.roomState.matchId ?? this.roomId,
      phase: this.mapPhase(this.roomState.snapshot.phase),
      tick: this.roomState.snapshot.tick,
      serverTime: Date.now(),
      participants: this.matchParticipants(),
      state: this.roomState.snapshot,
    };
  }

  private mapPhase(phase: BattleState['phase']): 'lobby' | 'countdown' | 'running' | 'finished' {
    switch (phase) {
      case 'ready':
        return 'countdown';
      case 'running':
        return 'running';
      case 'finished':
        return 'finished';
      default:
        return 'lobby';
    }
  }
}
