export interface CardEffectStatusRow {
  cardName: string;
  timing: string;
  summary: string;
  implemented: "implemented" | "partial";
  notes: string;
}

export const CARD_EFFECT_STATUS: CardEffectStatusRow[] = [
  { cardName: "アイゼン", timing: "battle", summary: "BP3000以下破壊 / 自軍アルティメット時1ドロー", implemented: "implemented", notes: "アタック時・ブロック時の両方に接続" },
  { cardName: "ファイザード", timing: "-", summary: "効果なし", implemented: "implemented", notes: "効果なしカードとして扱う" },
  { cardName: "ナイト", timing: "summon / attack", summary: "召喚時ネクサス破壊 / アタック時1ドロー", implemented: "implemented", notes: "召喚時は自軍アルティメット条件付き" },
  { cardName: "リューマン", timing: "destroyed", summary: "BP4000以下の相手スピリット1体破壊", implemented: "implemented", notes: "候補1件は自動解決、複数は対象選択" },
  { cardName: "ウルフ", timing: "attack", summary: "BP+3000 / 自軍アルティメット時さらに+3000", implemented: "implemented", notes: "battleOnlyBpBonusで管理しターン終わりに解消" },
  { cardName: "ARジークF", timing: "summon condition / attack / flash", summary: "赤スピリット1体条件 / デッキ破棄と強制ブロック / コア移動BP+3000", implemented: "implemented", notes: "スピリットブロック時のライフ移動も実装" },
  { cardName: "ARジークV", timing: "summon condition / summon / attack", summary: "赤スピリット3体条件 / デッキ破棄とライフ回復 / 強制ブロックと破壊", implemented: "implemented", notes: "ライフ回復は最大5まで" },
  { cardName: "ダブルドロー", timing: "main / flash", summary: "2ドロー / アルティメット時+1ドロー / BP+1000", implemented: "implemented", notes: "フラッシュ時は対象選択" },
  { cardName: "シャイニングフレイム", timing: "flash", summary: "BP10000以下の相手スピリット1体破壊", implemented: "implemented", notes: "対象0件でも停止しない" },
  { cardName: "フレイムテンペスト", timing: "flash", summary: "単体破壊 or 全体破壊", implemented: "implemented", notes: "単体は対象選択、全体は即時解決" },
  { cardName: "狩る者の集落", timing: "continuous / life damage", summary: "自軍アタックステップBP+2000 / ライフ減少時破壊", implemented: "implemented", notes: "自軍アルティメット時は破壊上限5000" },
];
