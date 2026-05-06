import { API_BASE_URL } from "./config";
import type { CreateRoomResponse, JoinRoomResponse } from "../types";

function debugApi(message: string, payload?: unknown) {
  console.info(`[api] ${message}`, payload ?? "");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  debugApi(`request ${path}`, init);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });

  if (!response.ok) {
    const message = await response.text();
    debugApi(`error ${path}`, message);
    throw new Error(message || "Request failed");
  }

  const body = (await response.json()) as T;
  debugApi(`response ${path}`, body);
  return body;
}

export function createRoom(displayName: string) {
  debugApi("create room", { displayName });
  return request<CreateRoomResponse>("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ displayName }),
  });
}

export function joinRoom(roomId: string, displayName: string) {
  debugApi("join room", { roomId, displayName });
  return request<JoinRoomResponse>(`/api/rooms/${roomId}/join`, {
    method: "POST",
    body: JSON.stringify({ displayName }),
  });
}
