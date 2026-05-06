import { WS_BASE_URL } from "./config";
import type { ClientCommand, ServerEvent, SessionPlayer } from "../types";

interface SocketHandlers {
  onEvent: (event: ServerEvent) => void;
  onClose: () => void;
  onLog?: (message: string) => void;
}

function writeLog(handlers: SocketHandlers, message: string, payload?: unknown) {
  const line = payload ? `${message} ${JSON.stringify(payload)}` : message;
  console.info(`[ws] ${line}`);
  handlers.onLog?.(line);
}

export function connectGameSocket(session: SessionPlayer, handlers: SocketHandlers) {
  const url = new URL("/ws", WS_BASE_URL);
  url.searchParams.set("roomId", session.roomId);
  url.searchParams.set("playerId", session.playerId);

  writeLog(handlers, "connecting", { roomId: session.roomId, playerId: session.playerId });
  const socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    writeLog(handlers, "connected");
  });

  socket.addEventListener("message", (event) => {
    const parsed = JSON.parse(event.data) as ServerEvent;
    if (parsed.type === "STATE_UPDATE") {
      writeLog(handlers, "received state", {
        turn: parsed.state.turnNumber,
        activePlayerIndex: parsed.state.activePlayerIndex,
        phase: parsed.state.phase,
        flashStep: parsed.state.flashStep,
        passCount: parsed.state.passCount,
        priorityPlayer: parsed.state.priorityPlayer,
        pendingEffect: parsed.state.pendingEffect?.effectName ?? null,
        pendingAttack: !!parsed.state.pendingAttack,
      });
    } else if (parsed.type === "ERROR") {
      writeLog(handlers, "received error", parsed);
    } else {
      writeLog(handlers, "received event", parsed);
    }
    handlers.onEvent(parsed);
  });

  socket.addEventListener("error", () => {
    writeLog(handlers, "socket error");
  });

  socket.addEventListener("close", () => {
    writeLog(handlers, "closed");
    handlers.onClose();
  });

  return {
    send(command: ClientCommand) {
      writeLog(handlers, "send command", command);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "COMMAND", command }));
        return;
      }
      writeLog(handlers, "send skipped, socket not open");
    },
    close() {
      writeLog(handlers, "closing");
      socket.close();
    },
  };
}
