import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom } from "../lib/api";
import { saveSession } from "../lib/session";

export function CreateRoomPage() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await createRoom(displayName.trim() || "Host");
      saveSession({
        roomId: response.roomId,
        playerId: response.playerId,
        playerIndex: response.playerIndex,
        displayName: displayName.trim() || "Host",
      });
      navigate(`/battle/${response.roomId}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "ルーム作成に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell single-shell">
      <section className="form-card large-card">
        <p className="eyebrow">Create Room</p>
        <h1>ルームを発行</h1>
        <form onSubmit={handleSubmit}>
          <label>
            表示名
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Host" />
          </label>
          <div className="inline-actions">
            <button type="button" onClick={() => navigate("/")}>
              戻る
            </button>
            <button type="submit" className="primary" disabled={loading}>
              {loading ? "作成中..." : "ルームを作成"}
            </button>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
        </form>
      </section>
    </main>
  );
}
