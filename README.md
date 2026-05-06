# Battle Spirits Online MVP

カード効果なしで 2 人対戦できる Battle Spirits 風 Web アプリです。フロントエンドは `React + Vite + TypeScript`、バックエンドは `Node.js + Express + TypeScript + ws`、カードマスタは `SQLite` で管理しています。

## カード定義形式

カードは [src/data/cards.js](./src/data/cards.js) の `cards` 配列で管理します。各カードは以下を持ちます。

- `id`
- `name`
- `cost`
- `reduction`
- `color`
- `symbolCount`
- `symbolColor`
- `levels`
- `type`
- `img`

### levels

`levels` は以下の配列です。

- `lv`
- `core`
- `bp`

`coreCount` が条件以上になったレベルのうち、最大の `lv` を現在レベルとして採用します。`spirit` の現在BPはそのレベルの `bp` を使います。

## カード種別の扱い

- `spirit`
  - `spirit zone` に出る
  - アタック / ブロック可能
  - `levels` から現在Lv / BPを計算する
- `nexus`
  - `nexus zone` に出る
  - アタック / ブロックしない
- `magic`
  - 使用後すぐトラッシュへ送られる
  - 効果は未実装

## 軽減シンボル

- コスト計算はサーバー側を正とする
- 自分の `spiritZone` と `nexusZone` にあるカードの `symbolColor` と `symbolCount` を参照する
- `magic` は場に残らないため軽減対象にならない
- `reduction[color]` の上限まで、その色のシンボル数ぶん軽減する
- 最終コストは `0` 未満にならない
- 支払いは `reserveCores -> trashCores`
- `spirit / nexus / magic` のすべてに軽減を適用する

### 特殊シンボル

- 現時点では `symbolColor: "arutimetto"` を `red` として扱う
- 将来的に特殊シンボルとして拡張しやすいよう、関数化した実装にしている

## ターン内ステップ

ターンは以下の順で進みます。

`start -> core -> draw -> refresh -> main -> attack -> end`

### 各ステップ

- `start`
  - ターン開始
  - `次のステップへ進む` で `core` へ進む
- `core`
  - ボイドからリザーブにコアを1個置く
  - 先攻1ターン目はコア追加しない
- `draw`
  - デッキから1枚ドローする
- `refresh`
  - `attackedThisTurn` を全て `false` にする
  - `spiritZone` と `nexusZone` のカードを全て回復状態にする
- `main`
  - `spirit / nexus` の召喚・配置
  - `magic` の使用
  - コア移動
- `attack`
  - アタック
  - ブロック / ライフ受けの解決
- `end`
  - ターン終了待ち
  - `ターン終了` または `次のステップへ進む` で相手ターンへ移る

### 操作制限

- ドローは `draw` ステップのみ
- 召喚・配置・magic使用は `main` ステップのみ
- コア移動は `main` ステップのみ
- アタックは `attack` ステップのみ
- ブロック / ライフ受けは `pendingAttack` がある時のみ
- ターンプレイヤー以外は基本操作できない
- 防御側のブロック / ライフ受けだけは相手ターン中にできる

## 疲労と回復

- フィールド上のカードは `isRested` を持つ
- `true` は回復状態、`false` は疲労状態
- `spirit` / `nexus` は召喚・配置時に疲労状態で出る
- `spirit` はアタック後に疲労する
- `spirit` はブロック後にも疲労する
- 疲労状態の `spirit` はアタックできない
- 疲労状態の `spirit` はブロックできない
- `refresh` ステップで `spiritZone` と `nexusZone` のカードをすべて回復する

## データベース

SQLite の `cards` テーブルには以下を保存します。

- `id`
- `name`
- `cost`
- `reduction`
- `color`
- `symbolCount`
- `symbolColor`
- `levels`
- `type`
- `img`

`reduction` と `levels` は JSON 文字列として保存し、seed は `id` 主キーで upsert します。

## cards.js を編集してカードを追加する方法

1. [src/data/cards.js](./src/data/cards.js) にカードを追加する
2. `img` を `public/images` の実ファイル名に合わせる
3. `npm run seed` を実行する

### 画像パスの注意

現在使うべき画像名:

- `/images/art_j.jpeg`
- `/images/uruhu.png`
- `/images/tennpest.png`

## 実装済み

- ルーム作成 / 参加
- SQLite の `cards` seed
- 固定デッキ生成
- コア管理
- 軽減シンボル計算
- `spirit zone` / `nexus zone`
- magic 使用後即トラッシュ
- レベル由来の BP 比較
- ステップ制ターン進行
- デバッグパネル
- WebSocket イベントログ
- battleLog

## ローカル起動

### フロントエンド

```bash
npm install
npm run dev
```

### バックエンド

```bash
cd server
npm install
npm run dev
```

## seed 実行

ルートから:

```bash
npm run seed
```

サーバーディレクトリから:

```bash
cd server
npm run seed
```

## ローカル 2 クライアント確認手順

1. `cd server && npm run dev`
2. 別ターミナルで `npm run dev`
3. ブラウザ 2 タブで `http://localhost:5173` を開く
4. タブAでルーム作成、タブBで参加
5. `次のステップへ進む` で `start -> core -> draw -> refresh -> main -> attack -> end` を確認する

### チェックリスト

- ステップが順番に進む
- 先攻1ターン目の `core` でコア追加されない
- `main` 以外で召喚できない
- `attack` 以外でアタックできない
- `draw` 以外で手動ドローできない
- `end` 後に相手ターンへ移る
- 軽減コストが手札に表示される
- battleLog にステップ進行が記録される

## 本番ビルド

### フロントエンド

```bash
npm run build
```

### バックエンド

```bash
cd server
npm run build
```

## Flash Timing

- Attack declaration moves the game into `phase: flash`.
- `flashOwner` is the defending player's `playerId`, and only that player can act during flash.
- This is a simplified implementation: only one flash action is allowed per attack. Multi-chain flash handling is not implemented yet.
- During flash, only `magic` cards can be used. Summon, set, attack, and block are locked.
- Choosing a magic card or pressing `フラッシュしない` returns the game to `phase: normal`, then block or life resolution continues.
- `flashUsed` shows whether the current flash window has already been consumed.

### Current Magic Behavior

- A magic card used in flash goes to trash immediately.
- The current temporary effect is `draw 1`.

### Future Expansion

- Multi-chain flash handling
- Card-specific magic effects
- More precise flash priority rules

## Priority Flash

- アタックステップ中の流れは `アタック宣言 -> attackFlash -> ブロック宣言 -> blockFlash -> バトル解決` です。
- フラッシュは防御側から開始します。
- `priorityPlayer` を持つプレイヤーだけがフラッシュ中に操作できます。
- 行動した場合は優先権が相手へ移り、`passCount` は `0` に戻ります。
- パスした場合は `passCount` が増え、優先権が相手へ移ります。
- 両者が連続でパスして `passCount = 2` になると、そのフラッシュ窓は終了します。
- `attackFlash` 終了後はブロック宣言へ進みます。
- `blockFlash` 終了後はライフ受けまたはBP比較の解決へ進みます。
- フラッシュ中に使えるのは `magic` のみです。

## Limited Card Effects

- 今回のカード効果は汎用エンジンではなく、登録済みカード専用の分岐で実装しています。
- `ultimate` は専用タイプとして扱い、`ARジークF` / `ARジークV` を含みます。
- 対象選択が必要な効果は `pendingEffect` を作成し、候補カードをクライアントでハイライトして `RESOLVE_EFFECT_TARGET` で確定します。

### 実装済みカード効果

- `アイゼン`: バトル時に BP3000以下破壊、アルティメットがいれば1ドロー
- `ナイト`: 召喚時のネクサス破壊、アタック時1ドロー
- `リューマン`: 破壊時に BP4000以下破壊
- `ウルフ`: アタック時 BP+3000、アルティメットがいればさらに+3000
- `ARジークF`: 召喚条件、アタック時デッキ破棄、強制ブロック、フラッシュでコア移動+BP上昇
- `ARジークV`: 召喚条件、召喚時デッキ破棄+ライフ増加、アタック時デッキ破棄+強制ブロック+破壊
- `ダブルドロー`: メインでドロー、フラッシュで BP+1000
- `シャイニングフレイム`: フラッシュで BP10000以下破壊
- `フレイムテンペスト`: フラッシュで単体破壊 / 全体破壊のモード選択
- `狩る者の集落`: 自分のアタックステップ中の継続 BP+2000、ライフ減少時の破壊効果

### 簡略化している点

- 効果処理は今回の10種類の登録カードだけに固定しています。
- 複数の同名永続効果や複数トリガーの完全なスタック処理は簡略化しています。
- 一部のBP上昇継続時間はターン単位またはバトル単位で簡略管理しています。

## Debug Test Mode

- サーバー側で `DEBUG_GAME=true` を設定すると、初期手札を固定したデバッグモードになります。
- サーバー側で `DEBUG_NO_SHUFFLE=true` を設定すると、デッキ順を固定してシャッフルを無効化します。
- フロント側で `VITE_DEBUG_GAME=true` を設定すると、Debug パネルを表示します。
- 本番ではこれらを `false` のまま使ってください。

### ローカル2タブ確認シナリオ

#### A. ルーム作成・参加

- 2タブで同じURLを開く
- 片方でルーム作成、もう片方で参加
- 対戦開始後にターン表示と roomId を確認する

#### B. 基本操作

- `core` ステップでコア追加を確認する
- `draw` ステップでドローを確認する
- `main` で召喚、配置、コア移動を確認する
- `attack` でアタック、ブロック、ライフ減少を確認する

#### C. フラッシュ

- アタック後に `attackFlash` が始まることを確認する
- 優先権が防御側に渡ることを確認する
- 防御側が magic を使えることを確認する
- 両者がパスすると `attackFlash` が終わることを確認する
- ブロック宣言後に `blockFlash` が始まることを確認する
- 両者がパスするとバトル解決に進むことを確認する

#### D. 対象選択効果

- `シャイニングフレイム` で BP10000以下の対象候補だけが光ることを確認する
- `フレイムテンペスト` で単体破壊 / 全体破壊を選べることを確認する
- `pendingEffect` 中に関係ない操作が無効化されることを確認する

#### E. アルティメット

- `ARジークF` は赤スピリット1体以上で召喚可能になることを確認する
- `ARジークV` は赤スピリット3体以上で召喚可能になることを確認する
- 条件未達時に ERROR が返ることを確認する

#### F. 固有効果

- `ナイト` のアタック時1ドロー
- `ウルフ` の BP +3000 / +6000
- `アイゼン` のバトル時破壊とアルティメット条件ドロー
- `リューマン` の破壊時効果
- `狩る者の集落` の BP +2000
- `狩る者の集落` のライフ減少時破壊効果

### Debugで確認しやすい項目

- `pendingEffect`
- `flashStep`
- `priorityPlayer`
- `passCount`
- `mustBlock`
- 各カードの `temporaryBpBonus`
- 各カードの `currentLevel / currentBp`

## 完成前チェックリスト

- `pendingEffect` 中に対象選択以外の操作ができない
- `flashStep` 中に召喚、通常アタック、ターン進行ができない
- `mustBlock` 中にライフ受けできない
- `attackFlash` 終了後にブロック選択へ進む
- `blockFlash` 終了後に BP 比較またはライフ減少へ進む
- `temporaryBpBonus` がターン終了時にリセットされる
- 破壊されたカードのコアが正しくリザーブへ戻る
- ライフが `0` になったら勝敗状態へ遷移する
- 対象候補が `0` 件でもゲームが停止しない
- WebSocket 切断時に画面がクラッシュしない
### 2026-05-06 確認メモ

- `DEBUG_GAME=true` と `DEBUG_NO_SHUFFLE=true` で固定初期手札・固定山札を使い、2プレイヤー進行をサーバーロジック上で最後まで通して勝敗確定まで確認
- `ARジークF` のフラッシュ効果で他スピリットの最後の1コアを移した場合、0コアのまま場に残る不具合を修正
- 修正後は、0コアになった元スピリットが正しくトラッシュへ移動し、試合進行も停止しないことを再確認
## Render Deployment

### Repository Layout

- Frontend: project root
- Backend: `server/`

### Frontend on Render Static Site

- Service Type: `Static Site`
- Root Directory: repository root
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`

Environment Variables:

- `VITE_API_BASE_URL=https://your-backend.onrender.com`
- `VITE_WS_URL=wss://your-backend.onrender.com`
- `VITE_DEBUG_GAME=false`

Notes:

- `VITE_` environment variables are embedded at build time.
- If you change `VITE_API_BASE_URL`, `VITE_WS_URL`, or `VITE_DEBUG_GAME`, redeploy the static site.

### Backend on Render Web Service

- Service Type: `Web Service`
- Root Directory: `server`
- Build Command: `npm install && npm run build`
- Start Command: `npm start`

Environment Variables:

- `NODE_ENV=production`
- `PORT=5000`
- `CORS_ORIGIN=https://your-frontend.onrender.com`
- `DB_PATH=/var/data/bspo.db`
- `DEBUG_GAME=false`
- `DEBUG_NO_SHUFFLE=false`

Notes:

- The server listens on `process.env.PORT` and falls back to `5000`.
- WebSocket is attached to the same HTTP server on `/ws`.
- In production the client should connect with `wss://your-backend.onrender.com/ws?...`.
- If you want to allow multiple frontend origins, set `CORS_ORIGIN` as a comma-separated list.
- Local development origin `http://localhost:5173` is always allowed.

### SQLite and Seed

- Default development DB path: `server/data/cards.sqlite`
- Production DB path should be set with `DB_PATH`, for example: `/var/data/bspo.db`
- The server creates the `cards` table automatically on startup if it does not exist.
- Card seed is executed at startup by the server.
- You can also run the seed manually:
  - repository root: `npm run seed`
  - backend directory: `cd server && npm run seed`

If you use Render with SQLite, attach a persistent disk. Without a persistent disk, the DB file can be lost on redeploy or restart.

### Render Setup Steps

#### Backend

1. In Render, create `New Web Service`.
2. Connect the GitHub repository.
3. Set `Root Directory` to `server`.
4. Set `Build Command` to `npm install && npm run build`.
5. Set `Start Command` to `npm start`.
6. Add environment variables:
   - `NODE_ENV=production`
   - `PORT=5000`
   - `CORS_ORIGIN=https://your-frontend.onrender.com`
   - `DB_PATH=/var/data/bspo.db`
   - `DEBUG_GAME=false`
   - `DEBUG_NO_SHUFFLE=false`
7. Deploy.
8. After deploy, open `https://your-backend.onrender.com/health` and confirm `{"ok":true}`.
9. Confirm WebSocket endpoint base URL is the same host and will be used as `wss://your-backend.onrender.com`.

#### Frontend

1. In Render, create `New Static Site`.
2. Connect the same GitHub repository.
3. Set `Root Directory` to repository root.
4. Set `Build Command` to `npm install && npm run build`.
5. Set `Publish Directory` to `dist`.
6. Add environment variables:
   - `VITE_API_BASE_URL=https://your-backend.onrender.com`
   - `VITE_WS_URL=wss://your-backend.onrender.com`
   - `VITE_DEBUG_GAME=false`
7. Deploy.
8. Open the frontend URL and confirm the home screen loads.

### Post-Deploy Checklist

- `https://your-backend.onrender.com/health` returns `{"ok":true}`
- Frontend can create a room
- Two devices or two browser sessions can join the same room
- WebSocket connects successfully
- Card images load correctly
- Battle starts after two players join
- One match can proceed to the result screen

### Render Environment Variable Summary

Backend:

- `NODE_ENV=production`
- `PORT=5000`
- `CORS_ORIGIN=https://your-frontend.onrender.com`
- `DB_PATH=/var/data/bspo.db`
- `DEBUG_GAME=false`
- `DEBUG_NO_SHUFFLE=false`

Frontend:

- `VITE_API_BASE_URL=https://your-backend.onrender.com`
- `VITE_WS_URL=wss://your-backend.onrender.com`
- `VITE_DEBUG_GAME=false`

### Important Notes

- Render free instances may sleep.
- SQLite data may be lost unless you mount a persistent disk and point `DB_PATH` to it.
- Frontend `VITE_` variables are compiled into the build, so changing them requires a redeploy.
