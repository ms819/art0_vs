import type { CardInstance, PublicCard } from "../types";

interface CardViewProps {
  card: CardInstance | PublicCard;
  onClick?: () => void;
  compact?: boolean;
  actionLabel?: string;
  disabled?: boolean;
  highlighted?: boolean;
}

export function CardView({
  card,
  onClick,
  compact = false,
  actionLabel,
  disabled = false,
  highlighted = false,
}: CardViewProps) {
  const hasBattleState = "coreCount" in card || "attackedThisTurn" in card;
  const hasReductionState = "reducedCost" in card || "playable" in card;
  const isDisabled = disabled || (hasReductionState && card.playable === false && !!onClick);
  const isRested = hasBattleState ? card.isRested !== false : true;

  return (
    <button
      type="button"
      className={`card ${compact ? "card-compact" : ""} ${hasBattleState && (!isRested || card.attackedThisTurn) ? "card-exhausted" : ""} ${isDisabled ? "card-unplayable" : ""} ${highlighted ? "card-highlighted" : ""}`}
      onClick={onClick}
      title={`${card.name} / COST ${card.cost}`}
      disabled={isDisabled}
    >
      <img src={card.img} alt={card.name} />
      <span className="card-caption">{card.name}</span>
      <span className="card-meta">COST {card.cost}</span>
      {hasReductionState && typeof card.reducedCost === "number" ? <span className="card-meta">REDUCED {card.reducedCost}</span> : null}
      {hasReductionState && typeof card.reductionUsed === "number" ? <span className="card-meta">REDUCTION -{card.reductionUsed}</span> : null}
      {hasBattleState && typeof card.currentLevel === "number" ? <span className="card-meta">Lv {card.currentLevel}</span> : null}
      {hasBattleState && typeof card.currentBp === "number" ? <span className="card-meta">BP {card.currentBp}</span> : null}
      {hasBattleState && typeof card.coreCount === "number" ? <span className="card-meta">CORE {card.coreCount}</span> : null}
      {hasBattleState && typeof card.temporaryBpBonus === "number" && card.temporaryBpBonus > 0 ? (
        <span className="card-meta">TEMP +{card.temporaryBpBonus}</span>
      ) : null}
      {hasBattleState ? <span className="card-meta">{isRested ? "READY" : "REST"}</span> : null}
      {hasBattleState && card.attackedThisTurn ? <span className="card-flag">ATTACKED</span> : null}
      {hasBattleState && !isRested ? <span className="card-flag">REST</span> : null}
      {hasReductionState && card.playable === false ? <span className="card-flag">NO CORE</span> : null}
      {disabled && !(hasReductionState && card.playable === false) ? <span className="card-flag">LOCK</span> : null}
      {actionLabel ? <span className="card-action">{actionLabel}</span> : null}
    </button>
  );
}
