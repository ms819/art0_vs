/**
 * 実支払いコスト = 印刷コスト - 軽減（最小0）
 * @param {import('../client/src/data/cards').cards[number]} card
 * @param {Record<string, number>} availableReductions // 例: { red:2, green:1 }
 */
export function calcActualCost(card, availableReductions = {}) {
  let reduce = 0;
  for (const color of Object.keys(card.reduction)) {
    const need = card.reduction[color] || 0;
    const have = availableReductions[color] || 0;
    reduce += Math.min(need, have);
  }
  return Math.max(0, card.cost - reduce);
}

/** 指定レベルの必要コア/BP */
export function getLevelInfo(card, lv) {
  return card.levels.find(l => l.lv === lv) || null;
}

/** 例：赤シンボル総数を返す（将来:多色/複数シンボル拡張時の置き場） */
export function getSymbol(card) {
  return { color: card.symbolColor, count: card.symbolCount };
}