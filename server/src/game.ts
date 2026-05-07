import type {
  AttackResolutionMode,
  CardCategory,
  CardDefinition,
  CardInstance,
  CardLevel,
  ClientCommand,
  ClientGameState,
  ClientPendingAttackState,
  CommandResult,
  CoreState,
  EffectTargetCandidate,
  FieldCard,
  FlashStep,
  InternalGameState,
  PendingEffect,
  PlayerIndex,
  PlayerState,
  PublicCard,
  Room,
  TurnStep,
} from "./types.js";

const STARTING_LIFE = 5;
const STARTING_RESERVE = 4;
const STARTING_HAND_SIZE = 4;
const STARTING_VOID = 30;
const COPIES_PER_CARD = 3;
const DEBUG_GAME = process.env.DEBUG_GAME === "true";
const DEBUG_NO_SHUFFLE = process.env.DEBUG_NO_SHUFFLE === "true";
const SYMBOL_COLORS = ["red", "blue", "green", "white", "yellow", "purple"] as const;

const CARD_IDS = {
  AIZEN: "A-001",
  NIGHT: "A-003",
  RYUMAN: "A-004",
  WOLF: "A-005",
  ARF: "A-006",
  ARV: "A-007",
  DOUBLE_DRAW: "A-008",
  SHINING_FLAME: "A-009",
  FLAME_TEMPEST: "A-010",
  VILLAGE: "A-011",
} as const;

const DEBUG_DECK_ORDER: Record<PlayerIndex, string[]> = {
  0: [
    CARD_IDS.NIGHT,
    CARD_IDS.DOUBLE_DRAW,
    CARD_IDS.WOLF,
    CARD_IDS.ARF,
    CARD_IDS.AIZEN,
    CARD_IDS.FLAME_TEMPEST,
    CARD_IDS.ARV,
    CARD_IDS.SHINING_FLAME,
    CARD_IDS.RYUMAN,
    CARD_IDS.VILLAGE,
    CARD_IDS.DOUBLE_DRAW,
  ],
  1: [
    CARD_IDS.RYUMAN,
    CARD_IDS.SHINING_FLAME,
    CARD_IDS.VILLAGE,
    CARD_IDS.FLAME_TEMPEST,
    CARD_IDS.AIZEN,
    CARD_IDS.NIGHT,
    CARD_IDS.ARF,
    CARD_IDS.DOUBLE_DRAW,
    CARD_IDS.WOLF,
    CARD_IDS.ARV,
    CARD_IDS.SHINING_FLAME,
  ],
};

export function maybeStartGame(room: Room, cards: CardDefinition[]) {
  if (room.gameState) {
    return room.gameState;
  }

  if (!room.players[0] || !room.players[1]) {
    return null;
  }

  const buildPlayerState = (playerIndex: PlayerIndex) => {
    const player = room.players[playerIndex];
    const deck = buildFixedDeck(cards, room.id, playerIndex);
    const { hand, remainingDeck } = splitOpeningCards(deck, playerIndex);

    return {
      playerIndex,
      playerId: player!.playerId,
      displayName: player!.displayName,
      hand,
      spiritZone: [],
      nexusZone: [],
      deck: remainingDeck,
      trash: [],
      cores: {
        lifeCores: STARTING_LIFE,
        reserveCores: STARTING_RESERVE,
        trashCores: 0,
        voidCores: STARTING_VOID,
      },
    } satisfies PlayerState;
  };

  room.gameState = {
    roomId: room.id,
    status: "active",
    winner: null,
    turnNumber: 1,
    activePlayerIndex: 0,
    currentStep: "start",
    phase: "normal",
    flashStep: null,
    priorityPlayer: null,
    passCount: 0,
    startedAt: new Date().toISOString(),
    players: [buildPlayerState(0), buildPlayerState(1)],
    pendingAttack: null,
    pendingEffect: null,
    message: `${room.players[0]!.displayName} のターン開始`,
    battleLog: [`Turn 1 start: ${room.players[0]!.displayName}`],
  };

  if (DEBUG_GAME) {
    addBattleLog(room.gameState, "DEBUG_GAME enabled: fixed opening hands active");
    if (DEBUG_NO_SHUFFLE) {
      addBattleLog(room.gameState, "DEBUG_NO_SHUFFLE enabled: deck order fixed");
    }
  }

  return room.gameState;
}

export function applyCommand(state: InternalGameState, playerIndex: PlayerIndex, command: ClientCommand): CommandResult {
  if (state.status !== "active") {
    return { ok: false, error: "対戦は終了しています" };
  }

  if (state.pendingEffect) {
    if (command.type !== "RESOLVE_EFFECT_TARGET") {
      return { ok: false, error: "効果解決中は対象選択のみ可能です" };
    }
    return resolveEffectTarget(state, playerIndex, command.pendingEffectId, command.targetInstanceId);
  }

  if (state.phase === "flash") {
    return resolveFlashCommand(state, playerIndex, command);
  }

  if (state.pendingAttack) {
    if (command.type !== "RESPOND_TO_ATTACK") {
      return { ok: false, error: "アタック解決中は防御側の応答のみ可能です" };
    }
    return resolvePendingAttack(state, playerIndex, command);
  }

  if (command.type === "RESPOND_TO_ATTACK") {
    return { ok: false, error: "pendingAttack がない状態では防御選択できません" };
  }

  if (command.type === "FLASH_PASS") {
    return { ok: false, error: "フラッシュ中でないためパスできません" };
  }

  if (command.type === "RESOLVE_EFFECT_TARGET" || command.type === "ACTIVATE_CARD_EFFECT" || command.type === "CHOOSE_MAGIC_MODE") {
    if (command.type === "ACTIVATE_CARD_EFFECT") {
      return { ok: false, error: "その効果は現在発動できません" };
    }
    return { ok: false, error: "現在その操作はできません" };
  }

  const player = state.players[playerIndex];

  switch (command.type) {
    case "ADVANCE_STEP":
      if (!isPlayersTurn(state, playerIndex)) {
        return notYourTurn();
      }
      return advanceStep(state, playerIndex);

    case "DRAW":
      if (!isPlayersTurn(state, playerIndex)) {
        return notYourTurn();
      }
      if (state.currentStep !== "draw") {
        return { ok: false, error: "ドローは draw ステップでのみ実行できます" };
      }
      return executeDrawStep(state, playerIndex);

    case "END_TURN":
      if (!isPlayersTurn(state, playerIndex)) {
        return notYourTurn();
      }
      if (state.currentStep !== "end") {
        return { ok: false, error: "ターン終了は end ステップでのみ実行できます" };
      }
      return finalizeTurn(state, playerIndex);

    case "PLAY_CARD":
      if (!isPlayersTurn(state, playerIndex)) {
        return notYourTurn();
      }
      if (state.currentStep !== "main") {
        return { ok: false, error: "召喚・配置・magic使用は main ステップでのみ可能です" };
      }
      return playCardFromHand(state, playerIndex, command.instanceId, "main");

    case "TRASH_FIELD_CARD": {
      if (!isPlayersTurn(state, playerIndex)) {
        return notYourTurn();
      }
      if (state.currentStep !== "main") {
        return { ok: false, error: "フィールド移動は main ステップでのみ可能です" };
      }

      const zone = getZone(player, command.zone);
      const fieldIndex = zone.findIndex((card) => card.instanceId === command.instanceId);
      if (fieldIndex < 0) {
        return { ok: false, error: "指定されたフィールドカードが見つかりません" };
      }

      const [card] = zone.splice(fieldIndex, 1);
      releaseFieldCardCores(player.cores, card);
      player.trash.push(stripFieldCard(card));
      setMessage(state, `${player.displayName} が ${card.name} をトラッシュへ送りました`);
      return { ok: true };
    }

    case "MOVE_CORE_TO_FIELD": {
      if (!isPlayersTurn(state, playerIndex)) {
        return notYourTurn();
      }
      if (state.currentStep !== "main") {
        return { ok: false, error: "コア移動は main ステップでのみ可能です" };
      }
      if (player.cores.reserveCores < 1) {
        return { ok: false, error: "リザーブコアが不足しています" };
      }

      const fieldCard = getZone(player, command.zone).find((card) => card.instanceId === command.instanceId);
      if (!fieldCard) {
        return { ok: false, error: "指定されたフィールドカードが見つかりません" };
      }

      player.cores.reserveCores -= 1;
      fieldCard.coreCount += 1;
      setMessage(state, `${player.displayName} が ${fieldCard.name} にコアを置きました`);
      return { ok: true };
    }

    case "MOVE_CORE_TO_RESERVE": {
      if (!isPlayersTurn(state, playerIndex)) {
        return notYourTurn();
      }
      if (state.currentStep !== "main") {
        return { ok: false, error: "コア移動は main ステップでのみ可能です" };
      }

      const fieldCard = getZone(player, command.zone).find((card) => card.instanceId === command.instanceId);
      if (!fieldCard) {
        return { ok: false, error: "指定されたフィールドカードが見つかりません" };
      }
      if (fieldCard.coreCount < 1) {
        return { ok: false, error: "そのカードに移動できるコアがありません" };
      }

      fieldCard.coreCount -= 1;
      player.cores.reserveCores += 1;
      setMessage(state, `${player.displayName} が ${fieldCard.name} からコアを戻しました`);
      destroyFieldCardsWithNoCores(state, playerIndex);
      return { ok: true };
    }

    case "ATTACK":
      if (!isPlayersTurn(state, playerIndex)) {
        return notYourTurn();
      }
      if (state.currentStep !== "attack") {
        return { ok: false, error: "アタックは attack ステップでのみ可能です" };
      }
      return startAttack(state, playerIndex, command.instanceId);
  }
}

export function toClientState(state: InternalGameState, viewerPlayerIndex: PlayerIndex): ClientGameState {
  const you = state.players[viewerPlayerIndex];
  const opponent = state.players[otherPlayer(viewerPlayerIndex)];

  return {
    roomId: state.roomId,
    status: state.status,
    winner: state.winner,
    turnNumber: state.turnNumber,
    activePlayerIndex: state.activePlayerIndex,
    currentStep: state.currentStep,
    phase: state.phase,
    flashStep: state.flashStep,
    priorityPlayer: state.priorityPlayer,
    passCount: state.passCount,
    startedAt: state.startedAt,
    viewerPlayerIndex,
    you: {
      playerIndex: you.playerIndex,
      hand: you.hand.map((card) => toHandCard(state, card, you)),
      spiritZone: you.spiritZone.map((card) => toPublicFieldCard(state, you, card)),
      nexusZone: you.nexusZone.map((card) => toPublicFieldCard(state, you, card)),
      symbolTotals: countReductionSymbols(you),
      life: you.cores.lifeCores,
      deckCount: you.deck.length,
      trash: you.trash.map(toPublicCard),
      cores: { ...you.cores },
    },
    opponent: {
      playerIndex: opponent.playerIndex,
      handCount: opponent.hand.length,
      spiritZone: opponent.spiritZone.map((card) => toPublicFieldCard(state, opponent, card)),
      nexusZone: opponent.nexusZone.map((card) => toPublicFieldCard(state, opponent, card)),
      symbolTotals: countReductionSymbols(opponent),
      life: opponent.cores.lifeCores,
      deckCount: opponent.deck.length,
      trash: opponent.trash.map(toPublicCard),
      cores: { ...opponent.cores },
    },
    pendingAttack: buildPendingAttack(state, viewerPlayerIndex),
    pendingEffect: state.pendingEffect,
    message: state.message,
    battleLog: state.battleLog,
  };
}

function advanceStep(state: InternalGameState, playerIndex: PlayerIndex): CommandResult {
  switch (state.currentStep) {
    case "start":
      state.currentStep = "core";
      setMessage(state, `${state.players[playerIndex].displayName} の core ステップ開始`);
      return { ok: true };
    case "core":
      return executeCoreStep(state, playerIndex);
    case "draw":
      return executeDrawStep(state, playerIndex);
    case "refresh":
      return executeRefreshStep(state, playerIndex);
    case "main":
      state.currentStep = "attack";
      setMessage(state, `${state.players[playerIndex].displayName} の attack ステップ開始`);
      addBattleLog(state, `${state.players[playerIndex].displayName} attack step start`);
      return { ok: true };
    case "attack":
      state.currentStep = "end";
      clearBattleOnlyBonuses(state);
      setMessage(state, `${state.players[playerIndex].displayName} の end ステップ開始`);
      return { ok: true };
    case "end":
      return finalizeTurn(state, playerIndex);
  }
}

function executeCoreStep(state: InternalGameState, playerIndex: PlayerIndex): CommandResult {
  const player = state.players[playerIndex];
  const isFirstPlayerFirstTurn = state.turnNumber === 1 && playerIndex === 0;

  if (!isFirstPlayerFirstTurn) {
    moveVoidToReserve(player.cores, 1);
    setMessage(state, `${player.displayName} がボイドからリザーブへコアを1個置きました`);
    addBattleLog(state, `${player.displayName} core step: +1 core`);
  } else {
    setMessage(state, `${player.displayName} は先攻1ターン目なのでコア追加を行いません`);
    addBattleLog(state, `${player.displayName} core step: no core on first turn`);
  }

  state.currentStep = "draw";
  return { ok: true };
}

function executeDrawStep(state: InternalGameState, playerIndex: PlayerIndex): CommandResult {
  const player = state.players[playerIndex];
  const drawn = drawCards(state, player, 1);
  if (state.status !== "active") {
    return { ok: true };
  }
  state.currentStep = "refresh";
  setMessage(state, `${player.displayName} が draw ステップで${drawn}枚ドローしました`);
  return { ok: true };
}

function executeRefreshStep(state: InternalGameState, playerIndex: PlayerIndex): CommandResult {
  readyPlayerForTurn(state.players[playerIndex]);
  state.currentStep = "main";
  setMessage(state, `${state.players[playerIndex].displayName} の refresh ステップを解決しました`);
  addBattleLog(state, "リフレッシュで全て回復した");
  addBattleLog(state, `${state.players[playerIndex].displayName} main step start`);
  return { ok: true };
}

function finalizeTurn(state: InternalGameState, playerIndex: PlayerIndex): CommandResult {
  addBattleLog(state, `${state.players[playerIndex].displayName} turn end`);
  state.activePlayerIndex = otherPlayer(playerIndex);
  state.turnNumber += 1;
  state.currentStep = "start";
  clearFlashState(state);
  clearBattleOnlyBonuses(state);
  clearTemporaryBonuses(state);
  state.pendingAttack = null;
  state.pendingEffect = null;
  setMessage(state, `${state.players[state.activePlayerIndex].displayName} のターン開始`);
  addBattleLog(state, `Turn ${state.turnNumber} start: ${state.players[state.activePlayerIndex].displayName}`);
  return { ok: true };
}

function startAttack(state: InternalGameState, playerIndex: PlayerIndex, instanceId: string): CommandResult {
  const player = state.players[playerIndex];
  const attacker = player.spiritZone.find((card) => card.instanceId === instanceId);
  if (!attacker) {
    return { ok: false, error: "指定されたアタッカーが見つかりません" };
  }
  if (attacker.attackedThisTurn) {
    return { ok: false, error: "そのカードはこのターンすでにアタック済みです" };
  }
  if (!attacker.isRested) {
    return { ok: false, error: "疲労状態のカードはアタックできません" };
  }
  if (!getCurrentLevel(attacker, attacker.coreCount)) {
    return { ok: false, error: "現在のコア数では有効なレベルがありません" };
  }

  attacker.attackedThisTurn = true;
  attacker.isRested = false;
  state.pendingAttack = {
    attackerPlayerIndex: playerIndex,
    attackerInstanceId: attacker.instanceId,
    defendingPlayerIndex: otherPlayer(playerIndex),
    resolutionMode: "pending",
    blockerInstanceId: null,
    mustBlock: false,
    mustBlockBySpiritOnly: false,
    lifeDamageOnSpiritBlock: 0,
  };

  setMessage(state, `${player.displayName} の ${attacker.name} がアタックし疲労した`);

  const result = handleAttackTriggeredEffects(state, playerIndex, attacker);
  if (!result.ok) {
    return result;
  }

  if (!state.pendingEffect) {
    startFlashWindow(state, "attackFlash");
    autoPassFlashIfNoPlayableMagic(state);
  }
  return { ok: true };
}

function resolveFlashCommand(state: InternalGameState, playerIndex: PlayerIndex, command: ClientCommand): CommandResult {
  if (!state.pendingAttack || !state.flashStep || !state.priorityPlayer) {
    clearFlashState(state);
    return { ok: false, error: "フラッシュ対象がありません" };
  }
  if (!hasPriority(state, playerIndex)) {
    return { ok: false, error: "優先権がないプレイヤーは操作できません" };
  }

  switch (command.type) {
    case "FLASH_PASS":
      return handleFlashPass(state, playerIndex);

    case "PLAY_CARD":
      return playCardFromHand(state, playerIndex, command.instanceId, "flash");

    case "CHOOSE_MAGIC_MODE":
      return chooseMagicMode(state, playerIndex, command.instanceId, command.mode);

    case "ACTIVATE_CARD_EFFECT":
      return activateCardEffect(state, playerIndex, command.instanceId, command.effectName);

    default:
      return { ok: false, error: "フラッシュ中は magic 使用、効果発動、パスのみ可能です" };
  }
}

function applyFlashPass(state: InternalGameState, playerIndex: PlayerIndex, autoPassed: boolean) {
  const player = state.players[playerIndex];
  addBattleLog(state, autoPassed ? `${player.displayName} は使用可能なマジックがないため自動パス` : `${player.displayName} passed`);
  state.passCount += 1;

  if (state.passCount >= 2) {
    const finishedStep = state.flashStep!;
    addBattleLog(state, `${finishedStep} finished`);
    clearFlashState(state);

    if (finishedStep === "attackFlash") {
      setMessage(state, "attackFlash finished. Choose block or life.");
      return;
    }

    resolveCombatAfterBlockFlash(state);
    return;
  }

  state.priorityPlayer = state.players[otherPlayer(playerIndex)].playerId;
  setMessage(state, autoPassed ? `${player.displayName} auto passed. Priority moved.` : `${player.displayName} passed. Priority moved.`);
}

function handleFlashPass(state: InternalGameState, playerIndex: PlayerIndex): CommandResult {
  applyFlashPass(state, playerIndex, false);
  autoPassFlashIfNoPlayableMagic(state);
  return { ok: true };
  const player = state.players[playerIndex];
  addBattleLog(state, `${player.displayName} がパス`);
  state.passCount += 1;

  if (state.passCount >= 2) {
    const finishedStep = state.flashStep!;
    addBattleLog(state, `${finishedStep} 終了`);
    clearFlashState(state);

    if (finishedStep === "attackFlash") {
      setMessage(state, "attackFlash が終了しました。防御側はブロック宣言かライフ受けを選択してください");
      return { ok: true };
    }

    resolveCombatAfterBlockFlash(state);
    return { ok: true };
  }

  state.priorityPlayer = state.players[otherPlayer(playerIndex)].playerId;
  setMessage(state, `${player.displayName} がパスしました。優先権が移動します`);
  return { ok: true };
}

function resolvePendingAttack(
  state: InternalGameState,
  playerIndex: PlayerIndex,
  command: Extract<ClientCommand, { type: "RESPOND_TO_ATTACK" }>,
): CommandResult {
  const pending = state.pendingAttack;
  if (!pending) {
    return { ok: false, error: "pendingAttack がない状態では防御選択できません" };
  }
  if (pending.defendingPlayerIndex !== playerIndex) {
    return { ok: false, error: "防御選択ができるのは防御側プレイヤーだけです" };
  }
  if (state.currentStep !== "attack") {
    return { ok: false, error: "防御選択は attack ステップでのみ可能です" };
  }
  if (state.phase !== "normal") {
    return { ok: false, error: "フラッシュ中はまだ防御選択できません" };
  }
  if (pending.resolutionMode !== "pending") {
    return { ok: false, error: "ブロック宣言はすでに完了しています" };
  }

  const defender = state.players[pending.defendingPlayerIndex];
  const availableBlockers = getAvailableBlockers(state, defender, pending.mustBlockBySpiritOnly);

  if (command.mode === "life") {
    if (pending.mustBlock && availableBlockers.length > 0) {
      return { ok: false, error: "このアタックはブロックしなければなりません" };
    }
    pending.resolutionMode = "life";
    pending.blockerInstanceId = null;
    addBattleLog(state, `${defender.displayName} がライフ受けを宣言`);
    startFlashWindow(state, "blockFlash");
    autoPassFlashIfNoPlayableMagic(state);
    if (!isFlashActive(state)) {
      return { ok: true };
    }
    setMessage(state, `${defender.displayName} がライフ受けを宣言しました。blockFlash を開始します`);
    return { ok: true };
  }

  const blocker = defender.spiritZone.find((card) => card.instanceId === command.blockerInstanceId);
  if (!blocker) {
    return { ok: false, error: "指定されたブロッカーが見つかりません" };
  }
  if (!blocker.isRested) {
    return { ok: false, error: "疲労状態のカードはブロックできません" };
  }
  if ((blocker.coreCount ?? 0) <= 0 || !getCurrentLevel(blocker, blocker.coreCount)) {
    return { ok: false, error: "ブロック可能なコアがありません" };
  }
  if (pending.mustBlockBySpiritOnly && blocker.type !== "spirit") {
    return { ok: false, error: "このアタックはスピリットでのみブロックできます" };
  }

  blocker.isRested = false;
  pending.resolutionMode = "block";
  pending.blockerInstanceId = blocker.instanceId;
  addBattleLog(state, `${blocker.name} がブロックし疲労した`);

  const blockTrigger = handleBlockTriggeredEffects(state, playerIndex, blocker);
  if (!blockTrigger.ok) {
    return blockTrigger;
  }

  if (!state.pendingEffect) {
    startFlashWindow(state, "blockFlash");
    autoPassFlashIfNoPlayableMagic(state);
    if (!isFlashActive(state)) {
      return { ok: true };
    }
    setMessage(state, `${defender.displayName} が ${blocker.name} でブロックしました。blockFlash を開始します`);
  }
  return { ok: true };
}

function playCardFromHand(
  state: InternalGameState,
  playerIndex: PlayerIndex,
  instanceId: string,
  context: "main" | "flash",
): CommandResult {
  const player = state.players[playerIndex];
  const handIndex = player.hand.findIndex((card) => card.instanceId === instanceId);
  if (handIndex < 0) {
    return { ok: false, error: "指定された手札カードが見つかりません" };
  }
  const card = player.hand[handIndex];

  if (card.type === "magic") {
    if (card.id === CARD_IDS.FLAME_TEMPEST) {
      return { ok: false, error: "フレイムテンペストは効果モードを選択してください" };
    }
    if (card.id === CARD_IDS.DOUBLE_DRAW && context === "flash") {
      return { ok: false, error: "ダブルドローのフラッシュ効果は効果選択から使用してください" };
    }
    return playMagicCard(state, playerIndex, card, context, null);
  }

  if (context !== "main") {
    return { ok: false, error: "フラッシュ中は magic のみ使用可能です" };
  }

  const payment = calculateCardPayment(state, card, player);
  if (!payment.playable) {
    return { ok: false, error: `${card.name} を出すためのリザーブコアが不足しています` };
  }

  if (card.type === "ultimate" && !canSummonUltimate(card, player)) {
    return { ok: false, error: `${card.name} の召喚条件を満たしていません` };
  }

  player.hand.splice(handIndex, 1);
  moveReserveToTrash(player.cores, payment.reducedCost);
  player.cores.reserveCores -= 1;

  const fieldCard: FieldCard = {
    ...card,
    coreCount: 1,
    attackedThisTurn: false,
    isRested: true,
    temporaryBpBonus: 0,
    battleOnlyBpBonus: 0,
  };

  if (card.type === "nexus") {
    player.nexusZone.push(fieldCard);
    setMessage(state, `${player.displayName} が ${card.name} を nexus zone に配置しました`);
  } else {
    player.spiritZone.push(fieldCard);
    setMessage(state, `${player.displayName} が ${card.name} を spirit zone に出しました`);
  }

  handleSummonTriggeredEffects(state, playerIndex, fieldCard);
  return { ok: true };
}

function chooseMagicMode(state: InternalGameState, playerIndex: PlayerIndex, instanceId: string, mode: string): CommandResult {
  const player = state.players[playerIndex];
  const card = player.hand.find((entry) => entry.instanceId === instanceId);
  if (!card || card.type !== "magic") {
    return { ok: false, error: "対象のmagicカードが見つかりません" };
  }
  return playMagicCard(state, playerIndex, card, state.phase === "flash" ? "flash" : "main", mode);
}

function playMagicCard(
  state: InternalGameState,
  playerIndex: PlayerIndex,
  card: CardInstance,
  context: "main" | "flash",
  mode: string | null,
): CommandResult {
  const player = state.players[playerIndex];
  const handIndex = player.hand.findIndex((entry) => entry.instanceId === card.instanceId);
  if (handIndex < 0) {
    return { ok: false, error: "対象のmagicカードが見つかりません" };
  }

  if (context === "main" && !isPlayersTurn(state, playerIndex)) {
    return notYourTurn();
  }
  if (context === "main" && state.currentStep !== "main") {
    return { ok: false, error: "magic使用は main ステップでのみ可能です" };
  }
  if (context === "flash" && (!hasPriority(state, playerIndex) || state.phase !== "flash")) {
    return { ok: false, error: "フラッシュ中の優先権がありません" };
  }

  if (card.id !== CARD_IDS.DOUBLE_DRAW && context === "main") {
    return { ok: false, error: "このmagicはフラッシュ専用です" };
  }

  if (card.id === CARD_IDS.DOUBLE_DRAW && context === "flash" && mode !== "flashBp") {
    return { ok: false, error: "ダブルドローのフラッシュ効果モードが必要です" };
  }
  if (card.id === CARD_IDS.FLAME_TEMPEST && mode !== "single" && mode !== "allSmall") {
    return { ok: false, error: "フレイムテンペストの効果モードを選択してください" };
  }

  const payment = calculateCardPayment(state, card, player);
  if (!payment.playable) {
    return { ok: false, error: `${card.name} を使うためのリザーブコアが不足しています` };
  }

  player.hand.splice(handIndex, 1);
  moveReserveToTrash(player.cores, payment.reducedCost);
  player.trash.push(card);

  switch (card.id) {
    case CARD_IDS.DOUBLE_DRAW:
      return resolveDoubleDraw(state, playerIndex, card, context);
    case CARD_IDS.SHINING_FLAME:
      return resolveShiningFlame(state, playerIndex, card);
    case CARD_IDS.FLAME_TEMPEST:
      return resolveFlameTempest(state, playerIndex, card, mode!);
    default:
      return { ok: false, error: "未対応のmagicです" };
  }
}

function activateCardEffect(state: InternalGameState, playerIndex: PlayerIndex, instanceId: string, effectName: string): CommandResult {
  if (state.phase !== "flash" || !hasPriority(state, playerIndex)) {
    return { ok: false, error: "今はカード効果を発動できません" };
  }

  const player = state.players[playerIndex];
  const card = player.spiritZone.find((entry) => entry.instanceId === instanceId);
  if (!card) {
    return { ok: false, error: "対象のカードが見つかりません" };
  }

  if (card.id === CARD_IDS.ARF && effectName === "arFFlashCoreBoost") {
    const level = getCurrentLevel(card, card.coreCount);
    if (!level || level.lv < 4) {
      return { ok: false, error: "ARジークF のフラッシュ効果を使えるレベルではありません" };
    }
    const candidates = player.spiritZone
      .filter((entry) => entry.instanceId !== card.instanceId && entry.type === "spirit" && entry.coreCount >= 1)
      .map((entry) => toEffectCandidate(state, player.playerId, "spirit", entry));
    if (candidates.length === 0) {
      return { ok: false, error: "コアを移せる自分のスピリットがいません" };
    }
    createPendingEffect(state, {
      sourceInstanceId: card.instanceId,
      sourceCardName: card.name,
      effectName: "arFFlashCoreBoost",
      controllerId: player.playerId,
      targetPlayerId: player.playerId,
      targetType: "ownSpiritWithCore",
      candidates,
      payload: { flashAction: true },
    });
    setMessage(state, `${card.name} のフラッシュ効果対象を選択してください`);
    return { ok: true };
  }

  return { ok: false, error: "その効果は現在発動できません" };
}

function resolveEffectTarget(
  state: InternalGameState,
  playerIndex: PlayerIndex,
  pendingEffectId: string,
  targetInstanceId: string | null,
): CommandResult {
  const pendingEffect = state.pendingEffect;
  if (!pendingEffect || pendingEffect.id !== pendingEffectId) {
    return { ok: false, error: "対象選択中の効果が見つかりません" };
  }
  if (pendingEffect.controllerId !== state.players[playerIndex].playerId) {
    return { ok: false, error: "この効果を選択できるプレイヤーではありません" };
  }

  const target =
    targetInstanceId === null ? null : pendingEffect.candidates.find((candidate) => candidate.instanceId === targetInstanceId) ?? null;
  if (targetInstanceId !== null && !target) {
    return { ok: false, error: "候補にない対象は選べません" };
  }

  state.pendingEffect = null;

  switch (pendingEffect.effectName) {
    case "aizenBattleDestroy":
      resolveAizenBattleEffect(state, pendingEffect, target);
      break;
    case "nightSummonDestroyNexus":
      if (target) {
        destroyNexusByPlayerId(state, target.playerId, target.instanceId);
        addBattleLog(state, `${pendingEffect.sourceCardName} で ${target.name} を破壊`);
      }
      break;
    case "ryumanDestroyedDestroy":
      if (target) {
        destroySpiritByPlayerId(state, target.playerId, target.instanceId);
        addBattleLog(state, `${pendingEffect.sourceCardName} で ${target.name} を破壊`);
      }
      break;
    case "shiningFlameDestroy":
      if (target) {
        destroySpiritByPlayerId(state, target.playerId, target.instanceId);
        addBattleLog(state, `シャイニングフレイムで ${target.name} を破壊`);
      }
      break;
    case "flameTempestDestroyOne":
      if (target) {
        destroySpiritByPlayerId(state, target.playerId, target.instanceId);
        addBattleLog(state, `フレイムテンペストで ${target.name} を破壊`);
      }
      break;
    case "arvAttackDestroySpirit":
      if (target) {
        destroySpiritByPlayerId(state, target.playerId, target.instanceId);
        addBattleLog(state, `ARジークVで ${target.name} を破壊`);
      }
      break;
    case "villageLifeDestroy":
      if (target) {
        destroySpiritByPlayerId(state, target.playerId, target.instanceId);
        addBattleLog(state, `狩る者の集落で ${target.name} を破壊`);
      }
      break;
    case "arFFlashCoreBoost":
      resolveArFCoreBoost(state, pendingEffect, target);
      break;
    case "doubleDrawFlashBuff":
      resolveDoubleDrawFlashBuff(state, pendingEffect, target);
      break;
    default:
      return { ok: false, error: "未対応の効果解決です" };
  }

  afterPendingEffectResolution(state, pendingEffect, playerIndex);
  return { ok: true };
}

function afterPendingEffectResolution(state: InternalGameState, effect: PendingEffect, playerIndex: PlayerIndex) {
  const payload = effect.payload;
  if (payload.drawIfUltimate === true) {
    const player = getPlayerById(state, effect.controllerId);
    if (player && hasOwnUltimate(player)) {
      drawCards(state, player, 1);
      addBattleLog(state, `${effect.sourceCardName} の効果で1枚ドロー`);
    }
  }

  const startFlash = payload.startFlashStep as FlashStep | undefined;
  if (startFlash) {
    startFlashWindow(state, startFlash);
    autoPassFlashIfNoPlayableMagic(state);
    if (!isFlashActive(state)) {
      return;
    }
    if (startFlash === "blockFlash") {
      setMessage(state, "blockFlash を開始します");
    } else {
      setMessage(state, "attackFlash を開始します");
    }
  }

  if (payload.flashAction === true) {
    state.passCount = 0;
    state.priorityPlayer = state.players[otherPlayer(playerIndex)].playerId;
    setMessage(state, `${effect.sourceCardName} の効果を解決しました。優先権が移動します`);
  }
}

function handleSummonTriggeredEffects(state: InternalGameState, playerIndex: PlayerIndex, card: FieldCard) {
  const player = state.players[playerIndex];
  const opponent = state.players[otherPlayer(playerIndex)];
  const level = getCurrentLevel(card, card.coreCount);
  if (!level) {
    return;
  }

  if (card.id === CARD_IDS.NIGHT && level.lv <= 2 && hasOwnUltimate(player)) {
    const candidates = opponent.nexusZone.map((entry) => toEffectCandidate(state, opponent.playerId, "nexus", entry));
    if (candidates.length === 1) {
      destroyNexusByPlayerId(state, candidates[0].playerId, candidates[0].instanceId);
      addBattleLog(state, `${card.name} summon effect destroyed ${candidates[0].name}`);
    } else if (candidates.length > 0) {
      createPendingEffect(state, {
        sourceInstanceId: card.instanceId,
        sourceCardName: card.name,
        effectName: "nightSummonDestroyNexus",
        controllerId: player.playerId,
        targetPlayerId: opponent.playerId,
        targetType: "nexus",
        candidates,
        payload: {},
      });
      setMessage(state, `${card.name} の召喚時効果で破壊するネクサスを選択してください`);
    }
  }

  if (card.id === CARD_IDS.ARV && level.lv >= 3) {
    const trashed = trashTopDeckCard(opponent);
    if (trashed) {
      addBattleLog(state, `${card.name} の召喚時効果で ${opponent.displayName} のデッキトップ ${trashed.name}(cost:${trashed.cost}) を破棄`);
      if (trashed.cost < card.cost) {
        const added = addLifeFromVoid(player, trashed.cost, 5);
        addBattleLog(state, `${card.name} の効果でライフを ${added} 増やした`);
      }
    }
  }
}

function handleAttackTriggeredEffects(state: InternalGameState, playerIndex: PlayerIndex, attacker: FieldCard): CommandResult {
  const player = state.players[playerIndex];
  const opponent = state.players[otherPlayer(playerIndex)];
  const level = getCurrentLevel(attacker, attacker.coreCount);
  if (!level) {
    return { ok: true };
  }

  if (attacker.id === CARD_IDS.NIGHT && level.lv <= 2) {
    drawCards(state, player, 1);
    addBattleLog(state, `${attacker.name} のアタック時効果で1枚ドロー`);
  }

  if (attacker.id === CARD_IDS.WOLF) {
    let amount = 3000;
    if (hasOwnUltimate(player)) {
      amount += 3000;
    }
    attacker.battleOnlyBpBonus += amount;
    addBattleLog(state, `${attacker.name} のアタック時効果で BP +${amount}`);
  }

  if (attacker.id === CARD_IDS.AIZEN) {
    const candidates = opponent.spiritZone
      .filter((card) => (getCurrentBp(state, opponent, card) ?? 0) <= 3000)
      .map((card) => toEffectCandidate(state, opponent.playerId, "spirit", card));
    if (candidates.length === 1) {
      resolveAizenBattleEffect(state, {
        id: "immediate-aizen-attack",
        sourceInstanceId: attacker.instanceId,
        sourceCardName: attacker.name,
        effectName: "aizenBattleDestroy",
        controllerId: player.playerId,
        targetPlayerId: opponent.playerId,
        targetType: "spirit",
        candidates,
        payload: {},
      }, candidates[0]);
      if (hasOwnUltimate(player)) {
        drawCards(state, player, 1);
        addBattleLog(state, `${attacker.name} battle effect drew 1 card`);
      }
      return { ok: true };
    }
    if (candidates.length > 1) {
      createPendingEffect(state, {
        sourceInstanceId: attacker.instanceId,
        sourceCardName: attacker.name,
        effectName: "aizenBattleDestroy",
        controllerId: player.playerId,
        targetPlayerId: opponent.playerId,
        targetType: "spirit",
        candidates,
        payload: { drawIfUltimate: hasOwnUltimate(player), startFlashStep: "attackFlash" },
      });
      setMessage(state, `${attacker.name} のバトル時効果対象を選択してください`);
      return { ok: true };
    }
    if (hasOwnUltimate(player)) {
      drawCards(state, player, 1);
      addBattleLog(state, `${attacker.name} の効果で1枚ドロー`);
    }
  }

  if (attacker.id === CARD_IDS.ARF && level.lv >= 3) {
    const trashed = trashTopDeckCard(opponent);
    if (trashed) {
      addBattleLog(state, `${attacker.name} の効果で ${opponent.displayName} のデッキトップ ${trashed.name}(cost:${trashed.cost}) を破棄`);
      if (trashed.cost < attacker.cost && state.pendingAttack) {
        state.pendingAttack.mustBlock = true;
        state.pendingAttack.mustBlockBySpiritOnly = true;
        state.pendingAttack.lifeDamageOnSpiritBlock = 1;
        addBattleLog(state, `${attacker.name} の効果でスピリットによる強制ブロックが発生`);
      }
    }
  }

  if (attacker.id === CARD_IDS.ARV && level.lv >= 4) {
    const trashed = trashTopDeckCard(opponent);
    if (trashed) {
      addBattleLog(state, `${attacker.name} の効果で ${opponent.displayName} のデッキトップ ${trashed.name}(cost:${trashed.cost}) を破棄`);
      if (trashed.cost < attacker.cost && state.pendingAttack) {
        state.pendingAttack.mustBlock = true;
        state.pendingAttack.mustBlockBySpiritOnly = false;
      }
      if (trashed.cost <= 4) {
        const candidates = opponent.spiritZone
          .filter((card) => (getCurrentBp(state, opponent, card) ?? 0) <= 12000)
          .map((card) => toEffectCandidate(state, opponent.playerId, "spirit", card));
        if (candidates.length > 0) {
          createPendingEffect(state, {
            sourceInstanceId: attacker.instanceId,
            sourceCardName: attacker.name,
            effectName: "arvAttackDestroySpirit",
            controllerId: player.playerId,
            targetPlayerId: opponent.playerId,
            targetType: "spirit",
            candidates,
            payload: { startFlashStep: "attackFlash" },
          });
          setMessage(state, `${attacker.name} の効果で破壊するスピリットを選択してください`);
          return { ok: true };
        }
      }
    }
  }

  return { ok: true };
}

function handleBlockTriggeredEffects(state: InternalGameState, playerIndex: PlayerIndex, blocker: FieldCard): CommandResult {
  const player = state.players[playerIndex];
  const opponent = state.players[otherPlayer(playerIndex)];

  if (blocker.id === CARD_IDS.AIZEN) {
    const candidates = opponent.spiritZone
      .filter((card) => (getCurrentBp(state, opponent, card) ?? 0) <= 3000)
      .map((card) => toEffectCandidate(state, opponent.playerId, "spirit", card));
    if (candidates.length === 1) {
      resolveAizenBattleEffect(state, {
        id: "immediate-aizen-block",
        sourceInstanceId: blocker.instanceId,
        sourceCardName: blocker.name,
        effectName: "aizenBattleDestroy",
        controllerId: player.playerId,
        targetPlayerId: opponent.playerId,
        targetType: "spirit",
        candidates,
        payload: {},
      }, candidates[0]);
      if (hasOwnUltimate(player)) {
        drawCards(state, player, 1);
        addBattleLog(state, `${blocker.name} battle effect drew 1 card`);
      }
      return { ok: true };
    }
    if (candidates.length > 1) {
      createPendingEffect(state, {
        sourceInstanceId: blocker.instanceId,
        sourceCardName: blocker.name,
        effectName: "aizenBattleDestroy",
        controllerId: player.playerId,
        targetPlayerId: opponent.playerId,
        targetType: "spirit",
        candidates,
        payload: { drawIfUltimate: hasOwnUltimate(player), startFlashStep: "blockFlash" },
      });
      setMessage(state, `${blocker.name} のバトル時効果対象を選択してください`);
      return { ok: true };
    }
    if (hasOwnUltimate(player)) {
      drawCards(state, player, 1);
      addBattleLog(state, `${blocker.name} の効果で1枚ドロー`);
    }
  }

  return { ok: true };
}

function resolveDoubleDraw(state: InternalGameState, playerIndex: PlayerIndex, card: CardInstance, context: "main" | "flash"): CommandResult {
  const player = state.players[playerIndex];
  if (context === "main") {
    let drawCount = 2;
    if (hasOwnUltimate(player)) {
      drawCount += 1;
    }
    drawCards(state, player, drawCount);
    setMessage(state, `${player.displayName} が ${card.name} を使用し ${drawCount} 枚ドローしました`);
    addBattleLog(state, `${card.name} のメイン効果で ${drawCount} 枚ドロー`);
    return { ok: true };
  }

  const candidates = getAllUnitCandidates(state);
  if (candidates.length === 0) {
    addBattleLog(state, `${card.name} のフラッシュ効果対象がいなかった`);
    finishFlashAction(state, playerIndex, card.name);
    autoPassFlashIfNoPlayableMagic(state);
    return { ok: true };
  }

  createPendingEffect(state, {
    sourceInstanceId: card.instanceId,
    sourceCardName: card.name,
    effectName: "doubleDrawFlashBuff",
    controllerId: player.playerId,
    targetPlayerId: "",
    targetType: "anyUnit",
    candidates,
    payload: { flashAction: true },
  });
  setMessage(state, `${card.name} のBPアップ対象を選択してください`);
  return { ok: true };
}

function resolveShiningFlame(state: InternalGameState, playerIndex: PlayerIndex, card: CardInstance): CommandResult {
  const opponent = state.players[otherPlayer(playerIndex)];
  const candidates = opponent.spiritZone
    .filter((entry) => (getCurrentBp(state, opponent, entry) ?? 0) <= 10000)
    .map((entry) => toEffectCandidate(state, opponent.playerId, "spirit", entry));

  if (candidates.length === 0) {
    addBattleLog(state, `${card.name} の対象がいなかった`);
    finishFlashAction(state, playerIndex, card.name);
    autoPassFlashIfNoPlayableMagic(state);
    return { ok: true };
  }

  createPendingEffect(state, {
    sourceInstanceId: card.instanceId,
    sourceCardName: card.name,
    effectName: "shiningFlameDestroy",
    controllerId: state.players[playerIndex].playerId,
    targetPlayerId: opponent.playerId,
    targetType: "spirit",
    candidates,
    payload: { flashAction: true },
  });
  setMessage(state, `${card.name} の破壊対象を選択してください`);
  return { ok: true };
}

function resolveFlameTempest(state: InternalGameState, playerIndex: PlayerIndex, card: CardInstance, mode: string): CommandResult {
  const opponent = state.players[otherPlayer(playerIndex)];

  if (mode === "allSmall") {
    const targets = opponent.spiritZone.filter((entry) => (getCurrentBp(state, opponent, entry) ?? 0) <= 4000);
    for (const target of [...targets]) {
      destroySpiritByPlayerId(state, opponent.playerId, target.instanceId);
    }
    addBattleLog(state, `${card.name} で BP4000以下のスピリットをすべて破壊`);
    finishFlashAction(state, playerIndex, card.name);
    autoPassFlashIfNoPlayableMagic(state);
    return { ok: true };
  }

  const candidates = opponent.spiritZone
    .filter((entry) => (getCurrentBp(state, opponent, entry) ?? 0) <= 8000)
    .map((entry) => toEffectCandidate(state, opponent.playerId, "spirit", entry));

  if (candidates.length === 0) {
    addBattleLog(state, `${card.name} の対象がいなかった`);
    finishFlashAction(state, playerIndex, card.name);
    autoPassFlashIfNoPlayableMagic(state);
    return { ok: true };
  }

  createPendingEffect(state, {
    sourceInstanceId: card.instanceId,
    sourceCardName: card.name,
    effectName: "flameTempestDestroyOne",
    controllerId: state.players[playerIndex].playerId,
    targetPlayerId: opponent.playerId,
    targetType: "spirit",
    candidates,
    payload: { flashAction: true },
  });
  setMessage(state, `${card.name} の破壊対象を選択してください`);
  return { ok: true };
}

function resolveAizenBattleEffect(state: InternalGameState, effect: PendingEffect, target: EffectTargetCandidate | null) {
  if (target) {
    destroySpiritByPlayerId(state, target.playerId, target.instanceId);
    addBattleLog(state, `${effect.sourceCardName} で ${target.name} を破壊`);
  } else {
    addBattleLog(state, `${effect.sourceCardName} の破壊対象がいなかった`);
  }
}

function resolveArFCoreBoost(state: InternalGameState, effect: PendingEffect, target: EffectTargetCandidate | null) {
  if (!target) {
    return;
  }
  const owner = getPlayerById(state, effect.controllerId);
  const source = owner?.spiritZone.find((entry) => entry.instanceId === effect.sourceInstanceId) ?? null;
  const from = owner?.spiritZone.find((entry) => entry.instanceId === target.instanceId) ?? null;
  if (!owner || !source || !from || from.coreCount < 1) {
    return;
  }
  from.coreCount -= 1;
  source.coreCount += 1;
  source.temporaryBpBonus += 3000;
  destroyFieldCardsWithNoCores(state, owner.playerIndex);
  addBattleLog(state, `${effect.sourceCardName} が ${from.name} からコアを移し BP +3000`);
}

function resolveDoubleDrawFlashBuff(state: InternalGameState, effect: PendingEffect, target: EffectTargetCandidate | null) {
  if (!target) {
    return;
  }
  const targetPlayer = getPlayerById(state, target.playerId);
  if (!targetPlayer) {
    return;
  }
  const card = targetPlayer.spiritZone.find((entry) => entry.instanceId === target.instanceId);
  if (!card) {
    return;
  }
  card.temporaryBpBonus += 1000;
  addBattleLog(state, `${effect.sourceCardName} で ${card.name} のBPを +1000`);
}

function resolveCombatAfterBlockFlash(state: InternalGameState) {
  const pending = state.pendingAttack;
  if (!pending) {
    return;
  }

  const attackerOwner = state.players[pending.attackerPlayerIndex];
  const defender = state.players[pending.defendingPlayerIndex];
  const attacker = attackerOwner.spiritZone.find((entry) => entry.instanceId === pending.attackerInstanceId) ?? null;

  if (!attacker) {
    state.pendingAttack = null;
    return;
  }

  if (pending.resolutionMode === "life") {
    applyLifeDamage(state, pending.defendingPlayerIndex, 1, pending.attackerPlayerIndex);
    state.pendingAttack = null;
    clearBattleOnlyBonuses(state);
    return;
  }

  if (pending.resolutionMode !== "block" || !pending.blockerInstanceId) {
    applyLifeDamage(state, pending.defendingPlayerIndex, 1, pending.attackerPlayerIndex);
    state.pendingAttack = null;
    clearBattleOnlyBonuses(state);
    return;
  }

  const blocker = defender.spiritZone.find((entry) => entry.instanceId === pending.blockerInstanceId) ?? null;
  if (!blocker) {
    applyLifeDamage(state, pending.defendingPlayerIndex, 1, pending.attackerPlayerIndex);
    state.pendingAttack = null;
    clearBattleOnlyBonuses(state);
    return;
  }

  if (pending.lifeDamageOnSpiritBlock > 0 && blocker.type === "spirit") {
    applyLifeDamage(state, pending.defendingPlayerIndex, pending.lifeDamageOnSpiritBlock, pending.attackerPlayerIndex);
  }

  const attackerBp = getCurrentBp(state, attackerOwner, attacker);
  const blockerBp = getCurrentBp(state, defender, blocker);
  state.pendingAttack = null;

  if (attackerBp === null || blockerBp === null) {
    clearBattleOnlyBonuses(state);
    return;
  }

  if (attackerBp > blockerBp) {
    destroyFieldCardByIndex(state, pending.defendingPlayerIndex, "spirit", blocker.instanceId);
    setMessage(state, `${attacker.name} が ${blocker.name} をBP比較で破壊しました`);
  } else if (attackerBp < blockerBp) {
    destroyFieldCardByIndex(state, pending.attackerPlayerIndex, "spirit", attacker.instanceId);
    setMessage(state, `${blocker.name} が ${attacker.name} をBP比較で破壊しました`);
  } else {
    destroyFieldCardByIndex(state, pending.attackerPlayerIndex, "spirit", attacker.instanceId);
    destroyFieldCardByIndex(state, pending.defendingPlayerIndex, "spirit", blocker.instanceId);
    setMessage(state, `${attacker.name} と ${blocker.name} は相打ちになりました`);
  }

  clearBattleOnlyBonuses(state);
}

function applyLifeDamage(state: InternalGameState, defenderIndex: PlayerIndex, amount: number, attackerIndex: PlayerIndex) {
  const defender = state.players[defenderIndex];
  for (let index = 0; index < amount; index += 1) {
    if (defender.cores.lifeCores <= 0) {
      break;
    }
    defender.cores.lifeCores -= 1;
    defender.cores.reserveCores += 1;
    addBattleLog(state, `${defender.displayName} のライフが1減少`);
    triggerVillageLifeEffect(state, defenderIndex, attackerIndex);
  }
  finalizeLifeCheck(state, defenderIndex);
}

function triggerVillageLifeEffect(state: InternalGameState, defenderIndex: PlayerIndex, attackerIndex: PlayerIndex) {
  if (state.currentStep !== "attack" || state.activePlayerIndex !== attackerIndex) {
    return;
  }
  const defender = state.players[defenderIndex];
  const attacker = state.players[attackerIndex];
  const village = defender.nexusZone.find((entry) => entry.id === CARD_IDS.VILLAGE && (getCurrentLevel(entry, entry.coreCount)?.lv ?? 0) >= 2);
  if (!village || state.pendingEffect) {
    return;
  }

  const limit = hasOwnUltimate(defender) ? 5000 : 4000;
  const candidates = attacker.spiritZone
    .filter((entry) => entry.type === "spirit" && (getCurrentBp(state, attacker, entry) ?? 0) <= limit)
    .map((entry) => toEffectCandidate(state, attacker.playerId, "spirit", entry));

  if (candidates.length === 0) {
    addBattleLog(state, `${village.name} の対象がいなかった`);
    return;
  }

  createPendingEffect(state, {
    sourceInstanceId: village.instanceId,
    sourceCardName: village.name,
    effectName: "villageLifeDestroy",
    controllerId: defender.playerId,
    targetPlayerId: attacker.playerId,
    targetType: "spirit",
    candidates,
    payload: {},
  });
  setMessage(state, `${village.name} の効果で破壊する相手スピリットを選択してください`);
}

function buildPendingAttack(state: InternalGameState, viewerPlayerIndex: PlayerIndex): ClientPendingAttackState | null {
  const pending = state.pendingAttack;
  if (!pending) {
    return null;
  }

  const attacker = state.players[pending.attackerPlayerIndex].spiritZone.find((card) => card.instanceId === pending.attackerInstanceId);
  if (!attacker) {
    return null;
  }

  const blocker =
    pending.blockerInstanceId === null
      ? null
      : state.players[pending.defendingPlayerIndex].spiritZone.find((card) => card.instanceId === pending.blockerInstanceId) ?? null;

  return {
    attackerPlayerIndex: pending.attackerPlayerIndex,
    attackerCard: toPublicFieldCard(state, state.players[pending.attackerPlayerIndex], attacker),
    defendingPlayerIndex: pending.defendingPlayerIndex,
    canRespond: viewerPlayerIndex === pending.defendingPlayerIndex,
    resolutionMode: pending.resolutionMode,
    blockerCard: blocker ? toPublicFieldCard(state, state.players[pending.defendingPlayerIndex], blocker) : null,
    mustBlock: pending.mustBlock,
    mustBlockBySpiritOnly: pending.mustBlockBySpiritOnly,
  };
}

function startFlashWindow(state: InternalGameState, flashStep: FlashStep) {
  const defender = state.players[state.pendingAttack!.defendingPlayerIndex];
  state.phase = "flash";
  state.flashStep = flashStep;
  state.priorityPlayer = defender.playerId;
  state.passCount = 0;
  addBattleLog(state, `${flashStep} 開始`);
}

function clearFlashState(state: InternalGameState) {
  state.phase = "normal";
  state.flashStep = null;
  state.priorityPlayer = null;
  state.passCount = 0;
}

function finishFlashAction(state: InternalGameState, playerIndex: PlayerIndex, sourceName: string) {
  addBattleLog(state, `${sourceName} を使用`);
  state.passCount = 0;
  state.priorityPlayer = state.players[otherPlayer(playerIndex)].playerId;
  setMessage(state, `${sourceName} を解決しました。優先権が移動します`);
}

function createPendingEffect(state: InternalGameState, effect: Omit<PendingEffect, "id">) {
  state.pendingEffect = {
    id: createEffectId(),
    ...effect,
  };
}

function createEffectId() {
  return `effect-${Math.random().toString(36).slice(2, 10)}`;
}

export function getCurrentLevel(card: Pick<CardDefinition, "levels">, coreCount: number): CardLevel | null {
  const sorted = [...card.levels].sort((left, right) => left.core - right.core);
  let current: CardLevel | null = null;
  for (const level of sorted) {
    if (coreCount >= level.core) {
      current = level;
    }
  }
  return current;
}

export function getCurrentBp(
  state: InternalGameState,
  owner: PlayerState,
  card: Pick<FieldCard, "type" | "levels" | "coreCount" | "temporaryBpBonus" | "battleOnlyBpBonus" | "color">,
): number | null {
  const level = getCurrentLevel(card, card.coreCount);
  if (!level || (card.type !== "spirit" && card.type !== "ultimate")) {
    return null;
  }
  let bonus = card.temporaryBpBonus + card.battleOnlyBpBonus;
  bonus += getVillageAttackBonus(state, owner, card);
  return level.bp + bonus;
}

function getVillageAttackBonus(
  state: InternalGameState,
  owner: PlayerState,
  card: Pick<FieldCard, "type" | "color">,
) {
  if (state.currentStep !== "attack" || state.activePlayerIndex !== owner.playerIndex) {
    return 0;
  }
  if (card.color !== "red" || (card.type !== "spirit" && card.type !== "ultimate")) {
    return 0;
  }
  return owner.nexusZone.reduce((sum, nexus) => {
    if (nexus.id !== CARD_IDS.VILLAGE) {
      return sum;
    }
    return sum + ((getCurrentLevel(nexus, nexus.coreCount)?.lv ?? 0) >= 1 ? 2000 : 0);
  }, 0);
}

function toPublicCard(card: CardInstance): PublicCard {
  return {
    instanceId: card.instanceId,
    id: card.id,
    cardId: card.cardId,
    name: card.name,
    cost: card.cost,
    reduction: card.reduction,
    color: card.color,
    symbolCount: card.symbolCount,
    symbolColor: card.symbolColor,
    levels: card.levels,
    type: card.type,
    img: card.img,
  };
}

function toHandCard(state: InternalGameState, card: CardInstance, player: PlayerState): PublicCard {
  const payment = calculateCardPayment(state, card, player);
  return {
    ...toPublicCard(card),
    reducedCost: payment.reducedCost,
    reductionUsed: payment.reductionUsed,
    playable: payment.playable,
  };
}

function toPublicFieldCard(state: InternalGameState, owner: PlayerState, card: FieldCard): PublicCard {
  const currentLevel = getCurrentLevel(card, card.coreCount);
  return {
    ...toPublicCard(card),
    coreCount: card.coreCount,
    attackedThisTurn: card.attackedThisTurn,
    isRested: card.isRested,
    temporaryBpBonus: card.temporaryBpBonus + card.battleOnlyBpBonus,
    currentLevel: currentLevel?.lv ?? null,
    currentBp: getCurrentBp(state, owner, card),
  };
}

function stripFieldCard(card: FieldCard): CardInstance {
  const {
    coreCount: _coreCount,
    attackedThisTurn: _attacked,
    isRested: _rested,
    temporaryBpBonus: _temp,
    battleOnlyBpBonus: _battleOnly,
    ...baseCard
  } = card;
  return baseCard;
}

function buildFixedDeck(cards: CardDefinition[], roomId: string, playerIndex: PlayerIndex) {
  const orderedCards = DEBUG_GAME ? orderCardsForDebug(cards, playerIndex) : cards;
  const deck = orderedCards.flatMap((card) =>
    Array.from({ length: COPIES_PER_CARD }, (_, cardIndex) => ({
      ...card,
      cardId: card.id,
      instanceId: `${roomId}-${playerIndex}-${card.id}-${cardIndex}-${Math.random().toString(36).slice(2, 8)}`,
    }) satisfies CardInstance),
  );
  return DEBUG_NO_SHUFFLE || DEBUG_GAME ? deck : shuffle(deck);
}

function splitOpeningCards(deck: CardInstance[], playerIndex: PlayerIndex) {
  if (!DEBUG_GAME) {
    return {
      hand: deck.slice(0, STARTING_HAND_SIZE),
      remainingDeck: deck.slice(STARTING_HAND_SIZE),
    };
  }

  const wantedIds = DEBUG_DECK_ORDER[playerIndex].slice(0, STARTING_HAND_SIZE);
  const hand: CardInstance[] = [];
  const remainingDeck = [...deck];
  for (const wantedId of wantedIds) {
    const cardIndex = remainingDeck.findIndex((card) => card.id === wantedId);
    if (cardIndex >= 0) {
      hand.push(remainingDeck.splice(cardIndex, 1)[0]);
    }
  }
  while (hand.length < STARTING_HAND_SIZE && remainingDeck.length > 0) {
    hand.push(remainingDeck.shift()!);
  }
  return { hand, remainingDeck: DEBUG_NO_SHUFFLE ? remainingDeck : shuffle(remainingDeck) };
}

function orderCardsForDebug(cards: CardDefinition[], playerIndex: PlayerIndex) {
  const order = DEBUG_DECK_ORDER[playerIndex];
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...cards].sort((left, right) => {
    const leftRank = rank.get(left.id) ?? 999;
    const rightRank = rank.get(right.id) ?? 999;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.id.localeCompare(right.id);
  });
}

export function hasOwnUltimate(player: PlayerState) {
  return player.spiritZone.some((card) => card.type === "ultimate" && !!getCurrentLevel(card, card.coreCount));
}

export function countOwnRedSpirits(player: PlayerState) {
  return player.spiritZone.filter((card) => card.type === "spirit" && card.color === "red" && !!getCurrentLevel(card, card.coreCount)).length;
}

export function destroySpirit(state: InternalGameState, ownerId: string, instanceId: string) {
  destroySpiritByPlayerId(state, ownerId, instanceId);
}

export function trashTopDeckCard(player: PlayerState) {
  const card = player.deck.shift() ?? null;
  if (card) {
    player.trash.push(card);
  }
  return card;
}

export function drawCards(state: InternalGameState, player: PlayerState, count: number) {
  let drawn = 0;
  for (let index = 0; index < count; index += 1) {
    const card = player.deck.shift();
    if (!card) {
      state.status = "finished";
      state.winner = otherPlayer(player.playerIndex);
      setMessage(state, `${player.displayName} はデッキ切れで敗北しました`);
      break;
    }
    player.hand.push(card);
    drawn += 1;
  }
  return drawn;
}

export function addLifeFromVoid(player: PlayerState, count: number, maxLife = 5) {
  const room = Math.max(0, maxLife - player.cores.lifeCores);
  const movable = Math.min(count, room, player.cores.voidCores);
  player.cores.voidCores -= movable;
  player.cores.lifeCores += movable;
  return movable;
}

export function moveCore(
  source: { type: "reserve" | "trash" | "life" | "void" | "field"; player: PlayerState; card?: FieldCard },
  target: { type: "reserve" | "trash" | "life" | "void" | "field"; player: PlayerState; card?: FieldCard },
  count: number,
) {
  const movable = Math.min(count, getCoreBucketCount(source));
  subtractCoreBucket(source, movable);
  addCoreBucket(target, movable);
  return movable;
}

export function getOpponent(state: InternalGameState, playerId: string) {
  const player = getPlayerById(state, playerId);
  if (!player) {
    return null;
  }
  return state.players[otherPlayer(player.playerIndex)];
}

export function canSummonUltimate(card: CardInstance | CardDefinition, player: PlayerState) {
  if (card.id === CARD_IDS.ARF) {
    return countOwnRedSpirits(player) >= 1;
  }
  if (card.id === CARD_IDS.ARV) {
    return countOwnRedSpirits(player) >= 3;
  }
  return true;
}

function getCoreBucketCount(bucket: { type: "reserve" | "trash" | "life" | "void" | "field"; player: PlayerState; card?: FieldCard }) {
  switch (bucket.type) {
    case "reserve":
      return bucket.player.cores.reserveCores;
    case "trash":
      return bucket.player.cores.trashCores;
    case "life":
      return bucket.player.cores.lifeCores;
    case "void":
      return bucket.player.cores.voidCores;
    case "field":
      return bucket.card?.coreCount ?? 0;
  }
}

function subtractCoreBucket(bucket: { type: "reserve" | "trash" | "life" | "void" | "field"; player: PlayerState; card?: FieldCard }, count: number) {
  switch (bucket.type) {
    case "reserve":
      bucket.player.cores.reserveCores -= count;
      break;
    case "trash":
      bucket.player.cores.trashCores -= count;
      break;
    case "life":
      bucket.player.cores.lifeCores -= count;
      break;
    case "void":
      bucket.player.cores.voidCores -= count;
      break;
    case "field":
      if (bucket.card) bucket.card.coreCount -= count;
      break;
  }
}

function addCoreBucket(bucket: { type: "reserve" | "trash" | "life" | "void" | "field"; player: PlayerState; card?: FieldCard }, count: number) {
  switch (bucket.type) {
    case "reserve":
      bucket.player.cores.reserveCores += count;
      break;
    case "trash":
      bucket.player.cores.trashCores += count;
      break;
    case "life":
      bucket.player.cores.lifeCores += count;
      break;
    case "void":
      bucket.player.cores.voidCores += count;
      break;
    case "field":
      if (bucket.card) bucket.card.coreCount += count;
      break;
  }
}

function calculateCardPayment(state: InternalGameState, card: CardInstance | CardDefinition, player: PlayerState) {
  const availableReduction = countReductionSymbols(player);
  const reductionUsed = (Object.entries(card.reduction) as Array<[keyof typeof card.reduction, number]>).reduce(
    (sum, [color, limit]) => sum + Math.min(limit, availableReduction[color] ?? 0),
    0,
  );
  const reducedCost = Math.max(0, card.cost - reductionUsed);
  const requiresFieldCore = card.type === "spirit" || card.type === "nexus" || card.type === "ultimate";
  const totalRequiredCores = reducedCost + (requiresFieldCore ? 1 : 0);

  if (card.type === "ultimate" && !canSummonUltimate(card, player)) {
    return {
      reductionUsed,
      reducedCost,
      playable: false,
    };
  }

  return {
    reductionUsed,
    reducedCost,
    playable: player.cores.reserveCores >= totalRequiredCores,
  };
}

function countReductionSymbols(player: PlayerState): Record<(typeof SYMBOL_COLORS)[number], number> {
  const symbols = createEmptySymbolTotals();
  for (const card of [...player.spiritZone, ...player.nexusZone]) {
    if ((card.coreCount ?? 0) <= 0) {
      continue;
    }
    const color = normalizeSymbolColor(card.symbolColor);
    if (!(color in symbols)) {
      continue;
    }
    symbols[color as keyof typeof symbols] += card.symbolCount;
  }
  return symbols;
}

function createEmptySymbolTotals(): Record<(typeof SYMBOL_COLORS)[number], number> {
  return {
    red: 0,
    blue: 0,
    green: 0,
    white: 0,
    yellow: 0,
    purple: 0,
  };
}

function normalizeSymbolColor(symbolColor: string) {
  if (symbolColor === "arutimetto") {
    return "red";
  }
  return symbolColor;
}

function toEffectCandidate(
  state: InternalGameState,
  playerId: string,
  zone: "spirit" | "nexus",
  card: FieldCard,
): EffectTargetCandidate {
  const owner = getPlayerById(state, playerId)!;
  return {
    instanceId: card.instanceId,
    playerId,
    zone,
    name: card.name,
    type: card.type,
    currentBp: zone === "spirit" ? getCurrentBp(state, owner, card) : null,
  };
}

function getAllUnitCandidates(state: InternalGameState) {
  const candidates: EffectTargetCandidate[] = [];
  for (const player of state.players) {
    for (const card of player.spiritZone) {
      if (card.type === "spirit" || card.type === "ultimate") {
        candidates.push(toEffectCandidate(state, player.playerId, "spirit", card));
      }
    }
  }
  return candidates;
}

function getAvailableBlockers(state: InternalGameState, defender: PlayerState, spiritOnly: boolean) {
  return defender.spiritZone.filter((card) => {
    if (!card.isRested || (card.coreCount ?? 0) <= 0 || !getCurrentLevel(card, card.coreCount)) {
      return false;
    }
    if (spiritOnly && card.type !== "spirit") {
      return false;
    }
    return card.type === "spirit" || card.type === "ultimate";
  });
}

function destroySpiritByPlayerId(state: InternalGameState, ownerId: string, instanceId: string) {
  const owner = getPlayerById(state, ownerId);
  if (!owner) {
    return;
  }
  destroyFieldCard(state, owner.playerIndex, "spirit", instanceId);
}

function destroyNexusByPlayerId(state: InternalGameState, ownerId: string, instanceId: string) {
  const owner = getPlayerById(state, ownerId);
  if (!owner) {
    return;
  }
  destroyFieldCardByIndex(state, owner.playerIndex, "nexus", instanceId);
}

function triggerRyumanDestroyedEffect(state: InternalGameState, ownerIndex: PlayerIndex, sourceName: string) {
  const owner = state.players[ownerIndex];
  const opponent = state.players[otherPlayer(ownerIndex)];
  const candidates = opponent.spiritZone
    .filter((card) => (getCurrentBp(state, opponent, card) ?? 0) <= 4000)
    .map((card) => toEffectCandidate(state, opponent.playerId, "spirit", card));
  if (candidates.length === 1) {
    destroySpiritByPlayerId(state, candidates[0].playerId, candidates[0].instanceId);
    addBattleLog(state, `${sourceName} destroyed effect destroyed ${candidates[0].name}`);
    return;
  }
  if (candidates.length === 0) {
    addBattleLog(state, `${sourceName} の破壊時効果対象がいなかった`);
    return;
  }
  createPendingEffect(state, {
    sourceInstanceId: "",
    sourceCardName: sourceName,
    effectName: "ryumanDestroyedDestroy",
    controllerId: owner.playerId,
    targetPlayerId: opponent.playerId,
    targetType: "spirit",
    candidates,
    payload: {},
  });
  setMessage(state, `${sourceName} の破壊時効果対象を選択してください`);
}

function destroyFieldCardByIndex(
  state: InternalGameState,
  ownerIndex: PlayerIndex,
  zoneName: "spirit" | "nexus",
  instanceId: string,
) {
  destroyFieldCard(state, ownerIndex, zoneName, instanceId);
}

function destroyFieldCard(
  state: InternalGameState,
  ownerIndex: PlayerIndex,
  zoneName: "spirit" | "nexus",
  instanceId: string,
) {
  const owner = state.players[ownerIndex];
  const zone = getZone(owner, zoneName);
  const fieldIndex = zone.findIndex((card) => card.instanceId === instanceId);
  if (fieldIndex < 0) {
    return null;
  }
  const [card] = zone.splice(fieldIndex, 1);
  releaseFieldCardCores(owner.cores, card);
  owner.trash.push(stripFieldCard(card));
  addBattleLog(state, `${card.name} was destroyed`);
  if (zoneName === "spirit" && card.id === CARD_IDS.RYUMAN) {
    triggerRyumanDestroyedEffect(state, ownerIndex, card.name);
  }
  return card;
}

function destroyFieldCardsWithNoCores(state: InternalGameState, ownerIndex: PlayerIndex) {
  const owner = state.players[ownerIndex];
  const cardsToDestroy = owner.spiritZone.filter((card) => !getCurrentLevel(card, card.coreCount));
  for (const card of [...cardsToDestroy]) {
    destroySpiritByPlayerId(state, owner.playerId, card.instanceId);
    setMessage(state, `${owner.displayName} の ${card.name} はコア不足で破壊されました`);
  }
}

function readyPlayerForTurn(player: PlayerState) {
  player.cores.reserveCores += player.cores.trashCores;
  player.cores.trashCores = 0;
  for (const card of player.spiritZone) {
    card.attackedThisTurn = false;
    card.isRested = true;
    card.battleOnlyBpBonus = 0;
  }
  for (const card of player.nexusZone) {
    card.isRested = true;
  }
}

function clearBattleOnlyBonuses(state: InternalGameState) {
  for (const player of state.players) {
    for (const card of player.spiritZone) {
      card.battleOnlyBpBonus = 0;
    }
  }
}

function clearTemporaryBonuses(state: InternalGameState) {
  for (const player of state.players) {
    for (const card of player.spiritZone) {
      card.temporaryBpBonus = 0;
    }
  }
}

function releaseFieldCardCores(cores: CoreState, card: FieldCard) {
  cores.reserveCores += card.coreCount;
}

function autoPassFlashIfNoPlayableMagic(state: InternalGameState) {
  for (let index = 0; index < 2; index += 1) {
    if (state.phase !== "flash" || !state.flashStep || !state.priorityPlayer || state.pendingEffect) {
      return;
    }
    const priorityIndex = state.players.findIndex((player) => player.playerId === state.priorityPlayer);
    if (priorityIndex < 0) {
      return;
    }
    if (hasPlayableFlashMagic(state, priorityIndex as PlayerIndex)) {
      return;
    }
    applyFlashPass(state, priorityIndex as PlayerIndex, true);
  }
}

function hasPlayableFlashMagic(state: InternalGameState, playerIndex: PlayerIndex) {
  const player = state.players[playerIndex];
  if (state.phase !== "flash" || state.priorityPlayer !== player.playerId || state.pendingEffect) {
    return false;
  }
  return player.hand.some((card) => {
    if (card.type !== "magic" || !canUseMagicInFlash(card)) {
      return false;
    }
    return calculateCardPayment(state, card, player).playable;
  });
}

function canUseMagicInFlash(card: CardInstance) {
  return card.id === CARD_IDS.DOUBLE_DRAW || card.id === CARD_IDS.SHINING_FLAME || card.id === CARD_IDS.FLAME_TEMPEST;
}

function isFlashActive(state: InternalGameState) {
  return state.phase === "flash";
}

function moveReserveToTrash(cores: CoreState, amount: number) {
  cores.reserveCores -= amount;
  cores.trashCores += amount;
}

function moveVoidToReserve(cores: CoreState, amount: number) {
  const transferable = Math.min(cores.voidCores, amount);
  cores.voidCores -= transferable;
  cores.reserveCores += transferable;
}

function finalizeLifeCheck(state: InternalGameState, defendingPlayerIndex: PlayerIndex) {
  const defender = state.players[defendingPlayerIndex];
  if (defender.cores.lifeCores <= 0) {
    state.status = "finished";
    state.winner = otherPlayer(defendingPlayerIndex);
    setMessage(state, `${defender.displayName} のライフが0になりました`);
  }
}

function getPlayerById(state: InternalGameState, playerId: string) {
  return state.players.find((player) => player.playerId === playerId) ?? null;
}

function getZone(player: PlayerState, zoneName: "spirit" | "nexus") {
  return zoneName === "spirit" ? player.spiritZone : player.nexusZone;
}

function setMessage(state: InternalGameState, message: string) {
  state.message = message;
  addBattleLog(state, message);
}

function addBattleLog(state: InternalGameState, entry: string) {
  state.battleLog = [...state.battleLog.slice(-59), entry];
}

function isPlayersTurn(state: InternalGameState, playerIndex: PlayerIndex) {
  return state.activePlayerIndex === playerIndex;
}

function hasPriority(state: InternalGameState, playerIndex: PlayerIndex) {
  return state.players[playerIndex].playerId === state.priorityPlayer;
}

function otherPlayer(playerIndex: PlayerIndex): PlayerIndex {
  return playerIndex === 0 ? 1 : 0;
}

function notYourTurn(): CommandResult {
  return { ok: false, error: "自分のターンではないためその操作はできません" };
}

function shuffle<T>(items: T[]) {
  const array = [...items];
  for (let index = array.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [array[index], array[swapIndex]] = [array[swapIndex], array[index]];
  }
  return array;
}
