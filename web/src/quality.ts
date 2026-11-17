// Профили качества + адаптация на лету по времени кадра.

export type QualityName = 'low' | 'mid' | 'high';

export interface QualityProfile {
  name: QualityName;
  poolSplats: number; // ёмкость GPU-пула (≈20 байт/сплат)
  maxRank: number; // доля сплатов, выше которой детали не грузим вообще (1 — всё)
  radius: number; // множитель радиусов «проявления»
  dprMax: number;
  maxSorted: number; // жёсткий потолок сплатов в кадре
}

export const PROFILES: Record<QualityName, QualityProfile> = {
  low: { name: 'low', poolSplats: 1_500_000, maxRank: 0.4, radius: 0.62, dprMax: 1.25, maxSorted: 700_000 },
  mid: { name: 'mid', poolSplats: 2_600_000, maxRank: 0.7, radius: 0.82, dprMax: 1.5, maxSorted: 1_400_000 },
  high: { name: 'high', poolSplats: 4_600_000, maxRank: 1, radius: 1.0, dprMax: 2, maxSorted: 2_600_000 },
};

export function detectQuality(): { name: QualityName; gpu: string } {
  const forced = new URLSearchParams(location.search).get('q') as QualityName | null;
  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    /* ignore */
  }
  if (forced && forced in PROFILES) return { name: forced, gpu };
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const strong = /Apple M\d|RTX|Radeon RX|Radeon Pro|GeForce GTX (10[6-9]|16)|Arc A/i.test(gpu);
  const weak = /Intel|UHD|Iris|Mali|Adreno|PowerVR|SwiftShader|llvmpipe/i.test(gpu);
  if (mobile || mem <= 4) return { name: 'low', gpu };
  if (strong) return { name: 'high', gpu };
  if (weak) return { name: 'mid', gpu };
  return { name: 'mid', gpu };
}

/**
 * Следит за временем кадра: сначала снижает разрешение, потом радиус деталей; возвращает обратно.
 * Решает по медиане кадров за 1.5 с (одиночные пики не в счёт) и только когда ничего не грузится:
 * подгрузка данных даёт тяжёлые кадры, но это не устойчивая нагрузка.
 */
export class Adaptive {
  renderScale = 1;
  detail = 1;
  /** ниже этого радиус деталей не опускаем */
  minDetail = 0.6;
  private frames: number[] = [];
  private sortEma = 10;
  private acc = 0;
  private lastDown = -1e9;
  private time = 0;
  private emaFps = 16.7;
  frozen = false;

  frame(dtMs: number, sortMs: number | null, busy = false) {
    // паузы (фоновая вкладка, троттлинг, отладчик) — не повод снижать качество
    if (dtMs > 200) return;
    this.time += dtMs;
    this.emaFps += (Math.min(dtMs, 100) - this.emaFps) * 0.08;
    if (sortMs != null) this.sortEma += (sortMs - this.sortEma) * 0.2;
    if (busy || this.time < 4000) {
      // идёт загрузка — копим, но не решаем
      this.frames.length = 0;
      this.acc = 0;
      return;
    }
    this.frames.push(dtMs);
    this.acc += dtMs;
    if (this.acc < 1500 || this.frozen) return;
    const sorted = [...this.frames].sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    this.frames.length = 0;
    this.acc = 0;
    const slow = med > 24 || this.sortEma > 90;
    if (slow) {
      if (med > 24 && this.renderScale > 0.7) this.renderScale = Math.max(0.7, this.renderScale - 0.1);
      else this.detail = Math.max(this.minDetail, this.detail - 0.1);
      this.lastDown = this.time;
    } else if (med < 19 && this.sortEma < 60 && this.time - this.lastDown > 3000) {
      if (this.detail < 1) this.detail = Math.min(1, this.detail + 0.1);
      else if (this.renderScale < 1) this.renderScale = Math.min(1, this.renderScale + 0.05);
    }
  }

  get fps() {
    return 1000 / this.emaFps;
  }
}
