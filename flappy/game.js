const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

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
const MEDALS = [
  { score: 40, name: 'PLATINUM', color: '#e5e4e2' },
  { score: 30, name: 'GOLD', color: '#ffd700' },
  { score: 20, name: 'SILVER', color: '#c0c0c0' },
  { score: 10, name: 'BRONZE', color: '#cd7f32' },
];
const MUTE_BTN = { x: W - 46, y: 12, w: 34, h: 34 };

let bird, pipes, score, state; // state: 'ready' | 'playing' | 'paused' | 'over'
let distSincePipe, lastTop, overTimer;
let highScore = 0;
let muted = false;
try {
  highScore = parseInt(localStorage.getItem('flappyHighScore'), 10) || 0;
  muted = localStorage.getItem('flappyMuted') === '1';
} catch (e) {}

// Scenery
let groundX = 0;
let tick = 0;
let shake = 0;
let flash = 0;
const clouds = Array.from({ length: 5 }, (_, i) => ({
  x: i * 100 + Math.random() * 60,
  y: 40 + Math.random() * 200,
  s: 0.6 + Math.random() * 0.8,
}));
const hills = Array.from({ length: 8 }, (_, i) => ({
  x: i * 70,
  h: 40 + Math.random() * 50,
  w: 90 + Math.random() * 40,
}));
let particles = [];

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
  burst(bird.x, bird.y, '#f7d51d', 24);
  sounds.hit();
  if (score > highScore) {
    highScore = score;
    try {
      localStorage.setItem('flappyHighScore', highScore);
    } catch (e) {}
  }
}

function update() {
  if (state === 'paused') return;
  tick++;
  const speed = pipeSpeed();

  // Ambient scenery keeps moving unless the game is over
  if (state !== 'over') {
    groundX = (groundX - speed) % 24;
    for (const c of clouds) {
      c.x -= 0.25 * c.s;
      if (c.x < -80) c.x = W + 40;
    }
    for (const h of hills) {
      h.x -= 0.6;
      if (h.x + h.w < 0) h.x = W + 20;
    }
  }

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.15;
    p.life--;
  }
  particles = particles.filter(p => p.life > 0);
  if (shake > 0) shake *= 0.85;
  if (flash > 0) flash -= 0.06;

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

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, H - GROUND_H);
  g.addColorStop(0, '#4ec0ca');
  g.addColorStop(1, '#cdeffa');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Distant hills
  ctx.fillStyle = '#9fd8a8';
  for (const h of hills) {
    ctx.beginPath();
    ctx.ellipse(h.x + h.w / 2, H - GROUND_H, h.w / 2, h.h, 0, Math.PI, 0);
    ctx.fill();
  }

  // Clouds
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const c of clouds) {
    const r = 16 * c.s;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.arc(c.x + r * 1.1, c.y - r * 0.5, r * 1.2, 0, Math.PI * 2);
    ctx.arc(c.x + r * 2.3, c.y, r, 0, Math.PI * 2);
    ctx.rect(c.x, c.y, r * 2.3, r);
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
    // Bottom pipe, cap at the top
    const by = p.top + p.gap;
    pipeCap(p.x, by);
    pipeBody(p.x, by + CAP_H - 1, PIPE_W, H - GROUND_H - by - CAP_H + 1);
  }
}

function drawGround() {
  const y = H - GROUND_H;
  ctx.fillStyle = '#ded895';
  ctx.fillRect(0, y, W, GROUND_H);
  // Grass strip
  ctx.fillStyle = '#73bf2e';
  ctx.fillRect(0, y, W, 14);
  ctx.fillStyle = '#558c22';
  ctx.fillRect(0, y + 14, W, 3);
  // Scrolling diagonal stripes on the grass
  ctx.fillStyle = '#8ad23c';
  for (let x = groundX - 24; x < W + 24; x += 24) {
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

function text(str, x, y, size, color = '#fff') {
  ctx.font = `bold ${size}px "Trebuchet MS", Verdana, sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size / 6;
  ctx.strokeStyle = '#2b1b0e';
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function panel(x, y, w, h) {
  ctx.fillStyle = '#ded895';
  ctx.strokeStyle = '#533';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 12);
  ctx.fill();
  ctx.stroke();
}

function drawMedal(x, y, medal) {
  ctx.beginPath();
  ctx.arc(x, y, 22, 0, Math.PI * 2);
  ctx.fillStyle = medal ? medal.color : '#c9c07a';
  ctx.fill();
  ctx.strokeStyle = '#533';
  ctx.lineWidth = 3;
  ctx.stroke();
  if (!medal) return;

  // Star in the middle
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 12 : 5;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fill();
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

function draw() {
  ctx.save();
  if (shake > 0.5) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  }

  drawSky();
  drawPipes();
  drawGround();
  drawParticles();
  drawBird();

  if (state !== 'over') text(score, W / 2, 80, 54);

  if (state === 'ready') {
    text('Flappy Bird', W / 2, 160, 46, '#ffd54a');
    text('Press Space or click', W / 2, H / 2 + 70, 22);
    text(`Best: ${highScore}`, W / 2, H / 2 + 100, 20);
    text('P: pause   M: mute', W / 2, H / 2 + 130, 15);
  } else if (state === 'paused') {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
    text('Paused', W / 2, H / 2 - 10, 48);
    text('P, Space or click to resume', W / 2, H / 2 + 30, 18);
  } else if (state === 'over') {
    const medal = MEDALS.find(m => score >= m.score);
    text('Game Over', W / 2, 150, 48, '#ff7043');
    panel(W / 2 - 140, 190, 280, 125);
    ctx.fillStyle = '#e8502f';
    ctx.font = 'bold 16px "Trebuchet MS", Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MEDAL', W / 2 - 85, 220);
    ctx.fillText('SCORE', W / 2 + 10, 220);
    ctx.fillText('BEST', W / 2 + 95, 220);
    drawMedal(W / 2 - 85, 255, medal);
    if (medal) text(medal.name, W / 2 - 85, 302, 13, medal.color);
    text(score, W / 2 + 10, 265, 38);
    text(highScore, W / 2 + 95, 265, 38, score >= highScore && score > 0 ? '#ffd54a' : '#fff');
    if (score > 0 && score >= highScore) text('NEW BEST!', W / 2 + 52, 298, 16, '#ffd54a');
    if (overTimer >= RESTART_DELAY && Math.floor(tick / 30) % 2 === 0) {
      text('Space or click to restart', W / 2, 360, 20);
    }
  }

  ctx.restore();

  drawMuteButton();

  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.max(0, flash)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// Fixed-step loop: the game runs at the same speed on 60Hz and 144Hz screens
let lastTime = null;
let acc = 0;

function loop(now) {
  if (lastTime === null) lastTime = now;
  acc += Math.min(now - lastTime, 250); // cap catch-up after a long stall
  lastTime = now;
  while (acc >= STEP) {
    update();
    acc -= STEP;
  }
  draw();
  requestAnimationFrame(loop);
}

// Convert a screen position to canvas coordinates (the canvas is scaled by CSS)
function canvasPoint(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((clientX - r.left - canvas.clientLeft) * W) / canvas.clientWidth,
    y: ((clientY - r.top - canvas.clientTop) * H) / canvas.clientHeight,
  };
}

function onPointer(clientX, clientY) {
  unlockAudio();
  const p = canvasPoint(clientX, clientY);
  const b = MUTE_BTN;
  if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) toggleMute();
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

reset();
requestAnimationFrame(loop);
