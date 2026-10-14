const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
// Logical game size. The canvas pixels are scaled up in resize() so it stays sharp.
const W = 400;
const H = 600;
const FONT = '"Lilita One", "Trebuchet MS", Verdana, sans-serif';

// Per-step values below assume a fixed 60 updates per second
const STEP = 1000 / 60;
const GRAVITY = 0.45;
const FLAP = -7.5;
const PIPE_W = 60;
const CAP_H = 26;
const CAP_OVER = 4;
const GAP = 150;
const MIN_GAP = 115;
const PIPE_SPEED = 2.5;
const MAX_PIPE_SPEED = 4;
const PIPE_SPACING = 225; // horizontal distance between pipes
const MAX_GAP_SHIFT = 120; // max vertical jump of the gap from one pipe to the next
const GROUND_H = 60;
const HIT_R = 12; // pipe collision radius, a bit smaller than the drawn bird
const RESTART_DELAY = 30; // steps after dying before a flap restarts
const MAX_LEVEL = 5; // level where speed and gap stop changing
const MEDALS = [
  { score: 40, name: 'PLATINUM', color: '#e5e4e2' },
  { score: 30, name: 'GOLD', color: '#ffd700' },
  { score: 20, name: 'SILVER', color: '#c0c0c0' },
  { score: 10, name: 'BRONZE', color: '#cd7f32' },
];
const MUTE_BTN = { x: W - 46, y: 12, w: 34, h: 34 };

// Difficulty only changes how fast the whole game runs
const DIFFICULTIES = {
  easy: { label: 'EASY', speed: 0.8 },
  normal: { label: 'NORMAL', speed: 1 },
  hard: { label: 'HARD', speed: 1.25 },
};
const DIFF_BTNS = Object.keys(DIFFICULTIES).map((key, i) => ({
  key, x: 40 + i * 110, y: 448, w: 100, h: 36,
}));

// Sky cycles day -> sunset -> night -> dawn, one phase per level (10 points)
const SKY = [
  { top: [78, 192, 202], bottom: [205, 239, 250], far: [143, 190, 206], mid: [118, 168, 190],
    near: [134, 206, 140], cloud: [255, 255, 255], sun: [255, 236, 170], sunY: 110, night: 0 },
  { top: [72, 52, 140], bottom: [255, 166, 108], far: [153, 98, 138], mid: [104, 66, 116],
    near: [92, 128, 88], cloud: [255, 196, 176], sun: [255, 128, 72], sunY: 330, night: 0.25 },
  { top: [8, 16, 44], bottom: [38, 56, 104], far: [34, 48, 88], mid: [22, 32, 64],
    near: [28, 66, 58], cloud: [110, 120, 160], sun: [255, 128, 72], sunY: 560, night: 1 },
  { top: [92, 148, 210], bottom: [255, 212, 160], far: [148, 156, 196], mid: [126, 134, 176],
    near: [116, 178, 126], cloud: [255, 234, 218], sun: [255, 196, 120], sunY: 300, night: 0.15 },
];

let bird, pipes, score, state; // state: 'ready' | 'playing' | 'paused' | 'over'
let distSincePipe, lastTop, overTimer;
let difficulty = 'normal';
let highScore = 0;
let muted = false;
try {
  const saved = localStorage.getItem('flappyDifficulty');
  if (saved in DIFFICULTIES) difficulty = saved;
  muted = localStorage.getItem('flappyMuted') === '1';
} catch (e) {}
loadHighScore();

// Each difficulty keeps its own best score ('normal' keeps the original key)
function highScoreKey() {
  return difficulty === 'normal' ? 'flappyHighScore' : `flappyHighScore-${difficulty}`;
}

function loadHighScore() {
  highScore = 0;
  try {
    highScore = parseInt(localStorage.getItem(highScoreKey()), 10) || 0;
  } catch (e) {}
}

function setDifficulty(key) {
  difficulty = key;
  loadHighScore();
  try {
    localStorage.setItem('flappyDifficulty', key);
  } catch (e) {}
}

// Scenery. Each layer is a strip that repeats every `period` pixels and
// scrolls at `factor` x the pipe speed, which gives the parallax depth.
const rand = (a, b) => a + Math.random() * (b - a);
let scroll = 0; // world distance travelled, drives every scrolling layer
let tick = 0;
let shake = 0;
let flash = 0;
let skyT = 0; // eases toward the current level to blend sky phases
let scorePop = 0;
let banner = 0;
let particles = [];

const stars = Array.from({ length: 70 }, () => ({
  x: rand(0, W), y: rand(0, 380), r: rand(0.6, 1.6), p: rand(0, Math.PI * 2),
}));
const clouds = Array.from({ length: 7 }, (_, i) => ({
  x: i * 80 + rand(0, 40), y: rand(30, 250), s: rand(0.6, 1.4),
}));
const peaks = Array.from({ length: 10 }, (_, i) => ({
  x: i * 66 + rand(0, 30), w: rand(140, 220), h: rand(110, 190),
}));
const buildings = [];
for (let x = 0; x < 520;) {
  const w = rand(28, 56);
  const h = rand(50, 150);
  const windows = [];
  for (let wy = 10; wy < h - 8; wy += 11) {
    for (let wx = 5; wx < w - 6; wx += 8) {
      if (Math.random() < 0.55) windows.push([wx, wy]);
    }
  }
  buildings.push({ x, w, h, windows, antenna: Math.random() < 0.25 });
  x += w + rand(2, 10);
}
const hills = Array.from({ length: 8 }, (_, i) => ({
  x: i * 70 + rand(0, 20), w: rand(90, 140), h: rand(40, 90),
}));
const specks = Array.from({ length: 10 }, () => [rand(0, 48), rand(0, 30), rand(2, 4)]);

function wrapX(base, factor, period, margin) {
  return ((((base - scroll * factor) % period) + period) % period) - margin;
}

// Sound (generated with Web Audio, no files needed)
let audio = null;

function unlockAudio() {
  // Browsers only allow audio to start from a user gesture
  if (!audio) {
    try {
      audio = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {}
  }
  if (audio && audio.state === 'suspended') audio.resume();
}

function tone(freq, endFreq, dur, type, vol, delay = 0) {
  if (muted || !audio) return;
  const t = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur);
}

const sounds = {
  flap: () => tone(420, 700, 0.09, 'square', 0.06),
  score: () => {
    tone(880, 880, 0.08, 'square', 0.06);
    tone(1320, 1320, 0.14, 'square', 0.06, 0.08);
  },
  hit: () => tone(240, 50, 0.35, 'sawtooth', 0.12),
};

function toggleMute() {
  muted = !muted;
  try {
    localStorage.setItem('flappyMuted', muted ? '1' : '0');
  } catch (e) {}
}

// Difficulty rises every 10 points
function level() {
  return Math.floor(score / 10);
}

function pipeSpeed() {
  return Math.min(PIPE_SPEED + level() * 0.3, MAX_PIPE_SPEED);
}

function pipeGap() {
  return Math.max(GAP - level() * 7, MIN_GAP);
}

function reset() {
  bird = { x: 80, y: H / 2, vy: 0, r: 14, rot: 0 };
  pipes = [];
  score = 0;
  state = 'ready';
  particles = [];
  distSincePipe = PIPE_SPACING; // spawn the first pipe right away
  lastTop = null;
  overTimer = 0;
  scorePop = 0;
  banner = 0;
}

function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 1 + Math.random() * 3;
    particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1,
      life: 25 + Math.random() * 15, color,
    });
  }
}

function flap() {
  if (state === 'ready' || state === 'paused') state = 'playing';
  if (state === 'playing') {
    bird.vy = FLAP;
    burst(bird.x - 10, bird.y + 6, '#fff', 4);
    sounds.flap();
  } else if (state === 'over' && overTimer >= RESTART_DELAY) reset();
}

function togglePause() {
  if (state === 'playing') state = 'paused';
  else if (state === 'paused') state = 'playing';
}

function addPipe() {
  const margin = 50;
  const gap = pipeGap();
  const min = margin;
  const max = H - GROUND_H - gap - margin;
  // Keep each gap within reach of the previous one
  const lo = lastTop === null ? min : Math.max(min, lastTop - MAX_GAP_SHIFT);
  const hi = lastTop === null ? max : Math.min(max, lastTop + MAX_GAP_SHIFT);
  const top = lo + Math.random() * (hi - lo);
  lastTop = top;
  pipes.push({ x: W, top, gap, scored: false });
}

function circleHitsRect(cx, cy, r, x, y, w, h) {
  const nx = Math.max(x, Math.min(cx, x + w));
  const ny = Math.max(y, Math.min(cy, y + h));
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}

function hitsPipe(p) {
  const { x, y } = bird;
  const bottom = p.top + p.gap;
  const capX = p.x - CAP_OVER;
  const capW = PIPE_W + CAP_OVER * 2;
  return (
    circleHitsRect(x, y, HIT_R, p.x, 0, PIPE_W, p.top) ||
    circleHitsRect(x, y, HIT_R, capX, p.top - CAP_H, capW, CAP_H) ||
    circleHitsRect(x, y, HIT_R, capX, bottom, capW, CAP_H) ||
    circleHitsRect(x, y, HIT_R, p.x, bottom, PIPE_W, H - GROUND_H - bottom)
  );
}

function gameOver() {
  state = 'over';
  overTimer = 0;
  shake = 12;
  flash = 1;
  burst(bird.x, bird.y, '#f7d51d', 14);
  burst(bird.x, bird.y, '#ff8a3d', 10);
  burst(bird.x, bird.y, '#fff', 6);
  sounds.hit();
  if (score > highScore) {
    highScore = score;
    try {
      localStorage.setItem(highScoreKey(), highScore);
    } catch (e) {}
  }
}

function update() {
  if (state === 'paused') return;
  tick++;
  const speed = pipeSpeed();

  // Scenery keeps scrolling unless the game is over
  if (state !== 'over') scroll += speed;
  skyT += (level() - skyT) * 0.015;

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.15;
    p.life--;
  }
  particles = particles.filter(p => p.life > 0);
  if (shake > 0) shake *= 0.85;
  if (flash > 0) flash -= 0.06;
  if (scorePop > 0) scorePop *= 0.85;
  if (banner > 0) banner--;

  if (state === 'ready') {
    bird.y = H / 2 + Math.sin(tick / 12) * 8;
    return;
  }

  if (state === 'over') {
    overTimer++;
    // Let the bird fall to the ground
    if (bird.y + bird.r < H - GROUND_H) {
      bird.vy += GRAVITY;
      bird.y += bird.vy;
      bird.rot = Math.min(bird.rot + 0.15, Math.PI / 2);
      if (bird.y + bird.r > H - GROUND_H) bird.y = H - GROUND_H - bird.r;
    }
    return;
  }

  bird.vy += GRAVITY;
  bird.y += bird.vy;
  bird.rot = Math.max(-0.5, Math.min(bird.vy * 0.07, 1.2));

  distSincePipe += speed;
  if (distSincePipe >= PIPE_SPACING) {
    distSincePipe -= PIPE_SPACING;
    addPipe();
  }

  for (const p of pipes) {
    p.x -= speed;
    if (!p.scored && p.x + PIPE_W / 2 < bird.x) {
      p.scored = true;
      score++;
      scorePop = 1;
      if (score % 10 === 0 && level() <= MAX_LEVEL) banner = 90;
      sounds.score();
    }
    if (hitsPipe(p)) {
      gameOver();
      break;
    }
  }
  pipes = pipes.filter(p => p.x + PIPE_W + CAP_OVER > 0);

  if (state === 'playing' && (bird.y + bird.r > H - GROUND_H || bird.y - bird.r < 0)) gameOver();
}

// ---------- Drawing ----------

const clamp01 = t => Math.max(0, Math.min(1, t));
const easeOut = t => 1 - (1 - t) ** 3;
const easeOutBack = t => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// Blend the two sky phases around skyT
function skyColors() {
  const i = Math.floor(skyT);
  let f = skyT - i;
  f = f * f * (3 - 2 * f);
  const a = SKY[i % SKY.length];
  const b = SKY[(i + 1) % SKY.length];
  const out = {};
  for (const k in a) {
    out[k] = Array.isArray(a[k])
      ? a[k].map((v, j) => v + (b[k][j] - v) * f)
      : a[k] + (b[k] - a[k]) * f;
  }
  return out;
}

function drawSky(c) {
  const horizon = H - GROUND_H;
  const g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, rgb(c.top));
  g.addColorStop(1, rgb(c.bottom));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Stars twinkle in at night
  if (c.night > 0.01) {
    ctx.fillStyle = '#fff';
    for (const s of stars) {
      ctx.globalAlpha = c.night * (0.55 + 0.45 * Math.sin(tick * 0.05 + s.p));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Sun
  const sunA = 1 - c.night;
  if (sunA > 0.01) {
    const glow = ctx.createRadialGradient(300, c.sunY, 10, 300, c.sunY, 90);
    glow.addColorStop(0, rgb(c.sun, 0.55 * sunA));
    glow.addColorStop(1, rgb(c.sun, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(200, c.sunY - 90, 200, 180);
    ctx.fillStyle = rgb(c.sun, sunA);
    ctx.beginPath();
    ctx.arc(300, c.sunY, 26, 0, Math.PI * 2);
    ctx.fill();
  }

  // Moon
  if (c.night > 0.01) {
    const glow = ctx.createRadialGradient(90, 95, 10, 90, 95, 70);
    glow.addColorStop(0, `rgba(255,250,220,${0.3 * c.night})`);
    glow.addColorStop(1, 'rgba(255,250,220,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(20, 25, 140, 140);
    ctx.globalAlpha = c.night;
    ctx.fillStyle = '#f4f1d6';
    ctx.beginPath();
    ctx.arc(90, 95, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath();
    ctx.arc(83, 90, 5, 0, Math.PI * 2);
    ctx.arc(97, 102, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Far mountains
  for (const p of peaks) {
    const x = wrapX(p.x, 0.08, 660, 120);
    const top = horizon - p.h;
    ctx.fillStyle = rgb(c.far);
    ctx.beginPath();
    ctx.moveTo(x - p.w / 2, horizon);
    ctx.lineTo(x - p.w * 0.08, top + 8);
    ctx.quadraticCurveTo(x, top - 4, x + p.w * 0.08, top + 8);
    ctx.lineTo(x + p.w / 2, horizon);
    ctx.fill();
    // Shaded right face
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath();
    ctx.moveTo(x, top + 2);
    ctx.lineTo(x + p.w * 0.08, top + 8);
    ctx.lineTo(x + p.w / 2, horizon);
    ctx.lineTo(x + p.w * 0.1, horizon);
    ctx.fill();
  }

  // Haze between the mountains and the city adds depth
  const haze = ctx.createLinearGradient(0, horizon - 220, 0, horizon);
  haze.addColorStop(0, rgb(c.bottom, 0));
  haze.addColorStop(1, rgb(c.bottom, 0.7));
  ctx.fillStyle = haze;
  ctx.fillRect(0, horizon - 220, W, 220);

  // Clouds (drift on their own and with the scroll)
  ctx.fillStyle = rgb(c.cloud, 0.85);
  for (const cl of clouds) {
    const x = wrapX(cl.x - tick * 0.15 * cl.s, 0.1 + 0.08 * cl.s, 560, 80);
    const r = 16 * cl.s;
    ctx.beginPath();
    ctx.arc(x, cl.y, r, 0, Math.PI * 2);
    ctx.arc(x + r * 1.1, cl.y - r * 0.5, r * 1.2, 0, Math.PI * 2);
    ctx.arc(x + r * 2.3, cl.y, r, 0, Math.PI * 2);
    ctx.rect(x, cl.y, r * 2.3, r);
    ctx.fill();
  }

  // City skyline, windows light up at night
  for (const b of buildings) {
    const x = wrapX(b.x, 0.22, 560, 60);
    const y = horizon - b.h;
    ctx.fillStyle = rgb(c.mid);
    ctx.fillRect(x, y, b.w, b.h);
    if (b.antenna) ctx.fillRect(x + b.w / 2 - 1, y - 14, 2, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (const [wx, wy] of b.windows) ctx.fillRect(x + wx, y + wy, 4, 6);
    if (c.night > 0.05) {
      ctx.fillStyle = `rgba(255,214,120,${0.9 * c.night})`;
      for (const [wx, wy] of b.windows) ctx.fillRect(x + wx, y + wy, 4, 6);
    }
  }

  // Near hills
  ctx.fillStyle = rgb(c.near);
  for (const h of hills) {
    const x = wrapX(h.x, 0.45, 560, 75);
    ctx.beginPath();
    ctx.ellipse(x, horizon, h.w / 2, h.h, 0, Math.PI, 0);
    ctx.fill();
  }
}

function pipeBody(x, y, w, h) {
  if (h <= 0) return;
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, '#5aa422');
  g.addColorStop(0.3, '#9be04b');
  g.addColorStop(0.7, '#74bf2e');
  g.addColorStop(1, '#4a8a1c');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // Shine and shadow strips
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(x + w * 0.16, y, w * 0.08, h);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(x + w * 0.82, y, w * 0.08, h);
  ctx.strokeStyle = '#2d5a10';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

function pipeCap(x, y) {
  const w = PIPE_W + CAP_OVER * 2;
  pipeBody(x - CAP_OVER, y, w, CAP_H);
}

function drawPipes() {
  for (const p of pipes) {
    // Top pipe, cap at the bottom
    pipeBody(p.x, 0, PIPE_W, p.top - CAP_H + 1);
    pipeCap(p.x, p.top - CAP_H);
    // Bottom pipe, cap at the top, which casts a small shadow on the body
    const by = p.top + p.gap;
    pipeBody(p.x, by + CAP_H - 1, PIPE_W, H - GROUND_H - by - CAP_H + 1);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(p.x + 1, by + CAP_H, PIPE_W - 2, 5);
    pipeCap(p.x, by);
  }
}

function drawGround() {
  const y = H - GROUND_H;
  ctx.fillStyle = '#ded895';
  ctx.fillRect(0, y, W, GROUND_H);
  // Dirt speckles
  ctx.fillStyle = 'rgba(160,140,80,0.35)';
  for (let x = -(scroll % 48) - 48; x < W + 48; x += 48) {
    for (const [sx, sy, s] of specks) ctx.fillRect(x + sx, y + 24 + sy, s, s);
  }
  // Grass strip
  ctx.fillStyle = '#73bf2e';
  ctx.fillRect(0, y, W, 14);
  ctx.fillStyle = '#558c22';
  ctx.fillRect(0, y + 14, W, 3);
  // Scrolling diagonal stripes on the grass
  ctx.fillStyle = '#8ad23c';
  for (let x = -(scroll % 24) - 24; x < W + 24; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 12, y);
    ctx.lineTo(x + 4, y + 14);
    ctx.lineTo(x - 8, y + 14);
    ctx.closePath();
    ctx.fill();
  }
  // Dirt shading
  ctx.fillStyle = '#c9c07a';
  ctx.fillRect(0, y + 17, W, 4);
}

// Shadow under the bird, smaller and fainter the higher it flies
function drawShadow() {
  const ground = H - GROUND_H;
  const d = clamp01((ground - bird.y) / 400);
  ctx.fillStyle = `rgba(0,0,0,${0.25 * (1 - d)})`;
  ctx.beginPath();
  ctx.ellipse(bird.x, ground + 3, 16 * (1 - d * 0.5), 4 * (1 - d * 0.5), 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBird() {
  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate(bird.rot);

  // Body
  const g = ctx.createRadialGradient(-4, -5, 2, 0, 0, bird.r + 2);
  g.addColorStop(0, '#fff176');
  g.addColorStop(1, '#f5a623');
  ctx.fillStyle = g;
  ctx.strokeStyle = '#533';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, bird.r + 3, bird.r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Wing (flaps while playing)
  const wing = state === 'over' ? 0 : Math.sin(tick * (state === 'ready' ? 0.3 : 0.5)) * 5;
  ctx.fillStyle = '#fff3c4';
  ctx.beginPath();
  ctx.ellipse(-5, 3 + wing * 0.3, 8, 5 + wing * 0.4, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Eye
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(7, -5, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(8.5, -5, 2, 0, Math.PI * 2);
  ctx.fill();

  // Beak
  ctx.fillStyle = '#f15a24';
  ctx.beginPath();
  ctx.moveTo(11, 0);
  ctx.quadraticCurveTo(22, -1, 20, 4);
  ctx.quadraticCurveTo(16, 8, 10, 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life / 20);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Outlined text with a soft drop shadow
function text(str, x, y, size, color = '#fff') {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size / 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.strokeText(str, x, y + Math.max(2, size / 14));
  ctx.strokeStyle = '#2b1b0e';
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function panel(x, y, w, h) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#f6efbd');
  g.addColorStop(1, '#ded895');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 16);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#533';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x + 6, y + 6, w - 12, h - 12, 11);
  ctx.stroke();
}

function drawMedal(x, y, medal, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.fillStyle = medal ? medal.color : '#c9c07a';
  ctx.fill();
  ctx.strokeStyle = '#533';
  ctx.lineWidth = 3;
  ctx.stroke();
  if (medal) {
    // Star in the middle
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 12 : 5;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fill();
    // Twinkle
    const t = 3 + Math.sin(tick * 0.15) * 3;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(13, -14 - t);
    ctx.lineTo(14.5, -14);
    ctx.lineTo(13, -14 + t);
    ctx.lineTo(11.5, -14);
    ctx.moveTo(13 - t, -14);
    ctx.lineTo(13, -15.5);
    ctx.lineTo(13 + t, -14);
    ctx.lineTo(13, -12.5);
    ctx.fill();
  }
  ctx.restore();
}

function drawButton(b, label, selected) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = selected ? '#ffd54a' : 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, 10);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = selected ? '#533' : 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 3;
  ctx.stroke();
  text(label, b.x + b.w / 2, b.y + 25, 18, selected ? '#fff' : '#ddd');
}

function drawMuteButton() {
  const { x, y, w, h } = MUTE_BTN;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();

  // Speaker
  const cx = x + 9;
  const cy = y + h / 2;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx - 3, cy - 4);
  ctx.lineTo(cx + 2, cy - 4);
  ctx.lineTo(cx + 8, cy - 10);
  ctx.lineTo(cx + 8, cy + 10);
  ctx.lineTo(cx + 2, cy + 4);
  ctx.lineTo(cx - 3, cy + 4);
  ctx.closePath();
  ctx.fill();

  // Sound waves, or an X when muted
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (muted) {
    ctx.moveTo(cx + 13, cy - 5);
    ctx.lineTo(cx + 21, cy + 5);
    ctx.moveTo(cx + 21, cy - 5);
    ctx.lineTo(cx + 13, cy + 5);
  } else {
    ctx.arc(cx + 9, cy, 6, -0.8, 0.8);
    ctx.moveTo(cx + 9 + Math.cos(-0.8) * 11, cy + Math.sin(-0.8) * 11);
    ctx.arc(cx + 9, cy, 11, -0.8, 0.8);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawScore() {
  ctx.save();
  ctx.translate(W / 2, 62);
  const s = 1 + scorePop * 0.3;
  ctx.scale(s, s);
  text(score, 0, 20, 56);
  ctx.restore();
}

function drawReady() {
  text('Flappy Bird', W / 2, 165 + Math.sin(tick / 20) * 5, 54, '#ffd54a');
  ctx.globalAlpha = 0.65 + 0.35 * Math.sin(tick / 10);
  text('Press Space or click', W / 2, H / 2 + 70, 24);
  ctx.globalAlpha = 1;
  text(`Best: ${highScore}`, W / 2, H / 2 + 100, 20);
  text('P: pause   M: mute', W / 2, H / 2 + 125, 15);
  for (const b of DIFF_BTNS) drawButton(b, DIFFICULTIES[b.key].label, b.key === difficulty);
  text('1 / 2 / 3 or click to change speed', W / 2, 508, 14);
}

function drawGameOver() {
  ctx.fillStyle = `rgba(0,0,0,${0.25 * clamp01(overTimer / 15)})`;
  ctx.fillRect(0, 0, W, H);

  const titleT = easeOut(clamp01(overTimer / 20));
  text('Game Over', W / 2, 150 - (1 - titleT) * 120, 52, '#ff7043');
  ctx.globalAlpha = titleT;
  text(`${DIFFICULTIES[difficulty].label} MODE`, W / 2, 182, 16);
  ctx.globalAlpha = 1;

  // Panel slides up, then the score counts up and the medal pops in
  const py = 200 + (1 - easeOutBack(clamp01((overTimer - 8) / 25))) * 420;
  const perStep = Math.max(1, Math.ceil(score / 40));
  const counting = Math.max(0, overTimer - 33);
  const shown = Math.min(score, counting * perStep);
  const medalT = clamp01((counting - Math.ceil(score / perStep)) / 12);
  const medal = MEDALS.find(m => score >= m.score);

  panel(W / 2 - 140, py, 280, 125);
  ctx.fillStyle = '#e8502f';
  ctx.font = `16px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('MEDAL', W / 2 - 85, py + 30);
  ctx.fillText('SCORE', W / 2 + 10, py + 30);
  ctx.fillText('BEST', W / 2 + 95, py + 30);
  drawMedal(W / 2 - 85, py + 65, medalT > 0 ? medal : null, 1 + (medal ? (1 - medalT) * 0.5 : 0));
  if (medal && medalT > 0) text(medal.name, W / 2 - 85, py + 112, 13, medal.color);
  text(shown, W / 2 + 10, py + 75, 38);
  const newBest = score > 0 && score >= highScore;
  text(highScore, W / 2 + 95, py + 75, 38, newBest ? '#ffd54a' : '#fff');
  if (newBest && medalT > 0) text('NEW BEST!', W / 2 + 52, py + 108, 16, '#ffd54a');

  if (medalT >= 1 && overTimer >= RESTART_DELAY && Math.floor(tick / 30) % 2 === 0) {
    text('Space or click to restart', W / 2, 372, 20);
  }
}

function draw() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const c = skyColors();

  ctx.save();
  if (shake > 0.5) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  }
  drawSky(c);
  drawPipes();
  drawGround();
  drawShadow();
  drawParticles();
  drawBird();
  // Night darkens the whole scene a little
  if (c.night > 0.01) {
    ctx.fillStyle = `rgba(10,15,45,${0.22 * c.night})`;
    ctx.fillRect(-20, -20, W + 40, H + 40);
  }
  ctx.restore();

  if (state === 'playing' || state === 'paused') drawScore();
  if (banner > 0) {
    ctx.globalAlpha = Math.min(1, banner / 20);
    text('SPEED UP!', W / 2, 150, 30, '#ffd54a');
    ctx.globalAlpha = 1;
  }

  if (state === 'ready') drawReady();
  else if (state === 'paused') {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
    text('Paused', W / 2, H / 2 - 10, 52);
    text('P, Space or click to resume', W / 2, H / 2 + 30, 18);
  } else if (state === 'over') drawGameOver();

  drawMuteButton();

  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.max(0, flash)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// Match the canvas pixels to its on-screen size so it is sharp on Retina screens
let scale = 1;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  scale = (canvas.clientHeight * dpr) / H || dpr;
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
}

// Fixed-step loop: the game runs at the same speed on 60Hz and 144Hz screens.
// Difficulty scales the number of steps per second, so everything speeds up together.
let lastTime = null;
let acc = 0;

function loop(now) {
  if (lastTime === null) lastTime = now;
  acc += Math.min(now - lastTime, 250); // cap catch-up after a long stall
  lastTime = now;
  const step = STEP / DIFFICULTIES[difficulty].speed;
  while (acc >= step) {
    update();
    acc -= step;
  }
  draw();
  requestAnimationFrame(loop);
}

// Convert a screen position to game coordinates (the canvas is scaled by CSS)
function canvasPoint(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((clientX - r.left - canvas.clientLeft) * W) / canvas.clientWidth,
    y: ((clientY - r.top - canvas.clientTop) * H) / canvas.clientHeight,
  };
}

function inside(p, b) {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

function onPointer(clientX, clientY) {
  unlockAudio();
  const p = canvasPoint(clientX, clientY);
  const diffBtn = state === 'ready' && DIFF_BTNS.find(b => inside(p, b));
  if (inside(p, MUTE_BTN)) toggleMute();
  else if (diffBtn) setDifficulty(diffBtn.key);
  else flap();
}

document.addEventListener('keydown', e => {
  unlockAudio();
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) flap();
  } else if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat) {
    togglePause();
  } else if (e.code === 'KeyM' && !e.repeat) {
    toggleMute();
  } else if (state === 'ready' && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
    setDifficulty(DIFF_BTNS[Number(e.code.slice(-1)) - 1].key);
  }
});
canvas.addEventListener('mousedown', e => onPointer(e.clientX, e.clientY));
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  onPointer(t.clientX, t.clientY);
}, { passive: false });

// Auto-pause when the player switches tabs or windows
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') state = 'paused';
});
window.addEventListener('blur', () => {
  if (state === 'playing') state = 'paused';
});
window.addEventListener('resize', resize);

resize();
reset();
requestAnimationFrame(loop);
