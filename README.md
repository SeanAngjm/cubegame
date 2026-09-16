# Cube Fit 🧊

A hands-on browser game for teaching **orthographic views** (front view,
top view, side view) — built for primary-school maths/geometry practice,
and designed to run well on a touchscreen classroom display.

## The idea

Most lessons on this topic work one way: show a 3D shape, ask the student
to identify its front/top/side view from a picture. Cube Fit flips it
around — **the student builds the view themselves.**

A block made of unit cubes floats in the middle of the scene. One or more
walls, each with a hole cut in the exact shape of one of that block's
views, slide through the block in turn. The student rotates the block
until every active wall's hole lines up, then hits **Test Fit**. A live
"X-Ray" panel per wall shows, cell by cell, which parts line up (green),
which parts of the hole are still open (amber), and which parts would hit
the solid wall (red).

### Three difficulty modes

| Mode | Walls | What it asks |
|---|---|---|
| **Easy** | 1 | Match one view — front, top, or side. |
| **Medium** | 2 | Find one rotation that satisfies two views at once (e.g. front AND top). |
| **Hard** | 3 | Find the one orientation (or symmetric equivalent) that satisfies all three views simultaneously. |

To make the puzzle non-trivial, most levels use **polycube shapes**
(blocky, multi-cube pieces) rather than a plain cube — a plain cube looks
identical from every 90°-aligned angle. Early Easy levels use flat,
one-cube-thick pieces (so two of the three views are simple rectangles
and only one view is "interesting" — the classic paper-and-pencil
orthographic exercise). Later levels, and Medium/Hard throughout, use
fully 3D pieces where all three views are distinct.

### Controls

- **Buttons**: six rotate buttons, always available. Instead of "X/Y/Z
  axis" labels (which primary students haven't learned yet), each button
  shows a curved arrow icon indicating which way it spins the block, and
  the three pairs are named in plain language — **Tip** (tips it
  forward/back), **Spin** (spins it left/right), **Roll** (rolls it like
  a wheel) — each color-coded to match its x-ray panel dots.
- **Touch**: swipe with **one finger** anywhere on the 3D scene to spin
  the block (left/right = Spin, up/down = Tip); drag with **two
  fingers** to orbit/zoom the camera instead — the two never conflict,
  which matters on a shared touchscreen. Roll is button-only for now (a
  two-finger twist gesture would be a natural follow-up).
- **Keyboard**: `Q`/`W` (Tip), `A`/`S` (Spin), `Z`/`X` (Roll),
  `Space` = Test Fit, `R` = reset.
- **Fullscreen button** (top bar) — handy for a classroom display/kiosk
  setup so the browser chrome doesn't eat screen space.

### Flow & progress

The game always opens on the **difficulty picker** first, showcasing all
three modes before dropping the student into a puzzle. A **🏠 button** in
the top bar reopens that picker at any time (so does the mode badge next
to it) — handy for a teacher switching difficulty mid-class or jumping
into the race mode below. Every level in every mode is playable from the
start — nothing is locked — so a student (or teacher demoing the game)
can jump straight to any level via the **Levels** button. Star ratings
and best-move counts are still saved per difficulty via `localStorage`,
purely as a record of best attempts, not as a gate.

The rotate buttons and action buttons (Test Fit / Reset / Hint) sit in a
single bar **below the 3D play area**, not off to the side — on a large
classroom touchscreen that keeps them within easy reach of a shorter
student, and the whole layout is sized to fit one screen without
scrolling.

### 2-Player Race mode

From the difficulty picker, **🏆 2-Player Race Mode** switches to a
split-screen view: two independent play areas side by side, each with
its own 3D scene, x-ray panel(s), rotate buttons and Test Fit button.
Both players get the *same* randomly-picked level (choose Easy/Medium/
Hard from the race screen's own toolbar) after a 3-2-1-GO countdown —
whoever lines theirs up and hits Test Fit successfully first wins. Since
each player has their own `<canvas>` element, the browser keeps their
touches separate automatically, so two students can rotate their own
block at the same time on one shared touchscreen with no extra work.
"Race Again" starts a fresh level at the same difficulty; the 🏠 button
returns to the single-player menu.

## Project structure

```
index.html                Page shell + UI (mode/level/help modals, x-ray
                            panel container, rotate controls)
css/style.css              All styling
js/geometry.js             Pure grid math: 90° rotations, projections to
                            2D silhouettes, silhouette comparison. No
                            Three.js/DOM - easy to unit test on its own.
js/levels.js                The shape library + Easy/Medium/Hard level
                            campaigns. Each level's hole(s) are derived
                            directly from the shape via geometry.js, so a
                            level can never be impossible - even Hard
                            mode (all 3 views at once) is always solvable
                            because a shape's own identity orientation
                            trivially satisfies all three simultaneously.
js/main.js                  Three.js scene, multi-wall build/slide
                            animation, per-view x-ray panels, touch/mouse
                            input, mode & level select UI, scoring, save
                            data.
js/icons.js                  Generates the curved-arrow SVG icons used on
                            the rotate buttons (see "Controls" above),
                            so direction is shown visually instead of via
                            axis labels.
js/competition.js            Self-contained 2-player split-screen race
                            mode. Reuses geometry.js/levels.js/icons.js
                            but drives its own pair of Three.js scenes
                            (one per player canvas) so it can't regress
                            the single-player game in main.js.
js/verify-levels.mjs        A standalone Node script (no browser needed)
                            that brute-forces every level's 24 possible
                            orientations, in all three modes, and
                            confirms a solution exists.
js/vendor/three/            Three.js, vendored locally so the game has no
                            external runtime dependency (works offline,
                            and isn't affected by school network filters
                            that block CDNs). OrbitControls has one small
                            local patch - see "Vendored library patch"
                            below.
```

## Running it locally

Any static file server works, e.g.:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

It's plain HTML/CSS/JS — no build step.

## Sanity-checking the levels

```bash
node js/verify-levels.mjs
```

This re-derives every level's hole(s) from its shape, in all three
difficulty modes, and brute-force searches all 24 possible cube
orientations to confirm at least one of them satisfies every active view
simultaneously. It also prints the worst-case number of quarter-turns
needed from any scrambled starting orientation, which is what the `par`
values (used for star ratings) should be based on. Run this after adding
or editing a shape or level.

## Adding a new shape / level

1. Add a list of unit-cube coordinates to the shape library in
   `js/levels.js`, e.g. `const MY_SHAPE = [[0,0,0],[1,0,0],[1,1,0]];` and
   register it in `SHAPE_LIB`.
2. Add an entry to `EASY_RAW` / `MEDIUM_RAW` / `HARD_RAW` referencing it
   with a `views` array (one entry for Easy, two for Medium, three for
   Hard) and a `par`.
3. Run `node js/verify-levels.mjs` to confirm it's solvable and see a
   sensible `par` (it always will be solvable, since holes are generated
   from the shape itself, but the worst-case number is a good habit to
   check before shipping).

## Vendored library patch

`js/vendor/three/controls/OrbitControls.js` has one small local patch:
its two `setPointerCapture`/`releasePointerCapture` calls are wrapped in
try/catch. Without it, a pointer that's released faster than the browser
can process it (a very quick tap, or certain automated test harnesses)
throws an uncaught `DOMException` from inside OrbitControls' own event
handler. The patch is marked with `[cube-fit patch]` comments in that
file — if you ever update Three.js, re-apply it (or check whether
upstream has fixed this itself).

## Publishing on GitHub Pages

1. Push this repo to GitHub (already done if you're reading this there).
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a
   branch**, branch `main`, folder `/ (root)`.
4. Save — GitHub will give you a `https://<username>.github.io/<repo>/`
   link within a minute or two.

## Roadmap / not built yet

Requested and planned, but not in this pass:

- **Build-your-own-block mode**: a voxel-style tray where students
  combine several smaller pieces into one custom shape before rotating
  it to fit — as a second mode alongside "rotate a preset block". This
  is the one remaining feature from the original request list that
  hasn't been built yet.

(The two-player split-screen race mode that used to be listed here has
since been built — see "2-Player Race mode" above.)
