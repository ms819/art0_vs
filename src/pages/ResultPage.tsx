import { Link, useLocation } from "react-router-dom";

interface ResultState {
  won: boolean;
  roomId: string;
}

export function ResultPage() {
  const location = useLocation();
  const state = location.state as ResultState | null;

  if (!state) {
    return (
      <main className="shell single-shell">
        <section className="form-card large-card">
          <p className="eyebrow">Result</p>
          <h1>対戦結果がありません</h1>
          <p>ルームに戻るか、新しく対戦を開始してください。</p>
          <Link to="/" className="primary-link">
            ホームに戻る
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="shell single-shell">
      <section className="result-card">
        <img src={state.won ? "/images/win.png" : "/images/lose.png"} alt={state.won ? "Win" : "Lose"} />
        <div className="result-copy">
          <p className="eyebrow">Room {state.roomId}</p>
          <h1>{state.won ? "Victory" : "Defeat"}</h1>
          <p>{state.won ? "勝利です。もう一度同じ構成で検証できます。" : "敗北です。盤面やログを確認して再戦できます。"}</p>
          <div className="result-actions">
            <Link to="/" className="primary-link">
              ホームに戻る
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
