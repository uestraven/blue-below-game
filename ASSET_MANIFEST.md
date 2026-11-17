# BLUE BELOW — Asset Manifest

Shared manifest between the art/audio side and the engine side. Every row is
something the release build actually loads.

## 1. Handoff status — read this first

**No art or audio handoff was provided for this build.** There was no art agent
output, no texture set, no demon model, no ending art and no audio files
available at any point. That is a gap in the brief's division of labour, not a
scheduling slip I can wait out, so rather than ship an unplayable shell I
authored a complete asset set myself, procedurally, and that set is what ships.

Two consequences, stated plainly:

- **Nothing in this build is "approved" by an art owner**, because there is no
  art owner. Every row below is marked `AUTHORED-BY-ENGINE`. If an art handoff
  arrives, §6 lists exactly what to replace and with what, and the engine side
  is already structured so each replacement is a one-line swap in
  `src/world/textures.ts` or `src/core/audio.ts`.
- **There are no placeholders in the release build.** Everything is finished to
  its intended quality for the period being imitated, not blocked out. The
  placeholder audit is in §5 and it comes back clean. Temporary development
  geometry was used during layout work and none of it survives: §5 lists how
  that was checked.

Everything is generated at runtime from code. There are no binary asset files
in the repository or the build output at all — `dist/` contains one HTML file,
one CSS file and one JS bundle, nothing else. Each asset is produced from a
fixed seed derived from its own name, so the same name always yields the same
pixels and every screenshot in `test/` is reproducible.

## 2. Conventions

| Property | Convention |
|---|---|
| World unit | 1 unit ≈ 1 metre. Grid cell = 3 units. |
| Up axis | +Y. Facing for characters and props = local +Z. |
| Surface texture size | 32–64 px, nearest-neighbour magnification, nearest-mip minification |
| Readable texture size | 128–256 px (signs, puzzle faces, decals) |
| Colour space | Gamma space throughout, no linearisation. Palette: `src/world/palette.ts` (18 colours) |
| Pivot — wall plates | Centre of the quad, normal facing into the room |
| Pivot — props | Geometric centre of the box; floor props sit with their base at the floor height |
| Pivot — character limbs | Joint at local Y=0, geometry hanging below, so mesh rotation is the joint |
| Texture wrap | Repeat for surfaces, clamp for signs/decals/faces |

## 3. Visual assets

All generators live in `src/world/textures.ts` unless noted. "Name" is the
cache key, which is also the three.js `Texture.name` in the running build.

### 3.1 Facility surfaces — 14 assets

| Name | Size | Used on | Approval |
|---|---|---|---|
| `surf.floor.concrete` | 64² | Maze, corridors, workshop floors | AUTHORED-BY-ENGINE |
| `surf.floor.tile` | 64² | Records, vestibule, vault approach | AUTHORED-BY-ENGINE |
| `surf.floor.grate` | 64² | Generator hall, secret store, shaft head | AUTHORED-BY-ENGINE |
| `surf.floor.vault` | 64² | Vault chamber | AUTHORED-BY-ENGINE |
| `surf.floor.lobby` | 64² | Reception | AUTHORED-BY-ENGINE |
| `surf.wall.concrete` | 64² | Maze and corridor walls | AUTHORED-BY-ENGINE |
| `surf.wall.painted` | 64² | Lobby, records, workshop (green dado) | AUTHORED-BY-ENGINE |
| `surf.wall.tile` | 64² | Vestibule | AUTHORED-BY-ENGINE |
| `surf.wall.rust` | 64² | Generator hall, secret store | AUTHORED-BY-ENGINE |
| `surf.wall.seam` | 64² | **The false wall only.** Carries the full-height seam tell | AUTHORED-BY-ENGINE |
| `surf.wall.vault` | 64² | Vault chamber and approach | AUTHORED-BY-ENGINE |
| `surf.ceil.panel` | 64² | Finished rooms | AUTHORED-BY-ENGINE |
| `surf.ceil.concrete` | 64² | Service areas, with conduit run | AUTHORED-BY-ENGINE |
| `surf.metal.dark` | 64² | Door leaves, housings, frames | AUTHORED-BY-ENGINE |

### 3.2 Props — 6 assets

| Name | Size | Used on | Approval |
|---|---|---|---|
| `surf.metal.machine` | 64² | Generator plant, pump, turbine housings | AUTHORED-BY-ENGINE |
| `surf.prop.crate` | 64² | Crates, debris | AUTHORED-BY-ENGINE |
| `surf.prop.locker` | 64² | Locker banks, filing cabinets, shelving | AUTHORED-BY-ENGINE |
| `surf.prop.desk` | 64² | Benches, desks, counters, lectern | AUTHORED-BY-ENGINE |
| `surf.prop.pipe` | 32² | Pipes, conduit, stacks (shaded cylinder strip) | AUTHORED-BY-ENGINE |
| `surf.prop.gunmetal`, `surf.prop.gungrip` | 32² | The gun, world and first-person | AUTHORED-BY-ENGINE |

Demon textures, both 64², both AUTHORED-BY-ENGINE:

| Name | Notes |
|---|---|
| `surf.demon.skin` | Dark mass with drum-tight bone showing through in patches and lengthwise sinew. A uniformly pale skin reads as a statue and a uniformly black one reads as a hole in the screen; this reads as a body |
| `surf.demon.face` | Built from absence: two oversized sunken sockets under a pale brow ridge, and a vertical split mouth with irregular teeth. Legible as wrong at eight pixels tall |

### 3.3 Blood-letter decals — composed per run

| Name | Size | Notes | Approval |
|---|---|---|---|
| `decal.blood.<numeral>.<letter>` | 128×256 | **Individual per-letter decals**, so the engine composes each run's four clues dynamically. Letter on top, Roman numeral below a separator bar, paint halo and drips. Alpha-tested at 0.45. Rendered with jitter and affine warp **off**. | AUTHORED-BY-ENGINE |
| `decal.scratch` | 64² | Tally marks + blood slash beside the false-wall seam | AUTHORED-BY-ENGINE |

The letter glyphs are hand-authored stroke polylines in
`src/world/strokefont.ts`, not a system font, so clue legibility does not
depend on the player's installed fonts. Curated alphabet:
`ABCDEFGHJKLMNPRSTUVWXY` — 22 letters, excluding I, O, Q and Z because at
224-line internal resolution in dripping paint they read as 1, 0, 0 and 2.

### 3.4 Puzzle faces — 3 assets

| Name | Size | Notes | Approval |
|---|---|---|---|
| `face.safe` | 256² | Counter safe door: TOTAL window, TARGET 8 plate, three toggles labelled +4 / −3 / +7 | AUTHORED-BY-ENGINE |
| `face.breaker` | 256² | Breaker cabinet: A1 B2 C3 D4, sequence row, KEYED ACCESS ONLY | AUTHORED-BY-ENGINE |
| `face.lock` | 256² | Exit door control: powered-latch lamp, four wheels numbered I–IV | AUTHORED-BY-ENGINE |

All three are rendered with jitter and affine warp **off** so the labels stay
legible. The face texture *is* the device door in each case: it is hidden when
the device opens, revealing the interior.

### 3.5 Signs and readables — 22 assets

`sign.*`, 256×128 or 256×256, plate styles `metal` / `paper` / `painted`.
Wayfinding (`lobby-dir`, `to-generator`, `to-records`, `to-tunnels`,
`corrA-sign`, `corrB-sign`, `corr-a2`, `t-vault`, `t-vault2`, `t-pump`,
`tunnel-mouth`, `sump`, `exit`, `records-sign`, `workshop-sign`,
`breaker-sign`, `safe-sign`, `plant-sign`, `vault-sign`, `vault-plate`,
`seam-note`), documents (`floorplan`, `memo`, `secret-note`,
`vault-note-prop`) and the generated `sign.diagram.<order>` which is repainted
per run to match that run's breaker order. All AUTHORED-BY-ENGINE, all with
jitter and affine warp off.

### 3.6 Lights, glows and flats

| Name | Notes |
|---|---|
| `surf.lamp.<hex>` | 32², one per distinct fixture colour (20 in use). Emissive quads at the light positions |
| `glow.<hex>` | 64², stepped radial falloff with alpha. Diamond halo and gun glint |
| `flat.<name>` | 8², solid palette colours for untextured low-poly parts |

### 3.7 Characters and hero props

| Asset | Build | Pivot / scale | Approval |
|---|---|---|---|
| **Demon** (`src/game/demon.ts`) | 2.55 units. Tapered 5-sided solids rather than plain boxes: forward-pitched torso with four rib slats, long neck, tapered skull with a hinged jaw, segmented legs (thigh + shin + foot) with backward-bending knees, segmented arms (upper + forearm + long hand) reaching below the knee, face quad and two emissive eye quads. `surf.demon.skin`, `surf.demon.face` | Group origin at the feet, local +Z = facing. Every limb segment pivots at its joint; forearms and shins are children of the upper segments | AUTHORED-BY-ENGINE |
| **Diamond** | Scaled octahedron + billboarded `glow` quad, emissive 1.5, slow Y rotation | Centre of the stone | AUTHORED-BY-ENGINE |
| **Gun (world)** | 4 boxes + billboarded glint quad | Centre of the cylinder | AUTHORED-BY-ENGINE |
| **Gun (first person)** | 4 boxes + muzzle-flash quad, rendered in a separate overlay pass with depth cleared so it never clips walls | Grip, offset (0.11, −0.085, −0.26) from the eye | AUTHORED-BY-ENGINE |
| **Front door** | 2 sliding leaves + frame + EXIT sign | Leaves slide ±2.9 units on X when unlocked | AUTHORED-BY-ENGINE |

**Demon animation names** (procedural, driven by distance travelled and state —
no clips, no skinning):

| Name | Trigger | Description |
|---|---|---|
| `idle` | `patrol` at rest | Minimal arm sway, slight forward lean |
| `walk` | `patrol`, `investigate`, `search` | ±0.42 rad leg swing, knees bending backwards, counter-swinging arms. The two legs are 0.86π out of phase rather than exactly opposed, so the gait limps |
| `run` | `chase` | ±0.95 rad leg swing, 0.42 rad forward pitch, arms low and reaching rather than pumping, jaw part open, eyes brighten, uneven vertical lurch |
| `twitch` | all states, overlaid | Head snaps to a random offset at irregular intervals (0.25-0.75 s while chasing, 1.2-3.8 s otherwise) and decays. Overlays whatever else is playing |
| `stand` | `reveal` | Dead still except head tracking; body self-illumination lifted to 0.5 so the first sighting survives the fog |
| `attack` | `attack` | Both arms thrown forward and splayed, forearms opening, torso pitched hard over, jaw wide, 0.42 s windup |
| `death` | `dead` | Falls forward over 1.5 s, then fades over 0.9 s, hidden at 2.4 s |

### 3.8 Ending stills — 3 assets

`src/ui/endingart.ts`, 320×200, drawn from the same palette and passed through
an ordered-dither and 5-bit quantisation pass so they match the game's banding.

| Asset | Content | Approval |
|---|---|---|
| `ending.ugly` | Vault interior, the diamond still lit on its pedestal, shutters closing, the player walking out empty-handed | AUTHORED-BY-ENGINE |
| `ending.bad` | Night exterior, lit city on the horizon, the player with the stone, the demon out on open ground behind them | AUTHORED-BY-ENGINE |
| `ending.good` | Dawn exterior, the facility dark and shut, the player with the stone, nothing behind them | AUTHORED-BY-ENGINE |

## 4. Audio

All synthesised at runtime in `src/core/audio.ts` from oscillators and one
procedurally generated noise buffer. No files. Spatial sources use `PannerNode`
with HRTF; the listener tracks the camera.

| Name | Type | Synthesis | Approval |
|---|---|---|---|
| `ambient.drone` | Loop | 3 detuned saws → steep lowpass with a 0.07 Hz LFO | AUTHORED-BY-ENGINE |
| `ambient.hum` | Loop, positional | Noise → bandpass 120 Hz + 60 Hz triangle, placed in the generator hall; louder once power is restored | AUTHORED-BY-ENGINE |
| `demon.growl` | Loop, positional | Noise at 0.55× rate + 47 Hz saw → resonant lowpass swept by agitation | AUTHORED-BY-ENGINE |
| `player.heartbeat` | Loop | Two sine thumps per beat, 62–134 BPM by proximity and chase state | AUTHORED-BY-ENGINE |
| `step_concrete` / `step_metal` / `step_tile` | One-shot | Filtered noise bursts, per-region surface, louder when sprinting | AUTHORED-BY-ENGINE |
| `draught` | One-shot, positional | Air pulling through a gap in masonry, played near the false wall every 3-6 s. The only audible cue that the wall is not a wall — it replaced a sign that gave the secret away | AUTHORED-BY-ENGINE |
| `knock` | One-shot, positional | Low sine thump + noise, doubled. Placed **inside a wall near the player** — the note's "something knocked from inside the walls". Every 20–42 s before the diamond, 6–14 s after it | AUTHORED-BY-ENGINE |
| `relay`, `clunk`, `latch` | One-shot | Switch and solenoid transients for the three devices | AUTHORED-BY-ENGINE |
| `denied`, `accept`, `beep`, `switch` | One-shot | Device and interface feedback | AUTHORED-BY-ENGINE |
| `pickup`, `shimmer` | One-shot | Item collection; the diamond's bell cluster | AUTHORED-BY-ENGINE |
| `gunshot`, `dryfire` | One-shot | Noise crack + low boom; dry hammer click | AUTHORED-BY-ENGINE |
| `roar`, `scream`, `hit`, `demon_die` | One-shot, positional | Demon spotting, reveal, impact, and a 2.4 s death descent | AUTHORED-BY-ENGINE |
| `rumble`, `drip`, `rat` | One-shot | Building stingers and tunnel detail | AUTHORED-BY-ENGINE |

## 5. Release audit — placeholders and unapproved assets

Performed against the `dist/` build used for the acceptance run.

| Check | Result |
|---|---|
| Binary asset files in `dist/` | **None.** `dist/` = `index.html`, one `.css`, one `.js` |
| External asset fetches at runtime | **None.** No `fetch`, no loaders, no CDN references |
| Texture generators reachable but unused | **None.** All 27 statically named generators in §3, plus every run-generated family (`decal.blood.*`, `sign.*`, `sign.diagram.*`, `surf.lamp.*`, `glow.*`, `flat.*`), were observed bound to live geometry. Verified by walking both scene graphs — see route 10 of `npm test` |
| Temporary development geometry | **None in the release.** Layout and collision were developed against the same grid data that ships; the only debug affordances are `window.__BB` (a function table over existing public methods, used by the tests) and a render/audio fast-forward toggle used by the tests. Neither draws anything |
| Untextured or default-material meshes | **None.** All 224 meshes use the project's own shader with an explicit `map`: 0 untextured, 0 foreign materials, 0 unnamed textures |
| Unapproved third-party assets | **None.** No fonts, images, models or sounds are shipped. Sign body text uses the player's monospace font; the clue letters do not depend on any font |
| Assets with no art owner | **All of them** — see §1. This is the one audit finding, and it is a process gap, not a defect in the build |

Build inventory, as measured by route 10: **224 meshes, 19,317 triangles, 86
distinct textures bound, 36 baked lights, 33 visible fixtures, 56 collision
volumes, 13 regions.** Internal render buffer is 224 lines tall with the width
following the window aspect (358×224 at 16:10, 398×224 at 16:9).

This audit is a test, not a claim: `npm test` route 10 re-runs all of it and
fails the build if a mesh ever ships untextured, a material ever comes from
outside the project's own shader, or a named generator stops being used.

## 6. Requests for the art and audio handoff

Specific, per asset, with the reproducible screenshot that shows the current
state. Screenshots regenerate with `node test/vantages.mjs` and
`node test/ui-shots.mjs`.

| Priority | Asset | Request | Current state shown in |
|---|---|---|---|
| High | **Demon model** | A low-poly stalker, ≤400 triangles, 2.4 units tall, origin at the feet, local +Z forward, with the six animation states in §3.7. Must read as a silhouette with two bright eye points at 24 units through heavy fog — that is the reveal shot and it is the single most important asset in the game. | `test/vantages/demon-reveal-far.png`, `demon-close.png`, `demon-mid.png`, `demon-lit.png` |
| High | **Ending stills** | Three 320×200 stills, this palette, matching the three texts in `src/ui/screens.ts`. The demon's fate must be unambiguous in each. | `test/ui/22-ending-ugly.png`, `23-ending-bad.png`, `24-ending-good.png` |
| Medium | **Facility surface set** | 14 tiling textures per §3.1, 64², this palette. Walls get a whole number of vertical repeats per wall, so keep any dado or plate detail aligned to the texture's own bottom edge. | `test/vantages/lobby-wide.png`, `generator-wide.png`, `workshop-wide.png`, `maze-dark.png`, `vault-diamond.png` |
| Medium | **Blood letters** | 22 individual 128×256 alpha decals, one per curated letter, plus 4 numeral plates — **individual, not composed strings**, because the engine assembles each run's four clues at load time. | `test/vantages/clue-III.png`, `clue-IV.png` |
| Medium | **Puzzle faces** | Three 256² device fronts per §3.4. They double as the device doors, so the whole plate must read as a closed door. | `test/vantages/counter-safe.png`, `breaker-cabinet.png`, `door-lock-panel.png` |
| Medium | **Audio pass** | Replace the synthesis in §4 with recorded material if desired. The wall `knock` and the directional `demon.growl` are load-bearing for gameplay, not decoration: players judge distance from them. | — (listen in-game) |
| Low | **Diamond and gun** | Hero props, ≤120 triangles each. The diamond needs to be identifiable as a light source from 40 units down the vault. | `test/vantages/vault-diamond.png`, `secret-room.png` |
| Low | **Environment props** | Crates, lockers, benches, pipes, machinery. Collision is defined by axis-aligned boxes in `src/world/props.ts` and is independent of the visual mesh, so art can be swapped without re-testing collision. | `test/vantages/records.png`, `tunnel-mouth.png`, `pump-chamber.png` |

## 7. Scenes still needing visual verification by a human

Automated screenshots exist for all of these; none has been looked at by a
person other than the agent that produced it.

- All 20 facility vantages in `test/vantages/`
- All 4 demon vantages, especially the first reveal at 24 units
- All 24 interface states in `test/ui/`
- Motion, which screenshots cannot show at all: the vertex jitter and affine
  texture swim under camera movement, the demon's run cycle, the light
  flicker rates, and the death and ending fades
