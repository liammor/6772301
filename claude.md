# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project goal and constraints

A Flappy Bird game for a school project. Keep it simple: build the basic game first, and only add extra features after the basics are done and the user asks for them. Course requirements: only HTML, CSS and JS (or Python), no backend and no server, just simple interactive page(s).

## Running

There is no build step, package manager, linter or test suite. Open `flappy/index.html` directly in a browser (`open flappy/index.html` on macOS) and reload after edits. Don't introduce a server, bundler or dependencies.

## Architecture

The whole game lives in `flappy/`: `index.html` (a single 400x600 `<canvas id="game">`), `style.css` (page centering and canvas frame only), and `game.js` (all logic and rendering, no modules).

`game.js` is one global-scope script built around a fixed-step loop: `loop()` runs `update()` at a fixed 60 steps per second (time accumulator, `STEP`) and calls `draw()` once per `requestAnimationFrame`. All velocities and timers are per step, so the speed is the same on any refresh rate.

- **State machine:** the `state` variable is `'ready' | 'playing' | 'paused' | 'over'`. `flap()` handles Space, click and tap and drives transitions: ready/paused -> playing, and over -> `reset()` once `RESTART_DELAY` steps have passed. P/Esc toggle pause, and losing focus auto-pauses. Clicks are first hit-tested against the mute button (`canvasPoint()` maps CSS-scaled coordinates to canvas pixels).
- **`update()`** does nothing while paused. Otherwise it advances scenery, particles and screen shake/flash, then branches on `state`. In `playing` it runs physics, spawns pipes by distance travelled (`PIPE_SPACING`), scores when the bird passes a pipe's center, and does circle-vs-rect collision (`HIT_R`) against pipe bodies and caps.
- **Speed modes:** Easy/Normal/Hard (`DIFFICULTIES`) are chosen on the ready screen (buttons in `DIFF_BTNS` or keys 1/2/3). They only scale how many `update()` steps run per second in `loop()`; no physics constant changes. Each mode has its own best score (`highScoreKey()`).
- **Difficulty ramp:** `pipeSpeed()` and `pipeGap()` derive from `level()` (score / 10). Each pipe stores its own `gap`, and `addPipe()` keeps each gap within `MAX_GAP_SHIFT` of the previous one.
- **`draw()`** layers sky/hills/clouds, pipes, ground, particles, bird, then state-specific overlays (the game-over panel shows a medal from `MEDALS`). Shake is applied via `ctx.translate`; the mute button and white flash are drawn after `ctx.restore()`.
- **Rendering:** all game code uses logical 400x600 coordinates (`W`, `H`). `resize()` sizes the canvas pixels to its CSS size × devicePixelRatio, and `draw()` applies that via `setTransform(scale…)`. CSS sets the canvas's on-screen size (2:3 `aspect-ratio`), not the HTML attributes.
- **Scenery:** a `scroll` distance drives every background layer through `wrapX(base, factor, period, margin)`. Each layer (mountains, clouds, city, hills) repeats every `period` px and moves at `factor` × the pipe speed. The sky blends between the `SKY` palettes (day, sunset, night, dawn) using `skyT`, which eases toward `level()`.
- **Font:** "Lilita One" from Google Fonts, linked in `index.html`. Offline it falls back to Trebuchet MS.
- **Sound:** generated with Web Audio in `tone()`, with no audio files. The `AudioContext` is created lazily in `unlockAudio()` on the first user input, as browsers require.
- **Tuning:** gameplay constants are at the top of `game.js`.
- **Persistence:** the high score (`flappyHighScore`) and mute setting (`flappyMuted`) are stored in `localStorage`, always wrapped in try/catch so the game still works when storage is blocked (e.g. opened via `file://` in some browsers).
