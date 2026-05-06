interface CardBackStackProps {
  count: number;
  label: string;
}

export function CardBackStack({ count, label }: CardBackStackProps) {
  return (
    <div className="stack">
      <img src="/images/card-back.jpeg" alt={label} />
      <div className="stack-copy">
        <span>{label}</span>
        <strong>{count}</strong>
      </div>
    </div>
  );
}
