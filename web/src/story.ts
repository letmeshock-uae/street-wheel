// Scroll-driven story: "City world model" as a loop of six chapters laid around the wheel.
// Everything here is driven by the position on the ring (not by time), so the story scrubs
// forwards and backwards together with the street.
import type { PoiDef } from './pois';
import { smoothstep } from './ring';

export type WidgetKind = 'capture' | 'gate' | 'detect' | 'registry' | 'case' | 'refresh';

export interface Chapter {
  id: string;
  title: string;
  start: number; // ring coordinate s where the chapter begins
  body: string;
  /** короткая строка для лендинг-полотна */
  short?: string;
  widget?: WidgetKind;
  items?: string[];
}

export interface StoryMarker extends PoiDef {
  chapter: string;
  kind: 'detection' | 'asset' | 'info';
  category?: string;
}

export interface StoryDef {
  title: string;
  subtitle: string;
  cta: string;
  startS: number;
  chapters: Chapter[];
  markers: StoryMarker[];
  /** текст финального полотна (круг-лендинг) */
}

export interface StoryState {
  active: number; // index of the chapter under the camera
  p: number; // 0..1 progress inside it
  chapterAlpha: number[]; // how visible each chapter's markers should be
  streetLap: boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const mod = (a: number, n: number) => ((a % n) + n) % n;
const pad2 = (n: number) => String(n).padStart(2, '0');

// verdicts for the quality-gate animation (decorative)
const GATE = [1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0];

interface Widget {
  update(p: number, t: number): void;
}

export class Story {
  readonly chapters: Chapter[];
  private lens: number[];
  private root: HTMLElement;
  private hero: HTMLElement;
  private rail: HTMLElement;
  private railSegs: HTMLElement[] = [];
  private railLabel: HTMLElement;
  private panels: HTMLElement[] = [];
  private widgets: (Widget | null)[] = [];
  private viewfinder: HTMLElement;
  private vfTime: HTMLElement;
  private heroDone = false;
  private startAbs: number | null = null;
  private lapGate = 1;
  private categories: string[];
  /** метки, которые уже «сработали» в виджетах (детекции найдены, ассеты занесены в реестр) */
  readonly revealed = new Set<string>();

  onGo?: (s: number) => void;
  onHover?: (markerId: string | null) => void;
  onOpenMarker?: (markerId: string) => void;

  constructor(parent: HTMLElement, readonly def: StoryDef, private L: number) {
    this.chapters = [...def.chapters].sort((a, b) => a.start - b.start);
    this.lens = this.chapters.map((c, i) => {
      const next = this.chapters[(i + 1) % this.chapters.length];
      return mod(next.start - c.start, L) || L;
    });
    const detections = def.markers.filter((m) => m.kind === 'detection');
    this.categories = [...new Set(detections.map((m) => m.category ?? m.title))];

    this.root = document.createElement('div');
    this.root.className = 'story';
    parent.appendChild(this.root);

    // full-screen viewfinder for "Capture"
    this.viewfinder = el('div', 'viewfinder', `<i></i><i></i><i></i><i></i><span class="vf-rec">REC</span><span class="vf-time">00:00:00</span>`);
    this.vfTime = this.viewfinder.querySelector('.vf-time')!;
    this.root.appendChild(this.viewfinder);

    // hero
    this.hero = el(
      'section',
      'story-hero',
      `<h1>${esc(def.title)}</h1><p>${esc(def.subtitle)}</p><div class="story-cta"><span></span>${esc(def.cta)}</div>`,
    );
    this.root.appendChild(this.hero);

    // progress rail
    this.rail = el(
      'nav',
      'story-rail',
      `<div class="rail-title">${esc(def.title)}</div><div class="rail-segs">${this.chapters
        .map((c, i) => `<button class="rail-seg" aria-label="${pad2(i + 1)} ${esc(c.title)}"><span class="rail-bar"><span></span></span><span class="rail-n">${pad2(i + 1)}</span></button>`)
        .join('')}</div><div class="rail-label"></div>`,
    );
    this.rail.setAttribute('aria-label', 'Chapters');
    this.root.appendChild(this.rail);
    this.railLabel = this.rail.querySelector('.rail-label')!;
    this.rail.querySelectorAll<HTMLElement>('.rail-seg').forEach((b, i) => {
      this.railSegs.push(b);
      b.addEventListener('click', () => this.onGo?.(this.chapters[i].start + 3));
    });

    // chapter panels
    this.chapters.forEach((c, i) => {
      const panel = el(
        'article',
        'story-panel',
        `<div class="sp-n">${pad2(i + 1)}<span>/ ${pad2(this.chapters.length)}</span></div><h2>${esc(c.title)}</h2><p>${esc(c.body)}</p><div class="sp-widget"></div>`,
      );
      panel.setAttribute('aria-hidden', 'true');
      this.root.appendChild(panel);
      this.panels.push(panel);
      this.widgets.push(this.makeWidget(c, panel.querySelector('.sp-widget')!, i));
    });
  }

  /** Where a chapter starts (for navigation from the minimap). */
  chapterStart(i: number) {
    return this.chapters[i].start;
  }

  chapterIndex(id: string) {
    return this.chapters.findIndex((c) => c.id === id);
  }

  private makeWidget(c: Chapter, host: HTMLElement, idx: number): Widget | null {
    const markers = this.def.markers;
    switch (c.widget) {
      case 'capture': {
        const items = c.items ?? [];
        host.innerHTML = `<div class="w-chips">${items.map((t) => `<span class="w-chip">${esc(t)}</span>`).join('')}</div>`;
        const chips = [...host.querySelectorAll<HTMLElement>('.w-chip')];
        return { update: (p) => chips.forEach((ch, i) => ch.classList.toggle('is-on', p > 0.12 + i * 0.18)) };
      }
      case 'gate': {
        host.innerHTML =
          `<div class="w-frames">${GATE.map(() => '<span class="w-frame"></span>').join('')}</div>` +
          `<div class="w-legend"><span><b class="ok"></b>passed <em data-k="ok">0</em></span><span><b class="no"></b>rejected <em data-k="no">0</em></span></div>`;
        const frames = [...host.querySelectorAll<HTMLElement>('.w-frame')];
        const ok = host.querySelector<HTMLElement>('[data-k="ok"]')!;
        const no = host.querySelector<HTMLElement>('[data-k="no"]')!;
        return {
          update: (p) => {
            let a = 0, b = 0;
            frames.forEach((f, i) => {
              const done = p > 0.08 + i * 0.065;
              f.classList.toggle('is-pass', done && GATE[i] === 1);
              f.classList.toggle('is-reject', done && GATE[i] === 0);
              if (done) GATE[i] ? a++ : b++;
            });
            ok.textContent = String(a);
            no.textContent = String(b);
          },
        };
      }
      case 'detect': {
        const dets = markers.filter((m) => m.kind === 'detection');
        host.innerHTML = `<ul class="w-list">${dets
          .map((m) => `<li data-id="${esc(m.id)}"><span class="w-dot"></span>${esc(m.category ?? m.title)}<em>scanning</em></li>`)
          .join('')}</ul>`;
        const rows = [...host.querySelectorAll<HTMLElement>('li')];
        // a detection "fires" a little before the camera reaches the object
        const at = dets.map((m) => Math.min(0.92, Math.max(0.06, (mod((m.street?.[0] ?? 0) - c.start, this.L) - 22) / this.lens[idx])));
        rows.forEach((r) => {
          const id = r.dataset.id!;
          r.addEventListener('mouseenter', () => this.onHover?.(id));
          r.addEventListener('mouseleave', () => this.onHover?.(null));
          r.addEventListener('click', () => this.onOpenMarker?.(id));
        });
        return {
          update: (p) =>
            rows.forEach((r, i) => {
              const on = p > at[i];
              if (on) this.revealed.add(dets[i].id);
              else this.revealed.delete(dets[i].id);
              if (r.classList.contains('is-on') !== on) {
                r.classList.toggle('is-on', on);
                r.querySelector('em')!.textContent = on ? 'detected' : 'scanning';
              }
            }),
        };
      }
      case 'registry': {
        const count = (cat: string) => markers.filter((m) => (m.category ?? m.title) === cat && m.kind !== 'info').length;
        host.innerHTML =
          `<div class="w-table"><div class="w-tr w-th"><span>Category</span><span>Records</span><span>Status</span></div>` +
          this.categories.map((cat) => `<div class="w-tr"><span>${esc(cat)}</span><span class="num">${count(cat)}</span><span><i>open</i></span></div>`).join('') +
          `</div>`;
        const rows = [...host.querySelectorAll<HTMLElement>('.w-tr:not(.w-th)')];
        const assets = markers.filter((k) => k.kind === 'asset');
        return {
          update: (p) =>
            rows.forEach((r, i) => {
              const on = p > 0.1 + i * 0.12;
              r.classList.toggle('is-on', on);
              // ярлыки ассетов в сцене появляются вместе со своей строкой реестра
              for (const a of assets) if ((a.category ?? a.title) === this.categories[i]) on ? this.revealed.add(a.id) : this.revealed.delete(a.id);
            }),
        };
      }
      case 'case': {
        const n = this.categories.length;
        host.innerHTML =
          `<div class="w-case"><div class="w-case-h"><span>Case 01</span><i>open</i></div>` +
          `<div class="w-case-t">One street, ${n} kinds of issues</div>` +
          this.categories.map((cat) => `<div class="w-case-row"><span class="w-dot"></span>${esc(cat)}</div>`).join('') +
          `<div class="w-case-f">Narrative ready</div></div>`;
        const rows = [...host.querySelectorAll<HTMLElement>('.w-case-row')];
        const foot = host.querySelector<HTMLElement>('.w-case-f')!;
        return {
          update: (p) => {
            rows.forEach((r, i) => r.classList.toggle('is-on', p > 0.12 + i * 0.1));
            foot.classList.toggle('is-on', p > 0.12 + n * 0.1 + 0.05);
          },
        };
      }
      case 'refresh': {
        const road = this.categories.find((c) => /road/i.test(c)) ?? this.categories[0];
        host.innerHTML =
          `<ul class="w-list w-refresh">${this.categories
            .map((cat) => `<li class="is-on${cat === road ? ' is-road' : ''}"><span class="w-dot"></span>${esc(cat)}<em>open</em></li>`)
            .join('')}</ul><div class="w-loop"><span class="w-loop-i">↻</span>The loop starts again</div>`;
        const roadRow = host.querySelector<HTMLElement>('.is-road');
        const loop = host.querySelector<HTMLElement>('.w-loop')!;
        const icon = host.querySelector<HTMLElement>('.w-loop-i')!;
        return {
          update: (p) => {
            if (roadRow) {
              const fixed = p > 0.3;
              if (roadRow.classList.contains('is-fixed') !== fixed) {
                roadRow.classList.toggle('is-fixed', fixed);
                roadRow.querySelector('em')!.textContent = fixed ? 'repaired' : 'open';
              }
            }
            loop.classList.toggle('is-on', p > 0.55);
            icon.style.transform = `rotate(${(p * 540).toFixed(1)}deg)`;
          },
        };
      }
      default:
        return null;
    }
  }

  /**
   * sCam — ring coordinate of the camera, sAbs — unbounded position (to know how far the user has walked),
   * streetLap — false on the finale lap, where the text panel tells the story.
   */
  update(sCam: number, sAbs: number, streetLap: boolean, dt: number, clock: number): StoryState {
    if (this.startAbs === null) this.startAbs = sAbs;
    const traveled = Math.abs(sAbs - this.startAbs);
    if (traveled > 12) this.heroDone = true;
    const heroA = this.heroDone ? 0 : 1 - smoothstep(1.5, 9, traveled);
    this.hero.style.opacity = heroA.toFixed(3);
    this.hero.style.transform = `translateY(${(-(1 - heroA) * 30).toFixed(1)}px)`;
    this.hero.style.visibility = heroA < 0.01 ? 'hidden' : 'visible';

    this.lapGate += ((streetLap ? 1 : 0) - this.lapGate) * Math.min(1, dt * 3);

    let active = 0, p = 0;
    const chapterAlpha: number[] = [];
    this.chapters.forEach((c, i) => {
      const off = mod(sCam - c.start, this.L);
      const len = this.lens[i];
      const inside = off < len;
      if (inside) {
        active = i;
        p = off / len;
      }
      // fade by metres so short and long chapters feel the same
      const a = inside ? smoothstep(0, 5, off) * (1 - smoothstep(len - 5, len, off)) : 0;
      chapterAlpha.push(a * this.lapGate);
      const pa = a * this.lapGate * (1 - heroA);
      const panel = this.panels[i];
      if (pa < 0.005) {
        if (panel.style.visibility !== 'hidden') {
          panel.style.visibility = 'hidden';
          panel.classList.remove('is-active');
        }
        return;
      }
      panel.style.visibility = 'visible';
      panel.classList.add('is-active');
      const enter = inside ? smoothstep(0, 5, off) : 0;
      const leave = inside ? smoothstep(len - 5, len, off) : 0;
      panel.style.opacity = pa.toFixed(3);
      panel.style.transform = `translateY(${((1 - enter) * 26 - leave * 26).toFixed(1)}px)`;
      panel.style.filter = pa > 0.98 ? '' : `blur(${((1 - pa) * 6).toFixed(1)}px)`;
      this.widgets[i]?.update(off / len, clock);
    });

    // rail
    this.railSegs.forEach((seg, i) => {
      const fill = !streetLap ? 0 : i < active ? 1 : i === active ? p : 0;
      (seg.firstElementChild!.firstElementChild as HTMLElement).style.transform = `scaleX(${fill.toFixed(3)})`;
      seg.classList.toggle('is-active', streetLap && i === active);
    });
    this.railLabel.textContent = streetLap ? this.chapters[active].title : 'Inside the loop';
    this.rail.style.opacity = (1 - heroA * 0.85).toFixed(3);

    // viewfinder belongs to "Capture"
    const capIdx = this.chapters.findIndex((c) => c.widget === 'capture');
    const vfA = capIdx >= 0 ? chapterAlpha[capIdx] * (1 - heroA) : 0;
    this.viewfinder.style.opacity = vfA.toFixed(3);
    this.viewfinder.style.visibility = vfA < 0.01 ? 'hidden' : 'visible';
    if (vfA > 0.01) {
      const t = Math.floor(clock);
      this.vfTime.textContent = `${pad2(Math.floor(t / 3600))}:${pad2(Math.floor(t / 60) % 60)}:${pad2(t % 60)}`;
    }

    return { active, p, chapterAlpha, streetLap };
  }
}

function el(tag: string, cls: string, html: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  return e;
}
