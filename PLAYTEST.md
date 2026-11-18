# BLUE BELOW — Playtest Report

Build under test: the production build in `dist/`, served over loopback and
driven in headless Chromium 159 (SwiftShader software GL).

Reproduce everything here with:

```bash
npm test                 # 19 routes, 521 checks
node test/vantages.mjs   # 24 in-world screenshots
node test/ui-shots.mjs   # 24 interface screenshots
```

---

## 1. Result summary

**521 / 521 checks passed across 19 routes. All three endings verified.**

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
| 15 | Flares: four shots, spent correctly, and they light the place | ✓ |
| 16 | Flare hit: 60 active seconds, paused by panels, Bad Ending while absent | ✓ |
| 17 | Two keys, two locks, and the cross collected exactly once | ✓ |
| 18 | The ritual kills permanently from every demon state | ✓ |
| 19 | Hunting: sight-only detection, patrol, pursuit, lost sight | ✓ |

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

### "I didn't know there was a sprint" — a discoverability defect

Reported after the balance change above, and the more important finding of the
two. Sprint was listed on the controls screen and nowhere else, and the stamina
bar — the only in-world advertisement for it — was configured to appear *only*
while sprinting or recovering. A player who never guessed the mechanic existed
was therefore never told, which is a UI hiding a mechanic behind itself.

Fixed on four surfaces:

- the stamina bar is now **always** visible during play, labelled `SHIFT RUN`
- the briefing screen lists the four verbs before the player is ever in danger
- the opening toast in the lobby says to hold Shift, and repeats on a timer
  until the player actually sprints, then stops permanently
- the demon reveal and its first sighting of the player both say
  `HOLD SHIFT TO RUN` instead of their usual line, until sprint has been used

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

## 1b. Feature round: flare gun, two keys, and the ritual

The special gun was replaced wholesale. What changed, and what it cost:

- **The flare gun** replaces the revolver, in the records annex emergency
  station, loaded with one flare, with three more cartridges placed around the
  facility. Flares are real projectiles that travel, fall and burn on the floor
  for ~20 s, occupying one of **three dynamic light slots** added to the world
  shader — the facility's own lighting is baked into vertex colours at load
  time, so a thrown light source could not be one of those.
- **The facility was darkened** (light gain 2.6 → 2.25, ambient 2.2 → 1.75,
  handlamp range 19 → 17) so a cartridge is worth spending. Route 15 pins both
  ends of that: dark enough to matter, not so dark it cannot be navigated.
- **A flare hit is temporary.** Sixty seconds of *active* gameplay, with the
  clock stopped by pausing and by any device panel. Permanent death is the
  ritual and only the ritual, which is what keeps the Bad Ending reachable
  while the demon is merely absent.
- **The ritual chain** is brass key → personal box → crucifix → pentagram. The
  gun pickup in the sealed store became the seal itself.
- **Clue chain**, so the ritual is discoverable rather than arbitrary: the
  records memo points at a sealed store off the tunnels, says the floor in
  there needs *something consecrated*, names Harding's box and where he used to
  wash his hands, and ends with *"a flare will only ever buy you a minute."*
  The note pinned in the sealed store explains the seal is a grave waiting for
  a headstone.

### Defects found while building it

1. **A judged hit always missed.** The flare was ballistic, so a confirmed hit
   fired down a 24-unit corridor dropped ~6 units and buried itself in the
   floor before reaching the demon. A shot already judged a hit at the trigger
   now flies true and tracks its target; only unaimed flares arc.
2. **Path smoothing cut straight through the false wall.** The false wall is
   deliberately walkable, so the string-puller treated it as open space and
   straightened corridor routes into diagonals that clipped through it and
   dumped the body in the dead-end sealed store, where it then wedged against
   a wall and could never leave. Smoothing now treats the false wall as solid
   while A* can still step onto it on purpose.
3. **A wedged body could never free itself.** `moveDisc` now pushes out of
   geometry before attempting to move, which also covers a player caught by a
   blocker that changes under them.
4. **The first-person pistol was enormous**, filling a quarter of the screen
   and reading as a crate. Scaled to 0.46 and the body texture retoned from
   speckled orange to blued steel with an orange band.
5. **A dead texture generator survived the refactor** (`surf.prop.gunmetal`).
   Route 10's release audit failed the build until it was removed — which is
   exactly what that audit is for.

---

## 1c. Feature round: the hunting system

The demon's senses and state machine were rewritten.

- **Sight is now its only sense.** The hearing model is gone entirely: sprinting
  no longer draws it, and nothing hands it a live player position. Detection is
  a configurable cone, a max range, and a **true 3D ray** — the old check only
  consulted the cell grid, so it could see straight through a workbench or the
  closed front door. It now tests the blocker boxes in 3D as well, and checks
  three heights up the player's body rather than one centre-of-mass point.
- **Patrol is a graph**, not a ring: 32 nodes across halls, intersections and
  rooms, with real adjacency, chosen by weight on time-since-visited, with
  dwell-and-turn at junctions. It keeps looking while it dwells.
- **`investigate` and `search` are gone**, replaced by a single `lostSight`
  state with the five-second clock the brief specifies. Giving up does not
  require reaching the last seen position.
- **Patrol randomness is seeded from the run seed**, so a given run hunts the
  same way every time and a failing route can be replayed. It was
  `Math.random()`, which made route 19 report different failures on consecutive
  runs — unusable as a regression test.
- **Dev-only visualisation** (F3): sight cone, per-body-point rays coloured by
  blocked/out-of-cone/clear, last seen marker, patrol destination, the whole
  patrol graph, and a readout of state and the lost-sight timer. Loaded through
  a dynamic import behind the build flag, so the release contains neither the
  module nor an extra chunk — the release gate asserts both.

### Defects found while building it

0. **The sealed store was open on one whole side.** Reported by the playtester.
   The room was carved at `gz 5..7` and the south-east tunnel runs `gz 8..9`
   across `gx 16..25`, so the two were adjacent with no wall row between them
   and the room's entire south face opened into the corridor — the "hidden"
   room was a wide alcove, and the false wall was decoration. Moved to
   `gz 4..6` so `gz 7` stays solid. Route 8 now walks the room's whole
   perimeter and asserts there is exactly one opening and that it is the false
   wall, so this cannot regress silently.

1. **My own release-gate check produced a false positive.** The asset audit has
   to skip the debug group, which put the literal `ai-debug` in the release
   bundle and tripped the check looking for it. Narrowed to strings that exist
   only inside the dev module.
2. **Two test-staging bugs of my own**, both worth recording because both
   produced plausible-looking failures: the scripted walker was being killed
   mid-way through a long collection walk by a live patrol, so every later
   assertion ran in the death phase; and the demon's facing drifted onto the
   player between sampling steps, so a "cannot see behind itself" check failed
   for the wrong reason.
3. **Pause-clock measurements were off by a frame or two** in two routes,
   because they sampled before the pause took effect. Both now measure strictly
   from inside the paused state.

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
| **The sealed store is enclosed on all four sides** | exactly **one** opening, and it is the false wall at (18, 6); all 12 room cells walkable |
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

### Route 15 — Flares and illumination

| Check | Result |
|---|---|
| A loose flare can be picked up before the pistol | ✓, and firing does nothing without it |
| The pistol is found loaded | 1 in it, 2 in hand after one loose cartridge |
| Four flares total per run | ✓ (1 loaded + 3 placed) |
| A collected flare stays collected | gone from the world; re-using adds nothing |
| The dark corridor is dark | ambient light **0.161** |
| …but navigable | above the 0.02 floor |
| A flare floods where it lands | **0.316 → 1.772** at the landing point (5.6×) |
| …and the player sees further for it | 0.161 → 0.222 back at the firing position |
| All four can be spent, then it dry-fires | ✓ |
| Simultaneous burning flares capped at the shader slot count | 3 |

### Route 16 — A flare in the demon

| Check | Result |
|---|---|
| The hit suppresses it | ✓ |
| Suppression starts at the full budget | **60.0 s** |
| It is still **alive** — a flare is not a kill | ✓ |
| It burns, then leaves the board | `burning` → `absent` |
| An absent demon cannot catch the player | 0 deaths |
| **A device panel pauses the return clock** | 39.60 → 39.60 over 10 simulated seconds behind the safe panel |
| **Pausing the game pauses the return clock** | unchanged over 10 simulated seconds |
| Ordinary play does spend it | 39.45 → 37.35 over 2 s |
| It returns away from the player | **116 units**, and with **no line of sight** |
| The clock is cleared on return, and it hunts again | ✓ |
| Escaping while it is merely absent | **BAD ending**, with 9.0 s still on its clock |

### Route 17 — Two keys, two locks

| Check | Result |
|---|---|
| The personal box exists from the start and reports itself locked | ✓ |
| Inspecting it without the key gives a readable, and it does not open | ✓ |
| The cross is not offered before the box is open | ✓ |
| The **brass** key does not open the breaker cabinet | ✓, and the cabinet names the steel key |
| The brass key **does** open the personal box | ✓ |
| The **steel** key opens the breaker cabinet | ✓ |
| The cross can be collected exactly once | gone from the world; re-using does nothing |
| Both keys and the cross survive the checkpoint | ✓ |

### Route 19 — The hunting system

All nine required scenarios, plus the configuration and the patrol itself.
FOV 110°, range 34, body points at 1.55 / 1.0 / 0.35 above the floor.

| Scenario | Result |
|---|---|
| Field of view, range and body points are configurable | ✓, read from `DEMON_SIGHT` |
| It starts on patrol knowing nothing about the player | ✓ |
| It explores | reached **3+ distinct patrol destinations** over 80 simulated seconds without ever seeing the player |
| **Exit hiding with no line of sight** | never chases over 5 s; still knows nothing |
| **Exit hiding directly behind it**, outside its cone | not detected across 90 consecutive single-frame checks with its facing held |
| **Enter its unobstructed cone** | detected, chase begins, last seen set |
| A wall between them | not detected |
| **Break sight round a corner** | switches to `lostSight`, destination is where it last *saw* the player |
| **Move elsewhere while concealed** | destination stays at the last observation, not the new position |
| **Unseen for more than five seconds** | gives up → `patrol`, timer peaked at the 5 s threshold, new route seeded near the sighting |
| **Visible again inside five seconds** | resumes the chase and the timer resets to **0** |
| **Use a panel during pursuit** | lost-sight timer **0.000 → 0.000 over 10 simulated seconds**; demon suspended; timer resumes on exit |
| **Banish with a flare** | returns as `patrol` with **no knowledge of the player** |
| **Complete the ritual** | standing in full view of it does nothing; `dead`, no pending return |

### Route 18 — The ritual, from every demon state

| State when the cross goes down | Result |
|---|---|
| **Live hunt** | permanent kill, exactly once; the seal cannot be used again |
| **Absent on a flare budget** (55 s left) | permanent kill, **pending return cancelled**, never comes back over 10 further simulated seconds |
| **Before the diamond is taken** | the seal sits armed (`crossPlaced`, not `ritualDone`); taking the diamond stages the resolution at the reveal, and the run still reaches the **Good Ending** after all three puzzles and the threshold |

### Route 14 — Chase balance

| Check | Result |
|---|---|
| The demon outruns a walking player | 5.0 vs 4.3 u/s |
| A sprinting player outruns the demon | 6.6 vs 5.0 u/s |
| One stamina bar buys enough lead to round a corner | 4.4 s of sprint = **29 units travelled, 7.1 units gained** |
| Stamina refills slower than it drains, so sprint is rationed | drain 0.225/s, regen 0.16/s |
| Walking away **loses** ground | 2.50 → 2.03 units (−0.47) |
| Sprinting away **gains** ground | 2.58 → 10.39 units (+7.81) |
| Sprinting is strictly better than walking under chase | walk −0.47, sprint +7.81 |
| Sprinting + breaking line of sight + getting out of earshot **loses it** | `chase` → `search`, survived |
| A player who does **not** react gets caught | ✓ — stood still beside a chasing demon and died |

Method note: the scripted walker moves at a commanded speed and does not model
stamina drain, so the two speed legs measure the raw difference. The stamina
cost is asserted numerically from the exported constants, and exercised for
real through the keyboard in route 12.

Two assertions in this route failed on first write because the *test* stood
still next to a chasing demon — once to observe its state, once to wait out its
memory. Both were correctly fatal. The route now models the real escape: sprint,
turn corners, keep going until out of earshot, then hold still.

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
  is lifted, and it carries the flare count, which flares have been taken, both
  keys, the cross, whether the cross has been placed, and the demon's remaining
  absence time. Anything collected *after* the diamond is lost on a retry —
  flares included, since they are part of the same progress record.
  Spec-conformant, possibly frustrating.
- **The demon can walk through the false wall.** Deliberate: the secret store
  is not a safe camping spot, and a thing that knocks from inside the walls
  should not be stopped by a fake one. It still blocks line of sight both ways,
  so you cannot shoot through it either.
- **Sprinting is the escape, and stamina is its price.** The demon chases at
  5.0 u/s, walking is 4.3 and sprinting is 6.6. Walking away loses about
  0.7 u/s, so noticing it is not enough on its own: you sprint, round a corner,
  and let it lose you — which is what the 5 s memory and 13 s search are for.
  One full stamina bar is 4.4 s of sprint, 29 units of travel, and 7.1 units
  gained, which is enough to get round a corner and no more. Hiding places
  remove you from its senses entirely.

  This number went back and forth and the history is worth recording. After the
  first playtest it was dropped to 4.1, *below* walking speed, so that simply
  moving away was enough. That was the wrong fix for the right complaint: the
  tester had not escaped because **they never knew sprinting existed**, and the
  one piece of UI that advertises it — the stamina bar — only appeared once you
  were already sprinting. Fixing the discoverability was the real fix; slowing
  the demon below walking pace just made sprint and stamina pointless. Reverted
  to 5.0 with discoverability fixed, on the tester's call.

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
