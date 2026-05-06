const STARTING_LIFE = 5;
const STARTING_RESERVE = 4;
const STARTING_HAND_SIZE = 4;
const STARTING_VOID = 30;
const COPIES_PER_CARD = 3;
const DEBUG_GAME = process.env.DEBUG_GAME === "true";
const DEBUG_NO_SHUFFLE = process.env.DEBUG_NO_SHUFFLE === "true";
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
};
const DEBUG_DECK_ORDER = {
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
export function maybeStartGame(room, cards) {
    if (room.gameState) {
        return room.gameState;
    }
    if (!room.players[0] || !room.players[1]) {
        return null;
    }
    const buildPlayerState = (playerIndex) => {
        const player = room.players[playerIndex];
        const deck = buildFixedDeck(cards, room.id, playerIndex);
        const { hand, remainingDeck } = splitOpeningCards(deck, playerIndex);
        return {
            playerIndex,
            playerId: player.playerId,
            displayName: player.displayName,
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
        };
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
        message: `${room.players[0].displayName} のターン開始`,
        battleLog: [`Turn 1 start: ${room.players[0].displayName}`],
    };
    if (DEBUG_GAME) {
        addBattleLog(room.gameState, "DEBUG_GAME enabled: fixed opening hands active");
        if (DEBUG_NO_SHUFFLE) {
            addBattleLog(room.gameState, "DEBUG_NO_SHUFFLE enabled: deck order fixed");
        }
    }
    return room.gameState;
}
export function applyCommand(state, playerIndex, command) {
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
export function toClientState(state, viewerPlayerIndex) {
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
function advanceStep(state, playerIndex) {
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
function executeCoreStep(state, playerIndex) {
    const player = state.players[playerIndex];
    const isFirstPlayerFirstTurn = state.turnNumber === 1 && playerIndex === 0;
    if (!isFirstPlayerFirstTurn) {
        moveVoidToReserve(player.cores, 1);
        setMessage(state, `${player.displayName} がボイドからリザーブへコアを1個置きました`);
        addBattleLog(state, `${player.displayName} core step: +1 core`);
    }
    else {
        setMessage(state, `${player.displayName} は先攻1ターン目なのでコア追加を行いません`);
        addBattleLog(state, `${player.displayName} core step: no core on first turn`);
    }
    state.currentStep = "draw";
    return { ok: true };
}
function executeDrawStep(state, playerIndex) {
    const player = state.players[playerIndex];
    const drawn = drawCards(state, player, 1);
    if (state.status !== "active") {
        return { ok: true };
    }
    state.currentStep = "refresh";
    setMessage(state, `${player.displayName} が draw ステップで${drawn}枚ドローしました`);
    return { ok: true };
}
function executeRefreshStep(state, playerIndex) {
    readyPlayerForTurn(state.players[playerIndex]);
    state.currentStep = "main";
    setMessage(state, `${state.players[playerIndex].displayName} の refresh ステップを解決しました`);
    addBattleLog(state, "リフレッシュで全て回復した");
    addBattleLog(state, `${state.players[playerIndex].displayName} main step start`);
    return { ok: true };
}
function finalizeTurn(state, playerIndex) {
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
function startAttack(state, playerIndex, instanceId) {
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
    }
    return { ok: true };
}
function resolveFlashCommand(state, playerIndex, command) {
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
function handleFlashPass(state, playerIndex) {
    const player = state.players[playerIndex];
    addBattleLog(state, `${player.displayName} がパス`);
    state.passCount += 1;
    if (state.passCount >= 2) {
        const finishedStep = state.flashStep;
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
function resolvePendingAttack(state, playerIndex, command) {
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
        setMessage(state, `${defender.displayName} が ${blocker.name} でブロックしました。blockFlash を開始します`);
    }
    return { ok: true };
}
function playCardFromHand(state, playerIndex, instanceId, context) {
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
    const fieldCard = {
        ...card,
        coreCount: 1,
        attackedThisTurn: false,
        isRested: false,
        temporaryBpBonus: 0,
        battleOnlyBpBonus: 0,
    };
    if (card.type === "nexus") {
        player.nexusZone.push(fieldCard);
        setMessage(state, `${player.displayName} が ${card.name} を nexus zone に配置しました`);
    }
    else {
        player.spiritZone.push(fieldCard);
        setMessage(state, `${player.displayName} が ${card.name} を spirit zone に出しました`);
    }
    handleSummonTriggeredEffects(state, playerIndex, fieldCard);
    return { ok: true };
}
function chooseMagicMode(state, playerIndex, instanceId, mode) {
    const player = state.players[playerIndex];
    const card = player.hand.find((entry) => entry.instanceId === instanceId);
    if (!card || card.type !== "magic") {
        return { ok: false, error: "対象のmagicカードが見つかりません" };
    }
    return playMagicCard(state, playerIndex, card, state.phase === "flash" ? "flash" : "main", mode);
}
function playMagicCard(state, playerIndex, card, context, mode) {
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
            return resolveFlameTempest(state, playerIndex, card, mode);
        default:
            return { ok: false, error: "未対応のmagicです" };
    }
}
function activateCardEffect(state, playerIndex, instanceId, effectName) {
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
function resolveEffectTarget(state, playerIndex, pendingEffectId, targetInstanceId) {
    const pendingEffect = state.pendingEffect;
    if (!pendingEffect || pendingEffect.id !== pendingEffectId) {
        return { ok: false, error: "対象選択中の効果が見つかりません" };
    }
    if (pendingEffect.controllerId !== state.players[playerIndex].playerId) {
        return { ok: false, error: "この効果を選択できるプレイヤーではありません" };
    }
    const target = targetInstanceId === null ? null : pendingEffect.candidates.find((candidate) => candidate.instanceId === targetInstanceId) ?? null;
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
function afterPendingEffectResolution(state, effect, playerIndex) {
    const payload = effect.payload;
    if (payload.drawIfUltimate === true) {
        const player = getPlayerById(state, effect.controllerId);
        if (player && hasOwnUltimate(player)) {
            drawCards(state, player, 1);
            addBattleLog(state, `${effect.sourceCardName} の効果で1枚ドロー`);
        }
    }
    const startFlash = payload.startFlashStep;
    if (startFlash) {
        startFlashWindow(state, startFlash);
        if (startFlash === "blockFlash") {
            setMessage(state, "blockFlash を開始します");
        }
        else {
            setMessage(state, "attackFlash を開始します");
        }
    }
    if (payload.flashAction === true) {
        state.passCount = 0;
        state.priorityPlayer = state.players[otherPlayer(playerIndex)].playerId;
        setMessage(state, `${effect.sourceCardName} の効果を解決しました。優先権が移動します`);
    }
}
function handleSummonTriggeredEffects(state, playerIndex, card) {
    const player = state.players[playerIndex];
    const opponent = state.players[otherPlayer(playerIndex)];
    const level = getCurrentLevel(card, card.coreCount);
    if (!level) {
        return;
    }
    if (card.id === CARD_IDS.NIGHT && level.lv <= 2 && hasOwnUltimate(player)) {
        const candidates = opponent.nexusZone.map((entry) => toEffectCandidate(state, opponent.playerId, "nexus", entry));
        if (candidates.length > 0) {
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
function handleAttackTriggeredEffects(state, playerIndex, attacker) {
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
        if (candidates.length > 0) {
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
function handleBlockTriggeredEffects(state, playerIndex, blocker) {
    const player = state.players[playerIndex];
    const opponent = state.players[otherPlayer(playerIndex)];
    if (blocker.id === CARD_IDS.AIZEN) {
        const candidates = opponent.spiritZone
            .filter((card) => (getCurrentBp(state, opponent, card) ?? 0) <= 3000)
            .map((card) => toEffectCandidate(state, opponent.playerId, "spirit", card));
        if (candidates.length > 0) {
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
function resolveDoubleDraw(state, playerIndex, card, context) {
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
function resolveShiningFlame(state, playerIndex, card) {
    const opponent = state.players[otherPlayer(playerIndex)];
    const candidates = opponent.spiritZone
        .filter((entry) => (getCurrentBp(state, opponent, entry) ?? 0) <= 10000)
        .map((entry) => toEffectCandidate(state, opponent.playerId, "spirit", entry));
    if (candidates.length === 0) {
        addBattleLog(state, `${card.name} の対象がいなかった`);
        finishFlashAction(state, playerIndex, card.name);
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
function resolveFlameTempest(state, playerIndex, card, mode) {
    const opponent = state.players[otherPlayer(playerIndex)];
    if (mode === "allSmall") {
        const targets = opponent.spiritZone.filter((entry) => (getCurrentBp(state, opponent, entry) ?? 0) <= 4000);
        for (const target of [...targets]) {
            destroySpiritByPlayerId(state, opponent.playerId, target.instanceId);
        }
        addBattleLog(state, `${card.name} で BP4000以下のスピリットをすべて破壊`);
        finishFlashAction(state, playerIndex, card.name);
        return { ok: true };
    }
    const candidates = opponent.spiritZone
        .filter((entry) => (getCurrentBp(state, opponent, entry) ?? 0) <= 8000)
        .map((entry) => toEffectCandidate(state, opponent.playerId, "spirit", entry));
    if (candidates.length === 0) {
        addBattleLog(state, `${card.name} の対象がいなかった`);
        finishFlashAction(state, playerIndex, card.name);
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
function resolveAizenBattleEffect(state, effect, target) {
    if (target) {
        destroySpiritByPlayerId(state, target.playerId, target.instanceId);
        addBattleLog(state, `${effect.sourceCardName} で ${target.name} を破壊`);
    }
    else {
        addBattleLog(state, `${effect.sourceCardName} の破壊対象がいなかった`);
    }
}
function resolveArFCoreBoost(state, effect, target) {
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
function resolveDoubleDrawFlashBuff(state, effect, target) {
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
function resolveCombatAfterBlockFlash(state) {
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
    }
    else if (attackerBp < blockerBp) {
        destroyFieldCardByIndex(state, pending.attackerPlayerIndex, "spirit", attacker.instanceId);
        setMessage(state, `${blocker.name} が ${attacker.name} をBP比較で破壊しました`);
    }
    else {
        destroyFieldCardByIndex(state, pending.attackerPlayerIndex, "spirit", attacker.instanceId);
        destroyFieldCardByIndex(state, pending.defendingPlayerIndex, "spirit", blocker.instanceId);
        setMessage(state, `${attacker.name} と ${blocker.name} は相打ちになりました`);
    }
    clearBattleOnlyBonuses(state);
}
function applyLifeDamage(state, defenderIndex, amount, attackerIndex) {
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
function triggerVillageLifeEffect(state, defenderIndex, attackerIndex) {
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
function buildPendingAttack(state, viewerPlayerIndex) {
    const pending = state.pendingAttack;
    if (!pending) {
        return null;
    }
    const attacker = state.players[pending.attackerPlayerIndex].spiritZone.find((card) => card.instanceId === pending.attackerInstanceId);
    if (!attacker) {
        return null;
    }
    const blocker = pending.blockerInstanceId === null
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
function startFlashWindow(state, flashStep) {
    const defender = state.players[state.pendingAttack.defendingPlayerIndex];
    state.phase = "flash";
    state.flashStep = flashStep;
    state.priorityPlayer = defender.playerId;
    state.passCount = 0;
    addBattleLog(state, `${flashStep} 開始`);
}
function clearFlashState(state) {
    state.phase = "normal";
    state.flashStep = null;
    state.priorityPlayer = null;
    state.passCount = 0;
}
function finishFlashAction(state, playerIndex, sourceName) {
    addBattleLog(state, `${sourceName} を使用`);
    state.passCount = 0;
    state.priorityPlayer = state.players[otherPlayer(playerIndex)].playerId;
    setMessage(state, `${sourceName} を解決しました。優先権が移動します`);
}
function createPendingEffect(state, effect) {
    state.pendingEffect = {
        id: createEffectId(),
        ...effect,
    };
}
function createEffectId() {
    return `effect-${Math.random().toString(36).slice(2, 10)}`;
}
export function getCurrentLevel(card, coreCount) {
    const sorted = [...card.levels].sort((left, right) => left.core - right.core);
    let current = null;
    for (const level of sorted) {
        if (coreCount >= level.core) {
            current = level;
        }
    }
    return current;
}
export function getCurrentBp(state, owner, card) {
    const level = getCurrentLevel(card, card.coreCount);
    if (!level || (card.type !== "spirit" && card.type !== "ultimate")) {
        return null;
    }
    let bonus = card.temporaryBpBonus + card.battleOnlyBpBonus;
    bonus += getVillageAttackBonus(state, owner, card);
    return level.bp + bonus;
}
function getVillageAttackBonus(state, owner, card) {
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
function toPublicCard(card) {
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
function toHandCard(state, card, player) {
    const payment = calculateCardPayment(state, card, player);
    return {
        ...toPublicCard(card),
        reducedCost: payment.reducedCost,
        reductionUsed: payment.reductionUsed,
        playable: payment.playable,
    };
}
function toPublicFieldCard(state, owner, card) {
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
function stripFieldCard(card) {
    const { coreCount: _coreCount, attackedThisTurn: _attacked, isRested: _rested, temporaryBpBonus: _temp, battleOnlyBpBonus: _battleOnly, ...baseCard } = card;
    return baseCard;
}
function buildFixedDeck(cards, roomId, playerIndex) {
    const orderedCards = DEBUG_GAME ? orderCardsForDebug(cards, playerIndex) : cards;
    const deck = orderedCards.flatMap((card) => Array.from({ length: COPIES_PER_CARD }, (_, cardIndex) => ({
        ...card,
        cardId: card.id,
        instanceId: `${roomId}-${playerIndex}-${card.id}-${cardIndex}-${Math.random().toString(36).slice(2, 8)}`,
    })));
    return DEBUG_NO_SHUFFLE || DEBUG_GAME ? deck : shuffle(deck);
}
function splitOpeningCards(deck, playerIndex) {
    if (!DEBUG_GAME) {
        return {
            hand: deck.slice(0, STARTING_HAND_SIZE),
            remainingDeck: deck.slice(STARTING_HAND_SIZE),
        };
    }
    const wantedIds = DEBUG_DECK_ORDER[playerIndex].slice(0, STARTING_HAND_SIZE);
    const hand = [];
    const remainingDeck = [...deck];
    for (const wantedId of wantedIds) {
        const cardIndex = remainingDeck.findIndex((card) => card.id === wantedId);
        if (cardIndex >= 0) {
            hand.push(remainingDeck.splice(cardIndex, 1)[0]);
        }
    }
    while (hand.length < STARTING_HAND_SIZE && remainingDeck.length > 0) {
        hand.push(remainingDeck.shift());
    }
    return { hand, remainingDeck: DEBUG_NO_SHUFFLE ? remainingDeck : shuffle(remainingDeck) };
}
function orderCardsForDebug(cards, playerIndex) {
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
export function hasOwnUltimate(player) {
    return player.spiritZone.some((card) => card.type === "ultimate" && !!getCurrentLevel(card, card.coreCount));
}
export function countOwnRedSpirits(player) {
    return player.spiritZone.filter((card) => card.type === "spirit" && card.color === "red" && !!getCurrentLevel(card, card.coreCount)).length;
}
export function destroySpirit(state, ownerId, instanceId) {
    destroySpiritByPlayerId(state, ownerId, instanceId);
}
export function trashTopDeckCard(player) {
    const card = player.deck.shift() ?? null;
    if (card) {
        player.trash.push(card);
    }
    return card;
}
export function drawCards(state, player, count) {
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
export function addLifeFromVoid(player, count, maxLife = 5) {
    const room = Math.max(0, maxLife - player.cores.lifeCores);
    const movable = Math.min(count, room, player.cores.voidCores);
    player.cores.voidCores -= movable;
    player.cores.lifeCores += movable;
    return movable;
}
export function moveCore(source, target, count) {
    const movable = Math.min(count, getCoreBucketCount(source));
    subtractCoreBucket(source, movable);
    addCoreBucket(target, movable);
    return movable;
}
export function getOpponent(state, playerId) {
    const player = getPlayerById(state, playerId);
    if (!player) {
        return null;
    }
    return state.players[otherPlayer(player.playerIndex)];
}
export function canSummonUltimate(card, player) {
    if (card.id === CARD_IDS.ARF) {
        return countOwnRedSpirits(player) >= 1;
    }
    if (card.id === CARD_IDS.ARV) {
        return countOwnRedSpirits(player) >= 3;
    }
    return true;
}
function getCoreBucketCount(bucket) {
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
function subtractCoreBucket(bucket, count) {
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
            if (bucket.card)
                bucket.card.coreCount -= count;
            break;
    }
}
function addCoreBucket(bucket, count) {
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
            if (bucket.card)
                bucket.card.coreCount += count;
            break;
    }
}
function calculateCardPayment(state, card, player) {
    const availableReduction = countReductionSymbols(player);
    const reductionUsed = Object.entries(card.reduction).reduce((sum, [color, limit]) => sum + Math.min(limit, availableReduction[color] ?? 0), 0);
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
function countReductionSymbols(player) {
    const symbols = {};
    for (const card of [...player.spiritZone, ...player.nexusZone]) {
        const color = normalizeSymbolColor(card.symbolColor);
        symbols[color] = (symbols[color] ?? 0) + card.symbolCount;
    }
    return symbols;
}
function normalizeSymbolColor(symbolColor) {
    if (symbolColor === "arutimetto") {
        return "red";
    }
    return symbolColor;
}
function toEffectCandidate(state, playerId, zone, card) {
    const owner = getPlayerById(state, playerId);
    return {
        instanceId: card.instanceId,
        playerId,
        zone,
        name: card.name,
        type: card.type,
        currentBp: zone === "spirit" ? getCurrentBp(state, owner, card) : null,
    };
}
function getAllUnitCandidates(state) {
    const candidates = [];
    for (const player of state.players) {
        for (const card of player.spiritZone) {
            if (card.type === "spirit" || card.type === "ultimate") {
                candidates.push(toEffectCandidate(state, player.playerId, "spirit", card));
            }
        }
    }
    return candidates;
}
function getAvailableBlockers(state, defender, spiritOnly) {
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
function destroySpiritByPlayerId(state, ownerId, instanceId) {
    const owner = getPlayerById(state, ownerId);
    if (!owner) {
        return;
    }
    const fieldCard = owner.spiritZone.find((entry) => entry.instanceId === instanceId);
    if (!fieldCard) {
        return;
    }
    const stripped = stripFieldCard(fieldCard);
    destroyFieldCardByIndex(state, owner.playerIndex, "spirit", instanceId);
    if (stripped.id === CARD_IDS.RYUMAN) {
        triggerRyumanDestroyedEffect(state, owner.playerIndex, stripped.name);
    }
}
function destroyNexusByPlayerId(state, ownerId, instanceId) {
    const owner = getPlayerById(state, ownerId);
    if (!owner) {
        return;
    }
    destroyFieldCardByIndex(state, owner.playerIndex, "nexus", instanceId);
}
function triggerRyumanDestroyedEffect(state, ownerIndex, sourceName) {
    const owner = state.players[ownerIndex];
    const opponent = state.players[otherPlayer(ownerIndex)];
    const candidates = opponent.spiritZone
        .filter((card) => (getCurrentBp(state, opponent, card) ?? 0) <= 4000)
        .map((card) => toEffectCandidate(state, opponent.playerId, "spirit", card));
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
function destroyFieldCardByIndex(state, ownerIndex, zoneName, instanceId) {
    const owner = state.players[ownerIndex];
    const zone = getZone(owner, zoneName);
    const fieldIndex = zone.findIndex((card) => card.instanceId === instanceId);
    if (fieldIndex < 0) {
        return;
    }
    const [card] = zone.splice(fieldIndex, 1);
    releaseFieldCardCores(owner.cores, card);
    owner.trash.push(stripFieldCard(card));
}
function destroyFieldCardsWithNoCores(state, ownerIndex) {
    const owner = state.players[ownerIndex];
    const cardsToDestroy = owner.spiritZone.filter((card) => !getCurrentLevel(card, card.coreCount));
    for (const card of [...cardsToDestroy]) {
        destroySpiritByPlayerId(state, owner.playerId, card.instanceId);
        setMessage(state, `${owner.displayName} の ${card.name} はコア不足で破壊されました`);
    }
}
function readyPlayerForTurn(player) {
    for (const card of player.spiritZone) {
        card.attackedThisTurn = false;
        card.isRested = true;
        card.battleOnlyBpBonus = 0;
    }
    for (const card of player.nexusZone) {
        card.isRested = true;
    }
}
function clearBattleOnlyBonuses(state) {
    for (const player of state.players) {
        for (const card of player.spiritZone) {
            card.battleOnlyBpBonus = 0;
        }
    }
}
function clearTemporaryBonuses(state) {
    for (const player of state.players) {
        for (const card of player.spiritZone) {
            card.temporaryBpBonus = 0;
        }
    }
}
function releaseFieldCardCores(cores, card) {
    cores.reserveCores += card.coreCount;
}
function moveReserveToTrash(cores, amount) {
    cores.reserveCores -= amount;
    cores.trashCores += amount;
}
function moveVoidToReserve(cores, amount) {
    const transferable = Math.min(cores.voidCores, amount);
    cores.voidCores -= transferable;
    cores.reserveCores += transferable;
}
function finalizeLifeCheck(state, defendingPlayerIndex) {
    const defender = state.players[defendingPlayerIndex];
    if (defender.cores.lifeCores <= 0) {
        state.status = "finished";
        state.winner = otherPlayer(defendingPlayerIndex);
        setMessage(state, `${defender.displayName} のライフが0になりました`);
    }
}
function getPlayerById(state, playerId) {
    return state.players.find((player) => player.playerId === playerId) ?? null;
}
function getZone(player, zoneName) {
    return zoneName === "spirit" ? player.spiritZone : player.nexusZone;
}
function setMessage(state, message) {
    state.message = message;
    addBattleLog(state, message);
}
function addBattleLog(state, entry) {
    state.battleLog = [...state.battleLog.slice(-59), entry];
}
function isPlayersTurn(state, playerIndex) {
    return state.activePlayerIndex === playerIndex;
}
function hasPriority(state, playerIndex) {
    return state.players[playerIndex].playerId === state.priorityPlayer;
}
function otherPlayer(playerIndex) {
    return playerIndex === 0 ? 1 : 0;
}
function notYourTurn() {
    return { ok: false, error: "自分のターンではないためその操作はできません" };
}
function shuffle(items) {
    const array = [...items];
    for (let index = array.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [array[index], array[swapIndex]] = [array[swapIndex], array[index]];
    }
    return array;
}
