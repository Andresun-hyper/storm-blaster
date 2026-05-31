import type {
  BotSelection,
  MatchId,
  PlayerId,
  RoomId,
} from './protocol.ts';

export type RoomCode = string;
export type RoomPhase = 'lobby' | 'countdown' | 'running' | 'finished';

export interface RoomParticipantState {
  playerId: PlayerId;
  displayName: string;
  connected: boolean;
  ready: boolean;
  isHost: boolean;
  bot: BotSelection | null;
  joinedAt: number;
  lastSeenAt: number;
  agentConnected?: boolean;
}

export interface RoomState<TState = unknown, TSummary = unknown> {
  roomId: RoomId;
  code: RoomCode;
  phase: RoomPhase;
  hostId: PlayerId;
  maxPlayers: number;
  createdAt: number;
  updatedAt: number;
  participants: RoomParticipantState[];
  matchId?: MatchId;
  snapshot?: TState;
  report?: TSummary;
}
