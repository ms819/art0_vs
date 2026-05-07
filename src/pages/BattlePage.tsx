import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { CardBackStack } from "../components/CardBackStack";
import { CardDetailModal } from "../components/CardDetailModal";
import { CardView } from "../components/CardView";
import { MobileActionSheet } from "../components/MobileActionSheet";
import { StatusPanel } from "../components/StatusPanel";
import { DEBUG_GAME } from "../lib/config";
import { loadSession } from "../lib/session";
import { connectGameSocket } from "../lib/ws";
import type { ClientCommand, ClientGameState, PendingEffect, PublicCard, ServerEvent, TurnStep } from "../types";

const MAX_LOG_LINES = 40;
const CARD_IDS = {
  DOUBLE_DRAW: "A-008",
  FLAME_TEMPEST: "A-010",
  ARF: "A-006",
} as const;

const CARD_EFFECT_TEXT: Record<string, string> = {
  "A-001": "アイゼン: バトル時にBP3000以下の相手スピリット1体を破壊。自分のアルティメットがいるなら1枚ドロー。",
  "A-003": "ナイト: 召喚時に自分のアルティメットがいれば相手ネクサス1つを破壊。アタック時に1枚ドロー。",
  "A-004": "リューマン: 破壊時にBP4000以下の相手スピリット1体を破壊。",
  "A-005": "ウルフ: アタック時にBP+3000。自分のアルティメットがいればさらに+3000。",
  "A-006": "ARジークF: 赤スピリット1体以上で召喚可能。アタック時のデッキ破棄、強制ブロック、フラッシュ時のコア移動+BP上昇を持つ。",
  "A-007": "ARジークV: 赤スピリット3体以上で召喚可能。召喚時とアタック時のデッキ破棄、ライフ増加、強制ブロック、破壊効果を持つ。",
  "A-008": "ダブルドロー: メインで2枚ドロー。自分のアルティメットがいればさらに1枚。フラッシュでは1体のBPを+1000。",
  "A-009": "シャイニングフレイム: フラッシュでBP10000以下の相手スピリット1体を破壊。",
  "A-010": "フレイムテンペスト: フラッシュでBP8000以下を1体破壊、またはBP4000以下をすべて破壊。",
  "A-011": "狩る者の集落: 自分のアタックステップ中、赤のスピリット/アルティメットをBP+2000。Lv2ではライフ減少時に破壊効果。",
};

interface MagicChoiceState {
  instanceId: string;
  cardName: string;
  modes: Array<{ label: string; mode: string }>;
}

interface MobileMenuAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  emphasis?: "primary" | "danger" | "neutral";
}

interface MobileMenuState {
  title: string;
  subtitle?: string;
  actions: MobileMenuAction[];
}

export function BattlePage() {
  const { roomId = "" } = useParams();
  const session = useMemo(() => loadSession(roomId), [roomId]);
  const navigate = useNavigate();
  const connectionRef = useRef<ReturnType<typeof connectGameSocket> | null>(null);
  const [message, setMessage] = useState("接続中...");
  const [connectedPlayers, setConnectedPlayers] = useState(1);
  const [state, setState] = useState<ClientGameState | null>(null);
  const [socketReady, setSocketReady] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [magicChoice, setMagicChoice] = useState<MagicChoiceState | null>(null);
  const [detailCard, setDetailCard] = useState<PublicCard | null>(null);
  const [mobileMenu, setMobileMenu] = useState<MobileMenuState | null>(null);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== "undefined" ? window.innerWidth <= 768 : false));
  const [logExpanded, setLogExpanded] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);

  function pushLog(line: string) {
    setLogs((current) => [`${new Date().toLocaleTimeString()} ${line}`, ...current].slice(0, MAX_LOG_LINES));
  }

  useEffect(() => {
    if (!session) {
      return;
    }

    const connection = connectGameSocket(session, {
      onEvent(event: ServerEvent) {
        if (event.type === "ROOM_STATUS") {
          setConnectedPlayers(event.connectedPlayers);
          setMessage(event.message);
          setSocketReady(true);
          if (event.connectedPlayers === 2) {
            pushLog("対戦開始待機が完了しました");
          }
          return;
        }

        if (event.type === "STATE_UPDATE") {
          setState(event.state);
          setMessage(event.state.message);
          setSocketReady(true);

          if (event.state.status === "finished" && event.state.winner !== null) {
            navigate("/result", {
              replace: true,
              state: {
                won: event.state.winner === event.state.viewerPlayerIndex,
                roomId: event.state.roomId,
              },
            });
          }
          return;
        }

        setMessage(event.message);
      },
      onClose() {
        setSocketReady(false);
        setMagicChoice(null);
        setMessage("接続が切断されました");
      },
      onLog(line) {
        pushLog(line);
      },
    });

    connectionRef.current = connection;

    return () => {
      connection.close();
      connectionRef.current = null;
    };
  }, [navigate, session]);

  useEffect(() => {
    if (!state || state.pendingEffect || state.phase !== "flash") {
      setMagicChoice(null);
    }
  }, [state]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const media = window.matchMedia("(max-width: 768px)");
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    setDebugOpen(!isMobile);
  }, [isMobile]);

  if (!session) {
    return <Navigate to="/" replace />;
  }

  function sendCommand(command: ClientCommand) {
    connectionRef.current?.send(command);
  }

  function closeTransientUi() {
    setMagicChoice(null);
    setDetailCard(null);
    setMobileMenu(null);
  }

  const waiting = !state || state.status === "waiting";
  const canAct = !!state && socketReady && state.activePlayerIndex === state.viewerPlayerIndex && state.status === "active";
  const isFlashPhase = state?.phase === "flash";
  const hasPriority = !!state && state.priorityPlayer === session.playerId;
  const isEffectController = !!state?.pendingEffect && state.pendingEffect.controllerId === session.playerId;
  const canRespondToAttack =
    !!state?.pendingAttack?.canRespond &&
    socketReady &&
    !isFlashPhase &&
    !state.pendingEffect &&
    state.pendingAttack.resolutionMode === "pending";

  function handlePlayCard(card: PublicCard) {
    if (!state) {
      return;
    }

    if (card.id === CARD_IDS.FLAME_TEMPEST) {
      setMagicChoice({
        instanceId: card.instanceId,
        cardName: card.name,
        modes: [
          { label: "BP8000以下を1体破壊", mode: "single" },
          { label: "BP4000以下を全破壊", mode: "allSmall" },
        ],
      });
      return;
    }

    if (card.id === CARD_IDS.DOUBLE_DRAW && state.phase === "flash") {
      setMagicChoice({
        instanceId: card.instanceId,
        cardName: card.name,
        modes: [{ label: "BP+1000", mode: "flashBp" }],
      });
      return;
    }

    sendCommand({ type: "PLAY_CARD", instanceId: card.instanceId });
  }

  function openHandCardMenu(card: PublicCard, canPlay: boolean) {
    setMobileMenu({
      title: card.name,
      subtitle: `${card.type} / cost ${card.cost} / reduced ${card.reducedCost ?? "-"}`,
      actions: [
        {
          label: card.type === "magic" ? "Use" : card.type === "nexus" ? "Set" : "Play",
          onClick: () => handlePlayCard(card),
          disabled: !canPlay,
          emphasis: "primary",
        },
        { label: "View Detail", onClick: () => setDetailCard(card) },
      ],
    });
  }

  function openFieldCardMenu(
    card: PublicCard,
    zone: "spirit" | "nexus",
    canActNow: boolean,
    canAttack: boolean,
    canRemoveCore: boolean,
    effectAction?: { label: string; onClick: () => void },
  ) {
    const actions: MobileMenuAction[] = [
      { label: "View Detail", onClick: () => setDetailCard(card) },
      { label: "Add Core", onClick: () => sendCommand({ type: "MOVE_CORE_TO_FIELD", zone, instanceId: card.instanceId }), disabled: !canActNow },
      {
        label: "Remove Core",
        onClick: () => sendCommand({ type: "MOVE_CORE_TO_RESERVE", zone, instanceId: card.instanceId }),
        disabled: !canRemoveCore,
      },
      {
        label: "Trash",
        onClick: () => sendCommand({ type: "TRASH_FIELD_CARD", zone, instanceId: card.instanceId }),
        disabled: !canActNow,
        emphasis: "danger",
      },
    ];

    if (canAttack) {
      actions.unshift({ label: "Attack", onClick: () => sendCommand({ type: "ATTACK", instanceId: card.instanceId }), emphasis: "primary" });
    }
    if (effectAction) {
      actions.unshift({ label: effectAction.label, onClick: effectAction.onClick, emphasis: "primary" });
    }

    setMobileMenu({
      title: card.name,
      subtitle: `Lv ${card.currentLevel ?? "-"} / BP ${card.currentBp ?? "-"} / Core ${card.coreCount ?? 0}`,
      actions,
    });
  }

  const selectableTargetIds = new Set(state?.pendingEffect?.candidates.map((candidate) => candidate.instanceId) ?? []);

  return (
    <main className="battle-shell">
      <header className="battle-topbar">
        <div>
          <p className="eyebrow">Room ID</p>
          <h1>{roomId}</h1>
        </div>
        <div className="battle-meta">
          <span>{socketReady ? "WS connected" : "WS connecting"}</span>
          <span>{connectedPlayers}/2 players</span>
          {state ? <span>Turn {state.turnNumber}</span> : null}
        </div>
      </header>

      {waiting ? (
        <section className="waiting-card">
          <p className="eyebrow">Waiting Room</p>
          <h2>対戦相手の参加待ち</h2>
          <p>{message}</p>
        </section>
      ) : (
        <section className="board-layout">
          <ActionGuide state={state} playerId={session.playerId} />

          <div className="board-header">
            <StatusPanel
              title="Opponent"
              life={state.opponent.life}
              deckCount={state.opponent.deckCount}
              trashCount={state.opponent.trash.length}
              handCount={state.opponent.handCount}
              cores={state.opponent.cores}
            />
            <div className="turn-banner">
              <p className="eyebrow">Battle State</p>
              <strong>{canAct ? "あなたのターン" : "相手のターン"}</strong>
              <span>Step: {state.currentStep}</span>
              <span>Flash Step: {state.flashStep ?? "-"}</span>
              <span>{message}</span>
            </div>
            <StatusPanel
              title="You"
              life={state.you.life}
              deckCount={state.you.deckCount}
              trashCount={state.you.trash.length}
              handCount={state.you.hand.length}
              cores={state.you.cores}
            />
          </div>

          {DEBUG_GAME ? (
            <DebugPanel
              state={state}
              playerId={session.playerId}
              logs={logs}
              open={debugOpen}
              onToggle={() => setDebugOpen((current) => !current)}
            />
          ) : null}

          <div className="battle-grid">
            <section className="opponent-area">
              <ZoneSection
                title="相手 spirit / ultimate"
                cards={state.opponent.spiritZone}
                isMobile={isMobile}
                deckCount={state.opponent.deckCount}
                deckLabel="相手デッキ"
                selectableIds={selectableTargetIds}
                onCardClick={(card) =>
                  selectableTargetIds.has(card.instanceId)
                    ? resolveTargetIfSelectable(state.pendingEffect, card, sendCommand)
                    : setDetailCard(card)
                }
              />
              <ZoneSection
                title="相手 nexus"
                cards={state.opponent.nexusZone}
                isMobile={isMobile}
                selectableIds={selectableTargetIds}
                onCardClick={(card) =>
                  selectableTargetIds.has(card.instanceId)
                    ? resolveTargetIfSelectable(state.pendingEffect, card, sendCommand)
                    : setDetailCard(card)
                }
              />
              <TrashSection title="相手トラッシュ" cards={state.opponent.trash} isMobile={isMobile} onCardClick={setDetailCard} />
            </section>

            <aside className="command-panel">
              {canAct && !state.pendingAttack && !isFlashPhase && !state.pendingEffect ? (
                <button type="button" className="primary" onClick={() => sendCommand({ type: "ADVANCE_STEP" })}>
                  次のステップへ進む
                </button>
              ) : null}
              {canAct && state.currentStep === "end" && !isFlashPhase && !state.pendingEffect ? (
                <button type="button" onClick={() => sendCommand({ type: "END_TURN" })}>
                  ターン終了
                </button>
              ) : null}
              <div className="command-note">
                <strong>現在の状況</strong>
                <span>{describeStep(state.currentStep)}</span>
                <span>{describeFlash(state, hasPriority)}</span>
                {state.pendingEffect ? <span>{state.pendingEffect.sourceCardName}: 対象を選択してください</span> : null}
              </div>
            </aside>

            <section className="player-area">
              <ZoneSection
                title="自分 spirit / ultimate"
                cards={state.you.spiritZone}
                isMobile={isMobile}
                deckCount={state.you.deckCount}
                deckLabel="自分デッキ"
                selectableIds={selectableTargetIds}
                renderCard={(card) => (
                  <FieldCardActions
                    key={card.instanceId}
                    card={card}
                    zone="spirit"
                    isMobile={isMobile}
                    canAct={canAct && !isFlashPhase && !state.pendingEffect}
                    currentStep={state.currentStep}
                    highlighted={selectableTargetIds.has(card.instanceId)}
                    effectAction={buildFieldEffectAction(state, hasPriority, card, sendCommand)}
                    onCardClick={() =>
                      selectableTargetIds.has(card.instanceId)
                        ? resolveTargetIfSelectable(state.pendingEffect, card, sendCommand)
                        : setDetailCard(card)
                    }
                    onOpenMenu={(options) =>
                      openFieldCardMenu(card, "spirit", options.canManageCore, options.canAttack, options.canRemoveCore, options.effectAction)
                    }
                    onAttack={() => sendCommand({ type: "ATTACK", instanceId: card.instanceId })}
                    onAddCore={() => sendCommand({ type: "MOVE_CORE_TO_FIELD", zone: "spirit", instanceId: card.instanceId })}
                    onRemoveCore={() => sendCommand({ type: "MOVE_CORE_TO_RESERVE", zone: "spirit", instanceId: card.instanceId })}
                    onTrash={() => sendCommand({ type: "TRASH_FIELD_CARD", zone: "spirit", instanceId: card.instanceId })}
                  />
                )}
              />
              <ZoneSection
                title="自分 nexus"
                cards={state.you.nexusZone}
                isMobile={isMobile}
                selectableIds={selectableTargetIds}
                renderCard={(card) => (
                  <FieldCardActions
                    key={card.instanceId}
                    card={card}
                    zone="nexus"
                    isMobile={isMobile}
                    canAct={canAct && !isFlashPhase && !state.pendingEffect}
                    currentStep={state.currentStep}
                    highlighted={selectableTargetIds.has(card.instanceId)}
                    onCardClick={() =>
                      selectableTargetIds.has(card.instanceId)
                        ? resolveTargetIfSelectable(state.pendingEffect, card, sendCommand)
                        : setDetailCard(card)
                    }
                    onOpenMenu={(options) =>
                      openFieldCardMenu(card, "nexus", options.canManageCore, false, options.canRemoveCore)
                    }
                    onAddCore={() => sendCommand({ type: "MOVE_CORE_TO_FIELD", zone: "nexus", instanceId: card.instanceId })}
                    onRemoveCore={() => sendCommand({ type: "MOVE_CORE_TO_RESERVE", zone: "nexus", instanceId: card.instanceId })}
                    onTrash={() => sendCommand({ type: "TRASH_FIELD_CARD", zone: "nexus", instanceId: card.instanceId })}
                  />
                )}
              />
              <TrashSection title="自分トラッシュ" cards={state.you.trash} isMobile={isMobile} onCardClick={setDetailCard} />
            </section>
          </div>

          <section className="hand-panel">
            <div className="zone-header">
              <h2>手札</h2>
              <p>{describeHandHint(state, hasPriority, canAct)}</p>
            </div>
            <div className="hand-row">
              {state.you.hand.map((card) => {
                const canPlay = canPlayHandCard(state, session.playerId, canAct, card);
                return (
                  <HandCardActions
                    key={card.instanceId}
                    card={card}
                    isMobile={isMobile}
                    canPlay={canPlay && !state.pendingEffect}
                    onDetail={() => setDetailCard(card)}
                    onPlay={() => handlePlayCard(card)}
                    onOpenMenu={() => openHandCardMenu(card, canPlay && !state.pendingEffect)}
                  />
                );
              })}
            </div>
          </section>

          <BattleLogPanel logs={state.battleLog} isMobile={isMobile} expanded={logExpanded} onToggle={() => setLogExpanded((current) => !current)} />

          {magicChoice ? (
            <MagicChoicePrompt
              choice={magicChoice}
              onChoose={(mode) => {
                sendCommand({ type: "CHOOSE_MAGIC_MODE", instanceId: magicChoice.instanceId, mode });
                setMagicChoice(null);
              }}
              onCancel={() => setMagicChoice(null)}
            />
          ) : null}

          {state.pendingEffect ? (
            <PendingEffectPrompt
              pendingEffect={state.pendingEffect}
              isController={isEffectController}
              onSelect={(instanceId) =>
                sendCommand({
                  type: "RESOLVE_EFFECT_TARGET",
                  pendingEffectId: state.pendingEffect!.id,
                  targetInstanceId: instanceId,
                })
              }
            />
          ) : null}

          {state.pendingAttack && state.phase === "flash" ? (
            <FlashPrompt
              state={state}
              hasPriority={hasPriority}
              canUseMagic={state.you.hand.some((card) => card.type === "magic" && card.playable !== false)}
              onPass={() => sendCommand({ type: "FLASH_PASS" })}
            />
          ) : null}

          {state.pendingAttack && state.phase === "normal" && state.pendingAttack.resolutionMode === "pending" ? (
            <AttackPrompt
              pendingAttack={state.pendingAttack}
              canRespond={canRespondToAttack}
              blockers={state.you.spiritZone}
              onTakeLife={() => sendCommand({ type: "RESPOND_TO_ATTACK", mode: "life" })}
              onBlock={(card) => sendCommand({ type: "RESPOND_TO_ATTACK", mode: "block", blockerInstanceId: card.instanceId })}
            />
          ) : null}

          {detailCard ? (
            <CardDetailModal
              card={detailCard}
              effectText={CARD_EFFECT_TEXT[detailCard.id] ?? "This card effect text is not registered yet."}
              onClose={() => setDetailCard(null)}
            />
          ) : null}
          {mobileMenu && isMobile ? <MobileActionSheet title={mobileMenu.title} subtitle={mobileMenu.subtitle} actions={mobileMenu.actions} onClose={() => setMobileMenu(null)} /> : null}
          {isMobile ? (
            <MobileBottomBar
              canAdvance={canAct && !state.pendingAttack && !isFlashPhase && !state.pendingEffect}
              canEnd={canAct && state.currentStep === "end" && !isFlashPhase && !state.pendingEffect}
              canPass={hasPriority && isFlashPhase && !state.pendingEffect}
              hasOpenUi={!!magicChoice || !!detailCard || !!mobileMenu}
              onAdvance={() => sendCommand({ type: "ADVANCE_STEP" })}
              onEnd={() => sendCommand({ type: "END_TURN" })}
              onPass={() => sendCommand({ type: "FLASH_PASS" })}
              onCancel={closeTransientUi}
            />
          ) : null}
        </section>
      )}
    </main>
  );
}

function ActionGuide({ state, playerId }: { state: ClientGameState; playerId: string }) {
  return (
    <section className="action-guide">
      <p className="eyebrow">Next Action</p>
      <strong>{buildActionMessage(state, playerId)}</strong>
    </section>
  );
}

function ZoneSection({
  title,
  cards,
  isMobile = false,
  deckCount,
  deckLabel,
  renderCard,
  selectableIds,
  onCardClick,
}: {
  title: string;
  cards: PublicCard[];
  isMobile?: boolean;
  deckCount?: number;
  deckLabel?: string;
  renderCard?: (card: PublicCard) => ReactNode;
  selectableIds?: Set<string>;
  onCardClick?: (card: PublicCard) => void;
}) {
  return (
    <section>
      <div className="zone-header">
        <h2>{title}</h2>
        {typeof deckCount === "number" && deckLabel ? <CardBackStack count={deckCount} label={deckLabel} /> : null}
      </div>
      <div className="field-row">
        {cards.map((card) =>
          renderCard ? (
            renderCard(card)
          ) : (
            <CardView
              key={card.instanceId}
              card={card}
              compact
              highlighted={!!selectableIds?.has(card.instanceId)}
              onClick={onCardClick ? () => onCardClick(card) : undefined}
              onInspect={onCardClick ? () => onCardClick(card) : undefined}
              mobileFriendly={isMobile}
            />
          ),
        )}
        {cards.length === 0 ? <div className="empty-zone">空のゾーン</div> : null}
      </div>
    </section>
  );
}

function TrashSection({
  title,
  cards,
  isMobile = false,
  onCardClick,
}: {
  title: string;
  cards: PublicCard[];
  isMobile?: boolean;
  onCardClick?: (card: PublicCard) => void;
}) {
  return (
    <section>
      <div className="zone-header">
        <h2>{title}</h2>
      </div>
      <div className="trash-row">
        {cards.map((card) => (
          <CardView
            key={card.instanceId}
            card={card}
            compact
            onClick={onCardClick ? () => onCardClick(card) : undefined}
            onInspect={onCardClick ? () => onCardClick(card) : undefined}
            mobileFriendly={isMobile}
          />
        ))}
      </div>
    </section>
  );
}

function HandCardActions({
  card,
  isMobile,
  canPlay,
  onDetail,
  onPlay,
  onOpenMenu,
}: {
  card: PublicCard;
  isMobile: boolean;
  canPlay: boolean;
  onDetail: () => void;
  onPlay: () => void;
  onOpenMenu: () => void;
}) {
  return (
    <div className="field-card-shell">
      <CardView
        card={card}
        onClick={isMobile ? onOpenMenu : onDetail}
        onInspect={onDetail}
        mobileFriendly={isMobile}
        actionLabel={isMobile ? "MENU" : "DETAIL"}
        disabled={false}
        disableByPlayable={false}
      />
      {!isMobile ? (
        <div className="field-card-actions">
          {canPlay ? (
            <button type="button" className="primary" onClick={onPlay}>
              {card.type === "magic" ? "USE" : card.type === "nexus" ? "SET" : "PLAY"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FieldCardActions({
  card,
  zone,
  isMobile,
  canAct,
  currentStep,
  highlighted,
  effectAction,
  onCardClick,
  onOpenMenu,
  onAttack,
  onAddCore,
  onRemoveCore,
  onTrash,
}: {
  card: PublicCard;
  zone: "spirit" | "nexus";
  isMobile: boolean;
  canAct: boolean;
  currentStep: TurnStep;
  highlighted?: boolean;
  effectAction?: { label: string; onClick: () => void };
  onCardClick: () => void;
  onOpenMenu: (options: {
    canAttack: boolean;
    canManageCore: boolean;
    canRemoveCore: boolean;
    effectAction?: { label: string; onClick: () => void };
  }) => void;
  onAttack?: () => void;
  onAddCore: () => void;
  onRemoveCore: () => void;
  onTrash: () => void;
}) {
  const canAttack =
    zone === "spirit" &&
    canAct &&
    currentStep === "attack" &&
    card.isRested === true &&
    !card.attackedThisTurn &&
    typeof card.currentLevel === "number" &&
    (card.coreCount ?? 0) > 0;
  const canManageCore = canAct && currentStep === "main";
  const canRemoveCore = canManageCore && (card.coreCount ?? 0) > 0;

  return (
    <div className="field-card-shell">
      <CardView
        card={card}
        compact
        highlighted={highlighted}
        onClick={
          isMobile && !highlighted
            ? () => onOpenMenu({ canAttack, canManageCore, canRemoveCore, effectAction })
            : onCardClick
        }
        onInspect={onCardClick}
        mobileFriendly={isMobile}
        actionLabel={highlighted ? "TARGET" : isMobile ? "MENU" : "DETAIL"}
      />
      {!isMobile ? (
        <div className="field-card-actions">
          {canAttack ? (
            <button type="button" className="primary" onClick={onAttack}>
              ATTACK
            </button>
          ) : null}
          {canManageCore ? (
            <button type="button" onClick={onAddCore}>
              +CORE
            </button>
          ) : null}
          {canRemoveCore ? (
            <button type="button" onClick={onRemoveCore}>
              -CORE
            </button>
          ) : null}
          {canManageCore ? (
            <button type="button" onClick={onTrash}>
              TRASH
            </button>
          ) : null}
          {effectAction ? (
            <button type="button" onClick={effectAction.onClick}>
              {effectAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AttackPrompt({
  pendingAttack,
  canRespond,
  blockers,
  onTakeLife,
  onBlock,
}: {
  pendingAttack: NonNullable<ClientGameState["pendingAttack"]>;
  canRespond: boolean;
  blockers: PublicCard[];
  onTakeLife: () => void;
  onBlock: (card: PublicCard) => void;
}) {
  const blockableCards = blockers.filter((card) => {
    if (typeof card.currentLevel !== "number" || card.isRested !== true || (card.coreCount ?? 0) <= 0) {
      return false;
    }
    if (pendingAttack.mustBlockBySpiritOnly && card.type !== "spirit") {
      return false;
    }
    return card.type === "spirit" || card.type === "ultimate";
  });
  const lifeDisabled = pendingAttack.mustBlock && blockableCards.length > 0;

  return (
    <section className="attack-prompt flash-prompt">
      <div>
        <p className="eyebrow">Block Declaration</p>
        <h2>{pendingAttack.attackerCard.name} がアタック中</h2>
        <p>
          Lv {pendingAttack.attackerCard.currentLevel ?? "-"} / BP {pendingAttack.attackerCard.currentBp ?? "-"} / CORE{" "}
          {pendingAttack.attackerCard.coreCount ?? 0}
        </p>
        {pendingAttack.mustBlock ? <p>このアタックはブロック必須です。</p> : null}
      </div>
      {canRespond ? (
        <div className="attack-actions">
          {!lifeDisabled ? (
            <button type="button" className="primary" onClick={onTakeLife}>
              ライフ受け
            </button>
          ) : null}
          {blockableCards.map((card) => (
            <button key={card.instanceId} type="button" onClick={() => onBlock(card)}>
              {card.name} でブロック
            </button>
          ))}
          {blockableCards.length === 0 ? <span>ブロック可能なカードがいません</span> : null}
        </div>
      ) : (
        <p>相手がブロック宣言を選択中です。</p>
      )}
    </section>
  );
}

function FlashPrompt({
  state,
  hasPriority,
  canUseMagic,
  onPass,
}: {
  state: ClientGameState;
  hasPriority: boolean;
  canUseMagic: boolean;
  onPass: () => void;
}) {
  return (
    <section className="attack-prompt pending-effect-prompt">
      <div>
        <p className="eyebrow">Flash</p>
        <h2>{state.flashStep === "attackFlash" ? "attackFlash" : "blockFlash"}</h2>
        <p>{hasPriority ? "あなたのフラッシュです" : "相手がフラッシュを選択中です"}</p>
        <p>両者が連続でパスするとフラッシュ終了です。</p>
      </div>
      {hasPriority ? (
        <div className="attack-actions">
          <span>{canUseMagic ? "magicか発動可能な効果を使うか、パスしてください。" : "使える magic がないためパスしてください。"}</span>
          <button type="button" onClick={onPass} disabled={!!state.pendingEffect}>
            パス
          </button>
        </div>
      ) : null}
    </section>
  );
}

function PendingEffectPrompt({
  pendingEffect,
  isController,
  onSelect,
}: {
  pendingEffect: PendingEffect;
  isController: boolean;
  onSelect: (instanceId: string | null) => void;
}) {
  return (
    <section className="attack-prompt">
      <div>
        <p className="eyebrow">Effect Target</p>
        <h2>{pendingEffect.sourceCardName}</h2>
        <p>{pendingEffect.effectName} の対象を選択してください</p>
      </div>
      {isController ? (
        <div className="attack-actions">
          {pendingEffect.candidates.map((candidate) => (
            <button key={candidate.instanceId} type="button" onClick={() => onSelect(candidate.instanceId)}>
              {candidate.name}
            </button>
          ))}
          {pendingEffect.candidates.length === 0 ? (
            <button type="button" onClick={() => onSelect(null)}>
              対象なしで進む
            </button>
          ) : null}
        </div>
      ) : (
        <p>相手が対象を選択中です。</p>
      )}
    </section>
  );
}

function MagicChoicePrompt({
  choice,
  onChoose,
  onCancel,
}: {
  choice: MagicChoiceState;
  onChoose: (mode: string) => void;
  onCancel: () => void;
}) {
  return (
    <section className="attack-prompt">
      <div>
        <p className="eyebrow">Magic Mode</p>
        <h2>{choice.cardName}</h2>
        <p>使用する効果を選択してください。</p>
      </div>
      <div className="attack-actions">
        {choice.modes.map((mode) => (
          <button key={mode.mode} type="button" onClick={() => onChoose(mode.mode)}>
            {mode.label}
          </button>
        ))}
        <button type="button" onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </section>
  );
}

function LegacyCardDetailModal({ card, onClose }: { card: PublicCard; onClose: () => void }) {
  return (
    <section className="modal-backdrop" onClick={onClose}>
      <div className="card-modal" onClick={(event) => event.stopPropagation()}>
        <div className="card-modal-media">
          <img src={card.img} alt={card.name} />
        </div>
        <div className="card-modal-body">
          <p className="eyebrow">Card Detail</p>
          <h2>{card.name}</h2>
          <div className="detail-grid">
            <span>COST {card.cost}</span>
            <span>COLOR {card.color}</span>
            <span>TYPE {card.type}</span>
            <span>REDUCTION {formatReduction(card.reduction)}</span>
            <span>CORE {card.coreCount ?? "-"}</span>
            <span>Lv {card.currentLevel ?? "-"}</span>
            <span>BP {card.currentBp ?? "-"}</span>
            <span>TEMP +{card.temporaryBpBonus ?? 0}</span>
          </div>
          <div className="card-modal-levels">
            <strong>Levels</strong>
            {card.levels.length > 0 ? (
              <ul>
                {card.levels.map((level) => (
                  <li key={`${card.instanceId}-${level.lv}`}>
                    Lv {level.lv}: Core {level.core} / BP {level.bp}
                  </li>
                ))}
              </ul>
            ) : (
              <p>レベルなし</p>
            )}
          </div>
          <div className="card-modal-effect">
            <strong>Effect</strong>
            <p>{CARD_EFFECT_TEXT[card.id] ?? "このカードの専用効果テキストは未設定です。"}</p>
          </div>
          <button type="button" className="primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </section>
  );
}

function DebugPanel({
  state,
  playerId,
  logs,
  open,
  onToggle,
}: {
  state: ClientGameState;
  playerId: string;
  logs: string[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="debug-panel">
      <button type="button" className="debug-toggle" onClick={onToggle}>
        {open ? "Hide Debug" : "Show Debug"}
      </button>
      {open ? (
        <>
          <div className="debug-grid">
        <div>
          <p className="eyebrow">Debug</p>
          <strong>roomId:</strong> {state.roomId}
          <br />
          <strong>playerId:</strong> {playerId}
          <br />
          <strong>turn player:</strong> {state.activePlayerIndex}
          <br />
          <strong>currentStep:</strong> {state.currentStep}
          <br />
          <strong>phase:</strong> {state.phase}
          <br />
          <strong>flashStep:</strong> {state.flashStep ?? "-"}
          <br />
          <strong>priorityPlayer:</strong> {state.priorityPlayer ?? "-"}
          <br />
          <strong>passCount:</strong> {state.passCount}
          <br />
          <strong>pendingAttack:</strong> {state.pendingAttack ? "yes" : "no"}
          <br />
          <strong>pendingEffect:</strong> {state.pendingEffect?.effectName ?? "-"}
          <br />
          <strong>mustBlock:</strong> {state.pendingAttack?.mustBlock ? "yes" : "no"}
          <br />
          <strong>mustBlockBySpiritOnly:</strong> {state.pendingAttack?.mustBlockBySpiritOnly ? "yes" : "no"}
        </div>
        <div>
          <strong>you</strong>
          <br />
          life {state.you.cores.lifeCores} / reserve {state.you.cores.reserveCores} / trash {state.you.cores.trashCores} / void {state.you.cores.voidCores}
          <br />
          deck {state.you.deckCount} / hand {state.you.hand.length}
          <br />
          symbols {formatSymbolTotals(state.you.symbolTotals)}
          <br />
          hand {formatDebugHand(state.you.hand)}
          <br />
          units {formatDebugCards(state.you.spiritZone)}
        </div>
        <div>
          <strong>opponent</strong>
          <br />
          life {state.opponent.cores.lifeCores} / reserve {state.opponent.cores.reserveCores} / trash {state.opponent.cores.trashCores} / void {state.opponent.cores.voidCores}
          <br />
          deck {state.opponent.deckCount} / hand {state.opponent.handCount}
          <br />
          symbols {formatSymbolTotals(state.opponent.symbolTotals)}
          <br />
          units {formatDebugCards(state.opponent.spiritZone)}
        </div>
      </div>
          <div className="debug-log">
        <p className="eyebrow">WebSocket Log</p>
        {logs.length === 0 ? <span>ログなし</span> : null}
        {logs.map((line, index) => (
          <code key={`${line}-${index}`}>{line}</code>
        ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function BattleLogPanel({
  logs,
  isMobile,
  expanded,
  onToggle,
}: {
  logs: string[];
  isMobile: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const visibleLogs = isMobile && !expanded ? logs.slice().reverse().slice(0, 3) : logs.slice().reverse();
  return (
    <section className="attack-prompt battle-log-panel">
      <div className="panel-toggle-row">
        <p className="eyebrow">Battle Log</p>
        {isMobile ? (
          <button type="button" onClick={onToggle}>
            {expanded ? "ログを閉じる" : "ログを開く"}
          </button>
        ) : null}
      </div>
      <div className="battle-log-list">
        {visibleLogs.map((line, index) => (
          <code key={`${line}-${index}`}>{line}</code>
        ))}
      </div>
    </section>
  );
}

function MobileBottomBar({
  canAdvance,
  canEnd,
  canPass,
  hasOpenUi,
  onAdvance,
  onEnd,
  onPass,
  onCancel,
}: {
  canAdvance: boolean;
  canEnd: boolean;
  canPass: boolean;
  hasOpenUi: boolean;
  onAdvance: () => void;
  onEnd: () => void;
  onPass: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mobile-bottom-bar">
      <button type="button" className="primary" onClick={onAdvance} disabled={!canAdvance}>
        次へ
      </button>
      <button type="button" onClick={onEnd} disabled={!canEnd}>
        終了
      </button>
      <button type="button" onClick={onPass} disabled={!canPass}>
        パス
      </button>
      <button type="button" onClick={onCancel} disabled={!hasOpenUi}>
        キャンセル
      </button>
    </div>
  );
}

function buildFieldEffectAction(
  state: ClientGameState,
  hasPriority: boolean,
  card: PublicCard,
  sendCommand: (command: ClientCommand) => void,
) {
  if (state.pendingEffect) {
    return undefined;
  }
  if (state.phase === "flash" && hasPriority && card.id === CARD_IDS.ARF && (card.currentLevel ?? 0) >= 4) {
    return {
      label: "EFFECT",
      onClick: () => sendCommand({ type: "ACTIVATE_CARD_EFFECT", instanceId: card.instanceId, effectName: "arFFlashCoreBoost" }),
    };
  }
  return undefined;
}

function resolveTargetIfSelectable(
  pendingEffect: PendingEffect | null,
  card: PublicCard,
  sendCommand: (command: ClientCommand) => void,
) {
  if (!pendingEffect) {
    return;
  }
  if (!pendingEffect.candidates.some((candidate) => candidate.instanceId === card.instanceId)) {
    return;
  }
  sendCommand({
    type: "RESOLVE_EFFECT_TARGET",
    pendingEffectId: pendingEffect.id,
    targetInstanceId: card.instanceId,
  });
}

function buildActionMessage(state: ClientGameState, playerId: string) {
  if (state.pendingEffect) {
    return state.pendingEffect.controllerId === playerId
      ? `${state.pendingEffect.sourceCardName} の対象を選択してください`
      : "相手が効果対象を選択中です";
  }
  if (state.pendingAttack?.mustBlock && state.pendingAttack.canRespond && state.phase === "normal" && state.pendingAttack.resolutionMode === "pending") {
    return "強制ブロック中です。ブロックできるカードを選んでください";
  }
  if (state.phase === "flash") {
    return state.priorityPlayer === playerId ? "あなたのフラッシュタイミングです" : "相手のフラッシュ解決を待っています";
  }
  switch (state.currentStep) {
    case "start":
      return "ターン開始です。次のステップへ進めてください";
    case "core":
      return "コアステップです。コア追加後に次へ進みます";
    case "draw":
      return "ドローステップです。ドローを確認してください";
    case "refresh":
      return "リフレッシュステップです。カードが回復します";
    case "main":
      return state.activePlayerIndex === state.viewerPlayerIndex ? "メインステップ: カードを召喚・配置できます" : "相手のメインステップです";
    case "attack":
      return state.activePlayerIndex === state.viewerPlayerIndex ? "アタックステップ: アタックできます" : "相手のアタックステップです";
    case "end":
      return state.activePlayerIndex === state.viewerPlayerIndex ? "ターン終了できます" : "相手ターンの終了待ちです";
  }
}

function describeStep(step: TurnStep) {
  switch (step) {
    case "start":
      return "ターン開始";
    case "core":
      return "ボイドからリザーブへコア追加";
    case "draw":
      return "1枚ドロー";
    case "refresh":
      return "疲労状態を回復";
    case "main":
      return "召喚・配置・magic・コア移動";
    case "attack":
      return "アタックと防御解決";
    case "end":
      return "ターン終了待ち";
  }
}

function describeFlash(state: ClientGameState, hasPriority: boolean) {
  if (state.phase !== "flash") {
    return "normal";
  }
  return `${state.flashStep} / ${hasPriority ? "あなたに優先権" : "相手に優先権"} / pass ${state.passCount}`;
}

function canPlayHandCard(state: ClientGameState, playerId: string, canAct: boolean, card: PublicCard) {
  if (card.playable === false || state.pendingEffect) {
    return false;
  }
  if (state.phase === "flash") {
    return state.priorityPlayer === playerId && card.type === "magic";
  }
  return canAct && state.currentStep === "main";
}

function describeHandHint(state: ClientGameState, hasPriority: boolean, canAct: boolean) {
  if (state.pendingEffect) {
    return "対象選択中です。候補カードだけ選択できます。";
  }
  if (state.phase === "flash") {
    return hasPriority ? "フラッシュ中です。magicカードのみ使用できます。" : "相手の優先権中です。";
  }
  if (canAct && state.currentStep === "main") {
    return "カードをクリックすると詳細表示、ボタンで召喚・使用します。";
  }
  return "現在は手札を操作できません。";
}

function formatDebugCards(cards: PublicCard[]) {
  if (cards.length === 0) {
    return "-";
  }
  return cards
    .map(
      (card) =>
        `${card.name}(Lv:${card.currentLevel ?? "-"},BP:${card.currentBp ?? "-"},TEMP:${card.temporaryBpBonus ?? 0},REST:${card.isRested ? "R" : "T"})`,
    )
    .join(" / ");
}

function formatDebugHand(cards: PublicCard[]) {
  if (cards.length === 0) {
    return "-";
  }
  return cards.map((card) => `${card.name}(cost:${card.cost},reduced:${card.reducedCost ?? "-"},playable:${card.playable ? "Y" : "N"})`).join(" / ");
}

function formatSymbolTotals(symbolTotals: Record<string, number>) {
  return Object.entries(symbolTotals)
    .filter(([, value]) => value > 0)
    .map(([color, value]) => `${color}:${value}`)
    .join(" / ") || "0";
}

function formatReduction(reduction: PublicCard["reduction"]) {
  return Object.entries(reduction)
    .filter(([, value]) => value > 0)
    .map(([color, value]) => `${color}:${value}`)
    .join(" / ") || "なし";
}
