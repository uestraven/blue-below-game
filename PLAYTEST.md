# BLUE BELOW — Playtest Report

Build under test: the production build in `dist/`, served over loopback and
driven in headless Chromium 159 (SwiftShader software GL).

Reproduce everything here with:

```bash
npm test                 # 14 routes, 292 checks
node test/vantages.mjs   # 24 in-world screenshots
node test/ui-shots.mjs   # 24 interface screenshots
```

---

## 1. Result summary

**292 / 292 checks passed across 14 routes. All three endings verified.**

| Route | What it plays | Result |
|---|---|---|
| 1 | Inspect the front door, reach the vault, read the note, leave the diamond | **Ugly Ending** ✓ |
| 2 | Take it, witness the delayed reveal, solve all three puzzles, escape without the gun | **Bad Ending** ✓ |
| 3 | Find the false wall, take the gun, one-shot kill, solve all three puzzles, escape | **Good Ending** ✓ |
| 4 | Miss the shot, finish the escape | demon alive, **Bad Ending** ✓ |
| 5 | Every gate before its prerequisite; every wrong input | all clear and recoverable ✓ |
| 6 | Open a puzzle during a live chase, then hammer it open and shut | demon frozen, state intact ✓ |
| 7 | Die and retry, then two fresh games | codes and wall clues consistent ✓ |
| 8 | Ramp, tight corners, false wall both ways, locked threshold, focus loss | ✓ |
| 9 | Measure the length of a complete first route | 1057 units ✓ |
| 10 | Release audit: placeholders, untextured geometry, unbound generators | clean ✓ |
| 11 | Audio graph: every sound constructs and schedules in a live context | ✓ |
| 12 | Real keyboard input: movement speeds, interaction, menus, a device panel | ✓ |
| 13 | Hiding: invisible to the demon, and not a suspension | ✓ |
| 14 | Chase balance: reacting and moving away is enough to escape | ✓ |

How the harness plays: it picks real menu choices, presses real puzzle
controls, walks with the real collision code and fires with the real hit check.
Routes 1–11 bypass the physical input devices and drive the frame clock
directly; **route 12 bypasses nothing** — it sends real key events through the
browser and lets the game run on `requestAnimationFrame`. There is no test-only
code path through the game in either case.

Route 12 exists because it catches a class of defect the others structurally
cannot: routes 1–11 move the player with a scripted walker, which never touches
the velocity model, so a movement bug is invisible to them. It found one — see
§4.12.

---

## 1a. Human playtest round 1 — what was reported and what changed

A human played the build. Four pieces of feedback, all acted on.

### "Left and right are swapped" — real bug, fixed

Strafing was mirrored. Forward is `(sin yaw, cos yaw)`, so right must be
`cross(forward, up)` = `(-cos yaw, 0, sin yaw)`; the code used
`(cos yaw, 0, -sin yaw)`, which is the *left* vector, so A and D were
transposed. Fixed in `player.ts`, along with the stale `player.right`.

Route 12 had asserted "A strafes sideways, not forward" — which passes
perfectly well with the controls mirrored. It now asserts the **sign** of the
displacement in both directions. This is the second bug in a row that only a
human caught because the automated check was too weak, and the test is now
strong enough to have caught it.

### "The monster graphics were not scary at all" — rebuilt

It was nine boxes. It is now 2.55 units of deliberately wrong proportions:

- tapered 5-sided solids instead of plain boxes, which reads angular and
  period-correct rather than like a mannequin
- forward-pitched spine with four rib slats across the chest
- long neck carrying a tapered skull **ahead of** the shoulders rather than on
  top, with a hinged jaw that opens when it runs and gapes when it attacks
- segmented legs with knees that bend backwards, and the two legs 0.86π out of
  phase instead of exactly opposed, so the gait limps
- segmented arms with the hands swinging below the knee
- a head twitch overlaid on every state, snapping to a random offset at
  irregular intervals — nothing alive moves its head in a clean sine wave, and
  this is most of what sells it
- skin reworked: a dark mass with drum-tight bone in patches. The first attempt
  overcorrected to pale grey and read as a statue; dark body with a pale skull
  is what actually works
- face rebuilt from absence — oversized sunken sockets under a pale brow ridge,
  vertical split mouth with irregular teeth

Screenshots: `test/vantages/demon-close.png`, `demon-mid.png`,
`demon-reveal-far.png`, `demon-lit.png`.

### "The gun was too easy to find, in the wide open" — fixed, and the cause was mine

The secret room was not the problem. I had put a **sign reading DRAUGHT** on
the wall next to the false wall, which hands over the secret room and with it
the good ending to anyone who walks past. That was my own over-signposting
against a brief that asked for "a subtle environmental clue". Removed.

What is left as the tell: the seam in the wall texture, the scratch marks
beside it, and a new positional `draught` sound that plays near the false wall
every few seconds. Inside, the gun is no longer lying on a crate with a glint
on it — it is in a steel footlocker that has to be forced first, so finding the
room is no longer the same as finding the weapon.

To keep the good ending discoverable without the sign, the records memo now
ends: *"containment left one on site. sealed store off the tunnels — you will
not find the door, you have to feel the air move."*

### "Add the ability to hide in objects" — added, see route 13

Six hiding places: under the reception counter, under the records desk, under
the generator control desk, inside the workshop locker, inside the locker bank
at the tunnel mouth, and inside the crate in the maze sump.

While hidden the demon **cannot see, hear or reach you** — sight, hearing and
the catch check are all skipped. You keep a limited look arc (±0.75 rad in a
locker, ±1.15 under a desk, ±0.6 in a crate) so you can watch it go past, and
stamina recovers. Each kind frames the screen differently: louvre slats for a
locker, a low letterbox for under a desk, a lid gap for a crate.

The important design decision: **hiding is not suspension.** A device panel
freezes the demon. Hiding leaves the world running, so it comes to where it
last perceived you, searches, and gives up on its own. Verified in route 13.

---

## 2. Route detail

### Route 1 — Ugly Ending

The front door is inspectable from the first minute and reports both locks and
their state. Walked lobby → vault on the real collision code. The handwritten
note is readable at the lectern on its own, **and** the pedestal always shows
the note before the decision screen. Both choices offered; leaving is
confirmed, and cancelling the confirmation returns to the decision rather than
dropping the player somewhere. Confirming ends immediately: ending `ugly`,
`diamondTaken` still false, demon never spawned (`state: dormant`).

### Route 2 — Bad Ending, no gun

Extraction gear refuses before the reveal with a stated reason rather than
silence. Checkpoint confirmed saved at pickup with `diamondTaken: true,
revealPlayed: false`. The reveal did **not** fire on pickup; it fired on the
return route, with the demon holding still at **24.4 units** down a straight
tunnel, then transitioning to `chase` after the hold. Safe → key (not
auto-collected) → breaker → lock → threshold. Ending `bad`, demon alive.

### Route 3 — Good Ending

Walked **through** the false wall into the sealed store (region confirmed
`secret`, discovery flagged), took the gun with one round. The checkpoint taken
later at the diamond correctly includes the gun. After the reveal, one shot at
the demon killed it; it stayed dead through 200 further frames. All three
puzzles then still had to be solved — verified explicitly — before the
threshold gave the `good` ending with the diamond kept.

### Route 4 — Miss, then escape

Aimed 135° off the demon and fired: round spent, demon alive. Firing again
reports empty and spends nothing. Completed all three puzzles and escaped to
the `bad` ending with the demon alive.

### Route 5 — Gates and mistakes

Every gate was tried before its prerequisite:

| Attempt | Response |
|---|---|
| Door code before power | Inspection readable, not the lock panel. Label: "Inspect the door control" |
| Safe before the reveal | Refused: "The counter window is dark. No standby power in this building yet." |
| Breaker before the reveal | Refused: "Nothing in the cabinet is energised. Not yet." |
| Breaker after the reveal, no key | Refused: "Keyed access only. The key is in the workshop safe." Label: "Breaker cabinet (locked)" |
| Key before the safe opens | Not offered at all |
| Safe submit at 0 | "TOTAL 0 DOES NOT MATCH TARGET 8. REJECTED." |
| Safe submit at 11 (`+4`,`+7`) | "TOTAL 11 DOES NOT MATCH TARGET 8. REJECTED." Safe stays shut |
| Safe reset | Counter clears to all-off |
| Breaker, correct then wrong | "A1 OUT OF ORDER. PANEL TRIPPED — SEQUENCE RESET TO 1 OF 4." Progress → 0, immediate retry succeeded |
| Lock submit part-set | "ALL FOUR WHEELS MUST BE SET." |
| Lock submit wrong code | "AAAA REJECTED. WHEELS HELD — ADJUST AND TRY AGAIN." Door stays locked |
| Lock clear | Wheels → `- - - -` |
| Re-using a solved device | Reports its state; does not reopen the panel |

Only `4 − 3 + 7 = 8` opens the safe, so all three switches are genuinely
required. Nothing in the sequence put the run into an unrecoverable state.

### Route 6 — Puzzle during a live chase

The player sprinted from the reveal to the workshop safe and arrived alive with
zero deaths, which also demonstrates that the chase is outrunnable. The demon
closed to **13.8 units in `chase`** state before the panel opened. Then:

- Panel opened during the chase; demon `suspended`, phase `puzzle`.
- Held open for **600 simulated frames (10 s)**: demon moved **0.0000 units**,
  stayed alive and suspended, kept `chase` state.
- Player did not drift — movement inputs are released on open and the view is
  locked to the device.
- On exit: control restored first, demon resumed with **2.48 s grace**, same
  `chase` state, same position (< 0.3 units).
- Opened and closed **six times in a row**: max movement while open
  **0.0000 units**; total drift across the whole sequence **0.25 units**,
  entirely during the shut gaps; never despawned, never repositioned, no
  damage, grace reapplied every time.
- The puzzle still solved correctly afterwards, with the demon still hunting.

### Route 7 — Retry and fresh games

All four wall decals matched the lock code in position order, and the code was
four distinct letters from the curated alphabet. The four blood letters were
visited **in reverse numeral order** (IV, III, II, I) to prove discovery order
does not matter; all four recorded, and the journal letters assembled into the
lock code.

Took the diamond with all four letters known, triggered the reveal, then let
the demon land a hit: death screen shown. Retry restored the same code, the
same four found letters, the diamond, the vault position, `revealPlayed: false`
so the reveal replays, and the demon back to `dormant`. Wall decals were
byte-identical before and after.

Two fresh games then generated independent seeds and new codes, and the walls
were repainted to match the new code each time. Flood fill confirmed **all 1188
carved cells reachable from the player's start** — no orphaned geometry.

### Route 8 — Collision details

| Check | Result |
|---|---|
| The vault dais ramp | Walked up: eye height rose 0.60 units, matching the height field; walked back down to exactly floor level |
| Tight corner: G tunnel north→south | ✓ |
| Tight corner: H tunnel into the K branch | ✓ |
| Tight corner: F branch (the escape loop) | ✓ |
| Tight corner: pump chamber → north tunnel | ✓ |
| Tight corner: entry hall → west tunnel | ✓ |
| False wall, eastward | Passes through into `secret` |
| False wall, westward | Passes back out into `maze` |
| Locked front door | Stops the player short of the threshold; crossing while locked does not end the run |
| Window focus loss | Pauses to the pause screen rather than leaving the player blind; resuming returns to play |
| Backing out of a panel | BACK and Esc both restore control |

### Route 9 — How long the game is

Shortest completionist path, measured leg by leg with the real pathfinder:
**1057 units, 4.1 minutes of pure walking** at walk speed, visiting the door,
the memo, all four blood letters, the tunnel maze, the false wall, the gun, the
vault, the reveal corridor, all three devices and the threshold.

The scripted optimal run in route 2 finished in **150 seconds of in-game
clock** — but that bot already knows the code, the breaker order and the route,
sprints in straight lines, reads nothing and never dies.

**On the 15–25 minute target:** I believe it lands in the band, and I have not
proved it. The measured floor is ~4 minutes of walking, before a first-time
player pays for reading five documents and four wall marks, searching an unlit
29×11 tunnel maze with four branches and two dead ends, finding a false wall,
the decision at the pedestal, and surviving a chase with detours and
line-of-sight breaks. Three to five times the optimal path is normal for an
unknown maze, which puts it in range. **This is an estimate, not a
measurement**, and it is the single thing most worth checking with a human.

### Route 12 — Real keyboard input

Everything here is real key events on a real frame loop, with speeds measured
from the player's own displacement rather than wall-clock time (headless input
latency in this environment reached 20 s for a nominal 500 ms hold, so timing
cannot be trusted).

| Check | Result |
|---|---|
| Hold **W** | 4.30 u/s — the design walk speed |
| Hold **Shift+W** | 6.60 u/s — the design sprint speed, and faster than walking |
| Stamina | Drains while sprinting |
| Release | Speed returns to 0.00; no action left stuck down |
| Hold **A** | Strafes sideways (9.07 units sideways, 0.00 forward) |
| **E** at the door panel | Opens the readable |
| **Esc** | Closes the readable, then pauses from exploration |
| **↓ / Enter** in the pause menu | Navigates to the journal |
| **Esc** from the journal | Back to pause; **Enter** resumes to play |
| **Tab** from play | Opens the clue journal; **Esc** returns |
| **E** at the safe | Opens the device panel |
| **Enter** / **D** / **Enter** in the panel | Actuates the first switch, moves the selection, actuates the second |
| **R** | Resets the counter |
| **Esc** | Steps back out; control restored; no key left stuck |

### Route 14 — Chase balance

| Check | Result |
|---|---|
| Walking is faster than the demon chases | 4.3 vs 4.1 u/s |
| …but only marginally | margin **0.20 u/s (4.9%)** |
| Sprinting opens the gap decisively | margin 2.50 u/s |
| Walking away from a live chase gains ground | 2.66 → **4.10** units over a 33-unit corridor |
| Sprinting gains much more | walk +1.44, sprint **+11.92** over the same stretch |
| Survived both | 0 deaths |
| A player who does **not** react still gets caught | ✓ — stood still beside a chasing demon and died |

### Route 13 — Hiding

Took the diamond, triggered the reveal for real, broke east to the maze sump
and got into the crate before it arrived. Then sat there while it hunted:

| Check | Result |
|---|---|
| Reached the hiding place alive | phase `play`, 0 deaths |
| Player hidden | ✓ |
| Hiding does **not** suspend the demon | `suspended: false` throughout |
| Still normal play, not a menu or puzzle mode | phase `play` |
| It came looking while we were hidden | closest **10.05 units** — it homes on where it last perceived the player, not where they are |
| It never caught the player | 0 deaths over 30 simulated seconds |
| It was never suspended at any point | ✓ |
| It lost the trail and gave up | `chase` → `patrol` |
| Climbing out restores control on a walkable floor cell | ✓, region `maze`, and the player can walk again |
| It can detect the player again once out of cover | `patrol` → `chase` |

### Route 11 — Audio

The AudioContext reaches `running`, all 22 one-shots fire flat and positional
(44 invocations), and the continuous sources — drone, machinery hum, demon
growl, heartbeat — plus the HRTF listener update all run clean. Zero failures,
zero console errors. See §6 for what this does not prove.

### Route 10 — Release audit

224 meshes, 19,317 triangles, 86 distinct textures bound, 36 baked lights, 33
fixtures, 56 collision volumes, internal buffer 358×224. Zero untextured
meshes, zero materials from outside the project shader, zero unnamed textures,
and every named texture generator confirmed bound to live geometry. Full detail
in `ASSET_MANIFEST.md` §5.

---

## 3. Performance

Measured in the generator hall — the most expensive viewpoint — with the demon
live, under **software** rendering (SwiftShader), which is a worst case:

| Measure | Median | p95 | Max |
|---|---|---|---|
| Simulation only | 0.1 ms | 0.7 ms | 5.9 ms |
| Simulation + render | 1.2 ms | 6.4 ms | 13 ms |

Load, including generating every texture, building and merging all geometry and
baking 36 lights with line-of-sight occlusion: **330 ms**. Comfortably 60 fps
in software; untested on real GPU hardware, where it should be irrelevant.

---

## 4. Defects found during testing and fixed

All of these were found by the automated routes or by looking at the generated
screenshots, and all are fixed in this build.

1. **Every merged world surface was wound backwards.** Floors, walls and
   ceilings were all back-facing and therefore culled: the first screenshots
   showed props and signs floating in a void. The corner-order convention and
   the face-normal cross product disagreed with the triangle winding. This also
   zeroed all floor lighting, because the normals pointed down.
2. **Colour-space mismatch.** Textures were tagged sRGB, so the hardware
   linearised them on read, but the custom shader never re-encoded on write —
   everything rendered at roughly gamma-squared darkness. The whole pipeline is
   now gamma space end to end, which is also what the hardware being imitated
   did.
3. **All three puzzle faces were buried inside their housings.** The safe, the
   breaker cabinet and the door lock rendered as blank boxes. The labelled
   panel is now the device's door, which is both correct and better: the player
   reads `TARGET 8` and the switch modifiers off the closed safe.
4. **The demon was invisible.** Its face and eye quads were rotated 180° away
   from its facing, because the yaw convention had been copied from the camera
   (which looks down −Z). Its skin was also near-black, so the silhouette did
   not read against an unlit corridor.
5. **The front doorway was permanently unnavigable.** The closed door's
   collision box nav-blocked the doorway cells at load time, so A* could never
   route through the door even after it opened. Nav marking now re-runs when
   the door state changes.
6. **Path smoothing cut through furniture.** String-pulled straight lines were
   only tested against cells, so the vault pedestal — which straddles a cell
   boundary and blocks no cell centre — stopped bodies dead while the path
   insisted it was clear. Smoothing now tests the body width along the segment.
7. **The open safe stole focus from the key inside it.** Standing at the open
   safe focused the safe ("already open") instead of the key, so the player
   could not take the key without stepping aside.
8. **Delayed puzzle-success callbacks were not cancelled.** A pending success
   timer survived the panel closing, so a success could land on a later run.
9. Wall textures banded at an arbitrary mid-wall height; walls now take a whole
   number of vertical repeats so dados and riveted plates align.
10. The diamond's halo was a flat square; it is now a stepped radial glow.
11a. **Strafing was mirrored** — A and D transposed, because the right vector
    was built as `(cos, -sin)` instead of `cross(forward, up)`. Shipped past 12
    automated routes because the only strafe assertion checked that the player
    moved sideways, not which way. Found by a human on first play.
11. The first reveal was two dim pixels at 36 units through heavy fog. The
    demon now appears at 24 units, in front of a dedicated light fixture at the
    tunnel's end, with lifted self-illumination for that state only.
12. **Player movement speed was frame-rate dependent, and sprinting stopped
    working on a slow machine.** The impulse-and-friction velocity model
    settled at an equilibrium *below* the speed cap, and that equilibrium moved
    with the frame rate: 4.16 u/s at 60 fps, 3.47 u/s at 27 fps, with Shift
    making no difference at all at the lower rate because the equilibrium was
    under both caps. The demon steps by `speed * dt` and is frame-rate
    independent, so this made the chase progressively less winnable the slower
    the machine — and completely unwinnable on a bad one. Velocity now
    approaches its target exponentially, which is frame-rate independent and
    actually reaches the cap: measured 4.30 and 6.60 u/s. Found only by route
    12, because every other route moves the player with a scripted walker that
    never touches the velocity model.

---

## 5. Known behaviour worth noting

Not defects — design consequences the brief implies — but a human should
confirm they feel right.

- **One checkpoint, exactly as specified.** It is taken the instant the diamond
  is lifted. If the player fetches the gun *after* the diamond and then dies,
  the checkpoint predates the pickup and they lose the gun — it is back on its
  crate in the secret store and must be re-fetched. Spec-conformant, possibly
  frustrating.
- **The demon can walk through the false wall.** Deliberate: the secret store
  is not a safe camping spot, and a thing that knocks from inside the walls
  should not be stopped by a fake one. It still blocks line of sight both ways,
  so you cannot shoot through it either.
- **Reacting is what saves you.** The demon chases at 4.1 u/s, walking is 4.3
  and sprinting is 6.6. So a player who notices it and simply moves away gains
  about 0.2 u/s - measured as 1.4 units over a 33-unit corridor, which is slow
  enough that they have to keep going and fast enough that reacting is what
  matters. Sprinting is decisive: 11.9 units over the same stretch. Standing
  still still gets you killed, and route 14 asserts that too.

  This was changed after the first human playtest. The demon used to chase at
  5.0 u/s, *faster* than walking, so the only escape was precise sprint-stamina
  management and the chase punished players who did the right thing a beat too
  slowly rather than players who did the wrong thing.

  Breaking line of sight is still the better tool and still works the same way:
  the demon holds a last known position for 5 s, searches for 13 s, then
  returns to patrol. Hiding places remove you from its senses entirely.

- **Readables are not a safe haven,** per the brief's "normal exploration
  rules". The world keeps running while a document is open; it auto-closes with
  a warning if the demon gets within 13 units.
- **`window.__BB` is present in the release build.** It is a function table
  over existing public methods that the test suite drives. It draws nothing and
  changes no behaviour, but it would let a curious player read the door code
  from the console. Removing it behind a build flag is a one-line change if that
  matters.

---

## 6. Unverified — read this before calling it done

**No human playtest was run. No tester was available in this environment.** The
brief asks for a first-time human playtest and that has not happened, so the
things a human playtest exists to catch have not been caught:

- **Where a first-time player gets lost.** The maze has signed route markers,
  four landmarks and a floor plan that deliberately stops at the workshop, and
  the automated routes prove everything is reachable — but reachable is not the
  same as findable.
- **Whether any clue is misread.** The curated alphabet excludes I, O, Q and Z
  for exactly this reason, and the blood letters render with jitter and warp
  disabled, but nobody has actually tried to read one under pressure.
- **Whether the demon ever feels like it caught them unfairly.** The grace
  period, the suspension rules and the escape loops are all in place and
  tested mechanically. "Fair" is a judgement no automated check makes.
- **Whether the session lands in 15–25 minutes.** See route 9.

Also unverified:

- **The audio has never been heard.** Headless runs keep the audio context
  suspended and the one-shots are dropped, so every sound in
  `ASSET_MANIFEST.md` §4 is verified only as code that constructs a valid
  WebAudio graph. The footsteps, the wall knocks and the directional demon
  growl are load-bearing for gameplay — players are supposed to judge distance
  by ear — and none of it has been listened to.
- **Motion.** Screenshots cannot show the vertex jitter or the affine texture
  swim under camera movement, the demon's run cycle, the light flicker rates,
  or the death and ending fades. All verified as stills only.
- **Real GPU hardware.** All rendering was software.
- **Mouse-capture recovery after a browser-enforced pointer-lock cooldown.**
  The code handles the failure path — it shows "Click to take the mouse back"
  and re-requests on the next click — but headless cannot exercise the real
  cooldown.
- **Any browser other than Chromium.** No Firefox or Safari run.
