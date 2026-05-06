import { calcActualCost, getAvailableReductionsFromBoard, levelFromCores } from './rules.js';

/**
 state 例（React側の構造に寄せる）：
 {
   me: { life, reserve, trash, zones: [ {card, cores, attacked}|null, ... ] },
   op: { life, reserve, trash, zones: [ ... ] },
   opHand: [card,...],  // 追加（AIの手札）
   opDeckCount: number  // 追加（必要なら）
 }
 ※ AIは "op" 側を操作すると仮定。
*/

export function generateLegalMoves(state) {
  const moves = [];
  const you = state.op; // AI視点の自軍
  const foe = state.me; // 相手

  // 1) SUMMON: 手札から空きゾーンへ、コスト+必要コアが払えるなら
  const emptyIdx = you.zones.map((z, i) => z ? null : i).filter(i => i !== null);
  const reductions = getAvailableReductionsFromBoard(you.zones);
  state.opHand?.forEach((card, handIndex) => {
    for (const zoneIndex of emptyIdx) {
      const actualCost = calcActualCost(card, reductions);
      const needCores = card.levels?.[0]?.core ?? 0;
      const totalPay = actualCost + needCores;
      if (you.reserve >= totalPay) {
        moves.push({ type: 'SUMMON', handIndex, zoneIndex, pay: { actualCost, needCores, totalPay } });
      }
    }
  });

  // 2) LEVEL_UP: 既存スピリットの次レベルに必要コアを置けるなら
  you.zones.forEach((z, zoneIndex) => {
    if (!z) return;
    const lvNow = levelFromCores(z.card, z.cores);
    const lvArr = z.card.levels || [];
    const pos = lvArr.findIndex(l => l.lv === lvNow.lv);
    const nextLv = lvArr[pos + 1];
    if (!nextLv) return;
    const needMore = nextLv.core - z.cores;
    if (needMore > 0 && needMore <= you.reserve) {
      moves.push({ type: 'LEVEL_UP', zoneIndex, needMore });
    }
  });

  // 3) ATTACK: まだ攻撃していないスピリットで攻撃
  you.zones.forEach((z, zoneIndex) => {
    if (!z || z.attacked) return;
    moves.push({ type: 'ATTACK', zoneIndex, symbols: z.card.symbolCount || 1 });
  });

  // 4) END_TURN: 常に可能
  moves.push({ type: 'END_TURN' });

  return moves;
}

// 盤面評価：AI(op)が高いほど良い
export function evaluate(state, perspective = 'op') {
  const me = state[perspective];
  const foe = state[perspective === 'op' ? 'me' : 'op'];

  // シンプル評価：ライフ差、リザーブ差、盤面パワーの合計
  const lifeScore = (me.life - foe.life) * 5;
  const reserveScore = (me.reserve - foe.reserve) * 0.5;
  const boardPower = sumBoardPower(me) - sumBoardPower(foe);
  return lifeScore + reserveScore + boardPower;
}

function sumBoardPower(side) {
  let s = 0;
  for (const z of side.zones) {
    if (!z) continue;
    const lv = levelFromCores(z.card, z.cores).lv || 1;
    const sym = z.card.symbolCount || 1;
    s += lv * 2 + sym * 2; // 適当重み：レベルとシンボル
  }
  return s;
}

// 1手先読み（深さ1）で最良手を選択
export function chooseMove(state, mode = 'heuristic') {
  const legal = generateLegalMoves(state);
  if (legal.length === 0) return { move: { type: 'END_TURN' }, explanation: '指し手なし→ターンエンド', score: evaluate(state) };

  if (mode === 'random') {
    const move = legal[Math.floor(Math.random() * legal.length)];
    return { move, explanation: explain(move), score: null };
  }

  // heuristic: 各合法手を適用→評価最大
  let best = null; let bestScore = -Infinity;
  for (const mv of legal) {
    const next = simulate(state, mv);
    const sc = evaluate(next, 'op');
    if (sc > bestScore) { bestScore = sc; best = mv; }
  }
  return { move: best, explanation: explain(best), score: bestScore };
}

// 状態をコピーして1手適用（サーバ側はシミュ専用）
function simulate(state, move) {
  const c = structuredClone(state);
  const you = c.op; const foe = c.me;
  switch (move.type) {
    case 'SUMMON': {
      const card = c.opHand[move.handIndex];
      c.op.reserve -= move.pay.totalPay;
      c.op.trash += move.pay.actualCost;
      c.op.zones[move.zoneIndex] = { card, cores: move.pay.needCores, attacked: false };
      c.opHand.splice(move.handIndex, 1);
      break;
    }
    case 'LEVEL_UP': {
      const z = you.zones[move.zoneIndex];
      z.cores += move.needMore;
      you.reserve -= move.needMore;
      break;
    }
    case 'ATTACK': {
      foe.life = Math.max(0, foe.life - move.symbols);
      const z = you.zones[move.zoneIndex];
      if (z) z.attacked = true;
      break;
    }
    case 'END_TURN':
    default:
      break;
  }
  return c;
}

function explain(move) {
  switch (move.type) {
    case 'SUMMON': return `手札からゾーン${move.zoneIndex + 1}に召喚（実コスト${move.pay.actualCost}、配置コア${move.pay.needCores}）`;
    case 'LEVEL_UP': return `ゾーン${move.zoneIndex + 1}のレベルアップ（追加コア${move.needMore}）`;
    case 'ATTACK': return `ゾーン${move.zoneIndex + 1}でアタック（シンボル${move.symbols}）`;
    case 'END_TURN': return '有効打なし→ターンエンド';
    default: return '—';
  }
}