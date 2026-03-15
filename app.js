import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ✅ Render 必须使用 process.env.PORT
const port = process.env.PORT || 3000;

app.use(express.static("public"));

server.listen(port, () => {
  console.log(`Listening on port ${port}`);
});

/*
  EXPERIENCE STATE
  2-player room, server-authoritative grid game.
*/
const GRID_COLS = 21;
const GRID_ROWS = 15;

// 1 = wall, 0 = floor
const MAP = [
  "111111111111111111111",
  "100000000010000000001",
  "101111011010110111101",
  "100000010000010000001",
  "101111010111010111101",
  "100000010010010000001",
  "111011111010111110111",
  "100010000000000010001",
  "101010111111111010101",
  "101010000010000010101",
  "101011111010111110101",
  "100000000000000000001",
  "101111011111110111101",
  "100000000010000000001",
  "111111111111111111111",
];

function isWall(cx, cy) {
  if (cx < 0 || cy < 0 || cx >= GRID_COLS || cy >= GRID_ROWS) return true;
  return MAP[cy][cx] === "1";
}

function cellKey(cx, cy) {
  return `${cx},${cy}`;
}

function randomSpawn(avoidKeys = new Set()) {
  for (let tries = 0; tries < 2000; tries++) {
    const cx = Math.floor(Math.random() * GRID_COLS);
    const cy = Math.floor(Math.random() * GRID_ROWS);
    if (!isWall(cx, cy) && !avoidKeys.has(cellKey(cx, cy))) return { cx, cy };
  }
  return { cx: 1, cy: 1 };
}

function buildInitialPellets() {
  const pellets = {};
  const power = {};

  // 4 corners-ish power pellets
  const powerSpots = [
    { cx: 1, cy: 1 },
    { cx: GRID_COLS - 2, cy: 1 },
    { cx: 1, cy: GRID_ROWS - 2 },
    { cx: GRID_COLS - 2, cy: GRID_ROWS - 2 },
  ];

  // normal pellets on every floor cell
  for (let y = 0; y < GRID_ROWS; y++) {
    for (let x = 0; x < GRID_COLS; x++) {
      if (!isWall(x, y)) pellets[cellKey(x, y)] = true;
    }
  }

  // power pellets replace normal pellets
  for (const p of powerSpots) {
    if (!isWall(p.cx, p.cy)) {
      power[cellKey(p.cx, p.cy)] = true;
      pellets[cellKey(p.cx, p.cy)] = false;
    }
  }

  return { pellets, power };
}

function createNewMatchState() {
  const { pellets, power } = buildInitialPellets();
  return {
    users: {}, // socket.id -> player
    pellets,
    powerPellets: power,
    lastWinner: null,
    message: null,
    serverTime: Date.now(),
  };
}

let experienceState = createNewMatchState();

const MAX_PLAYERS = 2;
const ROOM = "gameRoom";

const TICK_MS = 50; // 20fps server tick
const MOVE_COOLDOWN_MS = 110;

function clampInput(input) {
  return {
    up: !!input?.up,
    down: !!input?.down,
    left: !!input?.left,
    right: !!input?.right,
  };
}

function stepPlayer(p) {
  const now = Date.now();

  if (p.stunnedUntil && now < p.stunnedUntil) return;
  if (now - p.lastMoveAt < MOVE_COOLDOWN_MS) return;

  const input = p.input || { up: false, down: false, left: false, right: false };
  let dx = 0, dy = 0;

  // simple priority
  if (input.left) dx = -1;
  else if (input.right) dx = 1;
  else if (input.up) dy = -1;
  else if (input.down) dy = 1;

  if (dx === 0 && dy === 0) return;

  const nx = p.cx + dx;
  const ny = p.cy + dy;

  if (!isWall(nx, ny)) {
    p.cx = nx;
    p.cy = ny;
    p.dir = { dx, dy };
    p.lastMoveAt = now;
  }
}

function handlePickups(p) {
  const key = cellKey(p.cx, p.cy);

  if (experienceState.pellets[key]) {
    experienceState.pellets[key] = false;
    p.score += 1;
  }

  if (experienceState.powerPellets[key]) {
    experienceState.powerPellets[key] = false;
    p.powerUntil = Date.now() + 6000; // 6s power
    p.score += 3; // bonus
  }
}

function dropCoinsAround(cx, cy, count) {
  // scatter pellets within radius 2
  const spots = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!isWall(x, y)) spots.push({ x, y });
    }
  }

  for (let i = 0; i < count && spots.length > 0; i++) {
    const idx = Math.floor(Math.random() * spots.length);
    const s = spots.splice(idx, 1)[0];
    const k = cellKey(s.x, s.y);
    if (!experienceState.powerPellets[k]) experienceState.pellets[k] = true;
  }
}

function handleCollisions() {
  const ids = Object.keys(experienceState.users);
  if (ids.length < 2) return;

  const a = experienceState.users[ids[0]];
  const b = experienceState.users[ids[1]];
  if (!a || !b) return;

  // collision only if same cell
  if (a.cx !== b.cx || a.cy !== b.cy) return;

  const now = Date.now();
  const aPower = a.powerUntil && now < a.powerUntil;
  const bPower = b.powerUntil && now < b.powerUntil;

  if (aPower && !bPower) {
    const lost = Math.min(6, Math.floor(b.score / 3) + 2);
    b.score = Math.max(0, b.score - lost);
    b.stunnedUntil = now + 1200;
    dropCoinsAround(b.cx, b.cy, lost);
    experienceState.message = "POWER HIT!";
    experienceState.lastWinner = a.id;
  } else if (bPower && !aPower) {
    const lost = Math.min(6, Math.floor(a.score / 3) + 2);
    a.score = Math.max(0, a.score - lost);
    a.stunnedUntil = now + 1200;
    dropCoinsAround(a.cx, a.cy, lost);
    experienceState.message = "POWER HIT!";
    experienceState.lastWinner = b.id;
  } else {
    experienceState.message = null;
    experienceState.lastWinner = null;
  }
}

function serverTick() {
  experienceState.serverTime = Date.now();

  for (const id in experienceState.users) {
    const p = experienceState.users[id];
    stepPlayer(p);
    handlePickups(p);
  }

  handleCollisions();

  io.to(ROOM).emit("state", experienceState);
}

setInterval(serverTick, TICK_MS);

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  const userIDs = Object.keys(experienceState.users);

  // Only allow 2 users (room full)
  if (userIDs.length >= MAX_PLAYERS) {
    socket.emit("full");
    return;
  }

  socket.join(ROOM);

  // spawn away from existing user
  const avoid = new Set();
  for (const uid of userIDs) {
    const u = experienceState.users[uid];
    if (u) avoid.add(cellKey(u.cx, u.cy));
  }
  const spawn = randomSpawn(avoid);

  // two colors
  const palette = ["#FFD000", "#00D6FF"];
  const color = palette[userIDs.length % palette.length];

  experienceState.users[socket.id] = {
    id: socket.id,
    cx: spawn.cx,
    cy: spawn.cy,
    dir: { dx: 1, dy: 0 },
    input: { up: false, down: false, left: false, right: false },
    score: 0,
    color,
    powerUntil: 0,
    stunnedUntil: 0,
    lastMoveAt: 0,
  };

  io.to(ROOM).emit("state", experienceState);

  socket.on("input", (data) => {
    const mePlayer = experienceState.users[socket.id];
    if (!mePlayer) return;
    mePlayer.input = clampInput(data);
  });

  socket.on("disconnect", () => {
    delete experienceState.users[socket.id];

    experienceState.message = null;
    experienceState.lastWinner = null;

    // if everyone left, reset the whole match
    if (Object.keys(experienceState.users).length === 0) {
      experienceState = createNewMatchState();
    }

    io.to(ROOM).emit("state", experienceState);
  });
});
