import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { joinRoom } from "../lib/api";
import { saveSession } from "../lib/session";

export function HomePage() {
  const navigate = useNavigate();
  const [roomId, setRoomId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await joinRoom(roomId.trim().toUpperCase(), displayName.trim() || "Guest");
      saveSession({
        roomId: response.roomId,
        playerId: response.playerId,
        playerIndex: response.playerIndex,
        displayName: displayName.trim() || "Guest",
      });
      navigate(`/battle/${response.roomId}`);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "ルーム参加に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell hero-shell">
      <section className="hero-panel">
        <p className="eyebrow">Battle Spirits Online MVP</p>
        <h1>2人対戦の最小構成を、今あるカード画像で動かす。</h1>
        <p className="hero-copy">
          ルーム作成方式、固定デッキ、サーバー正の状態管理、WebSocket同期に絞ったMVPです。
        </p>
        <div className="hero-actions">
          <button type="button" className="primary" onClick={() => navigate("/create")}>
            ルームを作成
          </button>
        </div>
      </section>

      <section className="join-panel">
        <p className="eyebrow">Join Room</p>
        <h2>既存ルームに参加</h2>
        <form onSubmit={handleJoin} className="form-card">
          <label>
            ルームID
            <input value={roomId} onChange={(event) => setRoomId(event.target.value)} required maxLength={6} />
          </label>
          <label>
            表示名
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Guest" />
          </label>
          <button type="submit" className="primary" disabled={loading}>
            {loading ? "参加中..." : "参加する"}
          </button>
          {error ? <p className="error-text">{error}</p> : null}
        </form>
      </section>
    </main>
  );
}
