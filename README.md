# Cube Fit 🧊

A hands-on browser game for teaching **orthographic views** (front view,
top view, side view) — built for primary-school maths/geometry practice.

**[Play it live](#) once GitHub Pages is enabled — see below.**

## The idea

Most lessons on this topic work one way: show a 3D shape, ask the student
to identify its front/top/side view from a picture. Cube Fit flips it
around — **the student builds the view themselves.**

A block made of unit cubes floats in front of a wall. The wall has a hole
cut in the exact shape of one of that block's views (front, top, or
side). The student rotates the block 90° at a time and watches a live
"X-Ray" panel that shows, cell by cell, which parts line up with the hole
(green), which parts of the hole are still open (amber), and which parts
would smash into the solid wall (red). When every cell is green, they
push the block through.

To make the puzzle non-trivial, most levels use **polycube shapes**
(blocky, multi-cube pieces) rather than a plain cube — a plain cube looks
identical from every 90°-aligned angle, so there'd be nothing to figure
out. Early levels use flat, one-cube-thick pieces (so two of the three
views are simple rectangles and only one view is "interesting" — the
classic paper-and-pencil orthographic exercise). Later levels use fully
3D pieces where all three views are distinct and the puzzle gets genuinely
tricky.

## Project structure

```
index.html              Page shell + UI
css/style.css            All styling
js/geometry.js           Pure grid math: 90° rotations, projections,
                          silhouette comparison. No Three.js/DOM - easy
                          to unit test on its own.
js/levels.js              The shape library + the 18-level campaign.
                          Each level's hole is derived directly from the
                          shape via geometry.js, so a hole can never be
                          impossible.
js/main.js                Three.js scene, UI wiring, scoring, save data.
js/verify-levels.mjs      A standalone Node script (no browser needed)
                          that brute-forces every level's 24 possible
                          orientations and confirms a solution exists.
js/vendor/three/          Three.js, vendored locally so the game has zero
                          external dependencies at runtime (works offline,
                          and isn't affected by school network filters
                          that block CDNs).
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

This re-derives every level's hole from its shape and brute-force
searches all 24 possible cube orientations to confirm at least one of
them solves it. Run this after adding or editing a shape in `levels.js`.

## Adding a new shape / level

1. Add a list of unit-cube coordinates to the shape library in
   `js/levels.js`, e.g. `const MY_SHAPE = [[0,0,0],[1,0,0],[1,1,0]];`
2. Add an entry to `RAW_LEVELS` referencing it with a `view` of
   `'front'`, `'top'`, or `'side'`.
3. Run `node js/verify-levels.mjs` — it will tell you immediately if the
   level is solvable (it always will be, since the hole is generated
   from the shape, but it's a good habit before shipping a change).

## Publishing on GitHub Pages

1. Push this repo to GitHub (already done if you're reading this there).
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a
   branch**, branch `main`, folder `/ (root)`.
3. Save — GitHub will give you a `https://<username>.github.io/<repo>/`
   link within a minute or two.

## Controls

- Click the rotate arrows, or use the keyboard: `Q`/`W` (X axis),
  `A`/`S` (Y axis), `Z`/`X` (Z axis), `Space` to push, `R` to reset.
- Drag anywhere in the 3D scene to look around — that's just the camera
  and never counts as a move.
- Progress (stars + unlocked levels) is saved in the browser via
  `localStorage`, per device/browser.
