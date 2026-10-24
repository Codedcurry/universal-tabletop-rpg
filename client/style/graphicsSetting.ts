import { type GraphicsQuality, defaultQuality, parseQuality } from '@shared/graphics';

// Each viewer's graphics setting, kept on this device. Without a saved
// choice, a sensible default for the device: phones start on Low.

const KEY = 'graphics-quality';

export function loadGraphicsQuality(): GraphicsQuality {
  try {
    const saved = parseQuality(localStorage.getItem(KEY));
    if (saved) return saved;
  } catch {
    // Storage blocked (private mode): fall back to the default.
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return defaultQuality({
    touch: matchMedia('(pointer: coarse)').matches,
    // The short side (a phone held sideways is still a phone); the window too, as some browsers report a desktop-sized screen.
    screenWidth: Math.min(screen.width, screen.height, window.innerWidth),
    ...(nav.hardwareConcurrency ? { cores: nav.hardwareConcurrency } : {}),
    ...(nav.deviceMemory ? { memoryGb: nav.deviceMemory } : {}),
  });
}

export function saveGraphicsQuality(quality: GraphicsQuality): void {
  try {
    localStorage.setItem(KEY, quality);
  } catch {
    // Not saved; the choice still applies until the page closes.
  }
}
