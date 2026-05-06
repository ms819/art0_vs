// src/pages/Battle.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import "../styles/battle.css";
import { cards } from "../data/cards";
import {
connectMultiplayer,
sendState as wsSendState,
sendIntent as wsSendIntent,
amHost
} from "../utils/net";

/* ================= 画像・定数 ================= */
const WIN_IMG  = "/images/win.png";
const LOSE_IMG = "/images/lose.png";

/** 指定デッキ構成（画像ファイル名ベース） */
const deckImages = [
  "suthiraho-nn.jpeg", "suthiraho-nn.jpeg",
  "doraguron.jpeg", "doraguron.jpeg", "doraguron.jpeg",
  "rizadoejji.jpeg", "rizadoejji.jpeg", "rizadoejji.jpeg",
  "rokukeratopsu.jpeg", "rokukeratopsu.jpeg", "rokukeratopsu.jpeg",
  "raimei-ryu-zi-gurimu.webp", "raimei-ryu-zi-gurimu.webp", "raimei-ryu-zi-gurimu.webp",
  "art_j.jpeg","art_j.jpeg","art_j.jpeg",
];

/* ================= ルール系ユーティリティ ================= */
function getAvailableReductionsFromBoard(zones) {
  const sum = { red:0, blue:0, green:0, white:0, yellow:0, purple:0 };
  for (const z of zones) {
    if (!z || !z.card) continue;
    const { symbolColor, symbolCount = 1 } = z.card;
    if (sum.hasOwnProperty(symbolColor)) {
      sum[symbolColor] = (sum[symbolColor] || 0) + symbolCount;
    }
  }
  return sum;
}
function calcActualCost(card, reds) {
  let r = 0;
  for (const c of Object.keys(card.reduction || {})) {
    r += Math.min(card.reduction[c] || 0, reds[c] || 0);
  }
  return Math.max(0, (card.cost || 0) - r);
}
function levelFromCores(card, cores) {
  let cur = card.levels[0];
  for (const lv of card.levels) if (cores >= lv.core) cur = lv;
  return cur;
}
function getBP(z) { return levelFromCores(z.card, z.cores).bp || 0; }
/* ドラグロン：攻撃中のみ+2000（Lv1/2） */
function getAttackBP(z) {
  let bp = getBP(z);
  if (z.card?.id === "draguron-001") {
    const lv = levelFromCores(z.card, z.cores).lv;
    if (lv === 1 || lv === 2) bp += 2000;
  }
  return bp;
}
function attackerIsSiegwurm(z){ return !!z?.card && z.card.id === "siegwurm-001"; }
function attackerIsArtSieg(z){ return !!z?.card && z.card.id === "art_siegwurm-001"; }
function isFighterCard(z){ return !!z?.card && (z.card.type === "spirit" || z.card.type === "arutimetto"); } // 攻防可能

function deityLevel(side) {
  let lv = 0;
  for (const z of side.zones) {
    if (z && z.card?.type === "nexus" && z.card.id === "deity-001") {
      lv = Math.max(lv, levelFromCores(z.card, z.cores).lv);
    }
  }
  return lv;
}

/* ================= デッキ＆トラッシュ操作 ================= */
function drawRandomFromDeck(deckArr){
  if (!deckArr || deckArr.length === 0) return { card:null, rest:deckArr };
  const idx = (Math.random()*deckArr.length)|0;
  const card = deckArr[idx];
  const rest = [...deckArr.slice(0,idx), ...deckArr.slice(idx+1)];
  return { card, rest };
}

/* ================= AI（メイン使用） ================= */
function evalSide(side) {
  let s = 0;
  for (const z of side.zones) {
    if (!z) continue;
    const lv = levelFromCores(z.card, z.cores);
    s += (lv.bp || 0) / 1000 + (z.card.symbolCount || 1) * 2;
  }
  s += side.reserve * 0.3 + side.life * 5;
  return s;
}
function evaluate(state){ return evalSide(state.op) - evalSide(state.me); }

function sideHasThreeRedSpirits(sideZones){
  // 召喚制限は「赤のスピリット（type:'spirit' かつ color:'red'）」のみカウント（arutimettoは含めない）
  const cnt = sideZones.filter(z => z && z.card?.type==='spirit' && z.card.color==='red').length;
  return cnt >= 3;
}

function simulateMain(state, move){
  const c = structuredClone(state);
  const you = c.op;
  switch (move.type) {
    case "SUMMON": {
      const card = c.opHand[move.handIndex];
      you.reserve -= move.pay.totalPay;
      you.trash  += move.pay.actualCost;
      you.zones[move.zoneIndex] = { card, cores: move.pay.needCores, exhausted:false };
      c.opHand.splice(move.handIndex, 1);
      break;
    }
    case "ADD_CORE": {
      const z = you.zones[move.zoneIndex];
      if (z){ z.cores += move.n; you.reserve -= move.n; }
      break;
    }
    default: break;
  }
  return c;
}
function generateLegalMainMoves(state){
  const moves = [];
  const you = state.op;
  const empties = you.zones.map((z,i)=>z?null:i).filter(i=>i!==null);
  const reds = getAvailableReductionsFromBoard(you.zones);
  state.opHand.forEach((card, handIndex)=>{
    if (card.type === "magic") return; // メインでは使わない

    // ★ アルティメットジークヴルムの召喚制限（AI側）
    if (card.id === "art_siegwurm-001" && !sideHasThreeRedSpirits(you.zones)) return;

    const actualCost = calcActualCost(card, reds);
    const needCores  = card.levels?.[0]?.core ?? 0;
    const totalPay   = actualCost + needCores;
    if (you.reserve >= totalPay) {
      for (const zoneIndex of empties) {
        moves.push({ type:"SUMMON", handIndex, zoneIndex, pay:{ actualCost, needCores, totalPay }});
      }
    }
  });
  you.zones.forEach((z, zoneIndex)=>{
    if (!z) return;
    const next = z.card.levels.find(lv => lv.core > z.cores);
    if (next && you.reserve > 0) moves.push({ type:"ADD_CORE", zoneIndex, n:1 });
  });
  return moves;
}
function chooseBestMainMove(state){
  const legal = generateLegalMainMoves(state);
  if (legal.length === 0) return null;
  let best=null, score=-Infinity;
  for (const mv of legal) {
    const sc = evaluate(simulateMain(state, mv));
    if (sc > score){ score=sc; best=mv; }
  }
  return best;
}

/* ================= 本体 ================= */
export default function Battle(){

   /* ======== Multiplayer（net.js 利用） ======== */
 const [connected, setConnected] = useState(false);
 const [role, setRole] = useState("host");      // 'host' | 'guest'
 const [room, setRoom] = useState("room1");
 const isHost = () => role === "host";
 const playerName = isHost() ? "HOST" : "GUEST";

 // Hostのみ配信
 const sendState = (state) => {
   if (!connected || !amHost()) return;
   wsSendState(state);
 };
 // 双方が送れる操作リクエスト
 const sendIntent = (payload) => {
   if (!connected) return;
   wsSendIntent(payload);
 };
  // Host が受け取るゲストの意図
   function handleRemoteIntent(msgOrPayload) {
   const payload = msgOrPayload?.payload ?? msgOrPayload;
    switch (payload.type) {
      case "NEXT_STEP": return nextStep();
      case "END_TURN":  return endMyTurn();
      case "SUMMON": {
        const prev = selectedHandIndex;
        setSelectedHandIndex(payload.handIndex);
        setTimeout(()=>{ summonToZone(payload.zoneIdx); setSelectedHandIndex(prev); }, 0);
        return;
      }
      case "ADD_CORE":  return addCore(payload.zoneIdx, payload.n);
      case "ATTACK":    return attackWith(payload.zoneIdx);
      case "BLOCK_CHOICE": {
        const r = blockResolverRef.current; if (r) r(payload.choice);
        return;
      }
      case "FLASH_CHOICE": {
        const r = flashResolverRef.current; if (r) r(payload.use);
        return;
      }
      case "CORE_MOVE_PICK": {
        const r = coreMoveResolverRef.current; if (r) r(payload.zoneIndex);
        return;
      }
      case "DESTROY_PICK": {
        const r = destroyResolverRef.current; if (r) r(payload.zoneIndex);
        return;
      }
      default: return;
    }
  }

  /* ======== ゲーム状態 ======== */
  // デッキはユーザ指定構成で固定
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const baseDeck = useMemo(() => buildDeckFromImages(), []);
  const [me, setMe] = useState({ life:5, reserve:4, trash:0, zones:[null,null,null,null], cTrash:[] });
  const [op, setOp] = useState({ life:5, reserve:4, trash:0, zones:[null,null,null,null], cTrash:[] });
  const [deck, setDeck] = useState([]), [hand, setHand] = useState([]);
  const [opDeck, setOpDeck] = useState([]), [opHand, setOpHand] = useState([]);

  // 0:コア 1:ドロー 2:リフレッシュ 3:メイン 4:アタック
  const [phase, setPhase] = useState(0);

  // ターン管理
  const [isMyTurn, setIsMyTurn] = useState(true);
  const [turnIndex, setTurnIndex] = useState(1); // 1は先行の1ターン目
  const isFirstTurn = turnIndex === 1;

  // ジャンケン
  const [janken, setJanken] = useState({ open:true, msg:"先攻/後攻をジャンケンで決めます", lastAi:null });
  const jp = ["グー","チョキ","パー"];

  // UI / モーダル系
  const [blockPrompt, setBlockPrompt] = useState(null);
  const blockResolverRef = useRef(null);
  const [flashPrompt, setFlashPrompt] = useState(null);
  const flashResolverRef = useRef(null);
  const [coreMovePrompt, setCoreMovePrompt] = useState(null);
  const coreMoveResolverRef = useRef(null);
  const [revealPrompt, setRevealPrompt] = useState(null); // コスト確認フェーズ
  const revealResolverRef = useRef(null);
  const [destroyPrompt, setDestroyPrompt] = useState(null); // 破壊対象選択
  const destroyResolverRef = useRef(null);
  const [gameOver, setGameOver] = useState(null);

  // 霊峰Lv2の「最初攻撃」
  const [myFirstAttackUsed, setMyFirstAttackUsed] = useState(false);
  const [opFirstAttackUsed, setOpFirstAttackUsed] = useState(false);

  // 参照
  const meRef = useRef(me), opRef = useRef(op);
  const deckRef = useRef(deck), opDeckRef = useRef(opDeck);
  useEffect(()=>{ meRef.current = me; },[me]);
  useEffect(()=>{ opRef.current = op; },[op]);
  useEffect(()=>{ deckRef.current = deck; },[deck]);
  useEffect(()=>{ opDeckRef.current = opDeck; },[opDeck]);

  /* ======== Socket 接続 ======== */
  // 接続・受信
   useEffect(() => {
   if (!connected) return;
    const disconnect = connectMultiplayer({
   url: process.env.REACT_APP_WS_URL || "http://localhost:3001",
     // url は net.js 側のデフォルトに任せる or 環境変数で上書き可
     _roomId: room,
     _asHost: isHost(),
     name: playerName,
     onSystem: (msg) => { /* 任意でトースト等 */ },
     onState:  (state) => { if (!isHost()) hydrate(state); },
     onIntent: (msg)   => { if (isHost()) handleRemoteIntent(msg); },
     onChoice: (msg)   => { if (isHost()) handleRemoteIntent(msg); }, // まとめて受けるならここでも
   });
   return () => disconnect?.();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [connected, role, room]);

  // Host：状態変化ごとに配信
  useEffect(() => {
    if (connected && isHost()) sendState(snapshot());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, me, op, deck, hand, opDeck, opHand, phase, isMyTurn, turnIndex, janken, myFirstAttackUsed, opFirstAttackUsed]);

  // 状態スナップショット（送信用）
  function snapshot() {
    return {
      me: meRef.current,
      op: opRef.current,
      deck: deckRef.current,
      hand,
      opDeck: opDeckRef.current,
      opHand,
      phase,
      isMyTurn,
      turnIndex,
      janken,
      myFirstAttackUsed,
      opFirstAttackUsed,
    };
  }
  // 受信状態を適用（Guest）
  function hydrate(state) {
    if (!state) return;
    setMe(state.me); setOp(state.op);
    setDeck(state.deck); setHand(state.hand);
    setOpDeck(state.opDeck); setOpHand(state.opHand);
    setPhase(state.phase); setIsMyTurn(state.isMyTurn); setTurnIndex(state.turnIndex);
    setJanken(state.janken);
    setMyFirstAttackUsed(state.myFirstAttackUsed);
    setOpFirstAttackUsed(state.opFirstAttackUsed);
  }

  /* ================= デッキ生成（画像名→カード） ================= */
  function findCardByImageName(fname){
    let found = cards.find(c => (c.img || "").endsWith("/"+fname));
    if (!found && fname.includes("meteo")) {
      found = cards.find(c => c.id === "meteo-001" || c.id === "double-draw-001" || c.name === "メテオストーム" || c.name === "ダブルドロー");
    }
    return found ? {...found} : null;
  }
  function buildDeckFromImages(){
    const deck = [];
    deckImages.forEach((fn, i) => {
      const c = findCardByImageName(fn);
      if (c) deck.push({ ...c, deckIndex: i });
    });
    return deck;
  }
  function shuffle(arr){
    const a = [...arr];
    for (let i=a.length-1;i>0;i--){ const j=(Math.random()* (i+1))|0; [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  }

  // 初期化（デッキ配布と初手）
  useEffect(()=>{
    const myDeck = shuffle(baseDeck).map((c,i)=>({ ...c, deckIndex:i }));
    const enemyDeck = shuffle(baseDeck).map((c,i)=>({ ...c, deckIndex:i }));
    setDeck(myDeck); setOpDeck(enemyDeck);
    const draw = (d,n)=>{ const out=[]; const nd=[...d]; for(let i=0;i<n && nd.length;i++){ out.push(nd.shift()); } return [out,nd]; };
    const [m4, md] = draw(myDeck, 4); setHand(m4); setDeck(md);
    const [o4, od] = draw(enemyDeck, 4); setOpHand(o4); setOpDeck(od);
  }, [baseDeck]);

  // 勝敗
  useEffect(()=>{ if(!gameOver && op.life===0) setGameOver("win"); },[op.life,gameOver]);
  useEffect(()=>{ if(!gameOver && me.life===0) setGameOver("lose"); },[me.life,gameOver]);

  // アタックステップ入りで自分側の「最初アタック未使用」
  useEffect(()=>{ if(phase===4) setMyFirstAttackUsed(false); },[phase]);

  /* ========== 共通ヘルパ ========== */
  const destroySpirit = (owner, zoneIndex) => {
    if (owner==="me"){
      setMe(m=>{
        const z = m.zones[zoneIndex]; if(!z) return m;
        return { ...m,
          reserve: m.reserve + z.cores,
          zones: m.zones.map((zz,i)=> i===zoneIndex ? null : zz),
          cTrash: [...m.cTrash, z.card]
        };
      });
    } else {
      setOp(o=>{
        const z = o.zones[zoneIndex]; if(!z) return o;
        return { ...o,
          reserve: o.reserve + z.cores,
          zones: o.zones.map((zz,i)=> i===zoneIndex ? null : zz),
          cTrash: [...o.cTrash, z.card]
        };
      });
    }
  };
  const markExhausted = (owner, zoneIndex) => {
    if (owner==="me") setMe(m=>({...m, zones:m.zones.map((z,i)=> i===zoneIndex&&z?{...z,exhausted:true}:z)}));
    else setOp(o=>({...o, zones:o.zones.map((z,i)=> i===zoneIndex&&z?{...z,exhausted:true}:z)}));
  };
  const unExhaust = (owner, zoneIndex) => {
    if (owner==="me") setMe(m=>({...m, zones:m.zones.map((z,i)=> i===zoneIndex&&z?{...z,exhausted:false}:z)}));
    else setOp(o=>({...o, zones:o.zones.map((z,i)=> i===zoneIndex&&z?{...z,exhausted:false}:z)}));
  };
  const applyUnblockedDamage = (defender, symbols, attackerSide, attackerZone) => {
    if (defender === "op") {
      setOp(o => { const nl=Math.max(0,o.life-symbols); const d=o.life-nl; return {...o, life:nl, reserve:o.reserve+d}; });
    } else {
      setMe(m => { const nl=Math.max(0,m.life-symbols); const d=m.life-nl; return {...m, life:nl, reserve:m.reserve+d}; });
    }
    markExhausted(attackerSide, attackerZone);
  };

  /* ========== ネクサスLv1/2（既存） ========== */
  const askCoreMoveTarget = (owner, cores) =>
    new Promise(resolve => {
      if (coreMoveResolverRef.current) try { coreMoveResolverRef.current(null); } catch {}
      coreMoveResolverRef.current = resolve;
      setCoreMovePrompt({ owner, cores });
    });

  function maybeApplyDeityLv1(owner, destroyedCores, destroyedWasSieg){
    if (!destroyedWasSieg || destroyedCores<=0) return;
    const state = owner==="me"? meRef.current : opRef.current;
    if (deityLevel(state) < 1) return;

    const candidates = state.zones.map((z,i)=> z && z.card.type==='spirit' ? i : -1).filter(i=>i>=0);
    if (candidates.length === 0) return;

    if (owner==="me"){
      askCoreMoveTarget("me", destroyedCores).then(target=>{
        setCoreMovePrompt(null); coreMoveResolverRef.current=null;
        if (typeof target !== "number") return;
        setMe(m => ({
          ...m,
          reserve: Math.max(0, m.reserve - destroyedCores),
          zones: m.zones.map((z,i)=> i===target ? {...z, cores:z.cores + destroyedCores} : z)
        }));
      });
    } else {
      let best=-1, bestBP=-1;
      state.zones.forEach((z,i)=>{ if (z && z.card.type==='spirit'){ const bp=getBP(z); if (bp>bestBP){best=i; bestBP=bp;} }});
      if (best>=0){
        setOp(o => ({
          ...o,
          reserve: Math.max(0, o.reserve - destroyedCores),
          zones: o.zones.map((z,i)=> i===best ? {...z, cores:z.cores + destroyedCores} : z)
        }));
      }
    }
  }
  function maybeSiegLv2Refresh(owner, zoneIndex){
    const state = owner==="me"? meRef.current : opRef.current;
    if (deityLevel(state) < 2) return;
    const z = state.zones[zoneIndex]; if (!z || !attackerIsSiegwurm(z)) return;
    if (owner==="me"){ if (!myFirstAttackUsed){ setMyFirstAttackUsed(true); unExhaust("me", zoneIndex); } }
    else { if (!opFirstAttackUsed){ setOpFirstAttackUsed(true); unExhaust("op", zoneIndex); } }
  }

  /* ========== フラッシュ（メテオストーム） ========== */
  const magicIds = ["meteo-001", "double-draw-001"]; // フォールバック
  const hasMeteoInHand = (handArr) => handArr.findIndex(c => c.type==='magic' && magicIds.includes(c.id));
  function canSidePayMeteo(side){
    const state = side==="me" ? meRef.current : opRef.current;
    const handArr = side==="me" ? hand : opHand;
    const idx = hasMeteoInHand(handArr);
    if (idx < 0) return { ok:false };
    const card = handArr[idx];
    const reds = getAvailableReductionsFromBoard(state.zones);
    const cost = calcActualCost(card, reds);
    if (state.reserve < cost) return { ok:false };
    return { ok:true, idx, cost, card };
  }
  function canUseFlashNow(side, attackerSide, attackerZone, blockerZone){
    const isAtk = side === attackerSide;
    const state = side==="me" ? meRef.current : opRef.current;
    const z = state.zones[ isAtk ? attackerZone : blockerZone ];
    if (!z || !attackerIsSiegwurm(z)) return false;
    return canSidePayMeteo(side).ok;
  }
  function spendMeteo(side){
    const { ok, idx, cost, card } = canSidePayMeteo(side);
    if (!ok) return false;
    if (side==="me"){
      setMe(m => ({ ...m, reserve:m.reserve - cost, cTrash:[...m.cTrash, card] }));
      setHand(h => { const nh=[...h]; nh.splice(idx,1); return nh; });
    } else {
      setOp(o => ({ ...o, reserve:o.reserve - cost, cTrash:[...o.cTrash, card] }));
      setOpHand(h => { const nh=[...h]; nh.splice(idx,1); return nh; });
    }
    return true;
  }
  function aiWantsFlash(side, attackerSide, attackerZone, blockerZone, atkBP, blkBP){
    if (!canUseFlashNow(side, attackerSide, attackerZone, blockerZone)) return false;
    const isAtk = side === attackerSide;
    const myBP = isAtk ? atkBP : blkBP;
    const opBP = isAtk ? blkBP : atkBP;
    return myBP >= opBP;
  }
  async function flashLoop(attackerSide, attackerZone, blockerZone, atkBP, blkBP){
    let buffAtkSide = false, buffDefSide = false;
    let turn = (attackerSide === "me") ? "op" : "me";
    let passCount = 0;

    while (passCount < 2){
      const canUse = canUseFlashNow(turn, attackerSide, attackerZone, blockerZone);
      let use = false;
      if (turn === "me"){
        if (canUse){
          const { cost } = canSidePayMeteo("me");
          use = await new Promise(resolve => {
            if (flashResolverRef.current) try { flashResolverRef.current(false); } catch {}
            flashResolverRef.current = resolve;
            setFlashPrompt({ text:`フラッシュ：メテオストーム（実支払い ${cost}）を使いますか？\n効果：このバトル中、自軍ジークが相手スピリットを破壊したとき相手はライフ-1（その分相手リザーブ+1）` });
          });
          setFlashPrompt(null); flashResolverRef.current = null;
        }
      } else {
        use = canUse && aiWantsFlash("op", attackerSide, attackerZone, blockerZone, atkBP, blkBP);
      }

      if (use && spendMeteo(turn)){
        if (turn === "me") buffDefSide = (attackerSide!=="me");
        if (turn === "me") buffAtkSide = (attackerSide==="me");
        if (turn === "op") {
          buffDefSide = buffDefSide || (attackerSide!=="op");
          buffAtkSide = buffAtkSide || (attackerSide==="op");
        }
        passCount = 0;
      } else {
        passCount += 1;
      }
      turn = (turn === "me") ? "op" : "me";
    }
    return { buffAtkSide, buffDefSide };
  }
  function applyFlashExtraDamage(attackerSide, attackerZone, blockerZone, destroyed, buffs){
    const atkOwner = attackerSide;
    const defOwner = attackerSide === "me" ? "op" : "me";
    const atkZ = (atkOwner==="me"? meRef.current:opRef.current).zones[attackerZone];
    const blkZ = (defOwner==="me"? meRef.current:opRef.current).zones[blockerZone];

    if (destroyed.blk && buffs?.buffAtkSide && attackerIsSiegwurm(atkZ)){
      if (defOwner==="op") setOp(o=>({...o, life:Math.max(0,o.life-1), reserve:o.reserve+1}));
      else setMe(m=>({...m, life:Math.max(0,m.life-1), reserve:m.reserve+1}));
    }
    if (destroyed.atk && buffs?.buffDefSide && attackerIsSiegwurm(blkZ)){
      if (atkOwner==="op") setOp(o=>({...o, life:Math.max(0,o.life-1), reserve:o.reserve+1}));
      else setMe(m=>({...m, life:Math.max(0,m.life-1), reserve:m.reserve+1}));
    }
  }

  /* ========== コスト公開モーダル / 破壊対象選択モーダル ========== */
  const revealCostPhase = ({ owner, source, milledCard }) =>
    new Promise(resolve => {
      if (revealResolverRef.current) try { revealResolverRef.current(null); } catch {}
      revealResolverRef.current = resolve;
      setRevealPrompt({ owner, source, card: milledCard });
    });

  const askDestroyTarget = ({ owner, candidates }) =>
    new Promise(resolve => {
      if (destroyResolverRef.current) try { destroyResolverRef.current(null); } catch {}
      destroyResolverRef.current = resolve;
      setDestroyPrompt({ owner, candidates });
    });

  /* ========== アルティメットジークヴルム：召喚＆アタック処理 ========== */
  function canSummonArt(ownerZones){
    return sideHasThreeRedSpirits(ownerZones);
  }

  // 召喚時誘発：相手デッキからランダム1枚トラッシュ → コスト<=8なら自分ライフ回復（上限5）
  async function onArtSummoned(bySide){
    if (bySide === "me"){
      const { card: milled, rest } = drawRandomFromDeck(opDeckRef.current);
      setOpDeck(rest);
      if (milled) setOp(o=>({...o, cTrash:[...o.cTrash, milled]}));
      await revealCostPhase({ owner:"me", source:"summon", milledCard:milled });
      if (milled && (milled.cost ?? 0) <= 8){
        setMe(m => ({ ...m, life: Math.min(5, m.life + (milled.cost ?? 0)) }));
      }
    } else {
      const { card: milled, rest } = drawRandomFromDeck(deckRef.current);
      setDeck(rest);
      if (milled) setMe(m=>({...m, cTrash:[...m.cTrash, milled]}));
      await revealCostPhase({ owner:"op", source:"summon", milledCard:milled });
      if (milled && (milled.cost ?? 0) <= 8){
        setOp(o => ({ ...o, life: Math.min(5, o.life + (milled.cost ?? 0)) }));
      }
    }
  }

  // アタック時（Lv4/5）：ミル→コスト<=8で強制ブロック条件、さらに<=4でBP12000以下破壊
  async function onArtAttackTrigger(attackerSide, attackerZone){
    const atkOwner = attackerSide;

    // Lv確認（4/5のみ）
    const z = (atkOwner==="me" ? meRef.current : opRef.current).zones[attackerZone];
    const lvNow = levelFromCores(z.card, z.cores).lv;
    if (lvNow < 4) return { forceBlock:false };

    if (atkOwner==="me"){
      const { card: milled, rest } = drawRandomFromDeck(opDeckRef.current);
      setOpDeck(rest);
      if (milled) setOp(o=>({...o, cTrash:[...o.cTrash, milled]}));
      await revealCostPhase({ owner:"me", source:"attack", milledCard:milled });

      let forceBlock = false;
      if (milled && (milled.cost ?? 0) <= 8){
        const readyDefs = opRef.current.zones.some(zz => zz && !zz.exhausted && isFighterCard(zz));
        forceBlock = readyDefs;
      }
      if (milled && (milled.cost ?? 0) <= 4){
        const cands = opRef.current.zones
          .map((zz, i)=> (zz && zz.card.type==='spirit' && getBP(zz) <= 12000) ? {index:i, z:zz} : null)
          .filter(Boolean);
        if (cands.length>0){
          const pick = await askDestroyTarget({ owner:"me", candidates:cands });
          setDestroyPrompt(null); destroyResolverRef.current = null;
          if (typeof pick === "number") destroySpirit("op", pick);
        }
      }
      return { forceBlock };
    } else {
      const { card: milled, rest } = drawRandomFromDeck(deckRef.current);
      setDeck(rest);
      if (milled) setMe(m=>({...m, cTrash:[...m.cTrash, milled]}));
      await revealCostPhase({ owner:"op", source:"attack", milledCard:milled });

      let forceBlock = false;
      if (milled && (milled.cost ?? 0) <= 8){
        const readyDefs = meRef.current.zones.some(zz => zz && !zz.exhausted && isFighterCard(zz));
        forceBlock = readyDefs;
      }
      if (milled && (milled.cost ?? 0) <= 4){
        const cands = meRef.current.zones
          .map((zz, i)=> (zz && zz.card.type==='spirit' && getBP(zz) <= 12000) ? {index:i, z:zz} : null)
          .filter(Boolean);
        if (cands.length>0){
          // AIは最大BPを自動破壊
          const best = cands.reduce((a,b)=> (getBP(a.z) >= getBP(b.z) ? a : b));
          destroySpirit("me", best.index);
        }
      }
      return { forceBlock };
    }
  }

  /* ========== 自分の操作 ========== */
  const canSummon = isMyTurn && phase===3;
  const canAttack = isMyTurn && phase===4 && !(isFirstTurn && isMyTurn);

  function onHandClick(i){ setSelectedHandIndex(prev=> prev===i ? null : i); }
  const [selectedHandIndex, setSelectedHandIndex] = useState(null);

  const nextStep = () => {
    if (!isMyTurn || gameOver) return;
    if (connected && !isHost()) { sendIntent({ type: "NEXT_STEP" }); return; }

    if (isFirstTurn && phase===0){ setPhase(1); return; }

    if (phase===0){
      setMe(m=>({...m, reserve:m.reserve+1}));
    } else if (phase===1){
      if (deck.length>0){ setHand(h=>[...h, deck[0]]); setDeck(d=>d.slice(1)); }
    } else if (phase===2){
      setMe(m=>({ ...m, reserve:m.reserve+m.trash, trash:0, zones:m.zones.map(z=> z?{...z,exhausted:false}:z)}));
    } else if (phase===3 && isFirstTurn){
      endMyTurn();
      return;
    }
    setPhase(p=>Math.min(4,p+1));
  };

  function endMyTurn(){
    if (connected && !isHost()) { sendIntent({ type:"END_TURN" }); return; }
    setIsMyTurn(false);
    setPhase(0);
    if (isFirstTurn) setTurnIndex(2);
    enemyTurn(isFirstTurn);
  }

  const summonToZone = async (zoneIdx) => {
    if (!canSummon || selectedHandIndex===null) return;
    if (connected && !isHost()) { sendIntent({ type:"SUMMON", zoneIdx, handIndex:selectedHandIndex }); return; }

    if (me.zones[zoneIdx] !== null) return;
    const card = hand[selectedHandIndex];
    if (card.type === "magic") return;

    // ★ 召喚制限：アルティメットジークヴルム
    if (card.id === "art_siegwurm-001" && !canSummonArt(me.zones)){
      alert("このカードは自分のフィールドに赤のスピリットが3体以上いないと召喚できません。");
      return;
    }

    const reds = getAvailableReductionsFromBoard(me.zones);
    const actualCost = calcActualCost(card, reds);
    const needCores  = card.levels[0]?.core ?? 0;
    const totalPay   = actualCost + needCores;
    if (me.reserve < totalPay) { alert(`コア不足：必要${totalPay}（コスト${actualCost}+Lv1必要${needCores}）/ 手持ち${me.reserve}`); return; }

    setMe(m=>({ ...m, reserve:m.reserve-totalPay, trash:m.trash+actualCost, zones:m.zones.map((z,i)=> i===zoneIdx?{card, cores:needCores, exhausted:false}:z)}));
    setHand(h=>{ const nh=[...h]; nh.splice(selectedHandIndex,1); return nh; });
    setSelectedHandIndex(null);

    // ★ 召喚時誘発（自分）
    if (card.id === "art_siegwurm-001"){
      await onArtSummoned("me");
    }
  };

  const addCore = (zoneIdx, n) => {
    if (!canSummon) return;
    if (connected && !isHost()) { sendIntent({ type:"ADD_CORE", zoneIdx, n }); return; }
    const z = me.zones[zoneIdx]; if (!z) return;
    if (n>0 && me.reserve < n) return;
    setMe(m=>({ ...m, reserve:m.reserve - n, zones:m.zones.map((zz,i)=> i===zoneIdx ? {...zz, cores: Math.max(0, zz.cores+n)} : zz)}));
  };

  function aiChooseBlockFor(attackerBP, attackerSymbols, forced){
    const ready = opRef.current.zones
      .map((z,i)=>(z && !z.exhausted && isFighterCard(z))?{i,bp:getBP(z)}:null)
      .filter(Boolean);
    if (ready.length===0) return null;
    const killers = ready.filter(r=>r.bp>=attackerBP).sort((a,b)=>a.bp-b.bp);
    if (killers.length>0) return killers[0].i;
    if (!forced){
      const lethal = attackerSymbols >= opRef.current.life;
      if (!lethal) return null;
    }
    return ready.sort((a,b)=>b.bp-a.bp)[0].i;
  }

  const attackWith = async (zoneIdx) => {
    if (!canAttack || gameOver) return;
    if (connected && !isHost()) { sendIntent({ type:"ATTACK", zoneIdx }); return; }

    const z = meRef.current.zones[zoneIdx];
    if (!z || z.exhausted || !isFighterCard(z)) return;

    const symbols = Math.max(0, z.card.symbolCount || 1);
    const atkBPOv = getAttackBP(z);

    // 既存の強制ブロック（ジークヴルム）
    let forced  = attackerIsSiegwurm(z) && opRef.current.zones.some(zz => zz && !zz.exhausted && isFighterCard(zz));

    // ★ アルティメットジーク：Lv4/5アタック時処理（ミル→強制ブロック/破壊）
    if (attackerIsArtSieg(z)){
      const result = await onArtAttackTrigger("me", zoneIdx);
      forced = forced || result.forceBlock;
    }

    const blk = aiChooseBlockFor(atkBPOv, symbols, forced);
    if (blk === null) {
      applyUnblockedDamage("op", symbols, "me", zoneIdx);
      maybeSiegLv2Refresh("me", zoneIdx);
    } else {
      const buffs = await flashLoop("me", zoneIdx, blk, atkBPOv, getBP(opRef.current.zones[blk]));
      const destroyed = resolveBattleWithFlash("me", zoneIdx, blk, atkBPOv);
      applyFlashExtraDamage("me", zoneIdx, blk, destroyed, buffs);
    }
  };

  function resolveBattleWithFlash(attackerSide, attackerZone, blockerZone, attackerBPOv){
    const atkOwner = attackerSide;
    const defOwner = attackerSide === "me" ? "op" : "me";
    const atkState = atkOwner==="me" ? meRef.current : opRef.current;
    const defState = defOwner==="me" ? meRef.current : opRef.current;
    const atkZ = atkState.zones[attackerZone];
    const blkZ = defState.zones[blockerZone];
    if (!atkZ || !blkZ) {
      markExhausted(attackerSide, attackerZone);
      if (blkZ) markExhausted(defOwner, blockerZone);
      return { atk:false, blk:false };
    }
    const atkBP = typeof attackerBPOv==="number" ? attackerBPOv : getBP(atkZ);
    const blkBP = getBP(blkZ);
    const atkDestroyed = blkBP >= atkBP;
    const blkDestroyed = atkBP >= blkBP;

    const atkC = atkZ.cores, blkC = blkZ.cores;

    markExhausted(defOwner, blockerZone);
    markExhausted(attackerSide, attackerZone);

    if (atkDestroyed) destroySpirit(atkOwner, attackerZone);
    if (blkDestroyed) destroySpirit(defOwner, blockerZone);

    if (atkDestroyed && attackerIsSiegwurm(atkZ)) maybeApplyDeityLv1(atkOwner, atkC, true);
    if (blkDestroyed && attackerIsSiegwurm(blkZ)) maybeApplyDeityLv1(defOwner, blkC, true);

    maybeSiegLv2Refresh(attackerSide, attackerZone);
    return { atk:atkDestroyed, blk:blkDestroyed };
  }

  const onZoneClick = (zoneIdx)=> { if (me.zones[zoneIdx]===null) summonToZone(zoneIdx); };

  /* ========== 敵（AI）ターン ========== */
  const enemyTurn = async (firstTurn=false) => {
    if (gameOver) return;

    if (!firstTurn) setOp(o=>({...o, reserve:o.reserve+1}));

    if (opDeck.length>0){ setOpHand(h=>[...h, opDeck[0]]); setOpDeck(d=>d.slice(1)); }

    setOp(o=>({...o, reserve:o.reserve+o.trash, trash:0, zones:o.zones.map(z=> z?{...z,exhausted:false}:z)}));

    // 3 メイン（AI）
    let sim = {
      me: structuredClone(meRef.current),
      op: structuredClone({...opRef.current, reserve:opRef.current.reserve + (firstTurn?0:1) + opRef.current.trash, trash:0, zones:opRef.current.zones.map(z=> z?{...z,exhausted:false}:z)}),
      opHand: [...opHand, ...(opDeck[0]?[opDeck[0]]:[])],
      opDeckCount: Math.max(0, opDeck.length-1),
    };
    for (let i=0;i<20;i++){
      const mv = chooseBestMainMove(sim);
      if (!mv) break;
      if (mv.type==="SUMMON"){
        const card = sim.opHand[mv.handIndex];

        // ★ アルティメットジーク召喚制限（保険）
        if (card.id==="art_siegwurm-001" && !sideHasThreeRedSpirits(opRef.current.zones)){
          // 召喚不可 → スキップ
        } else {
          setOp(o=>({...o, reserve:o.reserve-mv.pay.totalPay, trash:o.trash+mv.pay.actualCost, zones:o.zones.map((z,idx)=> idx===mv.zoneIndex ? {card, cores:mv.pay.needCores, exhausted:false} : z)}));
          setOpHand(h=>{ const nh=[...h]; nh.splice(mv.handIndex,1); return nh; });

          // ★ 召喚時誘発（AI）
          if (card.id === "art_siegwurm-001"){
            await onArtSummoned("op");
          }
          sim = simulateMain(sim, mv);
        }
      } else if (mv.type==="ADD_CORE"){
        setOp(o=>({...o, reserve:o.reserve-mv.n, zones:o.zones.map((z,idx)=> idx===mv.zoneIndex ? {...z, cores:z.cores+mv.n} : z)}));
        sim = simulateMain(sim, mv);
      }
    }

    // 4 アタック
    setOpFirstAttackUsed(false);
    if (!firstTurn){
      for (let i=0;i<4;i++){
        if (gameOver) break;
        const z = opRef.current.zones[i];
        if (!z || z.exhausted || !isFighterCard(z)) continue;

        const symbols = Math.max(0, z.card.symbolCount || 1);
        const atkBPOv = getAttackBP(z);
        const readyDefs = meRef.current.zones.some(zz => zz && !zz.exhausted && isFighterCard(zz));

        // 既存の強制ブロック（ジークヴルム）
        let forced = attackerIsSiegwurm(z) && readyDefs;

        // ★ アルティメットジーク：アタック時処理（AI）
        if (attackerIsArtSieg(z)){
          const result = await onArtAttackTrigger("op", i);
          forced = forced || result.forceBlock;
        }

        if (!readyDefs) {
          applyUnblockedDamage("me", symbols, "op", i);
          maybeSiegLv2Refresh("op", i);
          continue;
        }

        const choice = await new Promise((resolve)=>{
          blockResolverRef.current = resolve;
          setBlockPrompt({ defender:"me", attackerSide:"op", attackerZone:i, attackerBP:atkBPOv, attackerSymbols:symbols, forced });
        });

        setBlockPrompt(null); blockResolverRef.current = null;
        let decided = choice;
        if (forced && (!decided || decided.type==="none")) {
          const firstReady = meRef.current.zones.findIndex(zz => zz && !zz.exhausted && isFighterCard(zz));
          if (firstReady !== -1) decided = { type:"block", blocker:firstReady };
        }

        if (!decided || decided.type==="none") {
          applyUnblockedDamage("me", symbols, "op", i);
          maybeSiegLv2Refresh("op", i);
        } else {
          const defBP = getBP(meRef.current.zones[decided.blocker]);
          const buffs = await flashLoop("op", i, decided.blocker, atkBPOv, defBP);
          const destroyed = resolveBattleWithFlash("op", i, decided.blocker, atkBPOv);
          applyFlashExtraDamage("op", i, decided.blocker, destroyed, buffs);
        }
      }
    }

    setIsMyTurn(true);
    setPhase(0);
    setTurnIndex(t => t+1);
  };

  /* ========== UI ========== */
  const phaseName = ["①コア","②ドロー","③リフレッシュ","④メイン","⑤アタック"][phase];
  const nextDisabled = !isMyTurn || (phase===4 && !(isFirstTurn && isMyTurn)) || !!gameOver;

  return (
    <div className="board">
      {/* ヘッダ（自分） */}
      <section className="side my-side">
        <header className="hud hud-top">
          <span className="hud-item">
            {isMyTurn ? "あなたのターン" : "相手のターン"} ／ フェーズ <b>{phaseName}</b>
            {isFirstTurn && isMyTurn && "（先行：コア/アタック自動スキップ）"}
          </span>
          <span className="hud-item">LIFE <b>{me.life}</b></span>
          <span className="hud-item">RESERVE <b>{me.reserve}</b></span>
          <span className="hud-item">TRASH <b>{me.trash}</b></span>
          <span className="hud-item">CARD-TRASH <b>{me.cTrash.length}</b></span>
          <span className="spacer" />

          {/* Multiplayer コントロール */}
          <div style={{ display:'flex', gap:6, alignItems:'center', marginRight:8 }}>
            <select value={role} onChange={(e)=>setRole(e.target.value)} disabled={connected}>
              <option value="host">Host</option>
              <option value="guest">Guest</option>
            </select>
            <input value={room} onChange={(e)=>setRoom(e.target.value)} disabled={connected} style={{ width:100 }} />
            {!connected
              ? <button className="btn" onClick={()=>setConnected(true)}>接続</button>
              : <button className="btn" onClick={()=>setConnected(false)}>切断</button>
            }
          </div>

          <button className="btn next-btn" onClick={nextStep} disabled={nextDisabled}>次のステップ</button>
          <button className="btn" onClick={endMyTurn} disabled={!isMyTurn || !!gameOver}>敵のターン</button>
        </header>

        {/* 自分フィールド */}
        <div className="field">
          {me.zones.map((z,i)=>{
            if (!z) {
              return (
                <div key={i} className={`zone ${selectedHandIndex!==null && canSummon ? "placeable" : ""}`} onClick={()=>{ if (me.zones[i]===null) summonToZone(i); }}>
                  <span>ゾーン{i+1}</span>
                </div>
              );
            }
            const info = levelFromCores(z.card, z.cores);
            return (
              <div key={i} className={`zone filled ${z.exhausted ? "attacked" : ""}`}>
                <img src={z.card.img} alt={z.card.name} className="zone-card" style={{width:"100%", height:"100%", objectFit:"cover"}}/>
                <div className="zone-badge">
                  {z.card.type==='nexus' ? `NEXUS Lv${info.lv}` : `Lv${info.lv} / BP ${info.bp}`}
                </div>
                {z.exhausted && <div className="zone-flag">疲労</div>}
                <div className="zone-controls">
                  <button className="btn-small" onClick={()=>addCore(i,-1)} disabled={!canSummon}>-</button>
                  <button className="btn-small" onClick={()=>addCore(i,+1)} disabled={!canSummon || me.reserve<=0}>+</button>
                  {isFighterCard(z) && (
                    <button className={`btn-small warn ${z.exhausted ? "disabled" : ""}`}
                            onClick={()=>attackWith(i)}
                            disabled={!canAttack || !!z.exhausted || !!gameOver}
                            title={!canAttack ? (isFirstTurn? "先行は攻撃不可":"アタックステップのみ") : (z.exhausted ? "疲労中" : "アタック")}>
                      ATK
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 手札 */}
        <footer className="hand hand-bottom">
          {hand.length===0 ? <span>手札ゾーン</span> : (
            <div className="hand-cards">
              {hand.map((card,idx)=>(
                <img key={card.deckIndex ?? `${card.id}-${idx}`} src={card.img} alt={card.name}
                     className={`card-img ${selectedHandIndex===idx ? "selected":""}`}
                     onClick={()=>onHandClick(idx)} draggable={false} title={card.name}/>
              ))}
            </div>
          )}
        </footer>
      </section>

      {/* 仕切り線 */}
      <div className="divider" />

      {/* 相手側 */}
      <section className="side op-side">
        <header className="hud hud-bottom">
          <span className="hud-item red">LIFE <b>{op.life}</b></span>
          <span className="hud-item red">RESERVE <b>{op.reserve}</b></span>
          <span className="hud-item red">TRASH <b>{op.trash}</b></span>
          <span className="hud-item red">CARD-TRASH <b>{op.cTrash.length}</b></span>
          <span className="spacer" />
          <span className="hud-item">敵手札 {opHand.length} 枚</span>
        </header>

        <div className="field">
          {op.zones.map((z,i)=>{
            if (!z) return <div key={i} className="zone"><span>{i+1}ゾーン</span></div>;
            const info = levelFromCores(z.card, z.cores);
            return (
              <div key={i} className={`zone filled ${z.exhausted ? "attacked" : ""}`}>
                <img src={z.card.img} alt={z.card.name} className="zone-card" style={{width:"100%", height:"100%", objectFit:"cover"}}/>
                <div className="zone-badge">
                  {z.card.type==='nexus' ? `NEXUS Lv${info.lv}` : `Lv${info.lv} / BP ${info.bp}`}
                </div>
                {z.exhausted && <div className="zone-flag">疲労</div>}
              </div>
            );
          })}
        </div>
      </section>

      {/* ブロックUI（自分が防御） */}
      {blockPrompt && blockPrompt.defender === "me" && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,.35)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999}}>
          <div style={{ background:"#fff", padding:16, borderRadius:12, width:560 }}>
            <div style={{fontWeight:700, marginBottom:8}}>
              ブロック{blockPrompt.forced ? "（必須）" : ""}を選択
            </div>
            <div style={{fontSize:14, marginBottom:8}}>
              敵のゾーン{blockPrompt.attackerZone+1} が攻撃（BP {blockPrompt.attackerBP} / シンボル {blockPrompt.attackerSymbols}）
            </div>
            <div style={{display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8}}>
              {me.zones.map((z,i)=>{
                if (!z || z.exhausted || !isFighterCard(z))
                  return <button key={i} className="btn" style={{opacity:.4}} disabled>{i+1}：ブロック不可</button>;
                const info = levelFromCores(z.card, z.cores);
                return (
                  <button
                    key={i}
                    className="btn"
                    onClick={()=>{
                      if (connected && !isHost()) {
                        sendIntent({ type:"BLOCK_CHOICE", choice:{ type:"block", blocker:i }});
                      } else {
                        const r=blockResolverRef.current; if(r) r({type:"block", blocker:i});
                        setBlockPrompt(null); blockResolverRef.current=null;
                      }
                    }}
                    title={`${z.card.name} / Lv${info.lv} BP${info.bp}`}>
                    {i+1}：{z.card.name}（Lv{info.lv} BP{info.bp}）
                  </button>
                );
              })}
            </div>
            {!blockPrompt.forced && (
              <div style={{display:"flex", gap:8, marginTop:12, justifyContent:"flex-end"}}>
                <button
                  className="btn"
                  onClick={()=>{
                    if (connected && !isHost()) {
                      sendIntent({ type:"BLOCK_CHOICE", choice:{ type:"none" }});
                    } else {
                      const r=blockResolverRef.current; if(r) r({type:"none"});
                      setBlockPrompt(null); blockResolverRef.current=null;
                    }
                  }}>
                  ブロックしない
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* フラッシュUI（自分） */}
      {flashPrompt && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,.35)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:10000}}>
          <div style={{background:"#fff", padding:16, borderRadius:12, width:520}}>
            <div style={{fontWeight:700, marginBottom:8}}>フラッシュ</div>
            <div style={{whiteSpace:"pre-wrap", marginBottom:12}}>{flashPrompt.text}</div>
            <div style={{display:"flex", gap:8, justifyContent:"flex-end"}}>
              <button
                className="btn"
                onClick={()=>{
                  if (connected && !isHost()) {
                    sendIntent({ type:"FLASH_CHOICE", use:false });
                  } else {
                    const r=flashResolverRef.current; if(r) r(false);
                    setFlashPrompt(null); flashResolverRef.current=null;
                  }
                }}>
                使わない
              </button>
              <button
                className="btn warn"
                onClick={()=>{
                  if (connected && !isHost()) {
                    sendIntent({ type:"FLASH_CHOICE", use:true });
                  } else {
                    const r=flashResolverRef.current; if(r) r(true);
                    /* close in caller */
                  }
                }}>
                使う
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ネクサスLv1：コア移動先選択（自分） */}
      {coreMovePrompt && coreMovePrompt.owner === "me" && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,.35)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:10001}}>
          <div style={{background:"#fff", padding:16, borderRadius:12, width:520}}>
            <div style={{fontWeight:700, marginBottom:8}}>コア移動先を選択（{coreMovePrompt.cores}コア）</div>
            <div style={{display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8}}>
              {me.zones.map((z,i)=>{
                if (!z || z.card.type!=='spirit') return <button key={i} className="btn" disabled style={{opacity:.4}}>{i+1}：不可</button>;
                const info = levelFromCores(z.card, z.cores);
                return (
                  <button
                    key={i}
                    className="btn"
                    onClick={()=>{
                      if (connected && !isHost()) {
                        sendIntent({ type:"CORE_MOVE_PICK", zoneIndex:i });
                      } else {
                        const r=coreMoveResolverRef.current; if(r) r(i);
                      }
                    }}>
                    {i+1}：{z.card.name}（Lv{info.lv} BP{info.bp}）
                  </button>
                );
              })}
            </div>
            <div style={{display:"flex", justifyContent:"flex-end", marginTop:8}}>
              <button className="btn" onClick={()=>{ const r=coreMoveResolverRef.current; if(r) r(null); }}>キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* ★ コスト確認モーダル */}
      {revealPrompt && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,.45)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:10002}}>
          <div style={{background:"#fff", padding:16, borderRadius:12, width:520}}>
            <div style={{fontWeight:700, marginBottom:8}}>コスト確認フェーズ</div>
            {revealPrompt.card ? (
              <div style={{display:"flex", gap:12, alignItems:"center"}}>
                <img src={revealPrompt.card.img} alt={revealPrompt.card.name} style={{width:96, height:96, objectFit:"cover", borderRadius:8}}/>
                <div>
                  <div>公開カード：<b>{revealPrompt.card.name}</b></div>
                  <div>コスト：<b>{revealPrompt.card.cost ?? 0}</b></div>
                </div>
              </div>
            ) : (
              <div>デッキが空でした（公開するカードなし）</div>
            )}
            <div style={{display:"flex", justifyContent:"flex-end", marginTop:12}}>
              <button className="btn" onClick={()=>{ const r=revealResolverRef.current; if(r) r(true); setRevealPrompt(null); revealResolverRef.current=null; }}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ★ 破壊対象選択（BP12000以下のspirit） */}
      {destroyPrompt && destroyPrompt.owner==="me" && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,.45)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:10003}}>
          <div style={{background:"#fff", padding:16, borderRadius:12, width:560}}>
            <div style={{fontWeight:700, marginBottom:8}}>破壊するスピリットを選択（BP≤12000）</div>
            <div style={{display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8}}>
              {destroyPrompt.candidates.map(({index, z})=>{
                const info = levelFromCores(z.card, z.cores);
                return (
                  <button
                    key={index}
                    className="btn"
                    onClick={()=>{
                      if (connected && !isHost()) {
                        sendIntent({ type:"DESTROY_PICK", zoneIndex:index });
                      } else {
                        const r=destroyResolverRef.current; if(r) r(index);
                      }
                    }}>
                    ゾーン{index+1}：{z.card.name}（Lv{info.lv} BP{info.bp}）
                  </button>
                );
              })}
            </div>
            <div style={{display:"flex", justifyContent:"flex-end", marginTop:10, gap:8}}>
              <button className="btn" onClick={()=>{ const r=destroyResolverRef.current; if(r) r(null); }}>やめる</button>
            </div>
          </div>
        </div>
      )}

      {/* 勝敗 */}
      {gameOver && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:11000}}>
          <img src={gameOver==="win" ? WIN_IMG : LOSE_IMG} alt={gameOver==="win" ? "勝利" : "敗北"}
               style={{maxWidth:"70vw", maxHeight:"70vh", borderRadius:16, background:"#fff"}}/>
        </div>
      )}

      {/* ジャンケンモーダル */}
      {janken.open && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:12000}}>
          <div style={{background:"#fff", padding:20, borderRadius:14, width:520}}>
            <div style={{fontWeight:700, marginBottom:8}}>ジャンケンで先攻/後攻を決めます</div>
            <div style={{marginBottom:8, color:"#444"}}>{janken.msg}</div>
            {janken.lastAi!==null && <div style={{marginBottom:12}}>相手：{jp[janken.lastAi]}</div>}
            <div style={{display:"flex", gap:8, justifyContent:"space-between"}}>
              {jp.map((label,idx)=>(
                <button key={label} className="btn" onClick={()=>{
                  const ai = (Math.random()*3)|0;
                  setJanken(j => ({...j, lastAi:ai}));
                  const mePick = idx;
                  const diff = (mePick - ai + 3) % 3;
                  if (diff === 0) {
                    setJanken(j => ({...j, msg:"あいこです。もう一回！"}));
                  } else {
                    const iWin = diff === 2;
                    setIsMyTurn(iWin);
                    setTurnIndex(1);
                    setPhase(iWin ? 1 : 0);
                    setJanken({ open:false, msg:"", lastAi:ai });
                    if (!iWin) {
                      setTimeout(()=>enemyTurn(true), 0);
                    }
                  }
                }}>{label}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}