# BLUE BELOW

A short first-person 3D survival horror game in the style of a late-1990s
PlayStation title. You are a thief inside a research facility that went dark
three nights ago, hired to steal a blue diamond. The job is simple until you
read the note next to it.

Desktop browser game. TypeScript, Three.js, Vite. No binary assets: every
texture, model, sound and ending still is generated from code at load time.

---

## Running it

One command, from a clean checkout:

```bash
./play.sh
```

It installs dependencies if needed, builds, serves the game on
`http://127.0.0.1:4173`, opens a browser if there is a display, and shuts the
server down cleanly on Ctrl-C. Options:

| Flag | Effect |
|---|---|
| `--dev` | Dev server with hot reload instead of the production build |
| `--port 5050` | Use a different port (it also steps to the next free port automatically) |
| `--no-open` | Just print the URL |
| `--no-build` | Serve whatever is already in `dist/` |
| `--help` | Usage |

`npm run play` does the same thing.

### Playing from another machine

The server binds to `127.0.0.1` only and is deliberately not reachable from
anywhere else. If the game is running on a remote desktop and you want to play
it on your laptop, forward the port rather than widening the bind:

```bash
ssh -N -L 4173:127.0.0.1:4173 <the-host-running-it>
```

then open `http://127.0.0.1:4173` on the laptop.

### Or drive the tools directly

```bash
npm install            # once
npm run dev            # development server at http://127.0.0.1:5173
npm run build          # typecheck + release build into dist/ (what you deploy)
npm run build:test     # same, plus the debug table the test suite drives
npm run preview        # serve the built game at http://127.0.0.1:4173
```

### Deploying to Cloudflare

The game is static — three files, no server code, no secrets — so it deploys as
an assets-only Cloudflare Worker.

```bash
npx wrangler login     # once
npm run cf:check       # validate the config and upload plan, change nothing
npm run cf:deploy      # run the release gate, then deploy
```

`npm run verify:release` is the gate on its own: 29 checks against the exact
artifact that gets uploaded, including booting the game with the production
Content-Security-Policy applied and confirming the debug table is absent.
Cloudflare Pages works too (`npm run build`, output `dist`).

**Read `CLOUDFLARE.md` first** — deploying makes the game and its source
public, and that doc covers what that means, the response-header policy and why
each CSP exception exists, and what has and has not been verified.

```bash
npm test               # build, then run the acceptance routes headless
npm run test:headed    # same, with a visible browser
npm run test:only      # skip the rebuild and just run the routes
npm run typecheck      # tsc --noEmit
```

12 routes, 259 checks. See `PLAYTEST.md` for what each route plays and what it
found. `npm run verify:release` adds 29 more against the deployable artifact.

Requires Node 20+ and a desktop browser with WebGL 2. The project ships an
`.npmrc` pinning the public npm registry, so `npm install` works regardless of
whatever registry the machine defaults to.

### Screenshots

```bash
node test/vantages.mjs   # 24 in-world vantage points -> test/vantages/
node test/ui-shots.mjs   # 24 interface states        -> test/ui/
```

Both are reproducible: every procedural asset is seeded from its own name.

---

## Controls

| Input | Action |
|---|---|
| **W A S D** | Move |
| **Mouse** | Look, and aim the gun once you have it |
| **Shift** | Sprint. Finite, and the loudest thing you can do |
| **E** | Interact: read, use a device, pick something up |
| **Left click** | Fire a flare, once you have the signal pistol |
| **Esc** | Close an interaction, or pause while exploring |
| **Tab** | Clue journal (also reachable from the pause screen) |
| **F3** | AI debug overlay — development builds only |

Pressing **E** at a locker, a crate, or the gap under a desk or counter climbs
inside it. While you are in there the demon cannot see or hear you at all, and
cannot reach you. You can look around a limited arc to watch it go past, and
**E** or **Esc** climbs back out. Six of them are spread through the facility.

Inside a device panel: mouse or **A**/**D** moves the selection, left click or
**E**/**Enter** actuates, **W**/**S** turns a letter wheel on the door lock,
**R** resets, **Esc** steps back. Device panels keep the mouse captured, so
stepping out of one never depends on the browser's pointer-lock cooldown.

Mouse sensitivity, master volume, effects volume and invert-look are on the
settings screen and persist in `localStorage`.

---

## The game

You start in reception, facing a locked front exit with two independent locks: a
powered latch and a four-letter wheel lock. Both are inspectable from the first
minute. The route in runs reception → generator hall → workshop → an unlit
service-tunnel maze → the vault, and you have to come back out the same way.

At the pedestal there is a handwritten note. Reading it comes before the
decision, and the decision is real:

- **Leave the diamond** → the **Ugly Ending**, immediately. The seal holds, the
  world is safe, and you walk out with nothing.
- **Take the diamond** → the facility stays normal for a stretch, then one
  demon reveals itself at the far end of a straight tunnel and stalks you for
  the rest of the run.

Getting out with the stone needs all three extraction puzzles, in this order,
because each one unlocks the next:

1. **Counter safe** (workshop) — three toggles, `+4`, `−3`, `+7`, against a
   target of **8**. All three are required: `4 − 3 + 7 = 8`. The key to the
   breaker cabinet is inside.
2. **Circuit breaker** (generator hall) — four breakers thrown in one exact
   order, given on the maintenance diagram on the adjacent wall. A wrong input
   trips the panel back to the start and you can retry immediately. Completing
   it restores power and releases the door's powered latch.
3. **Four-letter lock** (front door) — a code generated fresh per run and
   painted on four walls in blood, marked `I` to `IV`. The numeral is the
   letter's position. They can be found in any order and revisited any time.

### The flare gun

In the records annex there is an emergency signal kit holding a **signal
pistol, loaded with one flare**. Three more flare cartridges are scattered
through the facility — one in the parallel corridor, one on a shelf beside the
breaker cabinet, one dropped in the maze sump. **Four shots per run.**

A fired flare is a real object: it travels, falls, skids, and then burns on the
floor for about twenty seconds, lighting everything around it. The facility is
dark enough that spending a cartridge to see a room is a genuine decision, and
light enough that you can always navigate, recognise what you can interact
with, and read the wall clues without firing one.

A flare that lands **in the demon** sets it alight. It goes through a wall
burning and stays off the board for **sixty seconds of active gameplay** — the
clock stops dead while the game is paused or while a device panel has it
suspended — then comes back somewhere away from you and out of your sight, with
an audible warning first. That is relief, not a kill. Escaping while it is
merely absent is still the Bad Ending.

### The ritual

Behind a false wall in the maze is a sealed store. Nothing signposts it: a seam
in the masonry, scratch marks beside it, and a draught you can hear. Cut into
the floor inside is a **glowing pentagram**, and a note from the man who opened
the wall explaining what it is — a grave waiting for a headstone.

Somewhere else in the facility is a **small brass key**, and in the records
annex is a locked **personal box** belonging to the man who owned it. You can
find and inspect the box long before the key. Inside is a **brass crucifix**.

Put the cross in the seal and the thing the diamond released goes into the
floor with it, permanently. That is the only way to kill it for good — and it
still leaves you a safe to open, a panel to throw and a door to dial.

**Hiding is not the same as a device panel.** A panel suspends the demon
entirely. Hiding does not: the world keeps running and it keeps hunting, so it
comes to where it last saw you, searches, and eventually wanders off. You just
stop being something it can find.

**How it hunts.** It has exactly one sense: sight. A configurable cone (110°),
a maximum range (34 units), and a true three-dimensional line of sight that
walls, furniture and the closed front door all stop. It checks three heights up
your body, so peeking round a corner is a real thing rather than a coin toss.
**Nothing else ever tells it where you are** — there is no hearing model, and
leaving a hiding place does not give you away.

Unseen, it patrols a graph of connected nodes through the halls, intersections
and rooms, weighted toward places it has not been recently, pausing and turning
at junctions. It is looking the whole time it does this, so standing in its
view while it dwells at a corner is fatal.

Once it sees you it chases, updating where it last saw you for as long as it
keeps you in sight. Break line of sight and it goes to **the last place it
actually saw you** — not where you are — while a five-second clock runs. Show
yourself inside those five seconds and the clock resets. Stay unseen for five
unbroken seconds and it gives up, starting its next patrol near that last
sighting and widening out from there. A device panel freezes that clock dead.

**On outrunning it.** It chases at 5.0 units/second, you walk at 4.3 and sprint
at 6.6. Walking away loses ground, so noticing it is not enough on its own: you
sprint, round a corner, and let it lose you. One full stamina bar is about 4.4
seconds of sprint — enough to get round a corner and not much more. Sprinting is
also the loudest thing you can do, so it hears you from twice as far. Standing
still beside it is what gets you killed.

- **Bad Ending** — cross the threshold with the stone while it is still alive,
  *including* while it is temporarily absent after a flare hit.
- **Good Ending** — cross the threshold with the stone after completing the
  cross ritual.

If you place the cross before taking the diamond, the seal sits armed and the
ritual resolves at the moment lifting the stone releases the thing — the same
permanent outcome, staged at the reveal.

Opening any device panel suspends the demon entirely — it stops moving,
detecting and attacking, and keeps its exact position and chase state — locks
you to the device view, and drops every held key. Stepping back restores your
control first, then gives a 2.5 second grace period before it can hurt you.

Reading ordinary signs, documents and wall clues does **not** suspend it. Those
use normal exploration rules, so a readable closes itself if the demon gets
within 13 units and tells you why.

There is one checkpoint, taken the instant you lift the diamond and before the
reveal. A retry restores that moment exactly: the run's code, your inventory
then, and your puzzle progress then.

---

## Source layout

```
index.html
src/
  main.ts                 entry point, frame loop, debug handle
  core/
    input.ts              keyboard/mouse, pointer lock, focus loss, releaseAll()
    audio.ts              all sound, synthesised; HRTF panning for spatial cues
    settings.ts           persisted sensitivity and volumes
    rng.ts                mulberry32; seeds the run code and every asset
  render/
    psx.ts                vertex snapping, affine UVs, 224-line buffer, dither
  world/
    layout.ts             the facility as data: regions, lights, clues, staging
    grid.ts               collision, line of sight, floor height, A*
    build.ts              merges geometry per region, bakes vertex lighting
    props.ts              furniture, signs, devices, landmarks, decals
    textures.ts           every texture generator
    strokefont.ts         hand-authored glyphs for the blood letters
    palette.ts            the 18-colour palette
  game/
    game.ts               phase machine, interaction, reveal, ritual, endings
    flares.ts             flare projectiles, burning, and dynamic flare light
    player.ts             movement, collision, footsteps, view locking
    demon.ts              sight-only detection, patrol graph, chase, lost sight
    aidebug.ts            development-only AI visualisation (F3)
    state.ts              run state, generated secrets, the checkpoint
  ui/
    screens.ts            title, briefing, note, decision, pause, endings
    puzzles.ts            the three device panels
    hud.ts                prompt, inventory, stamina, directional demon cue
    endingart.ts          the three ending stills
    style.css
test/
  run-routes.mjs          the acceptance suite (12 routes)
  vantages.mjs            in-world screenshots
  ui-shots.mjs            interface screenshots
test/
  release-check.mjs       release gate for the deployable artifact
  cf-preflight.mjs        explains why wrangler dev cannot run on some hosts
wrangler.toml             Cloudflare Workers config (assets-only)
public/_headers           CSP, security and caching headers for the deploy
ASSET_MANIFEST.md         shared asset manifest and release audit
PLAYTEST.md               playtest report
CLOUDFLARE.md             deploy guide and what publishing this means
```

### How the period look is produced

Four effects, each switchable per material so that puzzle controls, blood
letters and wayfinding stay readable while everything else wobbles:

1. **Screen-space vertex snapping** — vertices are quantised to the
   low-resolution pixel grid in the vertex shader, which is the source of the
   characteristic geometry jitter.
2. **Affine texture mapping** — `uv * w` and `w` are interpolated and divided
   in the fragment shader, which cancels the GPU's perspective correction and
   makes textures swim across large surfaces.
3. **Gouraud-style lighting** — 36 static lights baked into vertex colours
   with line-of-sight occlusion at build time, plus one per-fragment handlamp.
   No shadow maps. Lighting is composited in gamma space, not linear.
4. **A 224-line internal buffer**, ordered 4×4 Bayer dithering, 5-bit colour
   quantisation, scanlines and a vignette, upscaled nearest-neighbour.

### Known deviation from the brief

The brief's puzzle table says both "the safe target is `12`" and "Set the
target to **`8`** so all three switches are required in the correct state:
`4 − 3 + 7 = 8`". These disagree, and only `8` satisfies the stated
requirement that all three switches be needed, so **the target is 8**. The
value appears in one place, `SAFE_TARGET` in `src/game/state.ts`, and the
safe's door plate, wall sign and panel all read it from there.
