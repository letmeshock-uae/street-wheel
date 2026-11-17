// "Landing lap" — the finale of the story. The street dissolves; its particles collapse onto the rim
// and only those that land on letters survive, while the page's own text splats assemble the copy.
// No background: white text and thin line graphics, made of particles, lying on the rim in perspective.
//
// The page is drawn on a 2D canvas (black background, white ink) and turned into splats: flat discs on
// the rim — they foreshorten together with the text, so lines never run into each other.
// Orientation: canvas x → w (right), canvas y → −s. The top of every line points away from the viewer,
// so the text stands upright on the part of the wheel that rises ahead. Sections are stacked bottom-up:
// the first one to read is the nearest.
import type { DecodedChunk } from './data';
import type { Chapter, StoryDef } from './story';

export interface PageSpec {
  sFrom: number; // nearest edge of the page (ring coordinate)
  sTo: number; // farthest edge
  wLeft: number;
  width: number; // metres across the street
  mpp: number; // metres per canvas pixel (resolution of the page)
  segId: number;
  scaleLogMin: number;
  scaleLogMax: number;
}

export function pageBounds(sp: PageSpec): { bmin: [number, number, number]; ext: [number, number, number] } {
  return { bmin: [sp.sFrom - 0.05, -0.02, sp.wLeft - 0.05], ext: [sp.sTo - sp.sFrom + 0.1, 0.08, sp.width + 0.1] };
}

const INK = '#ffffff';
const SOFT = '#dcd8d0';
const MUTED = '#8f8b84';
const ACCENT = '#ffc35a';
const OK = '#7fe0a0';
const NO = '#ff6b57';
const FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  stride: number;
}

export async function buildLanding(sp: PageSpec, story: StoryDef): Promise<{ chunk: DecodedChunk; texture: HTMLCanvasElement }> {
  // шрифт должен быть загружен до рисования, иначе canvas возьмёт запасной
  try {
    await Promise.all(['400', '500', '600', '700'].map((w) => document.fonts.load(`${w} 100px Inter`)));
  } catch {
    /* запасной шрифт тоже подойдёт */
  }
  const P = 1 / sp.mpp; // px per metre
  const W = Math.round(sp.width * P);
  // Анаморфоза, как у разметки на асфальте: вёрстка в «видимых» метрах растягивается вдоль улицы
  // в A раз. На подъёме ленты (там её и читают) перспектива сжимает её обратно в нормальные пропорции.
  const LAYOUT_LEN = 146;
  const H = Math.round(LAYOUT_LEN * P);
  const A = (sp.sTo - sp.sFrom) / LAYOUT_LEN;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  const regions: Region[] = [];
  const m = (v: number) => v * P;
  const font = (sizeM: number, weight = 400) => `${weight} ${m(sizeM).toFixed(1)}px ${FONT}`;
  type Ctx2 = CanvasRenderingContext2D & { letterSpacing?: string };

  const text = (t: string, xM: number, yM: number, sizeM: number, weight = 500, color = INK, spacing = 0) => {
    ctx.font = font(sizeM, weight);
    ctx.fillStyle = color;
    (ctx as Ctx2).letterSpacing = `${m(spacing).toFixed(1)}px`;
    ctx.fillText(t, m(xM), m(yM));
    (ctx as Ctx2).letterSpacing = '0px';
  };
  const wrap = (t: string, sizeM: number, maxM: number, weight: number) => {
    ctx.font = font(sizeM, weight);
    const lines: string[] = [];
    let line = '';
    for (const w of t.split(/\s+/)) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > m(maxM) && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  };
  const para = (t: string, xM: number, yM: number, sizeM: number, maxM: number, lh = 1.4, color = SOFT, weight = 500) => {
    const lines = wrap(t, sizeM, maxM, weight);
    lines.forEach((l, i) => text(l, xM, yM + i * sizeM * lh, sizeM, weight, color));
    return lines.length * sizeM * lh;
  };
  // крупное — полутоновой мозаикой из точек
  const halftone = (xM: number, yM: number, wM: number, hM: number, stride: number) =>
    regions.push({ x: Math.floor(m(xM)), y: Math.floor(m(yM)), w: Math.ceil(m(wM)), h: Math.ceil(m(hM)), stride });
  const line = (x0: number, y0: number, x1: number, y1: number, wM: number, color = INK) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = m(wM);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(m(x0), m(y0));
    ctx.lineTo(m(x1), m(y1));
    ctx.stroke();
  };
  const brackets = (x: number, y: number, w: number, h: number, len: number, lw: number, color: string) => {
    for (const [cx, cy, dx, dy] of [
      [x, y, 1, 1],
      [x + w, y, -1, 1],
      [x, y + h, 1, -1],
      [x + w, y + h, -1, -1],
    ]) {
      line(cx, cy, cx + dx * len, cy, lw, color);
      line(cx, cy, cx, cy + dy * len, lw, color);
    }
  };

  // ---------- layout: sections from the bottom (nearest) up; units are layout metres
  const cats = [...new Set(story.markers.filter((k) => k.kind === 'detection').map((k) => k.category ?? k.title))];
  const SHORT: Record<string, string> = {
    'Street light': 'Street lights',
    'Illegal advertising': 'Illegal ads',
    'Fence damage': 'Fences',
    Graffiti: 'Graffiti',
    'Road damage': 'Road damage',
  };
  const short = (c: string) => SHORT[c] ?? c;
  const chapters = [...story.chapters].sort((a, b) => a.start - b.start);
  const Wm = sp.width;
  const left = 2.4;
  const colX = 10.2; // text column
  const colW = 11.6;
  const gX = 23; // graphic column
  const gW = Wm - gX - 2.2;
  let cursor = H / P;

  const section = (hM: number, draw: (top: number) => void) => {
    const top = cursor - hM;
    draw(top);
    cursor = top;
  };

  const copy = story.landing ?? {};
  // 1) hero
  section(20, (t) => {
    text(copy.kicker ?? 'CITY WORLD MODEL', left, t + 2.8, 1.3, 700, ACCENT, 0.35);
    const hl = copy.headline ?? ['The city,', 'as a loop.'];
    hl.slice(0, 2).forEach((l, i) => text(l, left, t + 8 + i * 5, 4.6, 700));
    halftone(left - 0.5, t + 3.9, Wm - 2 * left + 1, 10.2, 2);
    para(copy.sub ?? 'Captured, checked, understood, updated. Every day.', left, t + 16.2, 1.3, Wm - 2 * left, 1.35);
  });

  // 2) the loop diagram — the wheel, again
  section(23, (t) => {
    const cx = Wm / 2, cy = t + 11.5, R = 7.2;
    ctx.strokeStyle = INK;
    ctx.lineWidth = m(0.14);
    ctx.beginPath();
    ctx.arc(m(cx), m(cy), m(R), 0, Math.PI * 2);
    ctx.stroke();
    chapters.forEach((c, i) => {
      // 01 at the bottom (nearest), then around the circle
      const a = Math.PI / 2 - (i / chapters.length) * Math.PI * 2;
      const nx = cx + Math.cos(a) * R, ny = cy + Math.sin(a) * R;
      ctx.fillStyle = i === 0 ? ACCENT : INK;
      ctx.beginPath();
      ctx.arc(m(nx), m(ny), m(1.05), 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'center';
      text(String(i + 1).padStart(2, '0'), nx, ny + 0.38, 1.0, 700, '#000');
      const ca = Math.cos(a), sa = Math.sin(a);
      ctx.textAlign = ca > 0.3 ? 'left' : ca < -0.3 ? 'right' : 'center';
      const lx = cx + ca * (R + 1.8), ly = cy + sa * (R + 1.8) + 0.45 + (Math.abs(ca) <= 0.3 ? Math.sign(sa) * 1.0 : 0);
      text(c.title, lx, ly, 1.3, 700);
      ctx.textAlign = 'left';
    });
    ctx.textAlign = 'center';
    text('every day', cx, cy + 0.6, 1.8, 400, MUTED);
    ctx.textAlign = 'left';
  });

  // 3..8) the six steps: number | title + line | line graphic
  const step = (c: Chapter, i: number, draw: (x: number, y: number, w: number, h: number) => void) =>
    section(13, (t) => {
      text(String(i + 1).padStart(2, '0'), left - 0.2, t + 7.6, 5.6, 700, ACCENT);
      halftone(left - 0.5, t + 2.6, colX - left - 0.3, 6, 2);
      text(c.title, colX, t + 3.2, 2.1, 700);
      para(c.short ?? c.body, colX, t + 5.5, 1.25, colW, 1.4);
      draw(gX, t + 1.2, gW, 10.6);
    });

  const byWidget = (w: string) => chapters.findIndex((c) => c.widget === w);
  const steps: [string, (x: number, y: number, w: number, h: number) => void][] = [
    [
      'capture',
      (x, y, w) => {
        brackets(x, y, w, 6.4, 1.6, 0.16, INK);
        ctx.fillStyle = NO;
        ctx.beginPath();
        ctx.arc(m(x + 1.3), m(y + 1.6), m(0.4), 0, Math.PI * 2);
        ctx.fill();
        text('REC', x + 2.0, y + 2.0, 1.0, 700, NO);
        text('own cameras', x + 1.3, y + 4.2, 1.05, 600, INK);
        text('driver fleet', x + 1.3, y + 5.7, 1.05, 600, INK);
      },
    ],
    [
      'gate',
      (x, y, w, h) => {
        const cols = 3, rows = 2, gap = 0.6;
        const fw = (w - gap * (cols - 1)) / cols, fh = (h - 2.4 - gap) / rows;
        const verdict = [1, 0, 1, 1, 1, 0];
        for (let r = 0; r < rows; r++)
          for (let k = 0; k < cols; k++) {
            const i = r * cols + k;
            const fx = x + k * (fw + gap), fy = y + r * (fh + gap);
            ctx.strokeStyle = verdict[i] ? INK : MUTED;
            ctx.lineWidth = m(0.12);
            ctx.strokeRect(m(fx), m(fy), m(fw), m(fh));
            if (verdict[i]) {
              line(fx + fw * 0.3, fy + fh * 0.55, fx + fw * 0.45, fy + fh * 0.72, 0.2, OK);
              line(fx + fw * 0.45, fy + fh * 0.72, fx + fw * 0.72, fy + fh * 0.3, 0.2, OK);
            } else {
              line(fx + fw * 0.3, fy + fh * 0.3, fx + fw * 0.7, fy + fh * 0.7, 0.2, NO);
              line(fx + fw * 0.7, fy + fh * 0.3, fx + fw * 0.3, fy + fh * 0.7, 0.2, NO);
            }
          }
        text('passed', x, y + h - 0.2, 1.0, 700, OK);
        text('rejected', x + w * 0.5, y + h - 0.2, 1.0, 700, NO);
      },
    ],
    [
      'detect',
      (x, y) => {
        cats.forEach((cat, i) => {
          const ry = y + 0.4 + i * 2.0;
          brackets(x, ry, 1.4, 1.4, 0.45, 0.12, ACCENT);
          text(short(cat), x + 2.2, ry + 1.15, 1.05, 600, INK);
        });
      },
    ],
    [
      'registry',
      (x, y, w) => {
        const rh = 1.9;
        cats.forEach((cat, i) => {
          const ry = y + 1.4 + i * rh;
          const n = story.markers.filter((k) => (k.category ?? k.title) === cat && k.kind !== 'info').length;
          text(short(cat), x, ry, 1.15, 600);
          ctx.textAlign = 'right';
          text(String(n), x + w, ry, 1.15, 700, ACCENT);
          ctx.textAlign = 'left';
          line(x, ry + 0.55, x + w, ry + 0.55, 0.05, MUTED);
        });
      },
    ],
    [
      'case',
      (x, y, w, h) => {
        ctx.strokeStyle = INK;
        ctx.lineWidth = m(0.12);
        ctx.beginPath();
        ctx.roundRect(m(x), m(y), m(w), m(h - 0.4), m(0.8));
        ctx.stroke();
        text('CASE 01', x + 0.9, y + 1.8, 1.0, 700, ACCENT, 0.12);
        text(`${cats.length} issues, one street`, x + 0.9, y + 3.6, 1.15, 700);
        cats.forEach((cat, i) => {
          ctx.fillStyle = ACCENT;
          ctx.beginPath();
          ctx.arc(m(x + 1.2), m(y + 5.3 + i * 1.25 - 0.32), m(0.25), 0, Math.PI * 2);
          ctx.fill();
          text(short(cat), x + 1.9, y + 5.3 + i * 1.25, 1.0, 500, SOFT);
        });
      },
    ],
    [
      'refresh',
      (x, y) => {
        text('Road damage', x, y + 1.6, 1.15, 700);
        line(x, y + 1.2, x + 8.2, y + 1.2, 0.14, NO);
        text('repaired · closed', x, y + 3.2, 1.0, 700, OK);
        const ax = x + 3.4, ay = y + 7.4, ar = 2.3;
        ctx.strokeStyle = INK;
        ctx.lineWidth = m(0.16);
        ctx.beginPath();
        ctx.arc(m(ax), m(ay), m(ar), -Math.PI * 0.35, Math.PI * 1.45);
        ctx.stroke();
        const ex = ax + ar * Math.cos(-Math.PI * 0.35), ey = ay + ar * Math.sin(-Math.PI * 0.35);
        line(ex, ey, ex - 1.0, ey - 0.15, 0.16);
        line(ex, ey, ex + 0.1, ey - 1.0, 0.16);
        text('back to 01', ax + ar + 0.9, ay + 0.4, 1.0, 600, MUTED);
      },
    ],
  ];
  for (const [w, draw] of steps) {
    const i = byWidget(w);
    if (i >= 0) step(chapters[i], i, draw);
  }

  // principles — коротко, крупно, по одной мысли
  const principles = copy.principles ?? [];
  if (principles.length) {
    section(4.5 + principles.length * 3.4, (t) => {
      text('PRINCIPLES', left, t + 2.4, 1.2, 700, ACCENT, 0.35);
      principles.forEach((p, i) => {
        const y = t + 5.4 + i * 3.4;
        text(String(i + 1).padStart(2, '0'), left, y, 1.0, 700, MUTED);
        para(p, left + 3, y, 1.45, Wm - left - 5, 1.3, INK, 600);
      });
    });
  }

  // closing (whatever room is left)
  if (cursor > 4) {
    section(Math.min(cursor, 8), (t) => {
      text(copy.closing ?? 'Back to the street.', left, t + 4.6, 2.6, 700);
      halftone(left - 0.5, t + 2, Wm - 2 * left, 3.4, 2);
    });
  }
  if (cursor < 0) console.warn(`landing: content is ${(-cursor).toFixed(1)} m longer than the page`);

  // ---------- canvas → splats. Всё — плоские диски на ободе: они сжимаются перспективой вместе
  // с текстом. Диски крупнее шага сетки — без зазоров, случайный сдвиг убирает муар.
  const data = ctx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (const r of regions)
    for (let y = Math.max(0, r.y); y < Math.min(H, r.y + r.h); y++) mask.fill(1, y * W + Math.max(0, r.x), y * W + Math.min(W, r.x + r.w));

  const xs: number[] = [], ys: number[] = [], sg: number[] = [], cols: number[] = [], als: number[] = [];
  const push = (x: number, y: number, sigmaM: number, r: number, g: number, b: number, a: number) => {
    const j = (sigmaM / sp.mpp) * 0.5;
    xs.push(x + (Math.random() - 0.5) * j);
    ys.push(y + (Math.random() - 0.5) * j);
    sg.push(sigmaM);
    cols.push((r & 255) | ((g & 255) << 8) | ((b & 255) << 16));
    als.push(Math.max(0, Math.min(255, Math.round(a * 255))));
  };
  // «чернила» на чёрном фоне — яркость или насыщенность пикселя
  const inkAt = (i: number) =>
    Math.max((0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255, (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2])) / 255);
  const full = (c: number, ink: number) => Math.max(0, Math.min(255, Math.round(c / Math.max(ink, 0.05))));

  // крупное — одна точка на ячейку, площадь точки ∝ заполненности
  for (const r of regions) {
    const k = r.stride;
    for (let y = r.y; y < r.y + r.h - k + 1; y += k)
      for (let x = r.x; x < r.x + r.w - k + 1; x += k) {
        let R = 0, G = 0, B = 0, ink = 0, n = 0;
        for (let yy = y; yy < y + k; yy++)
          for (let xx = x; xx < x + k; xx++) {
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
        if (cov < 0.08) continue;
        push(x + k / 2, y + k / 2, 0.72 * k * sp.mpp * Math.sqrt(Math.min(1, cov * 1.15)), full(R / n, cov), full(G / n, cov), full(B / n, cov), 1);
      }
  }

  // текст и линии — точка на пиксель
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask[p]) continue;
      const i = p * 4;
      const ink = inkAt(i);
      if (ink < 0.16) continue;
      push(x + 0.5, y + 0.5, 0.8 * sp.mpp, full(data[i], ink), full(data[i + 1], ink), full(data[i + 2], ink), Math.min(1, ink * 1.4));
    }

  // ---------- pack into the same layout as streamed chunks
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
  for (let k = 0; k < n; k++) {
    const s = sp.sTo - ys[k] * sp.mpp * A;
    const w = sp.wLeft + xs[k] * sp.mpp;
    const qx = q16(s, bmin[0], ext[0]), qy = q16(0.03, bmin[1], ext[1]), qz = q16(w, bmin[2], ext[2]);
    const r16 = (Math.random() * 65535) | 0;
    const j = k * 4;
    texA[j] = qx | (qy << 16);
    texA[j + 1] = qz | (r16 << 16);
    texA[j + 2] = (cols[k] | (als[k] << 24)) >>> 0;
    texA[j + 3] = 255 | (128 << 8) | (128 << 16) | (128 << 24); // identity rotation
    // оси сплата: x — вдоль улицы (растянут анаморфозой), y — нормаль ленты (плоский), z — поперёк
    texB[k] = ls(sg[k] * A) | (flat << 8) | (ls(sg[k]) << 16) | segBits;
    pos[k * 3] = bmin[0] + (qx / 65535) * ext[0];
    pos[k * 3 + 1] = bmin[1] + (qy / 65535) * ext[1];
    pos[k * 3 + 2] = bmin[2] + (qz / 65535) * ext[2];
    rank[k] = r16;
    alpha[k] = als[k];
  }

  // уменьшенная копия страницы — по ней частицы улицы, слетевшиеся на обод, решают, выжить ли
  // (попали на букву — остаются и белеют, нет — гаснут)
  const tex = document.createElement('canvas');
  const kk = Math.max(1, Math.ceil(Math.max(W, H) / 2048));
  tex.width = Math.max(1, Math.round(W / kk));
  tex.height = Math.max(1, Math.round(H / kk));
  tex.getContext('2d')!.drawImage(cv, 0, 0, tex.width, tex.height);
  return { chunk: { seg: sp.segId, tier: -2, count: n, texA, texB, pos, rank, alpha }, texture: tex };
}
