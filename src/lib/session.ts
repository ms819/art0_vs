import type { SessionPlayer } from "../types";

const PREFIX = "bs-online-session";

export function saveSession(session: SessionPlayer) {
  sessionStorage.setItem(`${PREFIX}:${session.roomId}`, JSON.stringify(session));
}

export function loadSession(roomId: string): SessionPlayer | null {
  const raw = sessionStorage.getItem(`${PREFIX}:${roomId}`);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SessionPlayer;
  } catch {
    sessionStorage.removeItem(`${PREFIX}:${roomId}`);
    return null;
  }
}

export function clearSession(roomId: string) {
  sessionStorage.removeItem(`${PREFIX}:${roomId}`);
}
