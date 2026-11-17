// Finale ("landing lap") — the chapter after the loop: a look inside the City World Model.
// The street dissolves and the walker passes through text made of particles, laid out in different
// planes: panels facing the walker in the middle of the street, long lines on the "walls" left and right,
// angled cards forming a conveyor, huge words on the asphalt. Each piece writes itself in reading order
// as you approach (see the shader) and scatters as you pass.
//
// Every element is drawn on a 2D canvas (black background, white ink) and turned into splats: flat discs
// in the panel plane. The plane is set by yaw (around the vertical) and tilt (around the cross-street
// axis); the shader rebuilds the same rotation from bits stored with every splat.
import type { DecodedChunk } from './data';
import type { StoryDef } from './story';

export interface PageSpec {
  sFrom: number; // where the finale begins (ring coordinate)
  sTo: number; // where it ends
  wLeft: number;
  width: number; // corridor width
  mpp: number; // metres per canvas pixel (text resolution)
  segId: number;
  scaleLogMin: number;
  scaleLogMax: number;
}

export function pageBounds(sp: PageSpec): { bmin: [number, number, number]; ext: [number, number, number] } {
  return { bmin: [sp.sFrom - 24, -0.6, sp.wLeft - 14], ext: [sp.sTo - sp.sFrom + 48, 16, sp.width + 28] };
}

// ---------------------------------------------------------------------------------------------
// COPY — the finale text (from the City World Model document). Edit freely; layout adapts.
// ---------------------------------------------------------------------------------------------
const COPY = {
  opening: {
    kicker: 'CITY WORLD MODEL · INSIDE THE LOOP',
    headline: ['Every kilometre', 'counts.'],
    sub: 'Scattered frames become a continuously updated, verifiable model of the city: the most data per kilometre, at the least cost per pass.',
  },
  fleet: 'Hundreds of cars, taxis and couriers drive the same streets with the same cameras. Soon, thousands.',
  flood: 'What comes back is a flood: duplicate, contradictory, ambiguous. Seeing a pole is easy. Deciding what is true is the work.',
  floor1: 'Observation first.',
  pipeline: [
    ['Raw data', 'Our own capture, partners and city sources.'],
    ['Preprocessing', 'Tag, filter, de-duplicate.'],
    ['Recognition', 'Pole, bollard, traffic light, sign, curb, stop, pedestrian, cyclist.'],
    ['Conflation', 'Which pole is this, exactly? Is it in the model? How sure are we?'],
    ['Observation', 'Pole 123456, with probability p and attributes a.'],
    ['Change service', 'Aggregate, resolve contradictions, count up to a threshold.'],
    ['Digital twin', 'Objects, their states, and the evidence behind every change.'],
  ] as [string, string][],
  rejected: 'Filtered out: a capped lens and a run of black frames. A camera focused on a raindrop. A helmet cam that filmed only sky.',
  life: { kicker: 'THE LIFE OF ONE STREET LIGHT', id: '7f3a' },
  episodes: [
    ['t0 · first pass', 'appeared', 'knowledge', 'We only just learned it exists.'],
    ['t1 · taxi, 12 frames', 'one look, not twelve', '', 'Same sensor, same light, same second. State confirmed, no event.'],
    ['t3 · resident report', 'waits', '', 'GPS ±20 m instead of 0.4 m, three candidate poles. It waits for a machine look.'],
    ['t4 · own fleet', 'degraded', 'world', 'Tilt 8°, over the 5° threshold. The city really changed.'],
    ['t5 · night pass', 'no vote', '', 'Too dark to measure. The look counts neither for nor against.'],
    ['t6–t8 · three clear looks', 'disappeared', 'world', 'Three good looks, no pole: K = 3.'],
  ] as [string, string, string, string][],
  eventCost: 'An event is expensive: it creates work orders and contractor deadlines. Four of six episodes create none. A false disappearance costs more than a delay.',
  principles: ['Many frames, one look.', 'Not seeing it is not seeing it gone.', 'A resident report waits for a machine look.', 'Protect the event.'],
  delta: 'A delta is not "the city changed". First pass: images with coordinates. First recognition: everything appears, cause knowledge. New classes: more appears, back-dated. Only the second pass shows the world.',
  bitemporal: 'Seen in August. Known in October. Both dates kept.',
  closing: ['The loop goes on.', 'Back to the street.'],
};

const INK = '#ffffff';
const SOFT = '#e2ded6';
const MUTED = '#9a968e';
const ACCENT = '#ffc35a';
const OK = '#7fe0a0';
const NO = '#ff6b57';
const FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';

type Ctx2 = CanvasRenderingContext2D & { letterSpacing?: string };

/** Холст одного элемента с примитивами в метрах; zones — порядок «написания». */
class Panel {
  readonly cv: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly halftones: { x: number; y: number; w: number; h: number; k: number }[] = [];
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
  zone(x: number, y: number, w: number, h: number) {
    this.zones.push({ x: this.m(x), y: this.m(y), w: this.m(w), h: this.m(h) });
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
    return mt.width / this.P;
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
  line(x0: number, y0: number, x1: number, y1: number, w: number, color = INK) {
    const c = this.ctx;
    c.strokeStyle = color;
    c.lineWidth = this.m(w);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(this.m(x0), this.m(y0));
    c.lineTo(this.m(x1), this.m(y1));
    c.stroke();
  }
  dot(x: number, y: number, r: number, color: string) {
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(this.m(x), this.m(y), this.m(r), 0, Math.PI * 2);
    this.ctx.fill();
  }
  halftone(x: number, y: number, w: number, h: number, k = 2) {
    this.halftones.push({ x: Math.floor(this.m(x)), y: Math.floor(this.m(y)), w: Math.ceil(this.m(w)), h: Math.ceil(this.m(h)), k });
  }
}

/** Где стоит элемент: f — доля пути финала (0..1), w/h — центр, yaw/tilt — плоскость, stretch — растяжение по «вверх» холста. */
interface Place {
  f: number;
  w: number;
  h: number;
  yaw?: number;
  tilt?: number;
  stretch?: number;
}

export async function buildLanding(sp: PageSpec, _story: StoryDef): Promise<{ chunk: DecodedChunk; texture: HTMLCanvasElement }> {
  try {
    await Promise.all(['300', '400', '500', '600', '700'].map((w) => document.fonts.load(`${w} 100px Inter`)));
  } catch {
    /* запасной шрифт тоже подойдёт */
  }
  const mpp = sp.mpp;
  const C = sp.wLeft + sp.width / 2; // ось прогулки (где идёт камера)
  const scene: { panel: Panel; at: Place }[] = [];
  const add = (panel: Panel, at: Place) => scene.push({ panel, at });
  const tmp = new Panel(1, 1, mpp);
  const heightOf = (t: string, size: number, maxW: number, lh = 1.3, weight = 500) => tmp.wrap(t, size, maxW, weight).length * size * lh;

  // ---- 1. opening: in the middle of the street, facing the walker
  {
    const o = COPY.opening;
    const subH = heightOf(o.sub, 0.95, 24, 1.3);
    const p = new Panel(26, 12.6 + subH, mpp);
    p.text(o.kicker, 0.3, 1.5, 0.85, 700, ACCENT, 0.25);
    o.headline.forEach((l, i) => p.text(l, 0.1, 6.0 + i * 4.2, 3.8, 700));
    p.halftone(0, 2.0, 26, 9.4, 2);
    p.para(o.sub, 0.3, 12.2, 0.95, 24);
    add(p, { f: 0.0, w: C, h: 1.2 + p.hM / 2 });
  }

  // ---- 2. the flood: long lines on the walls, read while walking past
  const wall = (t: string, f: number, side: -1 | 1, size = 1.5, len = 26) => {
    const h = heightOf(t, size, len - 1, 1.25, 600);
    const p = new Panel(len, h + 0.8, mpp);
    p.para(t, 0.4, size * 1.05, size, len - 1, 1.25, INK, 600);
    // left wall: text runs forward (+s); right wall: backward — both read left to right from the street
    add(p, { f, w: C + side * 9.5, h: 4.4, yaw: side < 0 ? 90 : -90 });
  };
  wall(COPY.fleet, 0.1, -1);
  wall(COPY.flood, 0.165, 1);

  // ---- 3. a word on the asphalt (stretched along the street, like road markings)
  {
    const p = new Panel(30, 3.4, mpp);
    p.text(COPY.floor1, 15, 2.7, 2.9, 700, INK, 0, 'center');
    p.halftone(0, 0, 30, 3.4, 2);
    add(p, { f: 0.235, w: C, h: 0.06, tilt: -90, stretch: 2.6 });
  }

  // ---- 4. the conveyor: what gets filtered out (left wall), then angled cards alternating left / right
  wall(COPY.rejected, 0.275, -1, 1.25, 24);
  COPY.pipeline.forEach(([title, body], i) => {
    const bh = heightOf(body, 0.8, 9.6, 1.3);
    const p = new Panel(10.5, 3.6 + bh, mpp);
    p.text(String(i + 1).padStart(2, '0'), 0.3, 1.5, 0.9, 700, ACCENT);
    p.text(title, 1.9, 1.5, 1.15, 700);
    p.zone(0.3, 2.0, 9.9, 0.2);
    p.line(0.3, 2.1, 10.2, 2.1, 0.05, MUTED);
    p.para(body, 0.3, 3.2, 0.8, 9.6);
    const side = i % 2 ? -1 : 1;
    add(p, { f: 0.32 + i * 0.034, w: C + side * 7.2, h: 2.2 + (i % 3) * 1.2 + p.hM / 2, yaw: side * 34 });
  });

  // ---- 5. the life of one street light: title in the middle, episodes alternating left / right
  {
    const p = new Panel(22, 10, mpp);
    p.text(COPY.life.kicker, 11, 1.6, 0.9, 700, ACCENT, 0.25, 'center');
    p.text(COPY.life.id, 11, 7.8, 5.6, 700, INK, 0, 'center');
    p.halftone(0, 2.4, 22, 6.2, 2);
    p.text('Look → Object → State → Event', 11, 9.6, 0.95, 600, MUTED, 0, 'center');
    add(p, { f: 0.575, w: C, h: 1.0 + p.hM / 2 });
  }
  COPY.episodes.forEach(([when, verb, cause, note], i) => {
    const nh = heightOf(note, 0.8, 9.4, 1.3);
    const p = new Panel(10.2, 4.6 + nh, mpp);
    p.text(when, 0.3, 1.2, 0.8, 600, MUTED);
    const vw = p.text(verb, 0.3, 2.9, 1.35, 700, verb === 'disappeared' ? NO : verb === 'degraded' ? ACCENT : INK);
    if (cause) p.text(`cause: ${cause}`, 0.3 + vw + 0.5, 2.9, 0.75, 700, cause === 'world' ? OK : MUTED);
    p.para(note, 0.3, 4.2, 0.8, 9.4);
    const side = i % 2 ? 1 : -1;
    add(p, { f: 0.61 + i * 0.04, w: C + side * 7.4, h: 2.4 + (i % 2) * 0.8 + p.hM / 2, yaw: side * 34 });
  });
  wall(COPY.eventCost, 0.875, 1, 1.3, 26);
  // напротив — что такое дельта
  wall(COPY.delta, 0.885, -1, 1.2, 28);
  // время дважды — на асфальте, перед принципами
  {
    const p = new Panel(30, 2.6, mpp);
    p.text(COPY.bitemporal, 15, 2.0, 1.7, 700, INK, 0, 'center');
    add(p, { f: 0.925, w: C, h: 0.06, tilt: -90, stretch: 2.6 });
  }

  // ---- 6. principles: one panel in the middle
  {
    const lines = COPY.principles.map((t) => heightOf(t, 1.3, 19.5, 1.2, 600));
    const p = new Panel(22, 3.4 + lines.reduce((a, h) => a + h + 0.9, 0), mpp);
    p.text('PRINCIPLES', 0.3, 1.4, 0.85, 700, ACCENT, 0.25);
    let y = 3.4;
    COPY.principles.forEach((t, i) => {
      p.text(String(i + 1).padStart(2, '0'), 0.3, y, 0.75, 700, MUTED);
      y += p.para(t, 2.2, y, 1.3, 19.5, 1.2, INK, 600) + 0.9;
    });
    add(p, { f: 0.96, w: C, h: 2.6 + p.hM / 2 });
  }

  // ---- 7. closing — on the asphalt, leading back into the street
  {
    const p = new Panel(30, 5.4, mpp);
    p.text(COPY.closing[0], 15, 2.7, 2.6, 700, INK, 0, 'center');
    p.halftone(0, 0, 30, 3.2, 2);
    p.text(COPY.closing[1], 15, 4.9, 1.4, 700, ACCENT, 0, 'center');
    add(p, { f: 1.0, w: C, h: 0.06, tilt: -90, stretch: 2.6 });
  }

  // ---------------------------------------------------------------------------------------------
  // canvases → splats
  // ---------------------------------------------------------------------------------------------
  const xs: number[] = [], ys: number[] = [], zs: number[] = [], sgU: number[] = [], sgV: number[] = [];
  const cols: number[] = [], als: number[] = [], words: number[] = [];
  const len = sp.sTo - sp.sFrom;
  for (const { panel: p, at } of scene) {
    const yaw = ((at.yaw ?? 0) * Math.PI) / 180, tilt = ((at.tilt ?? 0) * Math.PI) / 180;
    const stretch = at.stretch ?? 1;
    // базис плоскости в уличных координатах (s, h, w): U — вправо по холсту, V — вверх по холсту
    const U = [Math.sin(yaw), 0, Math.cos(yaw)];
    const V = [-Math.sin(tilt) * Math.cos(yaw), Math.cos(tilt), Math.sin(tilt) * Math.sin(yaw)];
    const cs = sp.sFrom + at.f * len, ch = at.h, cw = at.w;
    const yaw8 = Math.round((((at.yaw ?? 0) / 180 + 1) / 2) * 255) & 255;
    const tilt8 = Math.round((((at.tilt ?? 0) / 90 + 1) / 2) * 255) & 255;
    const W = p.cv.width, H = p.cv.height;
    const data = p.ctx.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    for (const r of p.halftones)
      for (let y = Math.max(0, r.y); y < Math.min(H, r.y + r.h); y++) mask.fill(1, y * W + Math.max(0, r.x), y * W + Math.min(W, r.x + r.w));
    const nz = Math.max(1, p.zones.length);
    const orderAt = (px: number, py: number) => {
      for (let zi = p.zones.length - 1; zi >= 0; zi--) {
        const z = p.zones[zi];
        if (px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h) return (zi + Math.min(1, Math.max(0, (px - z.x) / Math.max(1, z.w))) * 0.85) / nz;
      }
      return 0.98;
    };
    const push = (px: number, py: number, sigmaM: number, r: number, g: number, b: number, a: number) => {
      const order = Math.min(1, Math.max(0, orderAt(px, py) + (Math.random() - 0.5) * 0.02));
      const j = (sigmaM / mpp) * 0.3;
      const u = (px + (Math.random() - 0.5) * j) * mpp - p.wM / 2;
      const v = (p.hM / 2 - (py + (Math.random() - 0.5) * j) * mpp) * stretch;
      xs.push(cs + U[0] * u + V[0] * v);
      ys.push(ch + U[1] * u + V[1] * v);
      zs.push(cw + U[2] * u + V[2] * v);
      sgU.push(sigmaM);
      sgV.push(sigmaM * stretch);
      cols.push((r & 255) | ((g & 255) << 8) | ((b & 255) << 16));
      als.push(Math.max(0, Math.min(255, Math.round(a * 255))));
      words.push((Math.round(order * 65535) | (yaw8 << 16) | (tilt8 << 24)) >>> 0);
    };
    const inkAt = (i: number) =>
      Math.max(
        (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255,
        (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2])) / 255,
      );
    const full = (c: number, ink: number) => Math.max(0, Math.min(255, Math.round(c / Math.max(ink, 0.05))));
    for (const r of p.halftones) {
      const kk = r.k;
      for (let y = r.y; y < r.y + r.h - kk + 1; y += kk)
        for (let x = r.x; x < r.x + r.w - kk + 1; x += kk) {
          let R = 0, G = 0, B = 0, ink = 0, n = 0;
          for (let yy = y; yy < y + kk; yy++)
            for (let xx = x; xx < x + kk; xx++) {
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
          push(x + kk / 2, y + kk / 2, 0.72 * kk * mpp * Math.sqrt(Math.min(1, cov * 1.15)), full(R / n, cov), full(G / n, cov), full(B / n, cov), 1);
        }
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

  // ---- pack into the same layout as streamed chunks
  const n = xs.length;
  const { bmin, ext } = pageBounds(sp);
  const texA = new Uint32Array(n * 4);
  const texB = new Uint32Array(n);
  const pos = new Float32Array(n * 3);
  const rank = new Uint16Array(n);
  const alpha = new Uint8Array(n);
  const ls = (v: number) => Math.max(0, Math.min(255, Math.round(((Math.log(Math.max(v, 1e-6)) - sp.scaleLogMin) / (sp.scaleLogMax - sp.scaleLogMin)) * 255)));
  const flat = ls(0.002);
  const segBits = (sp.segId & 255) << 24;
  const q16 = (v: number, b: number, e: number) => Math.max(0, Math.min(65535, Math.round(((v - b) / e) * 65535)));
  for (let i = 0; i < n; i++) {
    const qx = q16(xs[i], bmin[0], ext[0]), qy = q16(ys[i], bmin[1], ext[1]), qz = q16(zs[i], bmin[2], ext[2]);
    const r16 = (Math.random() * 65535) | 0;
    const j = i * 4;
    texA[j] = qx | (qy << 16);
    texA[j + 1] = qz | (r16 << 16);
    texA[j + 2] = (cols[i] | (als[i] << 24)) >>> 0;
    // у элементов финала это слово хранит порядок «написания» (16 бит) и плоскость (yaw, tilt по 8 бит)
    texA[j + 3] = words[i];
    // оси точки: x — нормаль плоскости (плоская), y — «вверх» холста, z — «вправо» холста
    texB[i] = flat | (ls(sgV[i]) << 8) | (ls(sgU[i]) << 16) | segBits;
    pos[i * 3] = bmin[0] + (qx / 65535) * ext[0];
    pos[i * 3 + 1] = bmin[1] + (qy / 65535) * ext[1];
    pos[i * 3 + 2] = bmin[2] + (qz / 65535) * ext[2];
    rank[i] = r16;
    alpha[i] = als[i];
  }

  const tex = document.createElement('canvas');
  tex.width = tex.height = 1;
  const tc = tex.getContext('2d')!;
  tc.fillStyle = '#000';
  tc.fillRect(0, 0, 1, 1);
  return { chunk: { seg: sp.segId, tier: -2, count: n, texA, texB, pos, rank, alpha }, texture: tex };
}
