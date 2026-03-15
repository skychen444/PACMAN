// Create connection to Node.js Server
const socket = io();

let gameFull = false;
let me = null;

let experienceState = {
  users: {},
  pellets: {},
  powerPellets: {},
  lastWinner: null,
  message: null,
  serverTime: 0
};

// map must match server
const GRID_COLS = 21;
const GRID_ROWS = 15;
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

// responsive pixel grid sizing
let cellSize = 24;
let offsetX = 0;
let offsetY = 0;

function setup() {
  createCanvas(windowWidth, windowHeight);
  noSmooth(); // pixel vibe
  computeGridFit();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  computeGridFit(); // responsive canvas principles :contentReference[oaicite:0]{index=0}
}

function computeGridFit() {
  cellSize = floor(min(windowWidth / GRID_COLS, windowHeight / GRID_ROWS));
  cellSize = max(cellSize, 10);
  offsetX = floor((windowWidth - cellSize * GRID_COLS) / 2);
  offsetY = floor((windowHeight - cellSize * GRID_ROWS) / 2);
}

function draw() {
  background(5, 6, 10);

  if (gameFull) {
    drawCRTGlowText("ROOM FULL (max 2)", width / 2, height / 2);
    return;
  }

  drawNeonFrame();
  drawMaze();
  drawPellets();
  drawPlayers();
  drawHUD();
  sendInput(); // send current keys
}

// --- LOOK & FEEL ---

function drawNeonFrame() {
  // subtle scanlines
  noStroke();
  for (let y = 0; y < height; y += 4) {
    fill(255, 255, 255, 6);
    rect(0, y, width, 1);
  }
}

function drawMaze() {
  // walls: neon blue outlines + dark fill
  for (let y = 0; y < GRID_ROWS; y++) {
    for (let x = 0; x < GRID_COLS; x++) {
      if (MAP[y][x] === "1") {
        const px = offsetX + x * cellSize;
        const py = offsetY + y * cellSize;

        // dark body
        noStroke();
        fill(10, 12, 18);
        rect(px, py, cellSize, cellSize);

        // neon edge
        stroke(80, 140, 255, 220);
        strokeWeight(max(1, floor(cellSize * 0.09)));
        noFill();
        rect(px + 1, py + 1, cellSize - 2, cellSize - 2, floor(cellSize * 0.25));
      }
    }
  }
}

function drawPellets() {
  // pellets: small bright dots
  noStroke();

  for (let y = 0; y < GRID_ROWS; y++) {
    for (let x = 0; x < GRID_COLS; x++) {
      if (isWall(x, y)) continue;

      const k = cellKey(x, y);
      const cx = offsetX + x * cellSize + cellSize / 2;
      const cy = offsetY + y * cellSize + cellSize / 2;

      if (experienceState.pellets && experienceState.pellets[k]) {
        fill(255, 220, 170, 230);
        rect(cx - 1, cy - 1, 2, 2); // pixel dot
      }

      if (experienceState.powerPellets && experienceState.powerPellets[k]) {
        // power pellet: bigger + pulsing
        const pulse = 0.6 + 0.4 * sin(frameCount * 0.12);
        fill(255, 180, 60, 240);
        const s = floor(cellSize * (0.22 + 0.08 * pulse));
        rect(cx - s / 2, cy - s / 2, s, s);
      }
    }
  }
}

function drawPlayers() {
  const users = experienceState.users || {};
  for (let id in users) {
    const p = users[id];
    const px = offsetX + p.cx * cellSize + cellSize / 2;
    const py = offsetY + p.cy * cellSize + cellSize / 2;

    const now = Date.now();
    const power = p.powerUntil && now < p.powerUntil;
    const stunned = p.stunnedUntil && now < p.stunnedUntil;

    // base color
    let c = color(p.color || "#FFD000");
    if (power) {
      // power glow
      c = color(255, 255, 255);
    }
    if (stunned) {
      c = color(140, 140, 160);
    }

    drawPac(px, py, cellSize * 0.78, p.dir, c, power, (id === me));
  }
}

function drawPac(x, y, d, dir, col, power, isMe) {
  // mouth animation
  const t = frameCount * 0.18;
  const mouth = 0.18 + 0.18 * abs(sin(t)); // 0.18..0.36

  // direction angle
  let ang = 0;
  const dx = dir?.dx ?? 1;
  const dy = dir?.dy ?? 0;
  if (dx === 1) ang = 0;
  if (dx === -1) ang = PI;
  if (dy === -1) ang = -HALF_PI;
  if (dy === 1) ang = HALF_PI;

  // glow ring for "me" or power
  if (isMe || power) {
    noFill();
    stroke(255, 240, 120, power ? 200 : 80);
    strokeWeight(max(1, floor(cellSize * 0.09)));
    ellipse(x, y, d * 1.15, d * 1.15);
  }

  // body
  noStroke();
  fill(col);

  // draw wedge (pacman)
  const a0 = ang + mouth * PI;
  const a1 = ang - mouth * PI + TWO_PI;
  arc(x, y, d, d, a0, a1, PIE);

  // eye (tiny pixel)
  const ex = x + cos(ang - 0.9) * (d * 0.18);
  const ey = y + sin(ang - 0.9) * (d * 0.18);
  fill(10, 12, 18);
  rect(floor(ex), floor(ey), 2, 2);
}

function drawHUD() {
  // top overlay: scores only (no “player” text)
  const users = experienceState.users || {};
  const ids = Object.keys(users);

  // background strip
  noStroke();
  fill(0, 0, 0, 120);
  rect(0, 0, width, max(32, floor(cellSize * 1.2)));

  let x = 16;
  const y = max(16, floor(cellSize * 0.55));

  textAlign(LEFT, CENTER);
  textSize(max(12, floor(cellSize * 0.5)));
  for (let id of ids) {
    const p = users[id];
    const c = color(p.color || "#fff");
    fill(c);
    // small dot icon
    rect(x, y - 5, 10, 10);
    x += 16;

    fill(255);
    text(p.score ?? 0, x, y);
    x += 40;
  }

  // message (center)
  if (experienceState.message) {
    drawCRTGlowText(experienceState.message, width / 2, y);
  }
}

function drawCRTGlowText(txt, x, y) {
  textAlign(CENTER, CENTER);
  textSize(max(14, floor(cellSize * 0.55)));

  noStroke();
  fill(0, 200, 255, 40);
  text(txt, x + 2, y + 1);
  fill(255, 230, 130, 220);
  text(txt, x, y);
}

// --- INPUT (client -> server) ---

function sendInput() {
  if (!me) return;

  // Player 1: WASD, Player 2: Arrow keys (but both clients can use any; server just uses per-client input)
  const up = keyIsDown(87) || keyIsDown(38);    // W or Up
  const down = keyIsDown(83) || keyIsDown(40);  // S or Down
  const left = keyIsDown(65) || keyIsDown(37);  // A or Left
  const right = keyIsDown(68) || keyIsDown(39); // D or Right

  socket.emit("input", { up, down, left, right });
}

// --- SOCKET EVENTS ---

socket.on("state", (state) => {
  experienceState = state;
});

socket.on("full", () => {
  gameFull = true;
});

socket.on("connect", () => {
  me = socket.id;
});
