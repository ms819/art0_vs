export function levelFromCores(card, cores) {
  // card.levels = [{ lv:1, core:1 }, { lv:2, core:3 }, ...]
  let best = card.levels[0];
  for (const lv of card.levels) {
    if (cores >= lv.core) best = lv;
  }
  return best; // { lv, core }
}

export function getAvailableReductionsFromBoard(zones) {
  // まずは簡易に「同色1体につき-1（下限0）」などの近似。必要なら拡張。
  const count = zones.filter(z => z && z.card && z.card.color === 'red').length;
  return { red: Math.min(count, 3) }; // 例: 最大-3まで
}

export function calcActualCost(card, reductions) {
  const base = card.cost ?? 0;
  const red = (reductions?.[card.color] ?? 0);
  return Math.max(0, base - red);
}