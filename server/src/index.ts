import http from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import WebSocket, { WebSocketServer } from "ws";
import { getAllCards, initDatabase, seedDatabase } from "./db.js";
import { applyCommand, maybeStartGame, toClientState } from "./game.js";
import type { ClientMessage, PlayerIndex, Room } from "./types.js";

const PORT = Number(process.env.PORT ?? 5000);
const DEFAULT_LOCAL_ORIGINS = ["http://localhost:5173"];

async function main() {
  const db = await initDatabase();
  await seedDatabase(db);
  const cards = await getAllCards(db);
  const rooms = new Map<string, Room>();
  const allowedOrigins = buildAllowedOrigins(process.env.CORS_ORIGIN);

  const app = express();
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`CORS blocked for origin: ${origin}`));
      },
    }),
  );
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/cards", (_request, response) => {
    response.json(cards);
  });

  app.post("/api/rooms", (request, response) => {
    const roomId = createRoomId();
    const playerId = randomUUID();
    const displayName = parseDisplayName(request.body?.displayName, "Host");

    const room: Room = {
      id: roomId,
      players: [
        {
          playerId,
          displayName,
          socket: null,
        },
        null,
      ],
      gameState: null,
      createdAt: new Date().toISOString(),
    };

    rooms.set(roomId, room);
    log("room created", { roomId, playerId, displayName });
    response.status(201).json({
      roomId,
      playerId,
      playerIndex: 0 satisfies PlayerIndex,
    });
  });

  app.post("/api/rooms/:roomId/join", (request, response) => {
    const roomId = String(request.params.roomId ?? "").trim().toUpperCase();
    const room = rooms.get(roomId);
    if (!room) {
      response.status(404).send("存在しないルームIDです");
      return;
    }

    if (room.players[1]) {
      response.status(409).send("このルームにはすでに2人参加しています");
      return;
    }

    const playerId = randomUUID();
    room.players[1] = {
      playerId,
      displayName: parseDisplayName(request.body?.displayName, "Guest"),
      socket: null,
    };

    log("room joined", { roomId, playerId, displayName: room.players[1].displayName });
    response.json({
      roomId,
      playerId,
      playerIndex: 1 satisfies PlayerIndex,
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket, request) => {
    const requestUrl = new URL(request.url ?? "", `http://${request.headers.host}`);
    const roomId = requestUrl.searchParams.get("roomId")?.trim().toUpperCase() ?? "";
    const playerId = requestUrl.searchParams.get("playerId")?.trim() ?? "";

    log("ws connection", { roomId, playerId });

    const room = rooms.get(roomId);
    if (!room) {
      sendError(socket, "ROOM_NOT_FOUND", "存在しないルームIDです");
      socket.close();
      return;
    }

    const playerIndex = room.players.findIndex((player) => player?.playerId === playerId) as PlayerIndex | -1;
    if (playerIndex === -1) {
      sendError(socket, "PLAYER_NOT_FOUND", "プレイヤー認証に失敗しました");
      socket.close();
      return;
    }

    room.players[playerIndex]!.socket = socket;
    sendRoomStatus(room, playerIndex);

    const state = maybeStartGame(room, cards);
    if (state) {
      log("battle started", { roomId: room.id });
      broadcastState(room);
    } else {
      broadcastRoomStatus(room);
    }

    socket.on("message", (rawMessage) => {
      let parsed: ClientMessage;
      try {
        parsed = JSON.parse(String(rawMessage)) as ClientMessage;
      } catch {
        sendError(socket, "INVALID_JSON", "WebSocket メッセージのJSONが不正です");
        return;
      }

      if (parsed.type !== "COMMAND") {
        sendError(socket, "INVALID_EVENT", "不正なイベント名です");
        return;
      }

      if (!room.gameState) {
        sendError(socket, "GAME_NOT_READY", "対戦開始前のため、その操作はできません");
        return;
      }

      log("command received", { roomId: room.id, playerIndex, command: parsed.command });
      const result = applyCommand(room.gameState, playerIndex, parsed.command);
      if (!result.ok) {
        sendError(socket, "INVALID_COMMAND", result.error ?? "操作に失敗しました");
        return;
      }

      broadcastState(room);
    });

    socket.on("close", () => {
      log("ws closed", { roomId: room.id, playerIndex });
      const player = room.players[playerIndex];
      if (player) {
        player.socket = null;
      }

      if (!room.players[0]?.socket && !room.players[1]?.socket) {
        rooms.delete(room.id);
        log("room cleaned", { roomId: room.id });
      } else {
        broadcastRoomStatus(room);
      }
    });
  });

  server.listen(PORT, () => {
    log("server listening", { port: PORT });
  });

  function broadcastState(room: Room) {
    if (!room.gameState) {
      return;
    }

    room.players.forEach((player, index) => {
      if (!player?.socket || player.socket.readyState !== WebSocket.OPEN) {
        return;
      }

      const payload = {
        type: "STATE_UPDATE",
        state: toClientState(room.gameState!, index as PlayerIndex),
      };
      log("broadcast state", {
        roomId: room.id,
        playerIndex: index,
        turn: payload.state.turnNumber,
        activePlayerIndex: payload.state.activePlayerIndex,
        phase: payload.state.phase,
        flashStep: payload.state.flashStep,
        passCount: payload.state.passCount,
        pendingEffect: payload.state.pendingEffect?.effectName ?? null,
        pendingAttack: !!payload.state.pendingAttack,
      });
      player.socket.send(JSON.stringify(payload));
    });
  }

  function sendRoomStatus(room: Room, playerIndex: PlayerIndex) {
    const player = room.players[playerIndex];
    if (!player?.socket || player.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    player.socket.send(
      JSON.stringify({
        type: "ROOM_STATUS",
        roomId: room.id,
        message: room.gameState
          ? room.gameState.message
          : room.players[1]
            ? "対戦相手が接続中です"
            : "対戦相手の参加を待っています",
        connectedPlayers: room.players.filter((entry) => entry?.socket?.readyState === WebSocket.OPEN).length,
        expectedPlayers: 2,
        playerIndex,
      }),
    );
  }

  function broadcastRoomStatus(room: Room) {
    room.players.forEach((_player, playerIndex) => sendRoomStatus(room, playerIndex as PlayerIndex));
  }
}

function createRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function parseDisplayName(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, 24) : fallback;
}

function buildAllowedOrigins(rawOrigins: string | undefined) {
  const origins = new Set(DEFAULT_LOCAL_ORIGINS);
  if (!rawOrigins) {
    return origins;
  }

  for (const origin of rawOrigins.split(",")) {
    const trimmed = origin.trim();
    if (trimmed.length > 0) {
      origins.add(trimmed);
    }
  }
  return origins;
}

function sendError(socket: WebSocket, code: string, message: string) {
  log("error", { code, message });
  socket.send(JSON.stringify({ type: "ERROR", code, message }));
}

function log(message: string, payload?: unknown) {
  console.info(`[server] ${message}`, payload ?? "");
}

void main();
