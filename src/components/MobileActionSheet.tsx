interface ActionSheetItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  emphasis?: "primary" | "danger" | "neutral";
}

interface MobileActionSheetProps {
  title: string;
  subtitle?: string;
  actions: ActionSheetItem[];
  onClose: () => void;
}

export function MobileActionSheet({ title, subtitle, actions, onClose }: MobileActionSheetProps) {
  return (
    <section className="modal-backdrop mobile-sheet-backdrop" onClick={onClose}>
      <div className="mobile-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="mobile-sheet-header">
          <p className="eyebrow">Card Actions</p>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <div className="mobile-sheet-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={action.emphasis === "primary" ? "primary" : action.emphasis === "danger" ? "danger-button" : ""}
              onClick={() => {
                action.onClick();
                onClose();
              }}
              disabled={action.disabled}
            >
              {action.label}
            </button>
          ))}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}
