import type WebSocket from "ws";

export type PlayerIndex = 0 | 1;
export type CardColor = "red" | "blue" | "green" | "white" | "yellow" | "purple";
export type CardCategory = "spirit" | "nexus" | "magic" | "ultimate";
export type TurnStep = "start" | "core" | "draw" | "refresh" | "main" | "attack" | "end";
export type BattlePhase = "normal" | "flash";
export type FlashStep = "attackFlash" | "blockFlash";
export type AttackResolutionMode = "pending" | "life" | "block";
export type EffectTargetType = "spirit" | "nexus" | "anyUnit" | "ownSpiritWithCore";

export interface CardLevel {
  lv: number;
  core: number;
  bp: number;
}

export interface CardDefinition {
  id: string;
  name: string;
  cost: number;
  reduction: Record<CardColor, number>;
  color: CardColor;
  symbolCount: number;
  symbolColor: CardColor | string;
  levels: CardLevel[];
  type: CardCategory;
  img: string;
}

export interface CardInstance extends CardDefinition {
  instanceId: string;
  cardId: string;
}

export interface FieldCard extends CardInstance {
  coreCount: number;
  attackedThisTurn: boolean;
  isRested: boolean;
  temporaryBpBonus: number;
  battleOnlyBpBonus: number;
}

export interface PublicCard {
  instanceId: string;
  id: string;
  cardId: string;
  name: string;
  cost: number;
  reduction: Record<CardColor, number>;
  color: CardColor;
  symbolCount: number;
  symbolColor: CardColor | string;
  levels: CardLevel[];
  type: CardCategory;
  img: string;
  coreCount?: number;
  attackedThisTurn?: boolean;
  isRested?: boolean;
  temporaryBpBonus?: number;
  currentLevel?: number | null;
  currentBp?: number | null;
  reducedCost?: number;
  reductionUsed?: number;
  playable?: boolean;
}

export interface CoreState {
  lifeCores: number;
  reserveCores: number;
  trashCores: number;
  voidCores: number;
}

export interface PlayerState {
  playerIndex: PlayerIndex;
  playerId: string;
  displayName: string;
  hand: CardInstance[];
  spiritZone: FieldCard[];
  nexusZone: FieldCard[];
  deck: CardInstance[];
  trash: CardInstance[];
  cores: CoreState;
}

export interface PendingAttackState {
  attackerPlayerIndex: PlayerIndex;
  attackerInstanceId: string;
  defendingPlayerIndex: PlayerIndex;
  resolutionMode: AttackResolutionMode;
  blockerInstanceId: string | null;
  mustBlock: boolean;
  mustBlockBySpiritOnly: boolean;
  lifeDamageOnSpiritBlock: number;
}

export interface EffectTargetCandidate {
  instanceId: string;
  playerId: string;
  zone: "spirit" | "nexus";
  name: string;
  type: CardCategory;
  currentBp: number | null;
}

export interface PendingEffect {
  id: string;
  sourceInstanceId: string;
  sourceCardName: string;
  effectName: string;
  controllerId: string;
  targetPlayerId: string;
  targetType: EffectTargetType;
  candidates: EffectTargetCandidate[];
  payload: Record<string, unknown>;
}

export interface RoomPlayer {
  playerId: string;
  displayName: string;
  socket: WebSocket | null;
}

export interface Room {
  id: string;
  players: [RoomPlayer | null, RoomPlayer | null];
  gameState: InternalGameState | null;
  createdAt: string;
}

export interface InternalGameState {
  roomId: string;
  status: "waiting" | "active" | "finished";
  winner: PlayerIndex | null;
  turnNumber: number;
  activePlayerIndex: PlayerIndex;
  currentStep: TurnStep;
  phase: BattlePhase;
  flashStep: FlashStep | null;
  priorityPlayer: string | null;
  passCount: number;
  startedAt: string | null;
  players: [PlayerState, PlayerState];
  pendingAttack: PendingAttackState | null;
  pendingEffect: PendingEffect | null;
  message: string;
  battleLog: string[];
}

export interface ClientPendingAttackState {
  attackerPlayerIndex: PlayerIndex;
  attackerCard: PublicCard;
  defendingPlayerIndex: PlayerIndex;
  canRespond: boolean;
  resolutionMode: AttackResolutionMode;
  blockerCard: PublicCard | null;
  mustBlock: boolean;
  mustBlockBySpiritOnly: boolean;
}

export interface PlayerVisibleState {
  playerIndex: PlayerIndex;
  hand: PublicCard[];
  spiritZone: PublicCard[];
  nexusZone: PublicCard[];
  symbolTotals: Record<CardColor, number>;
  life: number;
  deckCount: number;
  trash: PublicCard[];
  cores: CoreState;
}

export interface OpponentVisibleState {
  playerIndex: PlayerIndex;
  handCount: number;
  spiritZone: PublicCard[];
  nexusZone: PublicCard[];
  symbolTotals: Record<CardColor, number>;
  life: number;
  deckCount: number;
  trash: PublicCard[];
  cores: CoreState;
}

export interface ClientGameState {
  roomId: string;
  status: "waiting" | "active" | "finished";
  winner: PlayerIndex | null;
  turnNumber: number;
  activePlayerIndex: PlayerIndex;
  currentStep: TurnStep;
  phase: BattlePhase;
  flashStep: FlashStep | null;
  priorityPlayer: string | null;
  passCount: number;
  startedAt: string | null;
  viewerPlayerIndex: PlayerIndex;
  you: PlayerVisibleState;
  opponent: OpponentVisibleState;
  pendingAttack: ClientPendingAttackState | null;
  pendingEffect: PendingEffect | null;
  message: string;
  battleLog: string[];
}

export interface CommandResult {
  ok: boolean;
  error?: string;
}

export type ClientCommand =
  | { type: "ADVANCE_STEP" }
  | { type: "DRAW" }
  | { type: "END_TURN" }
  | { type: "FLASH_PASS" }
  | { type: "PLAY_CARD"; instanceId: string }
  | { type: "CHOOSE_MAGIC_MODE"; instanceId: string; mode: string }
  | { type: "ACTIVATE_CARD_EFFECT"; instanceId: string; effectName: string }
  | { type: "RESOLVE_EFFECT_TARGET"; pendingEffectId: string; targetInstanceId: string | null }
  | { type: "TRASH_FIELD_CARD"; zone: "spirit" | "nexus"; instanceId: string }
  | { type: "MOVE_CORE_TO_FIELD"; zone: "spirit" | "nexus"; instanceId: string }
  | { type: "MOVE_CORE_TO_RESERVE"; zone: "spirit" | "nexus"; instanceId: string }
  | { type: "ATTACK"; instanceId: string }
  | { type: "RESPOND_TO_ATTACK"; mode: "life" }
  | { type: "RESPOND_TO_ATTACK"; mode: "block"; blockerInstanceId: string };

export type ClientMessage = { type: "COMMAND"; command: ClientCommand };
