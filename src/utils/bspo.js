// 盤面のシンボル合計（軽減用）
export function getAvailableReductionsFromBoard(zones) {
  const sum = { red:0, blue:0, green:0, white:0, yellow:0, purple:0 };
  for (const z of zones) {
    if (!z || !z.card) continue;
    const { symbolColor, symbolCount = 1 } = z.card;
    sum[symbolColor] = (sum[symbolColor] || 0) + symbolCount;
  }
  return sum;
}

// 実支払コスト
export function calcActualCost(card, availableReductions) {
  let reduce = 0;
  for (const color of Object.keys(card.reduction)) {
    const need = card.reduction[color] || 0;
    const have = availableReductions[color] || 0;
    reduce += Math.min(need, have);
  }
  return Math.max(0, card.cost - reduce);
}

// コア数から現在レベル情報
export function levelFromCores(card, cores) {
  let current = card.levels[0];
  for (const lv of card.levels) {
    if (cores >= lv.core) current = lv;
  }
  return current;
}