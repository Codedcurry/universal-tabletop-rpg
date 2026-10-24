/**
 * The 2.5D polish (HD-2D style): bloom, depth of field, soft shadows, glows,
 * and a gentle color grade, and how much of it each graphics setting turns
 * on. Pure settings and lens math; the renderer applies them.
 */

export const GRAPHICS_QUALITIES = ['low', 'medium', 'high'] as const;
export type GraphicsQuality = (typeof GRAPHICS_QUALITIES)[number];

export interface DepthOfFieldSettings {
  /** 0 to 1: how blurred things get far from the focus. */
  readonly strength: number;
  /** How smooth the blur is (costlier when higher). */
  readonly blurLevel: 'low' | 'medium' | 'high';
}

export interface EffectSettings {
  /** Bright things bleed light. */
  readonly bloom: { readonly threshold: number; readonly weight: number; readonly kernel: number; readonly scale: number } | null;
  /** Tilt-shift look: sharp where the camera looks, soft nearer and farther (2.5D view only). */
  readonly depthOfField: DepthOfFieldSettings | null;
  /** Sun shadows, softened at the edges. */
  readonly shadows: { readonly mapSize: number } | null;
  /** Glowing things (the active ring, highlights, effects) get a soft halo. */
  readonly glow: { readonly intensity: number; readonly blurKernelSize: number } | null;
  /** Contrast, exposure, and a light vignette. */
  readonly grade: { readonly exposure: number; readonly contrast: number; readonly vignette: number } | null;
  /**
   * Edge anti-aliasing. Multisampling only smooths geometry edges; screen-space
   * smoothing (FXAA) is never used because it would blur the pixel art.
   */
  readonly msaaSamples: 1 | 2 | 4;
  /** Render at most this many pixels per CSS pixel (sharper on high-DPI screens, costlier). */
  readonly maxPixelRatio: number;
}

const EFFECTS: Readonly<Record<GraphicsQuality, EffectSettings>> = {
  low: { bloom: null, depthOfField: null, shadows: null, glow: null, grade: null, msaaSamples: 1, maxPixelRatio: 1 },
  medium: {
    bloom: { threshold: 0.9, weight: 0.2, kernel: 32, scale: 0.5 },
    depthOfField: null,
    shadows: { mapSize: 1024 },
    glow: { intensity: 0.5, blurKernelSize: 16 },
    grade: { exposure: 1, contrast: 1.15, vignette: 1.2 },
    msaaSamples: 2,
    maxPixelRatio: 1.5,
  },
  high: {
    bloom: { threshold: 0.88, weight: 0.3, kernel: 64, scale: 0.5 },
    depthOfField: { strength: 0.8, blurLevel: 'medium' },
    shadows: { mapSize: 2048 },
    glow: { intensity: 0.6, blurKernelSize: 32 },
    grade: { exposure: 1, contrast: 1.2, vignette: 1.5 },
    msaaSamples: 4,
    maxPixelRatio: 2,
  },
};

export function effectsFor(quality: GraphicsQuality): EffectSettings {
  return EFFECTS[quality];
}

export interface DeviceInfo {
  readonly touch: boolean;
  /** The screen's shorter side in CSS pixels (so a phone held sideways still counts as a phone). */
  readonly screenWidth: number;
  readonly cores?: number;
  readonly memoryGb?: number;
}

/** A sensible starting setting: phones low, tablets and weak computers medium, the rest high. */
export function defaultQuality(device: DeviceInfo): GraphicsQuality {
  if (device.touch && device.screenWidth < 768) return 'low';
  const weak = (device.cores !== undefined && device.cores <= 2) || (device.memoryGb !== undefined && device.memoryGb <= 2);
  return device.touch || weak ? 'medium' : 'high';
}

/** A saved setting, or null if it isn't one. */
export function parseQuality(value: unknown): GraphicsQuality | null {
  return GRAPHICS_QUALITIES.find((quality) => quality === value) ?? null;
}

// ---------------------------------------------------------------------------
// Depth of field

/** A camera lens, in millimeters (scene units x 1000), as the renderer's depth of field takes it. */
export interface Lens {
  readonly focusDistance: number;
  readonly focalLength: number;
  readonly fStop: number;
  readonly lensSize: number;
}

const F_STOP = 1.4;
const LENS_SIZE = 50;
/** Blur (0 to 1) at full strength for something at half the focus distance. */
const FULL_BLUR = 0.5;

/**
 * A lens focused at `focus` (scene units from the camera). The focal length
 * grows with the focus distance, so the look stays the same at any zoom:
 * blur depends only on how far something is relative to the focus.
 */
export function depthOfFieldLens(focus: number, settings: DepthOfFieldSettings): Lens {
  // Blur at distance D is K * |S - D| / D, where K = (lensSize / fStop) * f / (S - f).
  // Choose f as a fixed share of S so that K = FULL_BLUR * strength.
  const k = (FULL_BLUR * settings.strength * F_STOP) / LENS_SIZE;
  const share = k / (1 + k);
  const focusDistance = focus * 1000;
  return { focusDistance, focalLength: share * focusDistance, fStop: F_STOP, lensSize: LENS_SIZE };
}

/** How blurred (0 to 1) something at `distance` (scene units) looks through the lens. */
export function blurAt(lens: Lens, distance: number): number {
  const depth = distance * 1000;
  const aperture = lens.lensSize / lens.fStop;
  const precalculated = (aperture * lens.focalLength) / (lens.focusDistance - lens.focalLength);
  return Math.min(1, Math.abs((precalculated * (lens.focusDistance - depth)) / depth));
}
