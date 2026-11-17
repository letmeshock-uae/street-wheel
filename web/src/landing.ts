// "Landing lap": on every other lap the street dissolves and its particles assemble into a white
// page lying along the rim of the wheel. The page is drawn on a 2D canvas and turned into splats:
// paper = big soft white splats, body text = 4 cm dots, headlines and pictures = halftone mosaic.
//
// Orientation: canvas x → w (right), canvas y → −s. The top of every line points away from the
// viewer, so the text stands upright on the part of the wheel that rises ahead. Sections are stacked
// bottom-up: the first one to read is the nearest.
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

const INK = '#141414';
const ACCENT = '#c98a1b';
const OK = '#2f8f4e';
const NO = '#c8432f';
const PAPER: [number, number, number] = [246, 244, 239];
const FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  stride: number;
  color: boolean;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
}

export async function buildLanding(sp: PageSpec, story: StoryDef, imageBase: string): Promise<DecodedChunk> {
  // шрифт должен быть загружен до рисования, иначе canvas возьмёт запасной
  try {
    await Promise.all([document.fonts.load('700 100px Inter'), document.fonts.load('400 100px Inter'), document.fonts.load('600 100px Inter')]);
  } catch {
    /* запасной шрифт тоже подойдёт */
  }
  const P = 1 / sp.mpp; // px per metre
  const W = Math.round(sp.width * P);
  const H = Math.round((sp.sTo - sp.sFrom) * P);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = `rgb(${PAPER.join(',')})`;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  const regions: Region[] = [];
  const m = (v: number) => v * P;
  const font = (sizeM: number, weight = 400) => `${weight} ${m(sizeM).toFixed(1)}px ${FONT}`;

  const [imCapture, imDetect, imRefresh] = await Promise.all([
    loadImage(imageBase + 'capture.jpg'),
    loadImage(imageBase + 'detect.jpg'),
    loadImage(imageBase + 'refresh.jpg'),
  ]);

  const text = (t: string, xM: number, yM: number, sizeM: number, weight = 400, color = INK, spacing = 0) => {
    ctx.font = font(sizeM, weight);
    ctx.fillStyle = color;
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${m(spacing).toFixed(1)}px`;
    ctx.fillText(t, m(xM), m(yM));
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
  };
  const wrap = (t: string, sizeM: number, maxM: number, weight = 400) => {
    ctx.font = font(sizeM, weight);
    const words = t.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > m(maxM) && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  };
  const para = (t: string, xM: number, yM: number, sizeM: number, maxM: number, lh = 1.4, color = INK) => {
    const lines = wrap(t, sizeM, maxM);
    lines.forEach((l, i) => text(l, xM, yM + i * sizeM * lh, sizeM, 400, color));
    return lines.length * sizeM * lh;
  };
  const halftone = (xM: number, yM: number, wM: number, hM: number, stride: number, color: boolean) =>
    regions.push({ x: Math.floor(m(xM)), y: Math.floor(m(yM)), w: Math.ceil(m(wM)), h: Math.ceil(m(hM)), stride, color });
  const cover = (im: HTMLImageElement, xM: number, yM: number, wM: number, hM: number, sx = 0, sy = 0, sw = 1, sh = 1) => {
    // object-fit: cover by the crop window (sx,sy,sw,sh in 0..1 of the source)
    const iw = im.naturalWidth * sw, ih = im.naturalHeight * sh;
    const r = Math.max(m(wM) / iw, m(hM) / ih);
    const cw = m(wM) / r, ch = m(hM) / r;
    ctx.drawImage(im, im.naturalWidth * sx + (iw - cw) / 2, im.naturalHeight * sy + (ih - ch) / 2, cw, ch, m(xM), m(yM), m(wM), m(hM));
  };
  const line = (x0: number, y0: number, x1: number, y1: number, wM: number, color = INK) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = m(wM);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(m(x0), m(y0));
    ctx.lineTo(m(x1), m(y1));
    ctx.stroke();
  };

  // ---------- layout: sections from the bottom (nearest) up
  const cats = [...new Set(story.markers.filter((k) => k.kind === 'detection').map((k) => k.category ?? k.title))];
  const chapters = [...story.chapters].sort((a, b) => a.start - b.start);
  const left = 3; // margin, m
  const colX = 11.5; // text column for steps
  const colW = sp.width - colX - 3;
  let cursor = H / P; // in metres, bottom of the next section

  const section = (hM: number, draw: (top: number) => void) => {
    const top = cursor - hM;
    draw(top);
    cursor = top;
  };

  // 1) hero
  section(26, (t) => {
    text('CITY WORLD MODEL', left, t + 3.6, 1.4, 700, ACCENT, 0.4);
    text('The city,', left, t + 10, 6, 700);
    text('as a loop.', left, t + 16.4, 6, 700);
    halftone(left - 0.5, t + 4.4, sp.width - 2 * left + 1, 13, 3, false);
    para('Captured, checked, understood, updated. Every day.', left, t + 20.6, 1.5, sp.width - 2 * left, 1.3);
  });

  // 2) the loop diagram — the wheel, again
  section(30, (t) => {
    const cx = sp.width / 2, cy = t + 15, R = 9.5;
    ctx.strokeStyle = INK;
    ctx.lineWidth = m(0.16);
    ctx.beginPath();
    ctx.arc(m(cx), m(cy), m(R), 0, Math.PI * 2);
    ctx.stroke();
    chapters.forEach((c, i) => {
      // 01 at the bottom (nearest), then clockwise as on the HUD wheel
      const a = Math.PI / 2 - (i / chapters.length) * Math.PI * 2;
      const nx = cx + Math.cos(a) * R, ny = cy + Math.sin(a) * R;
      ctx.fillStyle = i === 0 ? ACCENT : INK;
      ctx.beginPath();
      ctx.arc(m(nx), m(ny), m(1.25), 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'center';
      text(String(i + 1).padStart(2, '0'), nx, ny + 0.42, 1.1, 700, '#fff');
      const lx = cx + Math.cos(a) * (R + 2.4), ly = cy + Math.sin(a) * (R + 2.4);
      ctx.textAlign = Math.cos(a) > 0.3 ? 'left' : Math.cos(a) < -0.3 ? 'right' : 'center';
      text(c.title, lx, ly + 0.55 + (Math.abs(Math.cos(a)) <= 0.3 ? Math.sign(Math.sin(a)) * 1.2 : 0), 1.5, 700);
      ctx.textAlign = 'left';
    });
    ctx.textAlign = 'center';
    text('every day', cx, cy + 0.6, 2.2, 300, '#555');
    ctx.textAlign = 'left';
  });

  // 3..8) the six steps
  const step = (c: Chapter, i: number, draw: (x: number, y: number, w: number, h: number) => void) =>
    section(26, (t) => {
      text(String(i + 1).padStart(2, '0'), left - 0.3, t + 9.5, 7.5, 700, ACCENT);
      halftone(left - 0.6, t + 2, colX - left, 8.4, 3, false);
      text(c.title, colX, t + 4.4, 3, 700);
      halftone(colX - 0.3, t + 1.6, colW + 0.6, 3.6, 2, false);
      const used = para(c.short ?? c.body, colX, t + 6.9, 1.45, colW, 1.3, '#2a2a2a');
      const gy = t + 6.9 + used + 0.3;
      draw(colX, gy, colW, t + 25 - gy);
    });

  const byWidget = (w: string) => chapters.findIndex((c) => c.widget === w);
  const steps: [string, (x: number, y: number, w: number, h: number) => void][] = [
    [
      'capture',
      (x, y, w, h) => {
        if (imCapture) {
          cover(imCapture, x, y, w, h);
          halftone(x, y, w, h, 3, true);
        }
        text('● REC', x + 0.8, y + 1.6, 0.8, 700, NO);
        text('own cameras  ·  driver fleet', x + w - 13, y + h + 1.2, 0.75, 500, '#666');
      },
    ],
    [
      'gate',
      (x, y, w, h) => {
        const cols = 4, rows = 2, gap = 0.7;
        const fw = (w - gap * (cols - 1)) / cols, fh = (h - gap * (rows - 1) - 1.8) / rows;
        const verdict = [1, 0, 1, 1, 1, 0, 1, 0];
        for (let r = 0; r < rows; r++)
          for (let k = 0; k < cols; k++) {
            const i = r * cols + k;
            const fx = x + k * (fw + gap), fy = y + r * (fh + gap);
            if (imCapture) {
              ctx.globalAlpha = verdict[i] ? 1 : 0.35;
              cover(imCapture, fx, fy, fw, fh, (i * 0.11) % 0.6, ((i * 0.23) % 0.5), 0.4, 0.5);
              ctx.globalAlpha = 1;
            }
            if (!verdict[i]) {
              line(fx + 0.6, fy + 0.6, fx + fw - 0.6, fy + fh - 0.6, 0.22, NO);
              line(fx + fw - 0.6, fy + 0.6, fx + 0.6, fy + fh - 0.6, 0.22, NO);
            } else {
              line(fx + fw - 2.2, fy + fh - 1.1, fx + fw - 1.6, fy + fh - 0.6, 0.2, OK);
              line(fx + fw - 1.6, fy + fh - 0.6, fx + fw - 0.6, fy + fh - 1.8, 0.2, OK);
            }
          }
        halftone(x, y, w, h - 1.8, 3, true);
        text('passed', x, y + h - 0.2, 0.8, 600, OK);
        text('rejected', x + 4.5, y + h - 0.2, 0.8, 600, NO);
      },
    ],
    [
      'detect',
      (x, y, w, h0) => {
        if (imDetect) {
          // картинка без обрезки, чтобы рамки совпали с объектами на кадре
          const h = Math.min(h0, w / (imDetect.naturalWidth / imDetect.naturalHeight));
          cover(imDetect, x, y, w, h);
          // boxes over the objects in the picture (relative coordinates of the render)
          // доли кадра public/landing/detect.jpg (800×604, s = −14)
          const boxes: [number, number, number, number, string][] = [
            [0.21, 0.49, 0.065, 0.1, 'signage'],
            [0.29, 0.39, 0.13, 0.2, 'wall'],
            [0.78, 0.23, 0.05, 0.25, 'street light'],
            [0.44, 0.71, 0.21, 0.15, 'road surface'],
          ];
          ctx.strokeStyle = ACCENT;
          ctx.lineWidth = m(0.2);
          for (const [bx, by, bw, bh, label] of boxes) {
            ctx.strokeRect(m(x + bx * w), m(y + by * h), m(bw * w), m(bh * h));
            text(label, x + bx * w, y + by * h - 0.35, 0.65, 700, ACCENT);
          }
          halftone(x, y, w, h, 3, true);
        }
      },
    ],
    [
      'registry',
      (x, y, w) => {
        const rh = 1.75;
        text('Category', x, y + 1.1, 0.8, 700, '#777');
        text('Records', x + w * 0.62, y + 1.1, 0.8, 700, '#777');
        text('Status', x + w * 0.82, y + 1.1, 0.8, 700, '#777');
        line(x, y + 1.7, x + w, y + 1.7, 0.08);
        cats.forEach((cat, i) => {
          const ry = y + 1.7 + (i + 1) * rh;
          const n = story.markers.filter((k) => (k.category ?? k.title) === cat && k.kind !== 'info').length;
          text(cat, x, ry - 0.5, 0.95, 500);
          text(String(n), x + w * 0.62, ry - 0.5, 0.95, 700);
          text('open', x + w * 0.82, ry - 0.5, 0.85, 600, ACCENT);
          line(x, ry, x + w, ry, 0.04, '#bbb');
        });
      },
    ],
    [
      'case',
      (x, y, w, h) => {
        ctx.strokeStyle = INK;
        ctx.lineWidth = m(0.12);
        ctx.beginPath();
        ctx.roundRect(m(x), m(y), m(w), m(h), m(1));
        ctx.stroke();
        text('CASE 01', x + 1.2, y + 2, 0.8, 700, ACCENT, 0.15);
        text(`One street, ${cats.length} kinds of issues`, x + 1.2, y + 4.2, 1.35, 700);
        cats.forEach((cat, i) => {
          ctx.fillStyle = ACCENT;
          ctx.beginPath();
          ctx.arc(m(x + 1.6), m(y + 6.1 + i * 1.45 - 0.3), m(0.28), 0, Math.PI * 2);
          ctx.fill();
          text(cat, x + 2.4, y + 6.1 + i * 1.45, 0.9, 500, '#333');
        });
      },
    ],
    [
      'refresh',
      (x, y, w, h) => {
        if (imRefresh) {
          cover(imRefresh, x, y, w * 0.48, h);
          halftone(x, y, w * 0.48, h, 3, true);
        }
        const tx = x + w * 0.54;
        text('Road damage', tx, y + 2.2, 1.0, 600);
        line(tx, y + 1.85, tx + 7.3, y + 1.85, 0.12, NO);
        text('repaired · closed', tx, y + 3.7, 0.85, 600, OK);
        ctx.strokeStyle = INK;
        ctx.lineWidth = m(0.18);
        const ax = tx + 4, ay = y + 8.8, ar = 2.6;
        ctx.beginPath();
        ctx.arc(m(ax), m(ay), m(ar), -Math.PI * 0.35, Math.PI * 1.45);
        ctx.stroke();
        line(ax + ar * Math.cos(-Math.PI * 0.35), ay + ar * Math.sin(-Math.PI * 0.35), ax + ar * Math.cos(-Math.PI * 0.35) - 1.1, ay + ar * Math.sin(-Math.PI * 0.35) - 0.2, 0.18);
        line(ax + ar * Math.cos(-Math.PI * 0.35), ay + ar * Math.sin(-Math.PI * 0.35), ax + ar * Math.cos(-Math.PI * 0.35) + 0.1, ay + ar * Math.sin(-Math.PI * 0.35) - 1.1, 0.18);
        text('back to 01', tx, y + h - 0.4, 0.85, 600, '#666');
      },
    ],
  ];
  for (const [w, draw] of steps) {
    const i = byWidget(w);
    if (i >= 0) step(chapters[i], i, draw);
  }

  // closing (whatever room is left)
  if (cursor > 6) {
    section(Math.min(cursor, 14), (t) => {
      text('Keep walking.', left, t + 5.5, 3, 700);
      halftone(left - 0.5, t + 2.6, sp.width - 2 * left, 3.6, 3, false);
      text('The street comes back on the next lap.', left, t + 8, 1, 400, '#555');
    });
  }

  // ---------- canvas → splats
  const data = ctx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (const r of regions)
    for (let y = Math.max(0, r.y); y < Math.min(H, r.y + r.h); y++) mask.fill(1, y * W + Math.max(0, r.x), y * W + Math.min(W, r.x + r.w));

  const xs: number[] = [], ys: number[] = [], hs: number[] = [], sg: number[] = [], cols: number[] = [], als: number[] = [];
  const push = (x: number, y: number, h: number, sigmaM: number, r: number, g: number, b: number, a: number) => {
    xs.push(x);
    ys.push(y);
    hs.push(h);
    sg.push(sigmaM);
    cols.push((r & 255) | ((g & 255) << 8) | ((b & 255) << 16));
    als.push(Math.max(0, Math.min(255, Math.round(a * 255))));
  };
  const lum = (i: number) => (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;

  // paper
  const ps = Math.max(4, Math.round(0.48 * P));
  for (let y = ps / 2; y < H; y += ps) for (let x = ps / 2; x < W; x += ps) push(x, y, 0, 0.3, PAPER[0], PAPER[1], PAPER[2], 0.97);

  // halftone regions: one dot per cell; size from coverage (mono) or a full colour mosaic (pictures)
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
            ink += 1 - lum(i) / 0.96;
            n++;
          }
        if (!n) continue;
        R /= n;
        G /= n;
        B /= n;
        const cov = Math.max(0, Math.min(1, ink / n));
        if (r.color) {
          if (cov < 0.02) continue;
          push(x + k / 2, y + k / 2, 0.03, 0.42 * k * sp.mpp, R, G, B, 1);
        } else {
          if (cov < 0.08) continue;
          // pure ink colour, dot area ∝ coverage
          const dark = Math.min(1, cov * 1.15);
          push(x + k / 2, y + k / 2, 0.03, 0.5 * k * sp.mpp * Math.sqrt(dark), 0, 0, 0, 1);
          // the averaged colour is diluted by paper; recover the ink colour
          const j = cols.length - 1;
          const inv = (c: number, p: number) => Math.max(0, Math.min(255, Math.round(p - (p - c) / Math.max(dark, 0.05))));
          cols[j] = inv(R, PAPER[0]) | (inv(G, PAPER[1]) << 8) | (inv(B, PAPER[2]) << 16);
        }
      }
  }

  // fine ink (body text, lines): every pixel with enough ink outside halftone regions
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask[p]) continue;
      const i = p * 4;
      const l = lum(i);
      const sat = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
      const ink = Math.max(1 - l / 0.96, sat / 255);
      if (ink < 0.16) continue;
      const a = Math.min(1, ink * 1.25);
      const inv = (c: number, pp: number) => Math.max(0, Math.min(255, Math.round(pp - (pp - c) / Math.max(a, 0.05))));
      push(x + 0.5, y + 0.5, 0.03, 0.6 * sp.mpp, inv(data[i], PAPER[0]), inv(data[i + 1], PAPER[1]), inv(data[i + 2], PAPER[2]), a);
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
    const s = sp.sTo - ys[k] * sp.mpp;
    const w = sp.wLeft + xs[k] * sp.mpp;
    const h = hs[k];
    const qx = q16(s, bmin[0], ext[0]), qy = q16(h, bmin[1], ext[1]), qz = q16(w, bmin[2], ext[2]);
    const r16 = (Math.random() * 65535) | 0;
    const j = k * 4;
    texA[j] = qx | (qy << 16);
    texA[j + 1] = qz | (r16 << 16);
    texA[j + 2] = (cols[k] | (als[k] << 24)) >>> 0;
    texA[j + 3] = 255 | (128 << 8) | (128 << 16) | (128 << 24); // identity rotation
    const sgm = ls(sg[k]);
    texB[k] = sgm | (flat << 8) | (sgm << 16) | segBits;
    pos[k * 3] = bmin[0] + (qx / 65535) * ext[0];
    pos[k * 3 + 1] = bmin[1] + (qy / 65535) * ext[1];
    pos[k * 3 + 2] = bmin[2] + (qz / 65535) * ext[2];
    rank[k] = r16;
    alpha[k] = als[k];
  }
  return { seg: sp.segId, tier: -2, count: n, texA, texB, pos, rank, alpha };
}
