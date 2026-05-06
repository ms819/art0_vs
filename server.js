// server.js
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }, // 開発用
});

const rooms = new Map(); // roomId -> { hostId, players: Set, lastState }

io.on('connection', (socket) => {
  socket.on('join', ({ roomId, asHost, name }) => {
    if (!rooms.has(roomId)) rooms.set(roomId, { hostId: null, players: new Set(), lastState: null });
    const room = rooms.get(roomId);
    if (asHost) room.hostId = socket.id;
    room.players.add(socket.id);
    socket.join(roomId);

    // 直近の状態があれば新規参加者へ渡す（観戦/途中参加）
    if (room.lastState) socket.emit('state', room.lastState);

    io.to(roomId).emit('system', { type: 'JOINED', name, id: socket.id, asHost });
  });

  socket.on('intent', ({ roomId, payload }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    // 常にホストに集約
    if (room.hostId) io.to(room.hostId).emit('intent', { from: socket.id, payload });
  });

  socket.on('choice', ({ roomId, payload }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.hostId) io.to(room.hostId).emit('choice', { from: socket.id, payload });
  });

  socket.on('state', ({ roomId, state }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    // ホストのみが配信できる
    if (room.hostId === socket.id) {
      room.lastState = state;
      socket.to(roomId).emit('state', state);
    }
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms.entries()) {
      if (room.players.has(socket.id)) {
        room.players.delete(socket.id);
        if (room.hostId === socket.id) room.hostId = null;
        io.to(roomId).emit('system', { type: 'LEFT', id: socket.id });
        if (room.players.size === 0) rooms.delete(roomId);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('WS server on :' + PORT));