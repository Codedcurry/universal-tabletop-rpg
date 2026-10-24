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

### Known gaps (planned, not built yet)
- The DM's session lives in memory: reloading the DM's page ends the game (storage is step 12).
- No TURN relay configured yet; players on strict networks (some mobile carriers) may fail to connect. See `.env.example`.
- DM overrides and house rules (build step 15) — the engine currently only enforces.
- Line of sight for targeting (step 10); range is grid distance only.
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
- Animated dice tumble across the screen and land on the result, styled to match the active style pack. Coins flip and land heads/tails.
- **Not a physics simulation:** the result is decided first, then the animation plays to land on that face. This keeps results fair and works on phones.
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
