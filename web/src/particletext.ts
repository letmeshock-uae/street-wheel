// Надписи финала из частиц: заголовок посреди улицы лицом к идущему, две строки на стенах слева
// и справа, а в конце — «The loop goes on.» на асфальте. Остальной финал — обычная текстовая
// плашка (finale.ts). Каждая надпись «пишется» по мере приближения в порядке чтения: порядок
// лежит в ранге точки; вдали — редкая пыль, при проходе сквозь панель она снова рассыпается.
import type { DecodedChunk } from './data';

const COPY = {
  kicker: 'CITY WORLD MODEL · INSIDE THE LOOP',
  headline: ['Every kilometre', 'counts.'],
  lead: 'Scattered frames become a continuously updated, verifiable model of the city: the most data per kilometre, at the least cost per pass.',
  fleet: 'Hundreds of cars, taxis and couriers drive the same streets with the same cameras. Soon, thousands.',
  flood: 'What comes back is a flood: duplicate, contradictory, ambiguous. Seeing a pole is easy. Deciding what is true is the work.',
  closing: ['The loop goes on.', 'Back to the street.'],
};

const INK = '#ffffff';
const SOFT = '#e2ded6';
const ACCENT = '#ffc35a';
const FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';

/** где на круге-финале стоят надписи (метры от шва) — main.ts подстраивает под них плашку */
export const TEXT_AT = { opening: 30, fleet: 54, flood: 70, wallsEnd: 83, closingFromEnd: 46 };

export interface ParticleTextSpec {
  sMin: number;
  sMax: number;
  lane: number; // ось полосы, по которой идёт камера (w)
  mpp: number; // метров на пиксель холста — чёткость букв
  segId: number;
  scaleLogMin: number;
  scaleLogMax: number;
}

export function particleTextBounds(sp: ParticleTextSpec): { bmin: [number, number, number]; ext: [number, number, number] } {
  return { bmin: [sp.sMin + 2, -0.6, sp.lane - 16], ext: [sp.sMax - sp.sMin - 4, 24, 32] };
}

type Ctx2 = CanvasRenderingContext2D & { letterSpacing?: string };

/** Холст одной надписи с примитивами в метрах; zones — порядок «написания». */
class Panel {
  readonly cv: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly halftones: { x: number; y: number; w: number; h: number }[] = [];
  readonly zones: { x: number; y: number; w: number; h: number }[] = [];
  readonly P: number;
  constructor(readonly wM: number, readonly hM: number, mpp: number) {
    this.P = 1 / mpp;
    this.cv = document.createElement('canvas');
    this.cv.width = Math.max(1, Math.round(wM * this.P));
    this.cv.height = Math.max(1, Math.round(hM * this.P));
    this.ctx = this.cv.getContext('2d', { willReadFrequently: true })!;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    this.ctx.textBaseline = 'alphabetic';
  }
  m = (v: number) => v * this.P;
  font(sizeM: number, weight: number) {
    return `${weight} ${this.m(sizeM).toFixed(1)}px ${FONT}`;
  }
  text(t: string, x: number, y: number, size: number, weight = 600, color = INK, spacing = 0, align: CanvasTextAlign = 'left') {
    const c = this.ctx as Ctx2;
    c.font = this.font(size, weight);
    c.fillStyle = color;
    c.textAlign = align;
    c.letterSpacing = `${this.m(spacing).toFixed(1)}px`;
    const mt = c.measureText(t);
    c.fillText(t, this.m(x), this.m(y));
    c.letterSpacing = '0px';
    c.textAlign = 'left';
    const w = mt.width, px = this.m(x) - (align === 'center' ? w / 2 : align === 'right' ? w : 0);
    const asc = mt.actualBoundingBoxAscent || this.m(size) * 0.8, desc = mt.actualBoundingBoxDescent || this.m(size) * 0.25;
    this.zones.push({ x: px - 2, y: this.m(y) - asc - 2, w: w + 4, h: asc + desc + 4 });
  }
  /** размер шрифта, при котором строка влезает в maxW (не больше size) */
  fit(t: string, size: number, maxW: number, weight = 700, spacing = 0) {
    const c = this.ctx as Ctx2;
    c.font = this.font(size, weight);
    c.letterSpacing = `${this.m(spacing).toFixed(1)}px`;
    const w = c.measureText(t).width / this.P;
    c.letterSpacing = '0px';
    return w > maxW ? (size * maxW) / w : size;
  }
  wrap(t: string, size: number, maxW: number, weight: number) {
    this.ctx.font = this.font(size, weight);
    const lines: string[] = [];
    let line = '';
    for (const w of t.split(/\s+/)) {
      const test = line ? line + ' ' + w : w;
      if (this.ctx.measureText(test).width > this.m(maxW) && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  para(t: string, x: number, y: number, size: number, maxW: number, lh = 1.3, color = SOFT, weight = 500) {
    const lines = this.wrap(t, size, maxW, weight);
    lines.forEach((l, i) => this.text(l, x, y + i * size * lh, size, weight, color));
    return lines.length * size * lh;
  }
  /** крупный текст в этой области — блоками 2×2 (вчетверо меньше точек) */
  halftone(x: number, y: number, w: number, h: number) {
    this.halftones.push({ x: Math.floor(this.m(x)), y: Math.floor(this.m(y)), w: Math.ceil(this.m(w)), h: Math.ceil(this.m(h)) });
  }
}

/** Где стоит надпись: s, h, w — центр; yaw/tilt — плоскость (градусы); stretch — растяжение по «вверх» холста. */
interface Place {
  s: number;
  h: number;
  w: number;
  yaw?: number;
  tilt?: number;
  stretch?: number;
}

/** кватернион (w, x, y, z) поворота, у которого локальные оси: x — нормаль, y — V, z — U; упакован по байту */
function packQuat(U: number[], V: number[]): number {
  const N = [V[1] * U[2] - V[2] * U[1], V[2] * U[0] - V[0] * U[2], V[0] * U[1] - V[1] * U[0]];
  const m00 = N[0], m10 = N[1], m20 = N[2], m01 = V[0], m11 = V[1], m21 = V[2], m02 = U[0], m12 = U[1], m22 = U[2];
  let w: number, x: number, y: number, z: number;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  const b = (v: number) => Math.max(0, Math.min(255, Math.round((v + 1) * 127.5)));
  return (b(w) | (b(x) << 8) | (b(y) << 16) | (b(z) << 24)) >>> 0;
}

export async function buildParticleText(sp: ParticleTextSpec): Promise<DecodedChunk> {
  try {
    await Promise.all(['500', '600', '700'].map((w) => document.fonts.load(`${w} 100px Inter`)));
  } catch {
    /* запасной шрифт тоже подойдёт */
  }
  const mpp = sp.mpp;
  const C = sp.lane;
  const at = (lapX: number) => sp.sMin + lapX;
  const scene: { panel: Panel; at: Place }[] = [];
  const tmp = new Panel(1, 1, mpp);
  const heightOf = (t: string, size: number, maxW: number, lh = 1.3, weight = 500) => tmp.wrap(t, size, maxW, weight).length * size * lh;

  // ---- заголовок: посреди улицы, лицом к идущему
  {
    const PW = 28;
    const subH = heightOf(COPY.lead, 0.95, PW - 1.5, 1.3);
    const p = new Panel(PW, 13 + subH, mpp);
    p.text(COPY.kicker, 0.3, 1.5, p.fit(COPY.kicker, 1.0, PW - 0.6, 700, 0.25), 700, ACCENT, 0.25);
    const hs = Math.min(...COPY.headline.map((l) => p.fit(l, 3.8, PW - 0.6)));
    COPY.headline.forEach((l, i) => p.text(l, 0.2, 6.4 + i * hs * 1.1, hs, 700));
    p.halftone(0, 2.6, PW, 4.0 + hs * 1.1 * COPY.headline.length - 1.2);
    p.para(COPY.lead, 0.3, 12.6, 0.95, PW - 1.5);
    scene.push({ panel: p, at: { s: at(TEXT_AT.opening), w: C, h: 1.2 + p.hM / 2 } });
  }

  // ---- поток: длинные строки на стенах, читаются на ходу
  const wall = (t: string, lapX: number, side: -1 | 1, size = 1.5, len = 26) => {
    const h = heightOf(t, size, len - 1, 1.25, 600);
    const p = new Panel(len, h + 0.8, mpp);
    p.para(t, 0.4, size * 1.05, size, len - 1, 1.25, INK, 600);
    // левая стена: текст идёт вперёд (+s), правая — назад; обе читаются слева направо с улицы
    scene.push({ panel: p, at: { s: at(lapX), w: C + side * 9.5, h: 4.4, yaw: side < 0 ? 90 : -90 } });
  };
  wall(COPY.fleet, TEXT_AT.fleet, -1);
  wall(COPY.flood, TEXT_AT.flood, 1);

  // ---- финальная строка на асфальте, вытянута вдоль улицы, как разметка
  {
    const FW = 17;
    const [l0, l1] = COPY.closing;
    const s0 = tmp.fit(l0, 2.6, FW), s1 = tmp.fit(l1, 1.4, FW);
    const y0 = 0.5 + s0 * 0.75, y1 = y0 + 0.7 + s1 * 0.95;
    const p = new Panel(FW + 1, y1 + 0.5, mpp);
    p.text(l0, (FW + 1) / 2, y0, s0, 700, INK, 0, 'center');
    p.halftone(0, 0, FW + 1, y0 + 0.4);
    p.text(l1, (FW + 1) / 2, y1, s1, 700, ACCENT, 0, 'center');
    scene.push({ panel: p, at: { s: sp.sMax - TEXT_AT.closingFromEnd, w: C, h: 0.06, tilt: -90, stretch: 2.6 } });
  }

  // ---- холсты → точки
  const xs: number[] = [], ys: number[] = [], zs: number[] = [], sgU: number[] = [], sgV: number[] = [];
  const cols: number[] = [], als: number[] = [], ords: number[] = [], quats: number[] = [];
  for (const { panel: p, at: pl } of scene) {
    const yaw = ((pl.yaw ?? 0) * Math.PI) / 180, tilt = ((pl.tilt ?? 0) * Math.PI) / 180;
    const stretch = pl.stretch ?? 1;
    // базис плоскости в уличных координатах (s, h, w): U — вправо по холсту, V — вверх по холсту
    const U = [Math.sin(yaw), 0, Math.cos(yaw)];
    const V = [-Math.sin(tilt) * Math.cos(yaw), Math.cos(tilt), Math.sin(tilt) * Math.sin(yaw)];
    const quat = packQuat(U, V);
    const W = p.cv.width, H = p.cv.height;
    const data = p.ctx.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    for (const r of p.halftones)
      for (let y = Math.max(0, r.y); y < Math.min(H, r.y + r.h); y++) mask.fill(1, y * W + Math.max(0, r.x), y * W + Math.min(W, r.x + r.w));
    const nz = Math.max(1, p.zones.length);
    // порядок «написания»: строка за строкой, внутри строки — слева направо
    const orderAt = (px: number, py: number) => {
      for (let zi = p.zones.length - 1; zi >= 0; zi--) {
        const z = p.zones[zi];
        if (px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h) return (zi + Math.min(1, Math.max(0, (px - z.x) / Math.max(1, z.w))) * 0.85) / nz;
      }
      return 0.98;
    };
    const push = (px: number, py: number, sigmaM: number, r: number, g: number, b: number, a: number) => {
      ords.push(Math.min(1, Math.max(0, orderAt(px, py) + (Math.random() - 0.5) * 0.02)));
      const j = (sigmaM / mpp) * 0.3; // лёгкий разброс — не сетка
      const u = (px + (Math.random() - 0.5) * j) * mpp - p.wM / 2;
      const v = (p.hM / 2 - (py + (Math.random() - 0.5) * j) * mpp) * stretch;
      xs.push(pl.s + U[0] * u + V[0] * v);
      ys.push(pl.h + U[1] * u + V[1] * v);
      zs.push(pl.w + U[2] * u + V[2] * v);
      sgU.push(sigmaM);
      sgV.push(sigmaM * stretch);
      cols.push((r & 255) | ((g & 255) << 8) | ((b & 255) << 16));
      als.push(Math.max(0, Math.min(255, Math.round(a * 255))));
      quats.push(quat);
    };
    const inkAt = (i: number) =>
      Math.max(
        (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255,
        (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2])) / 255,
      );
    const full = (c: number, ink: number) => Math.max(0, Math.min(255, Math.round(c / Math.max(ink, 0.05))));
    const K = 2;
    for (const r of p.halftones)
      for (let y = r.y; y < r.y + r.h - K + 1; y += K)
        for (let x = r.x; x < r.x + r.w - K + 1; x += K) {
          let R = 0, G = 0, B = 0, ink = 0, n = 0;
          for (let yy = y; yy < y + K; yy++)
            for (let xx = x; xx < x + K; xx++) {
              if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
              const i = (yy * W + xx) * 4;
              R += data[i];
              G += data[i + 1];
              B += data[i + 2];
              ink += inkAt(i);
              n++;
            }
          if (!n) continue;
          const cov = Math.min(1, ink / n);
          if (cov < 0.1) continue;
          push(x + K / 2, y + K / 2, 0.72 * K * mpp * Math.sqrt(Math.min(1, cov * 1.15)), full(R / n, cov), full(G / n, cov), full(B / n, cov), 1);
        }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const q = y * W + x;
        if (mask[q]) continue;
        const i = q * 4;
        const ink = inkAt(i);
        if (ink < 0.28) continue;
        push(x + 0.5, y + 0.5, 0.8 * mpp, full(data[i], ink), full(data[i + 1], ink), full(data[i + 2], ink), Math.min(1, ink * 1.3));
      }
  }

  // ---- упаковка — тот же формат, что у кусков улицы; ранг точки = её порядок «написания»
  const n = xs.length;
  const { bmin, ext } = particleTextBounds(sp);
  const texA = new Uint32Array(n * 4);
  const texB = new Uint32Array(n);
  const pos = new Float32Array(n * 3);
  const rank = new Uint16Array(n);
  const alpha = new Uint8Array(n);
  const ls = (v: number) => Math.max(0, Math.min(255, Math.round(((Math.log(Math.max(v, 1e-6)) - sp.scaleLogMin) / (sp.scaleLogMax - sp.scaleLogMin)) * 255)));
  const flat = ls(0.002);
  const q16 = (v: number, b: number, e: number) => Math.max(0, Math.min(65535, Math.round(((v - b) / e) * 65535)));
  let outside = 0;
  for (let i = 0; i < n; i++) {
    if (xs[i] < bmin[0] || xs[i] > bmin[0] + ext[0] || ys[i] < bmin[1] || ys[i] > bmin[1] + ext[1] || zs[i] < bmin[2] || zs[i] > bmin[2] + ext[2]) outside++;
    const qx = q16(xs[i], bmin[0], ext[0]), qy = q16(ys[i], bmin[1], ext[1]), qz = q16(zs[i], bmin[2], ext[2]);
    const r16 = Math.round(ords[i] * 65535);
    const j = i * 4;
    texA[j] = qx | (qy << 16);
    texA[j + 1] = qz | (r16 << 16);
    texA[j + 2] = (cols[i] | (als[i] << 24)) >>> 0;
    texA[j + 3] = quats[i];
    // оси точки: x — нормаль (плоская), y — «вверх» холста, z — «вправо» холста
    texB[i] = flat | (ls(sgV[i]) << 8) | (ls(sgU[i]) << 16) | ((sp.segId & 255) << 24);
    pos[i * 3] = bmin[0] + (qx / 65535) * ext[0];
    pos[i * 3 + 1] = bmin[1] + (qy / 65535) * ext[1];
    pos[i * 3 + 2] = bmin[2] + (qz / 65535) * ext[2];
    rank[i] = r16;
    alpha[i] = als[i];
  }
  // точки за пределами коробки сплющиваются квантованием — сразу видно в консоли
  if (outside) console.warn(`[particle text] ${outside} points outside bounds — enlarge particleTextBounds`);
  return { seg: sp.segId, tier: -2, count: n, texA, texB, pos, rank, alpha };
}
