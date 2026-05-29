// WebSocket protocol proposal for multiplayer rooms.
// Keep this serializable and transport-only.

import type { RoomParticipantState, RoomPhase } from './roomTypes.ts';
import type { BotPolicy } from '../bots/policy.ts';

export type ProtocolVersion = 1;

export type RoomId = string;
export type MatchId = string;
export type PlayerId = string;
export type BotId = string;
export type ClientNonce = string;

export type RoomRole = 'host' | 'guest' | 'spectator';
export type MatchPhase = 'lobby' | 'countdown' | 'running' | 'finished';
export type MatchOutcome = 'win' | 'lose' | 'draw' | 'aborted';

export interface RoomInfo {
  roomId: RoomId;
  code: string;
  phase: RoomPhase;
  role: RoomRole;
  players: number;
  readyPlayers: number;
  maxPlayers: number;
  matchId?: MatchId;
  participants: RoomParticipantState[];
}

export interface BotSelection {
  botId: BotId;
  label?: string;
  difficulty?: 'easy' | 'normal' | 'hard';
  modules?: string[];
  policy?: BotPolicy;
}

export interface MatchParticipant {
  playerId: PlayerId;
  displayName: string;
  bot?: BotSelection;
  connected: boolean;
}

export interface MatchStateSnapshot<TState = unknown> {
  matchId: MatchId;
  phase: MatchPhase;
  tick: number;
  serverTime: number;
  participants: MatchParticipant[];
  state: TState;
}

export interface MatchReport<TSummary = unknown> {
  matchId: MatchId;
  outcome: MatchOutcome;
  durationMs: number;
  winnerId?: PlayerId;
  summary?: TSummary;
}

export interface ProtocolError {
  code: string;
  message: string;
  recoverable: boolean;
  details?: unknown;
}

export interface BaseEnvelope<TType extends string, TPayload> {
  v: ProtocolVersion;
  type: TType;
  nonce?: ClientNonce;
  payload: TPayload;
}

export interface CreateRoomRequest {
  playerId: PlayerId;
  displayName: string;
  maxPlayers?: number;
}

export interface JoinRoomRequest {
  roomCode: string;
  playerId: PlayerId;
  displayName: string;
}

export interface SelectBotRequest {
  roomId: RoomId;
  playerId: PlayerId;
  bot: BotSelection | null;
}

export interface StartMatchRequest {
  roomId: RoomId;
  playerId: PlayerId;
}

export interface ReadyRoomRequest {
  roomId: RoomId;
  playerId: PlayerId;
  ready: boolean;
}

export interface CreateRoomResponse {
  room: RoomInfo;
}

export interface JoinRoomResponse {
  room: RoomInfo;
}

export interface SelectBotResponse {
  room: RoomInfo;
  participant: MatchParticipant;
}

export interface ReadyRoomResponse {
  room: RoomInfo;
  participant: RoomParticipantState;
}

export interface StartMatchResponse {
  matchId: MatchId;
  phase: MatchPhase;
}

export interface RoomUpdateEvent {
  room: RoomInfo;
}

export interface StateSnapshotEvent<TState = unknown> {
  snapshot: MatchStateSnapshot<TState>;
}

export interface MatchReportEvent<TSummary = unknown> {
  report: MatchReport<TSummary>;
}

export interface ErrorEvent {
  error: ProtocolError;
}

export type ClientMessage =
  | BaseEnvelope<'room.create', CreateRoomRequest>
  | BaseEnvelope<'room.join', JoinRoomRequest>
  | BaseEnvelope<'match.bot.select', SelectBotRequest>
  | BaseEnvelope<'room.ready', ReadyRoomRequest>
  | BaseEnvelope<'match.start', StartMatchRequest>;

export type ServerMessage<TState = unknown, TSummary = unknown> =
  | BaseEnvelope<'room.created', CreateRoomResponse>
  | BaseEnvelope<'room.joined', JoinRoomResponse>
  | BaseEnvelope<'match.bot.selected', SelectBotResponse>
  | BaseEnvelope<'room.readied', ReadyRoomResponse>
  | BaseEnvelope<'room.updated', RoomUpdateEvent>
  | BaseEnvelope<'match.started', StartMatchResponse>
  | BaseEnvelope<'match.state', StateSnapshotEvent<TState>>
  | BaseEnvelope<'match.report', MatchReportEvent<TSummary>>
  | BaseEnvelope<'error', ErrorEvent>;
