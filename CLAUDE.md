# Universal Tabletop RPG Tool

A browser-based tool for running any tabletop RPG online with friends. Works on PC and mobile browsers. May become an installable app later (Capacitor for mobile, Tauri or Electron for desktop), so keep the code wrapper-friendly.

## Pitch
A PC- and mobile-friendly take on Tabletop Simulator, built specifically for tabletop RPGs. The key difference: **players are confined to the generated world.** Instead of floating over a sandbox table where anything goes, players are *in* the world, and the world has rules.

## Working rules
- **Write tests first, then implement.** Tests define the behavior; code is written to meet the spec, not shaped to fit tests after the fact.
- Keep game logic (rules engine) completely separate from rendering/UI so it can be tested without graphics.
- Check every feature on a phone-sized screen as it's built, not at the end.
- Never hard-code a single art style; all art goes through style packs (see below).
- Keep a credits file (`CREDITS.md`) for every third-party asset and its license from day one.

## Terminology
- The person running the game is the **DM** (dungeon master). Code always says `dm` (`isDm`, `dmOnly`, `DmVerifiedRoll`, ...).
- The DM can set their own display title in session settings (default "DM"; e.g. "Game Master", "Keeper", "Narrator"). The UI shows that title wherever players see the role (chat, system messages, roll log). It is stored with the session and synced to players on join.

## Tech stack
- **Language:** TypeScript (strict)
- **Dev server / build:** Vite
- **Rendering:** Babylon.js (3D scene used for a 2.5D look)
- **UI layer:** React, for menus, HP bars, ability bars, dice panel, chat log
- **Multiplayer:** Peer-to-peer via WebRTC using PeerJS. The DM's browser hosts and is the source of truth. Free public STUN servers; a free-tier TURN relay for players on strict networks.
- **Storage:** Local only. IndexedDB in the browser, plus Export/Import to files as backup.
- **Tests:** Vitest
- **Folders:** `client/` (rendering + UI), `shared/` (rules engine, game system format, pure logic)

## Architecture decisions
- **One npm package**, two source folders. Client code imports shared code via the `@shared/*` alias; shared code uses relative imports.
- **`shared/` is pure.** It must not import from `client/`, React, Babylon.js, PeerJS, or use browser/Node globals (DOM, `window`, `crypto`, `fs`, timers). Enforced two ways: `tsconfig.shared.json` type-checks it with no DOM or Node types, and `tests/architecture.test.ts` scans its imports. Things like randomness are injected (see `RandomSource`).
- **React and the render loop:** per-frame data (camera, token motion, animation frames, floating damage numbers) lives in Babylon's loop, never in React state. React re-renders only on rules-engine events (hit, heal, turn change, chat message).
- **Grid coordinates:** every grid uses `Cell = { q, r }` behind one `Grid` interface (neighbors, distance, line, range, world conversion).
  - Hex: axial coordinates, **pointy-top**.
  - Square: `q` = column, `r` = row; 8 neighbors, diagonal step costs 1 (Chebyshev distance). Alternate diagonal rules can be added later as a grid option.
  - World plane is x/z (Babylon's y is up / tile height).
- **Dice randomness:** `shared/` rolls through a `RandomSource` interface. The client supplies one built on `crypto.getRandomValues` (unbiased, rejection sampling); tests supply scripted sequences.

### Rules engine modules (`shared/`)
- `formula/` — arithmetic + dice + `@variables` + `floor/ceil/round/min/max/abs`. Used by every number in a system file.
- `system/` — game system format v1 (`types.ts` is the spec), `validateGameSystem` (reports every error with a path like `abilities[2].effects[0].amount`), creature math (level from XP, derived values, max HP, defense, speed). `samples/skirmish.ts` is an original demo system used by tests.
- `map/` — tiles with integer heights, blocked tiles, walls on shared edges, world bounds = the set of tiles.
- `movement/` — `stepCost`, `reachable`, `findPath` (Dijkstra). Step up ≤ `maxStepUp` costs 1; higher needs `climb` (extra cost per level); drops > `maxStepDown` are refused. Allies/downed creatures can be passed but not stopped on; enemies block. Square diagonals can't cut past blocked/missing corner cells or wall ends.
- `combat/` — pure `startCombat` / `applyAction` returning new state + events. One move budget and one action per turn. Attack hits if roll ≥ defense. 0 HP = downed (skipped in turn order until healed). Conditions count down at the end of the affected creature's turn and refresh rather than stack. Combat ends when one side is left standing; player characters on the winning side split the losers' XP evenly (rounded down), with level-ups raising current HP by the max-HP gain.

### Multiplayer (`shared/net/` + `client/net/`)
- `shared/net/` holds all session logic, pure and tested with an in-memory fake network (`testing.ts`) that JSON-encodes messages and can drop, duplicate, reorder, or cut them. `client/net/transport.ts` is the only WebRTC code: it just moves messages between PeerJS and the sessions.
- `HostSession` (DM) owns state and checks every request; `ClientSession` (player) mirrors what the DM shares. `parseClientMessage` validates every incoming message's shape first; malformed input is ignored.
- Identity: each player has a secret token (per browser tab, sessionStorage) that wins back the same seat on reconnect; other players only see the public id (`p1`). Newest connection with a token wins.
- Sync: public updates are versioned; a client seeing a gap requests a full snapshot. Whispers and hidden DM rolls go outside the versioned stream, only to those allowed to see them (`canSee`).
- Dice: player-mode rolls send raw random draws; the DM replays them (`replayRoll`) so impossible or tampered results are rejected. DM-verified mode rolls on the DM's device; physical mode records entered faces.
- Heartbeat: the DM pings every 2 s; 7 s of silence means the other side is gone (WebRTC often never reports it). Players pause and auto-reconnect with backoff; the DM marks silent players away.
- Player characters are rewritten to id `pc-<playerId>`; players control their own character plus anything the DM grants.
- The current UI is a functional text "table" (lobby, players, fight, log) to be replaced by the rendered world in steps 5–7. `client/demo.ts` holds placeholder content.

### Map editor (`shared/editor/` + `client/ui/MapEditor.tsx`)
- Maps: tiles have integer heights 0–30, optional `terrain` (default `grass`, cosmetic; looks come from the style pack) and `blocked`. At most 10,000 tiles. `toData()` is canonical (tiles by row then column, walls in fixed order), so equal maps give equal data. Imported files go through `validateMapData`.
- Every change is a `MapPatch` (only the tiles/walls that differ). Tool actions are `MapEdit`s turned into patches; `diffMaps`/`applyPatch` power undo/redo (`recordChange`, one undo step per drag stroke) and live sync (`HostSession.editMap` publishes a `mapPatch` update). Replacing the map with a different grid type uses `setMap` and resets history.
- Shapes: brush (covers every cell along a fast drag), line, rectangle (on-screen rectangle, hex rows offset), circle, ring (outline only), fill. Fill spreads only through shared edges like a paint bucket and never crosses walls: on tiles it covers the matching area (same height/terrain/blocked); with Add tiles it fills an enclosed empty area (`fillEmptyCells`) and refuses open ones. Hovering previews what the brush or fill will change. Walls go on the edge nearest the pointer (`edgeNeighbor`; square grids only use the four sides).
- `convertGrid` switches an existing map between hex and square, keeping each tile's on-screen column/row; walls that no longer sit on an edge are dropped and reported.
- Generation: seeded value noise (`seededRandom`, never used for dice). Presets: flat, hills (stone on top quarter), islands (sea border, deep water is `blocked`).
- Rendering (`client/render/WorldView.ts`): one mesh per terrain with a thin instance per tile; thin instances need `thinInstanceRefreshBoundingInfo` or they get culled. Renders only when something changed (map, highlight, camera, or shaders still compiling). The camera fits the map by projecting its corners. Picking is `rayPick` (shared/map): it walks the pointer's line of sight over the grid, because Babylon mesh picking gave wrong cells through holes. Empty space counts as ground, so the pointer reaches cells outside the world (for Add tiles). Edits never move the camera; it frames the map on first load, grid change, a new/generated/imported map, or "Re-center view". Babylon focuses the canvas on press; that focus is patched to `preventScroll` so the page doesn't jump. The wheel and middle-click are kept from scrolling the page.
- Edit-mode controls: left = tool, right-drag = pan, middle-drag = turn, wheel = zoom. Touch screens get a "Touch: editing / moving view" toggle.
- Messages over PeerJS's 16 KB limit are split into frames (`shared/net/framing.ts`) and reassembled with size caps (200 KB from players, 20 MB from the DM).

### Camera (`shared/camera/` + `client/render/CameraRig.ts`)
- Compass convention: a heading is where the camera LOOKS. 0 = north = toward row 0 (world -z), PI/2 = east (+x). The Babylon scene is right-handed (`useRightHandedSystem`), so facing north, east is on the right; the default left-handed space mirrored maps.
- Pure rules in `shared/camera`: N/E/S/W snapping and quarter turns (E = clockwise), frame-rate-independent gliding (`approach`, `approachAngle`), heading/orbit conversion (alpha = heading + PI/2), world-bounds clamping, the mode reducer (2.5D or top-down; turning free camera off snaps to the nearest direction in 2.5D, north-up in top-down), twist angle, and `spriteFacing` (which of 4 sprite directions to draw).
- `CameraRig` drives Babylon from those rules. Snapping view: drag pans (left for players, right for the DM), wheel/pinch zooms, and turning is Q/E, the turn buttons, middle-drag (a quarter turn per ~140 px), or a two-finger twist (~35 degrees per quarter turn). Free camera adds orbiting (left drag for players, middle drag in the editor). The camera orbits a point on the ground surface (top of a level-0 tile), so turning keeps the same tile centered, and that point is clamped to the map.
- Camera framing runs on the next drawn frame and builds its projection from the camera angles itself (Babylon returned stale matrices right after moving the camera).
- "Focus everyone here" (DM) sends a one-off `focus` message with a cell; players' cameras glide there. It is not session state.
- Map editor drags can be cancelled mid-stroke: right-click while holding the left button, Esc, a second finger on touch screens, or the on-screen Cancel button. Cancelling reverts everything the stroke changed and leaves no undo step.

### Tokens, combat visuals, dice, and the log (step 7)
- Combatants have `facing` (a compass heading): they start facing the nearest enemy, turn the way they move and toward whatever they target. `headingBetween` (shared/grid) gives the heading between two cells; `spriteFacing` picks the sprite direction.
- `shared/anim`: `scheduleCombatEvents` turns one action's events into a timeline (walk along the path, attack by type with later impacts for ranged/spell, hit/dodge/defend at impact, downed after the hit, floating texts, victory for standing winners, XP and level-ups); `resolveClip` applies the fallback rule (real frames if present, else lunge/brace/shake+red/hop/tipOver/jump/bob/itemBob); `proceduralPose` gives each motion's pose over time. All timings in `DEFAULT_TIMING`.
- `moveOptions` / `targetOptions` (shared/combat) list what the active creature can do; they reuse the engine's own checks and a test proves they match the engine exactly.
- `client/render/TokenLayer.ts`: billboard sprites (2.5D) or round discs (top-down), HTML name tags with HP meters, floating numbers, a gold ring under the active creature. HP bars change when the blow lands. Placeholder art (`client/style/placeholderSprites.ts`) draws 16x24 pixel figures per direction in team colors; only idle frames, so every action uses the fallback motions.
- Play controls (`useCombatPlay`): a click (not a drag) on a highlighted tile moves; picking an ability highlights targets, and a click on one (or its name tag) attacks. Players use this in their map view; the DM plays monsters the same way whenever the Map tab is not open. `CombatHud` shows HP, XP, moves left, abilities, and End turn; fixed to the bottom on phones.
- Dice: `planRollAnimation` (shared/dice/animation.ts) plans the throw from the already-decided result: throw/tumble/settle/reveal, 50–80 ms stagger, big pools compressed, coins ~1 s, big moments (natural max/1 on a d20 or a single-die roll) hold 0.4 s longer, speeds Fast/Normal/Dramatic/Off. All timings in `DICE_TIMING`. The tray (`addToTray`, `trayNotation`) builds notation from dice buttons. `DiceRollAnimation` throws every roll a viewer can see; tap to skip; short vibration on landing on touch devices.
- Combat is written to the shared log (`describeCombatEvents`): actions as `game` entries (Game log tab), turns and rounds as `system` entries (General). `LogList` has All / General / Player chat / Game log tabs, timestamps, color-coding, roll breakdowns on tap, and is a drawer on phones.

### DM tools and encounters
- The DM page: map beside a hideable `DM tools` panel with tabs Encounter / Map / Rules / Art / Session (sticky and self-scrolling on wide screens). Map-editing tools only work while the Map tab is open (they render into it through a portal); otherwise map clicks select creatures, place them, or play the fight. Starting a fight switches Map to Encounter.
- `CombatState.status` is `setup | active | ended`. `shared/combat/dm.ts`: `createEncounter`, `dmAddCombatant` (mid-fight it rolls initiative and slots in without disturbing the current turn), `dmRemoveCombatant`, `dmPlaceCombatant`, `dmRenameCombatant`, `dmEditCombatant` (stats, HP, XP, side, PC flag, XP value, abilities, conditions; emits readable change lists), `beginFight`. DM changes are logged as "{DM title} renames Goblin to Grizzle" etc.
- `EncounterPanel`: Start/Stop fight (with a "Roll initiative" choice), Clear encounter, add a monster or a player's character and click the map to place it, the `Roster`, and a `CreatureEditor` (sends only changed fields) with Move on map and Remove. Placing scrolls the map into view.
- `Roster` ("Turn order", numbered, with a one-line note saying how the order is decided right now) is the turn order: drag a row (handle for touch, anywhere with a mouse) or use arrow keys on the handle; `dmReorderCombatants` keeps whoever is acting on their turn. Reordering in setup unticks "Roll initiative", so `beginFight(..., { rollInitiative: false })` runs in the listed order; in such fights newcomers go last.
- Highlight colors come from the style pack (`actionColors`): move yellow, harm red, help blue, decided by `abilityIntent` (shared/system). The HUD hint and ability buttons use the same colors. The acting creature has a white ring with a glow (`activeColor`, kept apart from the yellow move tiles), a bouncing ▼ and a lit name tag (`data-active`).

- Ability range: `abilityReach` (shared/combat) lists every standable tile within an ability's range (own tile only for ally and self abilities), regardless of turn. Picking an ability, or hovering/focusing its button, shades that reach faintly (`WorldView.setReach`, a thinner overlay than the target highlight) in its action color; targets stay solid on top. Ability buttons show "range N" and stay pickable with nobody in reach (the hint says so); only a spent action or a condition like Stunned disables them.
- Control: players act for their own character while `playersControlOwn` is on (Session tab, "Players control their own characters"); off, the DM plays them and the player sees a note. The creature editor's "Controlled by" hands any creature to a player (`grantControl` / `revokeControl`); handed-over creatures stay with that player either way.

### 2.5D polish and graphics quality (step 8)
- `shared/graphics`: `effectsFor(quality)` maps Low / Medium / High to bloom, depth of field, sun shadows, glow, color grade, MSAA samples, and a pixel-ratio cap. Low turns every effect off. `defaultQuality` starts touch devices with a short side under 768px on Low, tablets and weak machines on Medium, others on High. `depthOfFieldLens` / `blurAt` reproduce Babylon's circle-of-confusion math; the focal length scales with the focus distance so the blur looks the same at any zoom.
- `client/render/SceneEffects.ts` applies them: `DefaultRenderingPipeline` (bloom, depth of field in the 2.5D view only, focused on the camera target each frame, contrast and vignette with no tone mapping, MSAA; never FXAA, which blurs pixel art), PCF `ShadowGenerator` on a warm sun, and a `GlowLayer` where only registered meshes glow and every other mesh is drawn black so it blocks the halo. With the pipeline on, the clear color is handed over in linear space.
- Sprites use alpha testing: crisp edges, shadows in their shape, and see-through highlights no longer draw over them. Name tags are placed in CSS pixels, since the canvas may draw more pixels than that on high-DPI screens.
- Each viewer picks the setting in the camera bar ("Graphics", ✨ on phones); it is saved in localStorage (`client/style/graphicsSetting.ts`). E2E tests start on Low through `storageState` (software rendering is slow); `e2e/graphics.spec.ts` tests the real defaults and every setting.

### Mobile and display settings (step 9)
- Tested on a real mid-range phone, including a 100 x 100 map: smooth.
- ⚙ on the map (`DisplaySettingsMenu`, store in `client/ui/displaySettings.ts`): graphics quality, combat animations (Fast / Normal / Off: `timingFor` in shared/anim scales every timing; Off makes actions happen at once, numbers still show), and "Keep mobile screens awake" (`useWakeLock`, Screen Wake Lock API, re-requested when the tab is shown again). People with "reduce motion" on start with combat and dice animations off. Escape closes the panel and returns focus to ⚙ so Q/E reach the map.
- Automatic step-down: `SlowFrameDetector` (shared/graphics) judges the median frame over ~3 s of continuous drawing (the view says whether a frame directly followed another, so idle pauses never count); slower than 25 fps lowers the setting one level and shows a note. If the person raises it by hand after that, it stays.
- Panning grabs the map: `panSensibility` (shared/camera) sets Babylon's pan speed from the zoom distance, field of view, view height, and pan inertia, so the ground under the pointer follows it. It depends only on the zoom, not the world's size. The canvas carries `data-animating` while creatures act.

### Example maps
- `shared/editor/examples.ts`: Forest Glade (small, hex), Snowy Pass (medium, square), Smuggler's Cove (large, hex), built from code with a small `MapBuilder` (rows and columns, painted by position; `enclose` walls a room except its openings; `scatter` places solid trees or rocks that never touch each other, the edge, or a wall). Tests check each is valid, its size, uses terrain, height, solid tiles, walls, and water, and that every open tile is reachable under the sample movement rules. Loaded from the Map tab's Examples panel (replaces the map; Undo works for the same grid type).
- Objects: a tile may hold one `object` (id like terrain; catalog in `shared/map/objects.ts` with name, nature/built, and whether it blocks by default). `setObject` places one (solid if it blocks) or removes it (only from tiles that have one); `clearMap` makes everything flat empty grass, keeping the world's shape. The Map tab has Objects / Remove objects tools and Clear map (asks "Are you sure about clearing the whole map?"; Undo works). Models are low-poly part lists in the style pack (`client/style/placeholderObjects.ts`), drawn as thin instances (`client/render/objectMeshes.ts`); natural ones get a fixed per-tile turn and size. The examples are dressed with objects (`MapBuilder.place` / `scatter`); a test checks each uses at least five kinds, natural and built.
- Solid tiles look like their terrain (style pack `solid`): a tree canopy on wood, a bush on grass, a boulder on stone, a crag on snow; deep water (`height` 0) is just darker water.

### DM controls: line of sight, fog of war, notes (step 10)
- `shared/vision`: `hasLineOfSight` walks the grid line between two cells. Walls, tall objects (`blocksSight` in the object catalog: trees, boulders, pillars...), solid tiles without an object (rock, crags, but not deep water), and ground higher than the line from eye (`EYE_HEIGHT` 1.5 levels up) to target (`TARGET_HEIGHT` 1) block it; creatures don't. A diagonal step on a square grid passes a corner if either way round is open. `visibleCells` / `sightOf` (union for several viewers, `VISION_RANGE` 10).
- Targeting needs line of sight (engine `checkTarget`), so `targetOptions` and the highlights follow it.
- Fog of war: a public session setting (`setFogOfWar`, Session tab). `useFog` (client) works out what the player's controlled creatures see, remembers explored tiles (dimmed), and hides creatures out of sight; unexplored tiles read "unexplored". It runs in the player's browser on the full state, so it hides things on screen but isn't secret from developer tools.
- DM notes: `HostSession.setNote(cell, text)` / `notes()`, kept only on the host, never published (a test checks no message to players mentions them). The Map tab's Notes tool opens a note for a tile; noted tiles are tinted violet on the DM's map and the note shows in the tile readout.
- Token permissions: "Players control their own characters" and the creature editor's "Controlled by" (see DM tools).

### Dice box
- `shared/dice/polyhedra.ts`: dice geometry (corner points; faces found by a brute-force convex hull), values with opposite faces adding to sides + 1, `upwardFace` (a d4 reads its top corner), `relabel` (swap two labels). `shared/dice/box.ts`: `boxPieces` (which shapes to throw: a d100 is tens + ones d10s, an odd-sided die is a cube with its value on every face, at most `BOX_LIMIT` 20 thrown, the rest counted) and `faceLabels`.
- `client/dice/simulate.ts` (cannon-es): a seeded throw into the walled, lidded `TRAY`, recorded at 60 frames a second with collision moments (for the clacks). Each piece stops for good once still and lying flat; one left leaning is nudged toward the middle (up to 5 times), and anything still leaning at the end tips onto its nearest face in a short closing step. At most 4 s (typically 1.5-3.5 s).
- `client/render/DiceView.ts` draws the tray and the dice (flat-shaded, numbers on a per-die texture after relabelling) and plays the recording at the dice-speed setting (Off: dice already at rest). `client/ui/DiceBox.tsx` replaces the old 2D animation: same queue, tap to skip, total in the header, crit glow and sting; rendered into the page body so nothing covers it.

### Style packs and art (step 13)
- The Pixel (HD-2D) pack, the default: tile tops are pixel art drawn in code (`shared/style/pixelTiles.ts`: 16x16, a small palette per terrain, 4 variants each, picked per tile by `cellSeed`), shown as flat caps with crisp (nearest) sampling over columns in the terrain's side color (`tileSideColor`); deep water is a darker tint. "Art style" under ⚙ switches to Simple colors (per device; `WorldView.setArtStyle` rebuilds the map without moving the camera, and the canvas effects redraw overlays after it).
- Custom art (`shared/style/art.ts`): the DM's own tile textures, by terrain, as data URLs (PNG/JPEG/GIF/WebP, under about 500 KB and 1024 px), checked by `validateCustomArt`. Part of the session (`art` in the snapshot, an `art` update), sent to every player and saved with the game; never uploaded anywhere. `HostSession.setTileArt(terrain, image | null)`. The DM tools' Art tab imports a tile per terrain with a crisp preview and `tileWarnings` (not square, odd or large sizes), and resets it. The DM's tiles show in either art style.
- Character sprite sheets (`shared/style/sheet.ts`): 4 rows per animation (down, left, right, up), animations in `CLIPS` order (idle first, the only one required), frames across. `guessFrameSize` picks the size whose grid lines cut fewest drawn pixels (the smallest among equally clean ones); `sliceSheet` counts each row's frames, mirrors a missing left/right, borrows facing-down for other gaps (with warnings), and refuses a sheet without idle; `frameAt` plays 8 frames a second (looping, or holding the last frame); `portraitRect` for the round token; `artKeyFor` ("goblin-2" uses "goblin" art unless it has its own). `CustomArt.characters` holds image, layout, and token, checked against the image (`setCharacterArt`). The Art tab's Characters section: pick a monster kind or one creature, import a sheet, change the frame size, preview any animation and facing, see the round token, then use it. `TokenLayer` draws such creatures from their sheet (a texture copy per token with frame offsets, square sprites, mirroring), plays real frames where the sheet has them and the fallback motions where it doesn't, holds the last downed frame, and uses the round token in top-down view.
- Free-form sheets (`shared/style/frames.ts`, `client/ui/FramePicker.tsx`): sprites of any size, anywhere, one view (classic battle sheets). `clearBackground` makes a solid background (the top-left colour) transparent; `findSprites` finds each sprite (connected pixels, pieces 1 pixel apart joined so held weapons stay with their sprite, specks dropped) in reading order; `planCells` sizes square cells for the picked frames and puts each one's feet (`footAnchor`, the middle of its lowest pixels) at the cell's bottom middle, so weapons reaching out don't make the body jump; `assembleLayout` writes one row per animation, mirrored for the side not faced, with `bodySize` (the tallest idle frame) so `TokenLayer` scales the sprite up by frame/body and the body keeps the usual height (`portraitRect` uses the body too). The picker is a window (`role="dialog"`, "Pick frames", portaled to the body; Escape cancels) that pops up when a sheet is chosen and asks for each animation in turn ("Drag a box around the idle frames", "Next: walk"): dragging a box adds every sprite whose middle is inside it, in reading order (left to right); clicking a "Sprite N" box adds one; "Remove frame N" takes one out. Frames go under a view (`View`: side, front, back; `sheetRows` gives a row per animation and view): facing down uses front, up uses back, left/right the side (mirrored for the side not faced), and a missing view is stood in for by another. "Choose token frame" makes the next sprite clicked the token's. Both importers: `TokenEditor` frames the round token (drag to move, "Token zoom" slider or wheel; a `Crop` in sheet pixels, cut by `makeToken` on use), and `SpeedField` sets each animation's frames a second (`SheetLayout.fps`, 1 to 30, default 8, used by `frameAt`). Runs share rows where they fit (`packRows`, first row with room; `SheetRow.column` is where a run starts), so the limit is frames in all, not rows. `TokenLayer` lifts a sprite scaled up for `bodySize` by the same amount, keeping its feet on the ground. Editing: each listed character has Edit ("Edit {key} art"), which reopens the picker. A character made in the picker keeps its `CharacterSource` (original sheet, picks, facing, token framing) on the host alone (`setCharacterArt(key, art, source)`, `artSource(key)`, saved as `artSources`, never published); one imported as a grid sheet opens on its own sheet, its frames found from the layout (`picksFromLayout`: each frame cell's sprite; left or right is the side view, down the front, up the back). The Art tab is split into Tiles and Characters sub-tabs; Characters has both importers ("Import sprite sheet" for grid sheets, "Pick frames from any sheet").

### Character creation (step 14)
- One picture → character, with the pixel-art converter (`shared/style/pixelate.ts`, `client/ui/OnePicture.tsx`): Art → Characters → "Make from one picture" opens a window ("Make a character"). `removeBackground` clears what's joined to the edges and within a tolerance of the top-left colour (inside pixels of that colour stay); `pixelArt` trims, shrinks to a height (area average, drawn if mostly drawn; never enlarges), reduces to a median-cut `palette`, and adds a dark 1-pixel outline if asked. `stillSheet` makes idle from the front (and the back, if added): two frames each (resting, and `breathe`: the upper body sinks a pixel) at 3 frames a second, feet at the bottom middle of square frames; left and right show the front, and the procedural motions do the rest. Sliders: Height (16 to 128), Colours (2 to 32), Background removal (0 to 120), Outline. Pictures are shrunk to 512 on loading. Like any character, it can be edited in the frame picker afterwards.
- Assembled sheets (picker and still) leave `FRAME_GAP` pixels between frames so their sprites are found apart again for editing; the picker opens on the view that has the idle frames.
- Mini pixel editor (`shared/style/paint.ts`, `client/ui/PixelEditor.tsx`): each listed character has Paint ("Paint {key} art"), a window ("Paint") on its finished sheet. `sheetFrames` lists each frame cell once with the directions that show it (`frameLabel`: "walk 2", or "walk 2, left" when the animation has more than one view). Tools: Pencil, Eraser, Fill (4-way, within the frame), Pick colour, Replace colour; "Paint on" this frame, every frame of its animation, or every frame (the same spot of each: frames are lined up by the feet). Swatches of the sheet's colours (`sheetColors`), Undo/Redo (Ctrl+Z / Ctrl+Y, 50 steps; a drag is one step), and a playing preview. Saving replaces the sheet (layout and token kept) and drops the frame-picker source, so Edit then starts from the painted sheet (the window says so).
- Frame-by-frame import: "Pick frames from any sheet" takes several files at once, and image files can be dropped on the Characters panel (one: a sheet; several: frames). Separate frames are sorted by name (numbers in order: walk_2 before walk_10) and laid out by `arrangeFrames` (rows up to 1024 across, standing on each row's floor, gaps so they're found apart), then opened in the frame picker.
- Not built yet: the layered character builder (#3 below); it waits for pre-animated art parts (bodies, hair, outfits, weapons) to stack.

### Game system entry (step 15)
- Rules tab (`client/ui/RulesPanel.tsx`): the system in play at a glance; "Edit rules", "New system" (`blankSystem`: one stat, one ability, one monster), "Save rules to a file" (`{id}.system.json`), "Load rules from a file" (checked, then opened in the editor to look over before use; a broken file gets a plain message naming its first problems).
- Rules editor (`client/ui/SystemEditor.tsx`, dialog "Rules editor"): sections Basics (name, XP per level, max HP, defense, initiative, speed, steps, climbing), Stats (stats and worked-out values, each with a formula name), Conditions, Abilities (cards: target, range, animation, description, optional attack roll, effects: damage, heal, put on a condition), Monsters (cards: level, XP value, stats with the defaults as placeholders, abilities as checkboxes). Checked as typed with `validateGameSystem`: each problem by its field, listed in words (`describePath`, "Abilities › Fire Bolt › effect 1 › amount", click to go there), counted on the section tabs; "Apply to game" waits until there are none. New entries' ids follow their names (`idFrom`, `renameEntryId`); a formula name change renames it in every formula and monster (`renameVariableId`); removing an ability, condition, or stat tidies what used it (`removeAbility`, `removeCondition`, `removeStat`; formulas using a removed stat are shown as problems).
- Applying (`setSystem(system, renames)`): creatures in play are fitted (`fitCreatures`: unknown stats, abilities, and conditions dropped, HP kept within the new maximum; renamed stats keep their values) and sent with the rules in one update (`{kind: 'system', system, combat}`), so no one sees new rules with old creatures; players' characters are fitted too, and joining characters are fitted instead of turned away (one left with no abilities gets the system's first). The change is logged ("DM updates the rules (Skirmish): Goblin loses ability shoot").
- House rules (`shared/combat/houseRules.ts`): `HouseRule` kinds `range` (an ability, or every ability with null, reaches more tiles), `sight` (no clear view needed), `target` (an ability can target any creature), `condition` (creatures under it can still act, or move), `movement` (every creature moves more each turn). `CombatContext.houseRules` relaxes the engine's checks (targets, reach, conditions, speed at turn start); `overrules` does the same for one action. `actionProblems(ctx, state, action)` lists why an action is refused, each `RuleProblem` with the rule that would allow it (`fix`, null when no ruling can, like a downed target or a spent action; `nowOnly` for movement a condition took this turn: allowed once, not kept). The engine's own refusals come from the same problems. `withRule` adds range and movement rules up; `ruleFits` drops rules about abilities or conditions the rules no longer have (on `setSystem`, listed in its changes).
- In play: clicking a creature that isn't a target (with an ability picked), a tile too far, or picking an ability while held by a condition shows a refusal in the combat bar ("Not by the rules: …", `RefusalBox`). The DM: "Allow just this once" or "Make it a house rule: …" (`overrule(action, always)`; logged "DM allows it just this once: …" / "DM makes a house rule: …"). A player: "Ask the DM" (`askRuling` message; logged "Ana asks DM to allow it: …"; one open request per player), shown to the DM above the map (`RulingRequests`: allow once, house rule, or No: "DM says no to Ana: …"; `pendingRulings`, `answerRuling`). Ability buttons stay pickable unless the action is spent.
- `SessionSnapshot.houseRules` (public, update `{kind: 'houseRules'}`, saved as `state.houseRules`); listed in the Rules tab with Drop (`removeHouseRule`, logged). `PROTOCOL_VERSION` is 2.
- Resources (optional `GameSystem.resources`: id, name, `max` formula with no dice, `refill` `turn` or `fight`): `computeCreature` gives each maximum; `Combatant.resources` holds points left (a resource left out is full, so older fights and saves still work; a new fight starts full); `resourceLeft`. An ability's `cost` ({mana: 2}) is paid when it's used, hit or miss, and reported after the attack roll ("Ana spends 2 Mana (1 left)"); an ability the creature can't pay for is refused (no ruling changes that), offers no targets, and its button is disabled ("Not enough Mana"). Per-turn resources refill at the start of the creature's turn. Effect `restore` gives points back up to the max ("regains"). The DM sets points in the creature editor (`CombatantPatch.resources`, 0 to max). Meters in the combat bar; costs on ability buttons ("range 6 · 2 Mana"). Removing or renaming a resource follows into costs and restore effects (`removeResource`, `renameEntryId(..., 'resource')`); fitting creatures drops points in resources the rules no longer have.
- Criticals (optional `GameSystem.critical`: `hit`, `miss`): by the natural roll (the kept die of the attack roll's first dice term, so 2d20kh1 works); at least `hit` always hits and rolls the damage dice again (bonuses once), at most `miss` always misses. `attackRolled.critical`, `damaged.critical`; the log says "critical hit!" / "critical miss"; the damage number gets a "!". Spell slots are resources (one per slot level).
- The rules editor has Resources (Stats section), a cost per resource on each ability, a "give back a resource" effect, and critical hits (Basics).
- "Start demo fight" keeps the rules in play (the sample rules only if there are none) and uses its goblins, or its first monster.
- Reactions (optional `AbilityDef.reaction`: `trigger` `enemyLeaves` or `attacked`, and for `attacked` a `defense` bonus; such an ability may have no effects). A reaction isn't an action (refused as one, no targets, left off the action buttons and listed apart in the combat bar, ready or used). Each creature gets one a round (`Combatant.reactionUsed`, back at the start of its turn); a condition that stops acting stops reacting; costs apply. `enemyLeaves`: a move that starts within an enemy's reaction range and ends outside it offers that enemy (each, in turn order) an attack of opportunity at the one leaving (no range or sight check). `attacked`: an attack roll that would hit (not a sure critical) is held (`HeldAttack`, rolled, not decided) while its target may react: the defense bonus applies to that attack; effects aimed at an enemy hit the attacker (a riposte); then it's settled.
- `CombatState.pending` (`PendingReaction`: trigger, who set it off, the creatures that may react with their reactions, the held attack): while set, only the first creature on it may act, with actions `react` (an offered ability) or `pass`; everything else is refused ("Waiting for Goblin to react", no ruling changes that). Events `reactionOffered` ("Goblin can react to Ana leaving"), `reacted` ("Ana reacts: Shield (+5 defense)", a "+5 defense" float), `reactionDeclined` ("Goblin doesn't react"); the held attack is logged when settled ("Goblin attacks Ana: 13 vs defense 16, miss"). A pending reaction whose creatures are gone, or in a fight that ended, is dropped.
- `ReactionPrompt` (`client/ui`): whoever controls the reacting creature, and the DM for anyone, gets its reactions and "Don't react"; everyone else sees who the fight is waiting for. Rules editor: "Used as" (an action, or a reaction to an enemy leaving or to an attack that would hit) and "Adds to defense against that attack". `PROTOCOL_VERSION` is 3.

### AI features (step 16)
- One provider interface (`shared/ai/provider.ts`: `AiProvider.complete({system, prompt, json, signal})`). Providers (`client/ai/providers.ts`): Ollama (`/api/chat`, plain-text body so no CORS preflight; the user sets `OLLAMA_ORIGINS` to the site), LM Studio and any OpenAI-compatible service (`/chat/completions`, optional key). Settings (`ttrpg.ai` in localStorage, the key too) stay on the DM's device; `listModels` for "Check connection"; unreachable services get a plain message saying how to fix it.
- Rulebook import (`shared/ai/bookImport.ts`, `client/ui/BookImport.tsx`, Rules tab "Import from a rulebook (AI)"): a PDF's text is read in the browser with pdf.js (`client/ai/bookText.ts`, loaded only when needed; text files work too; scanned books have no text and say so), cut into sections of whole pages (`sectionsOf`, about 9000 characters for small local models), and each section goes to the AI with `IMPORT_INSTRUCTIONS` (the format in brief, formula syntax, "only what this section states, never invent"). Replies are read leniently (`readJsonReply`: fenced or not, chatter, trailing commas) and merged, first good value winning (`mergeExtract`); `draftToSystem` tidies: ids and formula short names, names in formulas set right, monsters' abilities matched by name, effects and targets fitted, stand-ins for what the book didn't say (noted). The draft opens in the rules editor ("Imported: …", with the notes) to check before applying; anything still wrong shows there. Page range, progress, Stop. The text goes only to the AI the user chose.
- Next in this step: maps from a book (an encounter's description turned into a map plan the procedural generator builds; a map picture in the PDF as a tracing guide or read by a vision model; otherwise a set-up guide), narration suggestions, and image generation.

### Saving (step 12)
- `shared/net/saved.ts`: `SavedGame` (format `universal-tabletop-rpg/game`, version 1): room code, settings, system, map, fight, log, each player's seat (with their secret token, so returning players get their own seats; the file is the DM's alone, notes included), and the counters. `validateSavedGame` checks files and storage before use. `HostSession.saveGame(code)` / `restore(saved)`; restored players start away.
- `client/storage/savedGames.ts`: IndexedDB (`universal-tabletop-rpg` / `games`, keyed by room code); every call fails quietly when storage is blocked. App autosaves within 0.8 s of any change (a stream of changes doesn't postpone it) and when the tab is hidden or closed; the DM header shows "✓ Saved".
- A DM tab remembers the room it hosts (sessionStorage), so a reload resumes the game automatically in the same room; players' pages reconnect to their seats. The home screen lists saved games (Resume, Delete with a confirm) and loads game files; the Session tab saves one. Resuming retries the old room code briefly (a reload can leave it held for a moment); if it stays taken (the game is open elsewhere) the game carries on under a new code and the DM is told.
- The dice box can be pinned open (Dice box button, per device): it shows the last roll at rest, docks in a corner, and drags by its header.

### Sound (step 11)
- `shared/audio`: `combatSounds(timeline)` times sounds to the animation (a step per tile walked, swing/shoot/spell/item as the attack starts, hit/miss/block at impact, downed, heal, level-up, one victory fanfare); `diceSounds(plan)` (rattle, a clack per die as it lands, a sting for a natural max or 1; silent with dice animation off); `musicScore(seed)`: a calm C-major loop (pad chords from a set of progressions, bass roots, a pentatonic melody, one note at a time), tested to stay in key.
- `client/audio/soundEngine.ts`: the placeholder sound pack, every sound synthesized with Web Audio (oscillators, filtered noise), so there are no files to load or credit. It wakes on the first press or key (browser rule), plays background music with a look-ahead scheduler, and reads the ⚙ volumes (Sound effects, default 60; Music, default 0 = off). Buttons and tabs click softly; a player hears a chime when their turn comes.

### Hosting
- GitHub Pages: `.github/workflows/pages.yml` builds with `BASE_PATH=/<repo>/` (vite `base`) and deploys on every push to master: https://codedcurry.github.io/universal-tabletop-rpg/ (the repo is public; Pages source is "GitHub Actions").

### Known gaps (planned, not built yet)
- Saved favorite rolls per character (optional in the spec) are not built yet.
- No TURN relay configured yet; players on strict networks (some mobile carriers) may fail to connect. See `.env.example`.
- House rules (build step 15). The DM can edit creatures directly (see DM tools), but rules themselves are not overridable yet.
- Fog of war is not secret from a player inspecting their browser (see above); true secrecy would need per-player state from the host.
- Resources beyond HP (mana, spell slots), critical hits, falling damage, reactions.

## Confined world rules
- No table, no sandbox, no loose physics objects. Everything is part of the map.
- Tokens move tile to tile, respect height (no walking up cliffs without a climb action), and are blocked by walls.
- Cameras stay within the world's bounds, including free cam. No seeing through walls.
- Players see what their character sees: fog of war and line of sight.
- The rules engine enforces rules; the DM can override.

## Visual style: 2.5D (HD-2D, like Octopath Traveler)
- Structure similar to Final Fantasy Tactics (3D blocks with real height, 2D sprites, rotating camera, turn-based grid combat), with Octopath-style HD-2D lighting and effects on top
- 3D terrain tiles with real height, textured in pixel-art style
- **Grid type:** Hex by default; the user can choose square per map. Rules engine, movement, line of sight, and map editor must support both through one shared grid interface (test both grid types).
- Characters are flat 2D pixel-art sprites that always face the camera, with 4 facing directions and frame-by-frame animations (see Animations)
- Pixel-perfect rendering (no texture smoothing)
- Polish: depth of field, bloom, soft lighting, glow effects. All reducible via a "low graphics" setting for phones.
- The HD-2D look comes mainly from the renderer's lighting and effects, so standard pixel-art packs should look right in the scene.

## Animations
### Animation set
Each animation exists in all 4 directions, usually 4–8 frames:
- **Idle:** breathing / shifting weight
- **Walk** (run optional)
- **Attack:** separate melee swing, ranged shot, and spell cast
- **Defend:** raised shield / guard stance
- **Hit:** flinch when damaged
- **Dodge:** sidestep on a miss
- **Downed:** collapse at 0 HP
- **Victory:** celebration after combat
- **Use item:** e.g. drinking a potion

### Animation state machine
- Listens to rules engine events: attack declared → attacker's attack animation; hit → target's hit animation + damage number; miss → target's dodge; HP reaches 0 → downed; combat won → victory.
- Characters return to idle after each action.
- Pure logic with no graphics dependency; write its tests first.

### Fallback rule
If a character is missing an animation, the tool fakes it with a procedural motion using the idle frame instead of freezing or erroring. Real frames are always used when they exist; fallbacks only fill gaps.
- **Attack:** lunge forward and back
- **Defend:** lean back and brace
- **Hit:** shake and flash red
- **Dodge:** quick hop sideways
- **Downed:** tip over and fade
- **Victory:** little jump
- **Walk** (if missing): bobbing hop while moving
- **Use item:** small bob with item icon popping up

This means every character can perform every action, even if only idle frames were imported. Users can import a quick, incomplete character and add proper frames later.

## Camera system
- **2.5D mode:** Fixed tilted angle that snaps between North / East / South / West with smooth rotation. Zoom within limits. Controls: Q/E or arrow buttons on PC; on-screen buttons or two-finger twist on mobile.
- **Top-down mode:** Straight down, zoom and pan only. Characters shown as round tokens/portraits instead of flat sprites.
- **Free cam toggle (both modes):** In 2.5D, free orbit/tilt/pan; turning it off snaps to nearest N/E/S/W. In top-down, free rotation while staying overhead; turning it off snaps back to north-up. Free cam stays within world bounds.
- **Sprite facing:** Choose which of the 4 sprite directions to show based on the character's facing relative to the camera angle.
- Each player controls their own camera. DM has an optional "focus everyone here" button.
- Snapping math and sprite-direction logic are pure functions; test them first.

## Art and assets
### Style packs
- All art is bundled into **style packs**: characters, tiles, effects, and render settings together.
- HD-2D is the first pack. Later, users can choose other styles (e.g. smooth painted, hand-drawn) by swapping packs.

### Asset sources
- itch.io, OpenGameArt.org, Liberated Pixel Cup (LPC — requires credit and share-alike), Kenney.nl (CC0, good for UI/placeholders), freesound.org for sounds.
- Prefer CC0 or commercial-use licenses since this may become an app.
- Own art: LibreSprite, Piskel, or Aseprite. Sound editing: Audacity.

### Asset spec (for imports)
- **Characters:** PNG sprite sheet, transparent background, fixed grid of 4 directions × animations (full set listed under Animations) at a set frame size. Only idle is required; missing animations use the fallback rule.
- **Tiles:** square pixel-art textures at a set size, for tile tops and sides.
- **Tokens:** any square image, auto-cropped to a circle. Can be generated automatically from a character's portrait.
- Importer auto-slices sheets, shows a live animation preview, and warns on wrong sizes.
- User-imported art stays private to that user.

### In-tool character creation (users never edit raw sprite sheets)
1. **One picture → animated character:** User uploads one image (or front + back); the tool animates it procedurally (idle bob, walk hop, attack lunge, hit flash/knockback) and mirrors left/right automatically.
2. **Pixel-art converter:** Shrinks any image and reduces it to a limited palette to match the style, with a pixel-size slider.
3. **Layered character builder:** Pre-animated parts (body, hair, outfit, weapon, shield) stacked into a finished sheet automatically. Palette swaps for recoloring.
4. **Mini pixel editor:** Touch-ups; editing a layer updates every frame.
5. **Frame-by-frame import:** For artists; drag in frames, tool assembles the sheet with live preview. Full sheet upload also supported.
- Build order: #1 and #2 first, then #3 once art parts exist, then #4 and #5.

## Dice rolling
### Dice panel
- **Common dice section:** Coin flip, d4, d6, d8, d10, d12, d20, d100 (percentile).
- **Custom roll input** beside it, using standard dice notation: e.g. `2d6+3`, `4d6kh3` (keep highest 3), `1d20-1`, `3d8+1d6`. Also custom dice with any number of sides (e.g. `d7`) and multiple coins (e.g. `5 coins`).
- **Multiple dice at once:** Users can add several of any dice (including coins) to a tray and throw them together; results show individually plus the total.
- Quick re-roll of the last roll; optional saved favorite rolls per character.
- DM option for **hidden rolls** (only the DM sees the result).

### Dice notation (implemented in `shared/dice/`)
- Terms joined by `+` / `-`; whitespace and case are ignored.
- Dice: `NdS` (count defaults to 1, e.g. `d20`), `d%` = `d100`. Any side count ≥ 1.
- Keep/drop modifiers: `khN` keep highest, `klN` keep lowest, `dhN` drop highest, `dlN` drop lowest (N defaults to 1). Keeping/dropping must leave at least one die.
- Constants: `+3`, `-1`.
- Coins: `coin`, `coins`, `N coin`, `N coins` (space optional, e.g. `5coins`). A coin term's value is its number of heads, so `5 coins` totals the heads.
- Limits: at most 1000 dice per term and 1,000,000 sides, to protect phones.
- Invalid input throws `DiceNotationError` with a readable message and the character position.

### Roll animation
- Real 3D dice (d4, d6, d8, d10, d12, d20, d100 as two d10s, coins) are thrown into a dice box (a felt tray with a wooden rim, like Owlbear Rodeo's) and tumble, bounce, and knock into each other. Coins flip and land heads/tails.
- **The result is decided first; the physics never decides it.** Each throw is a physics simulation run ahead of time from a seed everyone shares (the same tumble for everyone), then the face that landed up is relabelled to show the result already decided by the secure roll. Results stay fair and the same for everyone; the simulation is cheap enough for phones.
- Reduced/skip-animation option for low graphics mode or speed.

### Who rolls (DM setting, per session)
- **Player rolls (default):** Each player throws their own dice on their own device (tap, or flick/swipe gesture on mobile). The result is generated on the player's device with a secure random generator (`crypto.getRandomValues`), then sent to the DM and broadcast so everyone sees the same roll and animation.
- **DM-verified rolls (optional):** Players still tap/flick to throw on their own screen, but the result is generated on the DM's device. Prevents tampering; use for groups that want strict fairness.
- **Physical dice (optional):** Players roll real dice at home and enter the result; the log marks it as a manual entry.
- The roll log always shows which mode produced each roll.

### Roll feel (satisfying, not slow)
Goal: long enough to savor, short enough not to drag out the game. Target about **1.5 seconds** from throw to readable result.
- **Phases:** throw (~0.2s) → tumble with easing/deceleration (~0.8–1.0s) → settle with a small bounce (~0.2s) → result reveal with a pop/scale-up and glow, held ~0.6s before fading to the log.
- **Multiple dice:** All roll together with a slight stagger (~50–80ms between dice) so they land in a quick "clack-clack-clack." The total appears after the last die lands. Large pools (10+ dice) speed up so the total time stays near the target.
- **Coins:** ~1s spin and land; multiple coins flip together with stagger.
- **Big moments:** Natural max (e.g. nat 20) and natural 1 get a special effect (burst, color flash, distinct sound) and hold slightly longer (~+0.4s). These are worth savoring; normal rolls are not slowed down.
- **Sound:** rattle while tumbling, a satisfying clack on landing, a chime or sting for crits and fumbles.
- **Haptics:** a short vibration on landing on mobile, where the browser supports it.
- **Player control:** tap to skip the animation and see the result immediately; speed setting (Fast / Normal / Dramatic) per player.
- All timing values live in one config file so they can be tuned during playtesting.

### Fairness and rules
- The dice notation parser and roller are pure logic in `shared/`; write their tests first (parsing, modifiers, keep-highest/lowest, totals, invalid input errors).
- Rules engine can request rolls (e.g. attack roll) using the same roller, so manual and automatic rolls work the same way.

## Chat log
- A log panel with **category tabs:**
  - **All:** everything combined
  - **General:** system messages (player joined/left, turn changes, session events)
  - **Player chat:** messages between players and DM; optional DM whispers to one player
  - **Game log:** rolls (who rolled, dice, individual results, total), damage, healing, XP gained, status effects/conditions, turn order, DM rulings and house rule applications
- Entries are timestamped and color-coded by type; rolls show the full breakdown on tap/click.
- Hidden DM rolls and whispers only appear for their intended recipients.
- On mobile, the log is a collapsible drawer; on PC, a side panel.
- Saved locally with the session and included in Export.

## Game systems and rules
- A **game system file format** describes any tabletop system as data: stats, dice formulas, HP/resources, XP, abilities, conditions, monsters.
- The rules engine reads this format and enforces rules with deterministic code (not AI).
- Ability effects (damage formula, targeting, range, conditions applied) need a small, deliberately designed effect format inside the system file — design it up front, versioned, with a tiny sample system used in tests.
- **House rules:** When the DM overrides a ruling, it is saved as a house rule the engine applies from then on.
- **Entering a system:** Manual entry forms (always available, free). Optional AI-assisted import (see below).
- **Copyright:** Imported book data stays private to the user who owns the book. Never share or publish imported content. Users can share their own homebrew. Openly licensed systems (e.g. D&D 5e SRD, Pathfinder ORC content) could be built in after checking each license.

## AI (optional, swappable, free by default)
- One "AI provider" interface; plug-ins for a local model, free API tiers, or a user-supplied paid API key. Nothing billed to the developer.
- **Text AI** (Ollama / LM Studio): (1) **book import** — user uploads PDF or photos of a book they own, AI fills the game system format, user reviews and corrects before saving; (2) **narration suggestions** for the DM.
- **Image AI** (ComfyUI + Stable Diffusion + pixel-art LoRA, running locally): portraits, tokens, terrain textures, character base images. Output goes through the pixel-art converter and one-picture animator. Not relied on for full sprite sheets.
- Map generation uses procedural generation (noise algorithms), not AI.
- Check model and LoRA licenses before any commercial release.

### DM PC generation
- Image generation runs on the DM's PC. Players (including on mobile) send requests over the game connection; results are sent back.
- Request queue with position shown to players ("3rd in line").
- Optional DM approval before results reach players.
- Progress bar, then 2–4 variations to pick from.
- Results saved locally on the DM's PC and the player's device; never regenerated.
- Fallback when the DM has no AI set up: character builder or image upload.
- "Pause generation during combat" setting to avoid stutter on the DM's PC.

## Multiplayer details
- DM clicks "Host Game" and gets a room code/link; players join by link and code.
- DM's device holds maps, game systems, and session state. Each player keeps their own character locally; it syncs to the DM on join.
- The DM's chosen display title is part of session state and syncs to players on join.
- If the DM's browser closes or disconnects, the game pauses until they reconnect. DMs should host from a PC (phones pause background tabs).

## Build plan
1. **MVP definition:** A DM hosts a room, players join by link, everyone sees a hex map with height, and combat runs with HP and damage numbers.
2. **Project setup:** Vite + TypeScript repo, folder structure (`client/`, `shared/`), Vitest running one passing test, responsive UI layer, credits file.
3. **Core rules engine (no graphics):** Characters, HP, damage, XP, abilities, turn order, game system format, movement rules (height, walls), grid interface (hex + square), dice notation parser and roller. Tests first.
4. **Multiplayer foundation:** PeerJS host/join, DM as source of truth, state sync.
5. **Map editor:** Hex/square grid, raise/lower tiles, place shapes, procedural generation, world bounds, save/load. Mouse and touch (tap, drag, pinch zoom). Full editor is PC-first. Edits sync live.
6. **Camera system:** As specified above, including world bounds.
7. **Tokens and combat visuals:** Sprites, movement, HP bars, floating damage numbers, XP bar, ability bar (bottom of screen on phones, large tap targets). All synced. Uses placeholder style pack. Dice panel with roll animation, and chat log with category tabs.
8. **2.5D visual polish:** Depth of field, bloom, lighting, glows.
9. **Mobile performance:** Test on a real mid-range phone; "low graphics" setting.
10. **DM controls:** Fog of war, line of sight, DM-only notes, token permissions.
11. **Sound:** Hits, spells, UI clicks, music.
12. **Local storage and backups:** IndexedDB, Export/Import files.
13. **Style packs and asset import:** Style pack format, asset spec, importer with auto-slicing and preview, auto tokens.
14. **Character creation tools:** One-picture animator and pixel-art converter, then layered builder, mini editor, frame import.
15. **Game system entry:** Manual forms, house rules.
16. **AI features:** Book import, narration suggestions, DM PC image generation.
17. **Custom content:** Custom damage number styles, additional style packs.

## Commands
- `npm run dev` — dev server (add `-- --host` to open it from a phone on the same Wi-Fi)
- `npm test` — run all unit tests once; `npm run test:watch` while developing
- `npm run test:e2e` — Playwright end-to-end tests: real Chrome sessions over real WebRTC, with a local PeerJS server started automatically (includes a phone-width check)
- `npm run typecheck` — type-check all projects (shared is checked without DOM/Node types)
- `npm run build` — type-check and production build

## Development tools
- **Required:** VS Code + Claude Code, Node.js, Git + GitHub, Chrome/Edge, a phone for testing.
- **Project libraries (npm):** TypeScript, Vite, Babylon.js, React, PeerJS, Vitest.
- **Art/sound:** LibreSprite / Piskel / Aseprite, Audacity.
- **Optional AI:** Ollama or LM Studio; ComfyUI + Stable Diffusion + pixel-art LoRA.
- **Later:** Static hosting (GitHub Pages / Netlify / Cloudflare Pages), TURN relay free tier, Capacitor and Tauri/Electron for apps.

## Out of scope for v1
System-specific character sheets, physics-simulated dice (animated dice are in scope), accounts/logins, a marketplace, public sharing of imported book content.
