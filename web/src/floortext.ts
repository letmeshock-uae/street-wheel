// Финальная строка на асфальте — «The loop goes on. / Back to the street.» из частиц, как дорожная
// разметка. Лежит на круге-финале сразу после того, как текстовая плашка уехала вверх, и перед тем,
// как город собирается обратно: вдали — редкая пыль, по мере приближения собирается целиком (shaders.ts).
import type { DecodedChunk } from './data';

const LINES = ['The loop goes on.', 'Back to the street.'] as const;
const INK = '#ffffff';
const ACCENT = '#ffc35a';
const FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';

/** ширина надписи, м — помещается между стенами улицы */
const WIDTH = 17;
/** вытянута вдоль улицы, как разметка: в перспективе буквы выглядят нормальными */
const STRETCH = 2.6;
/** сплат лежит плашмя: поворот на 90° вокруг оси w (локальная x → «вверх», y → вдоль улицы) */
const QUAT_FLAT = (218 | (128 << 8) | (128 << 16) | (218 << 24)) >>> 0;

export interface FloorTextSpec {
  sCenter: number; // центр надписи вдоль улицы (s)
  w: number; // ось полосы, по которой идёт камера (w)
  mpp: number; // метров на пиксель холста — чёткость букв
  segId: number;
  scaleLogMin: number;
  scaleLogMax: number;
}

export function floorTextBounds(sp: FloorTextSpec): { bmin: [number, number, number]; ext: [number, number, number] } {
  return { bmin: [sp.sCenter - 16, -0.5, sp.w - 11], ext: [32, 1.5, 22] };
}

export async function buildFloorText(sp: FloorTextSpec): Promise<DecodedChunk> {
  try {
    await document.fonts.load(`700 100px Inter`);
  } catch {
    /* запасной шрифт тоже подойдёт */
  }
  const P = 1 / sp.mpp; // пикселей на метр
  const ctx0 = document.createElement('canvas').getContext('2d')!;
  const fit = (t: string, size: number) => {
    ctx0.font = `700 ${(size * P).toFixed(1)}px ${FONT}`;
    const w = ctx0.measureText(t).width / P;
    return w > WIDTH ? (size * WIDTH) / w : size;
  };
  const s0 = fit(LINES[0], 2.6), s1 = fit(LINES[1], 1.4);
  const y0 = 0.5 + s0 * 0.75, y1 = y0 + 0.7 + s1 * 0.95;
  const wM = WIDTH + 1, hM = y1 + 0.5;

  const cv = document.createElement('canvas');
  cv.width = Math.round(wM * P);
  cv.height = Math.round(hM * P);
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.fillStyle = '#000';
  c.fillRect(0, 0, cv.width, cv.height);
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.font = `700 ${(s0 * P).toFixed(1)}px ${FONT}`;
  c.fillStyle = INK;
  c.fillText(LINES[0], (wM / 2) * P, y0 * P);
  c.font = `700 ${(s1 * P).toFixed(1)}px ${FONT}`;
  c.fillStyle = ACCENT;
  c.fillText(LINES[1], (wM / 2) * P, y1 * P);

  const W = cv.width, H = cv.height;
  const data = c.getImageData(0, 0, W, H).data;
  const xs: number[] = [], zs: number[] = [], sig: number[] = [], cols: number[] = [], als: number[] = [];
  // холст → улица: вправо по холсту — +w, вверх по холсту — вперёд по улице (+s)
  const push = (px: number, py: number, sigma: number, r: number, g: number, b: number, a: number) => {
    const j = (sigma / sp.mpp) * 0.3; // лёгкий разброс — не сетка
    xs.push(sp.sCenter + (hM / 2 - (py + (Math.random() - 0.5) * j) / P) * STRETCH);
    zs.push(sp.w + (px + (Math.random() - 0.5) * j) / P - wM / 2);
    sig.push(sigma);
    cols.push((r & 255) | ((g & 255) << 8) | ((b & 255) << 16));
    als.push(Math.max(0, Math.min(255, Math.round(a * 255))));
  };
  const inkAt = (i: number) =>
    Math.max(
      (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255,
      (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2])) / 255,
    );
  const full = (v: number, ink: number) => Math.max(0, Math.min(255, Math.round(v / Math.max(ink, 0.05))));
  // крупная строка — блоками 2×2 (вчетверо меньше точек), мелкая — по пикселю, чтобы буквы были чёткими
  const split = Math.round((y0 + 0.4) * P);
  const K = 2;
  for (let y = 0; y + K <= split; y += K)
    for (let x = 0; x + K <= W; x += K) {
      let R = 0, G = 0, B = 0, ink = 0;
      for (let yy = y; yy < y + K; yy++)
        for (let xx = x; xx < x + K; xx++) {
          const i = (yy * W + xx) * 4;
          R += data[i];
          G += data[i + 1];
          B += data[i + 2];
          ink += inkAt(i);
        }
      const n = K * K, cov = Math.min(1, ink / n);
      if (cov < 0.1) continue;
      push(x + K / 2, y + K / 2, 0.72 * K * sp.mpp * Math.sqrt(Math.min(1, cov * 1.15)), full(R / n, cov), full(G / n, cov), full(B / n, cov), 1);
    }
  for (let y = split; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const ink = inkAt(i);
      if (ink < 0.28) continue;
      push(x + 0.5, y + 0.5, 0.8 * sp.mpp, full(data[i], ink), full(data[i + 1], ink), full(data[i + 2], ink), Math.min(1, ink * 1.3));
    }

  // ---- упаковка — тот же формат, что у кусков улицы
  const n = xs.length;
  const { bmin, ext } = floorTextBounds(sp);
  const texA = new Uint32Array(n * 4);
  const texB = new Uint32Array(n);
  const pos = new Float32Array(n * 3);
  const rank = new Uint16Array(n);
  const alpha = new Uint8Array(n);
  const ls = (v: number) => Math.max(0, Math.min(255, Math.round(((Math.log(Math.max(v, 1e-6)) - sp.scaleLogMin) / (sp.scaleLogMax - sp.scaleLogMin)) * 255)));
  const flat = ls(0.002);
  const q16 = (v: number, b: number, e: number) => Math.max(0, Math.min(65535, Math.round(((v - b) / e) * 65535)));
  const qy = q16(0.04, bmin[1], ext[1]); // чуть над асфальтом
  for (let i = 0; i < n; i++) {
    const qx = q16(xs[i], bmin[0], ext[0]), qz = q16(zs[i], bmin[2], ext[2]);
    const r16 = (Math.random() * 65535) | 0;
    const j = i * 4;
    texA[j] = qx | (qy << 16);
    texA[j + 1] = qz | (r16 << 16);
    texA[j + 2] = (cols[i] | (als[i] << 24)) >>> 0;
    texA[j + 3] = QUAT_FLAT;
    // оси точки: x — нормаль (плоская), y — вдоль улицы (растянута), z — поперёк
    texB[i] = flat | (ls(sig[i] * STRETCH) << 8) | (ls(sig[i]) << 16) | ((sp.segId & 255) << 24);
    pos[i * 3] = bmin[0] + (qx / 65535) * ext[0];
    pos[i * 3 + 1] = bmin[1] + (qy / 65535) * ext[1];
    pos[i * 3 + 2] = bmin[2] + (qz / 65535) * ext[2];
    rank[i] = r16;
    alpha[i] = als[i];
  }
  return { seg: sp.segId, tier: -2, count: n, texA, texB, pos, rank, alpha };
}
