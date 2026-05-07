import type { PublicCard } from "../types";

interface CardDetailModalProps {
  card: PublicCard;
  effectText: string;
  onClose: () => void;
}

export function CardDetailModal({ card, effectText, onClose }: CardDetailModalProps) {
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
              <p>No levels</p>
            )}
          </div>
          <div className="card-modal-effect">
            <strong>Effect</strong>
            <p>{effectText}</p>
          </div>
          <button type="button" className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </section>
  );
}

function formatReduction(reduction: PublicCard["reduction"]) {
  return Object.entries(reduction)
    .filter(([, value]) => value > 0)
    .map(([color, value]) => `${color}:${value}`)
    .join(" / ") || "none";
}
