import { io } from 'socket.io-client';

let socket = null;
let roomId = null;
let asHost = false;

export function connectMultiplayer({ url, _roomId, _asHost, name, onState, onIntent, onChoice, onSystem }) {
  socket = io(url, { transports: ['websocket'] });
  roomId = _roomId;
  asHost = _asHost;

  socket.on('connect', () => {
    socket.emit('join', { roomId, asHost, name });
  });

  socket.on('state', (state) => onState?.(state));
  socket.on('intent', (msg) => onIntent?.(msg));
  socket.on('choice', (msg) => onChoice?.(msg));
  socket.on('system', (msg) => onSystem?.(msg));

  return () => socket?.disconnect();
}

export function sendState(state) {
  if (!socket) return;
  socket.emit('state', { roomId, state });
}

export function sendIntent(payload) {
  if (!socket) return;
  socket.emit('intent', { roomId, payload });
}

export function sendChoice(payload) {
  if (!socket) return;
  socket.emit('choice', { roomId, payload });
}

export function amHost() { return asHost; }