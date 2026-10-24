import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Color4 } from '@babylonjs/core/Maths/math.color';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { DepthOfFieldEffectBlurLevel } from '@babylonjs/core/PostProcesses/depthOfFieldEffect';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent';
import '@babylonjs/core/Rendering/depthRendererSceneComponent';
import type { Scene } from '@babylonjs/core/scene';
import { type EffectSettings, depthOfFieldLens } from '@shared/graphics';

// The HD-2D polish over the scene: bloom, depth of field (2.5D view only),
// soft sun shadows, glows, and a gentle color grade. What is on comes from
// the graphics setting (shared/graphics); changing it rebuilds the effects.

const BLUR_LEVELS = {
  low: DepthOfFieldEffectBlurLevel.Low,
  medium: DepthOfFieldEffectBlurLevel.Medium,
  high: DepthOfFieldEffectBlurLevel.High,
} as const;

export class SceneEffects {
  private settings: EffectSettings | null = null;
  private pipeline: DefaultRenderingPipeline | null = null;
  private glow: GlowLayer | null = null;
  private shadows: ShadowGenerator | null = null;
  private topDown = false;
  private focus = 0;
  private readonly casters = new Set<AbstractMesh>();
  private readonly receivers = new Set<AbstractMesh>();
  private readonly glowing = new Set<Mesh>();
  /** The background color as the scene was given it. */
  private readonly background: Color4;

  constructor(
    private readonly scene: Scene,
    private readonly engine: AbstractEngine,
    private readonly camera: Camera,
    private readonly sun: DirectionalLight,
  ) {
    this.background = scene.clearColor.clone();
  }

  /** Switches to new settings (a different graphics quality). */
  apply(settings: EffectSettings): void {
    this.disposeEffects();
    this.settings = settings;
    // Sharper on high-DPI screens, up to the setting's limit.
    this.engine.setHardwareScalingLevel(1 / Math.max(1, Math.min(window.devicePixelRatio || 1, settings.maxPixelRatio)));

    if (settings.shadows) {
      const shadows = new ShadowGenerator(settings.shadows.mapSize, this.sun);
      shadows.usePercentageCloserFiltering = true; // soft edges
      shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
      shadows.bias = 0.0002; // a share of the 400-unit depth range: about 0.08 units
      shadows.normalBias = 0.02;
      shadows.setDarkness(0.35);
      // The sun sits 150 units back along its direction (see WorldView): cover everything in front of it.
      this.sun.shadowMinZ = 1;
      this.sun.shadowMaxZ = 400;
      this.shadows = shadows;
      for (const mesh of this.casters) shadows.addShadowCaster(mesh, false);
    }
    for (const mesh of this.receivers) mesh.receiveShadows = this.shadows !== null;

    if (settings.glow) {
      const glow = new GlowLayer('glow', this.scene, { blurKernelSize: settings.glow.blurKernelSize });
      glow.intensity = settings.glow.intensity;
      // Only what is meant to glow (sprites are emissive too, and must stay crisp). Everything else
      // is drawn black, so a creature standing in front of a glow hides it instead of being washed over.
      glow.customEmissiveColorSelector = (mesh, _subMesh, material, result) => {
        const emissive = this.glowing.has(mesh as Mesh) ? (material as StandardMaterial).emissiveColor : null;
        if (emissive) result.set(emissive.r, emissive.g, emissive.b, 1);
        else result.set(0, 0, 0, 1);
      };
      this.glow = glow;
    }

    if (settings.bloom || settings.depthOfField || settings.grade || settings.msaaSamples > 1) {
      const pipeline = new DefaultRenderingPipeline('polish', true, this.scene, [this.camera]);
      pipeline.samples = settings.msaaSamples;
      pipeline.fxaaEnabled = false; // it would blur the pixel art
      if (settings.bloom) {
        pipeline.bloomEnabled = true;
        pipeline.bloomThreshold = settings.bloom.threshold;
        pipeline.bloomWeight = settings.bloom.weight;
        pipeline.bloomKernel = settings.bloom.kernel;
        pipeline.bloomScale = settings.bloom.scale;
      }
      if (settings.depthOfField) pipeline.depthOfFieldBlurLevel = BLUR_LEVELS[settings.depthOfField.blurLevel];
      pipeline.imageProcessingEnabled = settings.grade !== null;
      if (settings.grade) {
        const grade = pipeline.imageProcessing;
        // No tone mapping: it washes out the flat pixel-art colors. Contrast and a vignette do the grading.
        grade.toneMappingEnabled = false;
        grade.exposure = settings.grade.exposure;
        grade.contrast = settings.grade.contrast;
        grade.vignetteEnabled = true;
        grade.vignetteWeight = settings.grade.vignette;
        grade.vignetteCameraFov = 0.6;
      }
      this.pipeline = pipeline;
      // The pipeline treats the background as linear and brightens it on output: hand it the linear color.
      this.scene.clearColor = this.background.toLinearSpace();
      this.updateDepthOfField();
    }
  }

  /** A mesh that casts sun shadows (and, unless told otherwise, receives them). */
  addShadowCaster(mesh: AbstractMesh, receives = true): void {
    this.casters.add(mesh);
    this.shadows?.addShadowCaster(mesh, false);
    if (receives) {
      this.receivers.add(mesh);
      mesh.receiveShadows = this.shadows !== null;
    }
    mesh.onDisposeObservable.addOnce(() => {
      this.casters.delete(mesh);
      this.receivers.delete(mesh);
      this.shadows?.removeShadowCaster(mesh, false);
    });
  }

  /** A mesh that gets a soft glow halo. */
  addGlow(mesh: Mesh): void {
    this.glowing.add(mesh);
    mesh.onDisposeObservable.addOnce(() => this.glowing.delete(mesh));
  }

  /** Depth of field belongs to the tilted view; looking straight down, everything is at one depth. */
  setTopDown(topDown: boolean): void {
    this.topDown = topDown;
    this.updateDepthOfField();
  }

  /** Keeps the focus on the point the camera looks at (call when the camera moves). */
  setFocus(distance: number): void {
    if (Math.abs(distance - this.focus) < 1e-3) return;
    this.focus = distance;
    this.updateDepthOfField();
  }

  private updateDepthOfField(): void {
    const pipeline = this.pipeline;
    const settings = this.settings?.depthOfField;
    if (!pipeline) return;
    const enabled = !!settings && !this.topDown && this.focus > 0;
    if (pipeline.depthOfFieldEnabled !== enabled) pipeline.depthOfFieldEnabled = enabled;
    if (!enabled || !settings) return;
    const lens = depthOfFieldLens(this.focus, settings);
    pipeline.depthOfField.focusDistance = lens.focusDistance;
    pipeline.depthOfField.focalLength = lens.focalLength;
    pipeline.depthOfField.fStop = lens.fStop;
    pipeline.depthOfField.lensSize = lens.lensSize;
  }

  private disposeEffects(): void {
    this.pipeline?.dispose();
    this.pipeline = null;
    this.scene.clearColor = this.background.clone();
    this.glow?.dispose();
    this.glow = null;
    this.shadows?.dispose();
    this.shadows = null;
  }

  dispose(): void {
    this.disposeEffects();
    this.casters.clear();
    this.receivers.clear();
    this.glowing.clear();
  }
}
