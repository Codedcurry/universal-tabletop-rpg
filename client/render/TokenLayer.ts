import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import {
  type AnimationStep,
  type Clip,
  type FloatingText,
  type Pose,
  proceduralPose,
  resolveClip,
  scheduleCombatEvents,
} from '@shared/anim';
import { type SpriteDirection, spriteFacing } from '@shared/camera';
import type { CombatEvent, CombatState, Combatant } from '@shared/combat';
import { type Cell, type Grid, cellKey } from '@shared/grid';
import { type GameSystem, computeCreature } from '@shared/system';
import {
  SPRITE_HEIGHT,
  SPRITE_WIDTH,
  drawFigure,
  drawRoundToken,
  teamColor,
} from '../style/placeholderSprites';
import type { StylePack } from '../style/stylePack';

// Creatures on the map: a sprite that always faces the camera (2.5D) or a
// round token (top-down), with an HTML name tag and HP bar floating above,
// played through the animation timeline from shared/anim.

/** Placeholder art only has idle frames, so every other clip uses its fallback motion. */
const AVAILABLE: ReadonlySet<Clip> = new Set<Clip>(['idle']);
const SPRITE_W = 0.8;
const SPRITE_H = (SPRITE_W * SPRITE_HEIGHT) / SPRITE_WIDTH;
const FLOAT_MS = 1400;

interface PlayingStep extends AnimationStep {
  /** Absolute start time (performance.now() milliseconds). */
  readonly at: number;
}

interface Token {
  readonly id: string;
  readonly root: TransformNode;
  readonly pivot: TransformNode;
  readonly sprite: Mesh;
  readonly disc: Mesh;
  /** Follows the root without its billboard turning, so the disc stays flat on the ground. */
  readonly discAnchor: TransformNode;
  readonly material: StandardMaterial;
  readonly label: HTMLDivElement;
  readonly meter: HTMLDivElement;
  readonly fill: HTMLDivElement;
  readonly targetButton: HTMLButtonElement;
  /** A bouncing arrow over the creature whose turn it is. */
  readonly turnMarker: HTMLSpanElement;
  readonly nameTag: HTMLSpanElement;
  readonly discTexture: DynamicTexture;
  combatant: Combatant;
  maxHp: number;
  /** HP shown on the bar: changes when the blow lands, not when the update arrives. */
  hpShown: number;
  hpChanges: { at: number; hp: number }[];
  steps: PlayingStep[];
  /** Where the token stands on the map when not walking. */
  home: Vector3;
  direction: SpriteDirection | null;
}

interface Floater {
  readonly element: HTMLDivElement;
  readonly tokenId: string;
  readonly at: number;
}

export class TokenLayer {
  private readonly tokens = new Map<string, Token>();
  private readonly textures = new Map<string, DynamicTexture>();
  private readonly floaters: Floater[] = [];
  private readonly activeRing: Mesh;
  private grid: Grid | null = null;
  private heights = new Map<string, number>();
  private combat: CombatState | null = null;
  private topDown = false;
  private targets = new Set<string>();

  constructor(
    private readonly scene: Scene,
    private readonly style: StylePack,
    private readonly overlay: HTMLDivElement,
    private readonly onTokenClick: (id: string) => void,
  ) {
    // The creature acting stands on a bright ring with a soft glow inside, in a color apart from the
    // move highlight (which surrounds it), plus the HTML arrow over its name tag.
    this.activeRing = CreateTorus('active-ring', { diameter: style.cellSize * 1.05, thickness: 0.12, tessellation: 40 }, scene);
    const ringMaterial = new StandardMaterial('active-ring', scene);
    ringMaterial.disableLighting = true;
    ringMaterial.emissiveColor = Color3.FromHexString(style.activeColor);
    this.activeRing.material = ringMaterial;
    this.activeRing.isPickable = false;
    const glow = CreateDisc('active-glow', { radius: style.cellSize * 0.5, tessellation: 40 }, scene);
    const glowMaterial = new StandardMaterial('active-glow', scene);
    glowMaterial.disableLighting = true;
    glowMaterial.emissiveColor = Color3.FromHexString(style.activeColor);
    glowMaterial.alpha = 0.3;
    glowMaterial.backFaceCulling = false;
    glow.material = glowMaterial;
    glow.rotation.x = Math.PI / 2;
    glow.position.y = 0.01;
    glow.isPickable = false;
    glow.parent = this.activeRing;
    this.activeRing.setEnabled(false);
  }

  /** The map the tokens stand on (for tile heights and positions). */
  setMap(grid: Grid | null, heights: Map<string, number>): void {
    this.grid = grid;
    this.heights = heights;
    for (const token of this.tokens.values()) token.home = this.groundAt(token.combatant.position);
  }

  setTopDown(topDown: boolean): void {
    this.topDown = topDown;
    for (const token of this.tokens.values()) {
      token.sprite.setEnabled(!topDown);
      token.disc.setEnabled(topDown);
    }
  }

  /** Creatures the current ability can target: their name tags become buttons. */
  setTargets(ids: readonly string[], intent: 'harm' | 'help' = 'harm'): void {
    this.targets = new Set(ids);
    for (const token of this.tokens.values()) {
      const targetable = this.targets.has(token.id);
      token.targetButton.hidden = !targetable;
      token.targetButton.classList.toggle('help', intent === 'help');
      token.label.classList.toggle('targetable', targetable);
    }
  }

  /**
   * Shows a new combat state. With `events` (the action that produced it),
   * creatures act it out on the timeline; without, they just appear in place.
   */
  setCombat(combat: CombatState | null, system: GameSystem | null, events: readonly CombatEvent[] | null, now: number): void {
    this.combat = combat;
    const present = new Set(Object.keys(combat?.combatants ?? {}));
    for (const [id, token] of this.tokens) {
      if (!present.has(id)) this.remove(token);
    }
    if (!combat || !system) {
      this.activeRing.setEnabled(false);
      return;
    }

    const timeline = events
      ? scheduleCombatEvents(events, {
          combatantIds: combat.order,
          sideOf: (id) => combat.combatants[id]?.side ?? '',
          isStanding: (id) => (combat.combatants[id]?.hp ?? 0) > 0,
          conditionName: (id) => system.conditions.find((condition) => condition.id === id)?.name ?? id,
        })
      : null;

    for (const [id, combatant] of Object.entries(combat.combatants)) {
      const token = this.tokens.get(id) ?? this.create(id, combatant);
      const previousHp = token.combatant.hp;
      // The DM can rename creatures or move them to another side at any moment.
      if (combatant.sheet.name !== token.combatant.sheet.name || combatant.side !== token.combatant.side) {
        token.nameTag.textContent = combatant.sheet.name;
        token.targetButton.textContent = `Target ${combatant.sheet.name}`;
        drawRoundToken(token.discTexture.getContext() as unknown as CanvasRenderingContext2D, 64, combatant.sheet.name, teamColor(combatant.side));
        token.discTexture.update();
        token.direction = null; // redraw the sprite in its new colors
      }
      token.combatant = combatant;
      token.maxHp = computeCreature(system, combatant.sheet).maxHp;
      token.home = this.groundAt(combatant.position);
      token.label.dataset.cell = `${combatant.position.q},${combatant.position.r}`;

      const mine = timeline?.steps.filter((step) => step.combatantId === id) ?? [];
      token.steps.push(...mine.map((step) => ({ ...step, at: now + step.start })));
      // The bar changes when the blow (or heal) lands, if this action showed one.
      const landed = timeline?.texts.find((text) => text.combatantId === id && (text.kind === 'damage' || text.kind === 'heal'));
      if (landed && combatant.hp !== previousHp) {
        token.hpChanges.push({ at: now + landed.start, hp: combatant.hp });
      } else {
        token.hpShown = combatant.hp;
      }
      this.updateLabel(token);
    }
    for (const text of timeline?.texts ?? []) this.float(text, now);
    this.markActive();
  }

  /** Points out the creature whose turn it is: arrow and highlighted name tag (the ring follows in update). */
  private markActive(): void {
    const activeId = this.combat?.status === 'active' ? this.combat.order[this.combat.turnIndex] : undefined;
    for (const token of this.tokens.values()) {
      const active = token.id === activeId;
      token.label.dataset.active = String(active);
      token.label.classList.toggle('active', active);
      token.turnMarker.hidden = !active;
    }
  }

  /**
   * Advances animations and moves name tags to follow their creatures.
   * Returns true while anything is still moving, so the view keeps drawing.
   */
  update(now: number, cameraHeading: number, viewport: { width: number; height: number }): boolean {
    let animating = false;
    const transform = this.scene.getTransformMatrix();
    const screen = new Viewport(0, 0, viewport.width, viewport.height);
    const activeId = this.combat?.status === 'active' ? this.combat.order[this.combat.turnIndex] : undefined;

    for (const token of this.tokens.values()) {
      while (token.hpChanges[0] && token.hpChanges[0].at <= now) {
        token.hpShown = (token.hpChanges.shift() as { hp: number }).hp;
        this.updateLabel(token);
      }
      if (token.hpChanges.length > 0) animating = true;

      // Finished steps fall away; the creature is back to idle (or stays down).
      while (token.steps[0] && now > token.steps[0].at + token.steps[0].duration) token.steps.shift();
      const step = token.steps[0] && now >= token.steps[0].at ? token.steps[0] : null;
      if (token.steps.length > 0) animating = true;

      let position = token.home;
      let pose: Pose = proceduralPose(token.combatant.hp > 0 ? 'none' : 'tipOver', 1);
      if (step) {
        const progress = step.duration > 0 ? (now - step.at) / step.duration : 1;
        if (step.clip === 'walk' && step.path && step.path.length > 1) position = this.alongPath(step.path, progress);
        const resolved = resolveClip(AVAILABLE, step.clip);
        if (resolved.kind === 'procedural') pose = proceduralPose(resolved.motion, progress);
      }
      this.applyPose(token, position, pose, cameraHeading);

      // Name tag above the head; in top-down (north up), just north of the round token.
      const tagAnchor = this.topDown ? new Vector3(0, 0.05, -0.5 * this.style.cellSize) : new Vector3(0, SPRITE_H + 0.15, 0);
      const head = Vector3.Project(position.add(tagAnchor), Matrix.Identity(), transform, screen);
      const visible = head.z > 0 && head.z < 1;
      token.label.style.display = visible ? '' : 'none';
      token.label.style.transform = `translate(${head.x}px, ${head.y}px) translate(-50%, -100%)`;
    }

    if (activeId && this.tokens.has(activeId)) {
      const active = this.tokens.get(activeId) as Token;
      this.activeRing.setEnabled(true);
      this.activeRing.position.copyFrom(active.home.add(new Vector3(0, 0.02, 0)));
    } else {
      this.activeRing.setEnabled(false);
    }

    // Floating numbers rise and fade, then go.
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const floater = this.floaters[i] as Floater;
      if (now < floater.at) {
        floater.element.style.display = 'none';
        animating = true;
        continue;
      }
      const age = (now - floater.at) / FLOAT_MS;
      const token = this.tokens.get(floater.tokenId);
      if (age >= 1 || !token) {
        floater.element.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      animating = true;
      const anchor = Vector3.Project(token.home.add(new Vector3(0, SPRITE_H, 0)), Matrix.Identity(), transform, screen);
      floater.element.style.display = '';
      floater.element.style.opacity = String(age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3);
      floater.element.style.transform = `translate(${anchor.x}px, ${anchor.y - 50 * age}px) translate(-50%, -100%)`;
    }
    return animating;
  }

  dispose(): void {
    for (const token of this.tokens.values()) this.remove(token);
    for (const floater of this.floaters) floater.element.remove();
    for (const texture of this.textures.values()) texture.dispose();
    this.activeRing.dispose();
  }

  // -------------------------------------------------------------------------

  private groundAt(cell: Cell): Vector3 {
    if (!this.grid) return Vector3.Zero();
    const { x, z } = this.grid.toWorld(cell, this.style.cellSize);
    const height = this.heights.get(cellKey(cell)) ?? 0;
    return new Vector3(x, (height + 1) * this.style.levelHeight, z);
  }

  private alongPath(path: readonly Cell[], progress: number): Vector3 {
    const t = Math.min(1, Math.max(0, progress)) * (path.length - 1);
    const index = Math.min(path.length - 2, Math.floor(t));
    const from = this.groundAt(path[index] as Cell);
    const to = this.groundAt(path[index + 1] as Cell);
    return Vector3.Lerp(from, to, t - index);
  }

  private applyPose(token: Token, position: Vector3, pose: Pose, cameraHeading: number): void {
    const facing = token.combatant.facing;
    const forward = new Vector3(Math.sin(facing), 0, -Math.cos(facing));
    const right = new Vector3(Math.cos(facing), 0, Math.sin(facing));
    const offset = forward.scale(pose.forward).add(right.scale(pose.side)).add(new Vector3(0, pose.up, 0));
    token.root.position.copyFrom(position.add(offset.scale(this.style.cellSize)));
    token.discAnchor.position.copyFrom(token.root.position);
    token.pivot.rotation.z = pose.tilt;
    token.sprite.visibility = pose.alpha;
    token.disc.visibility = pose.alpha;
    token.sprite.overlayAlpha = 0.6 * pose.red;
    token.disc.overlayAlpha = 0.6 * pose.red;

    const direction = spriteFacing(facing, cameraHeading);
    if (direction !== token.direction) {
      token.direction = direction;
      token.material.diffuseTexture = this.figure(token.combatant.side, direction);
    }
  }

  private figure(side: string, direction: SpriteDirection): DynamicTexture {
    const key = `figure:${side}:${direction}`;
    let texture = this.textures.get(key);
    if (!texture) {
      texture = new DynamicTexture(key, { width: SPRITE_WIDTH, height: SPRITE_HEIGHT }, this.scene, false, Texture.NEAREST_SAMPLINGMODE);
      texture.hasAlpha = true;
      drawFigure(texture.getContext() as unknown as CanvasRenderingContext2D, direction, teamColor(side));
      texture.update(); // flipped for the GPU, like every canvas texture; without it the figure is upside down
      this.textures.set(key, texture);
    }
    return texture;
  }

  private create(id: string, combatant: Combatant): Token {
    const root = new TransformNode(`token-${id}`, this.scene);
    root.billboardMode = TransformNode.BILLBOARDMODE_Y; // always faces the camera, standing upright
    const pivot = new TransformNode(`token-pivot-${id}`, this.scene);
    pivot.parent = root;

    const material = new StandardMaterial(`token-${id}`, this.scene);
    material.disableLighting = true;
    material.emissiveColor = Color3.White();
    material.useAlphaFromDiffuseTexture = true;
    material.backFaceCulling = false;

    const sprite = CreatePlane(`sprite-${id}`, { width: SPRITE_W, height: SPRITE_H }, this.scene);
    sprite.parent = pivot;
    sprite.position.y = SPRITE_H / 2; // feet on the ground, tipping over around the feet
    sprite.material = material;
    sprite.isPickable = false;
    sprite.renderOverlay = true;
    sprite.overlayColor = Color3.Red();
    sprite.overlayAlpha = 0;

    const discTexture = new DynamicTexture(`disc-${id}`, { width: 64, height: 64 }, this.scene, true);
    discTexture.hasAlpha = true;
    drawRoundToken(discTexture.getContext() as unknown as CanvasRenderingContext2D, 64, combatant.sheet.name, teamColor(combatant.side));
    discTexture.update();
    const discMaterial = new StandardMaterial(`disc-${id}`, this.scene);
    discMaterial.disableLighting = true;
    discMaterial.emissiveColor = Color3.White();
    discMaterial.diffuseTexture = discTexture;
    discMaterial.useAlphaFromDiffuseTexture = true;
    const disc = CreateDisc(`disc-${id}`, { radius: this.style.cellSize * 0.42, tessellation: 32 }, this.scene);
    disc.rotation.x = Math.PI / 2; // lie flat, facing up
    disc.position.y = 0.03;
    disc.material = discMaterial;
    disc.isPickable = false;
    disc.renderOverlay = true;
    disc.overlayColor = Color3.Red();
    disc.overlayAlpha = 0;
    // The disc lies on the ground: parent it to an un-billboarded node that follows the root.
    const discAnchor = new TransformNode(`disc-anchor-${id}`, this.scene);
    disc.parent = discAnchor;

    sprite.setEnabled(!this.topDown);
    disc.setEnabled(this.topDown);

    // Name tag and HP bar, as HTML over the canvas for crisp text.
    const label = document.createElement('div');
    label.className = 'token-label';
    label.dataset.testid = 'token';
    label.dataset.id = id;
    const name = document.createElement('span');
    name.className = 'token-name';
    name.textContent = combatant.sheet.name;
    const meter = document.createElement('div');
    meter.className = 'token-hp';
    meter.setAttribute('role', 'meter');
    const fill = document.createElement('div');
    fill.className = 'token-hp-fill';
    meter.append(fill);
    const targetButton = document.createElement('button');
    targetButton.type = 'button';
    targetButton.className = 'token-target';
    targetButton.textContent = `Target ${combatant.sheet.name}`;
    targetButton.hidden = true;
    targetButton.addEventListener('click', () => this.onTokenClick(id));
    const turnMarker = document.createElement('span');
    turnMarker.className = 'turn-marker';
    turnMarker.dataset.testid = 'turn-marker';
    turnMarker.textContent = '▼';
    turnMarker.setAttribute('aria-hidden', 'true');
    turnMarker.hidden = true;
    label.dataset.active = 'false';
    label.append(turnMarker, name, meter, targetButton);
    this.overlay.append(label);

    const token: Token = {
      id,
      root,
      pivot,
      sprite,
      disc,
      discAnchor,
      nameTag: name,
      discTexture,
      material,
      label,
      meter,
      fill,
      targetButton,
      turnMarker,
      combatant,
      maxHp: 1,
      hpShown: combatant.hp,
      hpChanges: [],
      steps: [],
      home: this.groundAt(combatant.position),
      direction: null,
    };
    this.tokens.set(id, token);
    return token;
  }

  private updateLabel(token: Token): void {
    const name = token.combatant.sheet.name;
    const hp = token.hpShown;
    token.meter.setAttribute('aria-label', hp > 0 ? `${name}: ${hp} of ${token.maxHp} HP` : `${name}: down`);
    token.meter.setAttribute('aria-valuemin', '0');
    token.meter.setAttribute('aria-valuemax', String(token.maxHp));
    token.meter.setAttribute('aria-valuenow', String(hp));
    const share = Math.max(0, Math.min(1, hp / token.maxHp));
    token.fill.style.width = `${share * 100}%`;
    token.fill.classList.toggle('low', share <= 0.35);
    token.label.classList.toggle('down', hp <= 0);
  }

  private float(text: FloatingText, now: number): void {
    const element = document.createElement('div');
    element.className = `float-text ${text.kind}`;
    element.dataset.testid = 'float-text';
    element.textContent = text.text;
    element.style.display = 'none';
    this.overlay.append(element);
    this.floaters.push({ element, tokenId: text.combatantId, at: now + text.start });
  }

  private remove(token: Token): void {
    token.root.dispose(false, false);
    token.sprite.dispose();
    token.disc.dispose();
    token.discAnchor.dispose();
    token.material.dispose();
    token.label.remove();
    this.tokens.delete(token.id);
  }
}

