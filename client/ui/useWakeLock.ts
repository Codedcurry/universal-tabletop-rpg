import { useEffect } from 'react';

// Keeps the screen from dimming and locking while `active` (in a game, with
// "Keep mobile screens awake" checked). A phone that locks sends the tab to the
// background, which drops the connection until the player comes back. The
// browser lets go of the lock whenever the tab is hidden, so it is asked for
// again when the tab is shown. Browsers without the feature just skip it.

interface Sentinel {
  release(): Promise<void>;
}
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> };

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
    if (!active || !wakeLock) return;
    let sentinel: Sentinel | null = null;
    let stopped = false;

    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const next = await wakeLock.request('screen');
        if (stopped) await next.release();
        else sentinel = next;
      } catch {
        // Refused (e.g. battery saver): the screen just may dim.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release();
      sentinel = null;
    };
  }, [active]);
}
