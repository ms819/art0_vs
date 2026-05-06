import type { CoreState } from "../types";

interface StatusPanelProps {
  title: string;
  life: number;
  deckCount: number;
  trashCount: number;
  handCount?: number;
  cores: CoreState;
}

export function StatusPanel({ title, life, deckCount, trashCount, handCount, cores }: StatusPanelProps) {
  return (
    <section className="status-panel">
      <div>
        <p className="eyebrow">{title}</p>
        <h3>LIFE {life}</h3>
      </div>
      <div className="status-grid">
        <span>Reserve {cores.reserveCores}</span>
        <span>LifeCores {cores.lifeCores}</span>
        <span>TrashCores {cores.trashCores}</span>
        <span>VoidCores {cores.voidCores}</span>
        <span>Deck {deckCount}</span>
        <span>Card Trash {trashCount}</span>
        {typeof handCount === "number" ? <span>Hand {handCount}</span> : null}
      </div>
    </section>
  );
}
