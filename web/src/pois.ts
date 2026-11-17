// Точки интереса и сноски. Обычный DOM поверх canvas: чёткий текст, доступность,
// работает во всех браузерах. Позиция считается той же функцией изгиба, что и сплаты.
import type { Camera } from './camera';
import type { Manifest } from './data';
import { bendPoint, smoothstep, wrap } from './ring';

export interface PoiDef {
  id: string;
  title: string;
  /** 'detection' — frame around the object, 'asset' — registry tag, otherwise a dot with a label */
  kind?: 'detection' | 'asset' | 'info';
  category?: string;
  chapter?: string;
  text?: string;
  tag?: string;
  link?: string;
  image?: string;
  /** уличные координаты [s, h, w] (их выдаёт режим разметки — клавиша E) */
  street?: [number, number, number];
  /** или исходные координаты модели [x, y, z] (например, из SuperSplat) */
  model?: [number, number, number];
}

export interface Poi extends PoiDef {
  s: number;
  h: number;
  w: number;
  el: HTMLElement;
  visible: boolean;
}

export function modelToStreet(m: Manifest, p: [number, number, number]): [number, number, number] {
  const R = m.modelToStreet.matrix;
  const s = R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2];
  let h = R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2];
  const w = R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2];
  const gs = m.modelToStreet.groundS, gh = m.modelToStreet.groundH;
  let g = gh[0];
  if (s >= gs[gs.length - 1]) g = gh[gh.length - 1];
  else
    for (let i = 1; i < gs.length; i++)
      if (s < gs[i]) {
        const t = (s - gs[i - 1]) / (gs[i] - gs[i - 1]);
        g = s < gs[0] ? gh[0] : gh[i - 1] + (gh[i] - gh[i - 1]) * t;
        break;
      }
  h -= g;
  return [s, h, w];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class PoiLayer {
  pois: Poi[] = [];
  private open: Poi | null = null;
  private card: HTMLElement;
  private tmp = [0, 0, 0];
  onOpen?: (p: Poi | null) => void;
  /** на каком расстоянии вдоль улицы метка начинает проявляться (впереди / позади) */
  range = 70;
  rangeBehind = 22;
  private hot: string | null = null;

  constructor(private root: HTMLElement, private m: Manifest, private cam: Camera) {
    this.card = document.createElement('aside');
    this.card.className = 'poi-card';
    this.card.setAttribute('role', 'dialog');
    this.card.hidden = true;
    root.appendChild(this.card);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.select(null);
    });
  }

  set(defs: PoiDef[]) {
    for (const p of this.pois) p.el.remove();
    this.pois = defs.map((d, i) => {
      const [s, h, w] = d.street ?? (d.model ? modelToStreet(this.m, d.model) : [0, 0, 0]);
      const el = document.createElement('div');
      el.className = `poi poi--${d.kind ?? 'info'}`;
      el.style.display = 'none';
      if (d.kind === 'detection')
        el.innerHTML =
          `<button class="det-box" aria-label="${esc(d.title)}"><i></i><i></i><i></i><i></i></button>` +
          `<div class="poi-label"><b>Detected</b>${esc(d.category ?? d.title)}</div>`;
      else if (d.kind === 'asset')
        el.innerHTML =
          `<button class="poi-dot" aria-label="${esc(d.title)}"><span></span></button>` +
          `<div class="poi-label"><b>Asset · ${esc(d.category ?? '')}</b>${esc(d.title)}<em>registered</em></div>`;
      else
        el.innerHTML = `<button class="poi-dot" aria-label="${esc(d.title)}"><span></span></button><div class="poi-label"><b>${esc(d.tag ?? String(i + 1).padStart(2, '0'))}</b>${esc(d.title)}</div>`;
      const poi: Poi = { ...d, s, h, w, el, visible: false };
      el.querySelector('button')!.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select(this.open === poi ? null : poi);
      });
      this.root.appendChild(el);
      return poi;
    });
  }

  /** подсветка метки (наведение на строку в панели главы) */
  highlight(id: string | null) {
    this.hot = id;
    for (const q of this.pois) q.el.classList.toggle('is-hot', q.id === id);
  }

  byId(id: string) {
    return this.pois.find((p) => p.id === id) ?? null;
  }

  select(p: Poi | null) {
    this.open = p;
    for (const q of this.pois) q.el.classList.toggle('is-open', q === p);
    if (!p) {
      this.card.hidden = true;
      this.onOpen?.(null);
      return;
    }
    this.card.innerHTML =
      `<button class="poi-close" aria-label="Close">×</button>` +
      `<div class="poi-card-tag">${esc(p.kind === 'detection' ? 'Detected' : p.kind === 'asset' ? 'Asset' : p.tag ?? '')}</div><h2>${esc(p.title)}</h2>` +
      (p.image ? `<img src="${esc(p.image)}" alt="">` : '') +
      (p.text ? `<p>${esc(p.text)}</p>` : '') +
      (p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener">Learn more →</a>` : '');
    this.card.querySelector('.poi-close')!.addEventListener('click', () => this.select(null));
    this.card.hidden = false;
    this.onOpen?.(p);
  }

  /** chapterAlpha(p) — дополнительная видимость метки (глава рассказа активна или нет) */
  update(sCam: number, kappa: number, cssW: number, cssH: number, globalAlpha: number, chapterAlpha: (p: Poi) => number = () => 1) {
    const L = this.m.street.length;
    const focal = cssH / 2 / this.cam.tanY;
    for (const p of this.pois) {
      const ds = wrap(p.s - sCam, L);
      const d = Math.abs(ds);
      const rng = ds >= 0 ? this.range : this.rangeBehind;
      let a = (1 - smoothstep(rng * 0.6, rng, d)) * globalAlpha * chapterAlpha(p);
      if (p.id === this.hot) a = Math.max(a, 0.9 * globalAlpha * Math.min(1, chapterAlpha(p) * 4));
      let pr: ReturnType<Camera['project']> = null;
      if (a > 0.01) {
        bendPoint(p.s, p.h, p.w, sCam, kappa, L, this.tmp);
        pr = this.cam.project(this.tmp[0], this.tmp[1], this.tmp[2], cssW, cssH);
        if (!pr || pr.depth < 1.2 || pr.x < -80 || pr.x > cssW + 80 || pr.y < -80 || pr.y > cssH + 80) a = 0;
      }
      const vis = a > 0.01 && !!pr;
      if (vis !== p.visible) {
        p.visible = vis;
        p.el.style.display = vis ? '' : 'none';
      }
      if (!vis || !pr) {
        if (p === this.open && d > this.range) this.select(null);
        continue;
      }
      if (p.kind === 'detection') {
        // рамка «детекции» примерно на 2.2 м объекта
        const box = Math.max(34, Math.min(260, (2.2 * focal) / pr.depth));
        p.el.style.setProperty('--box', `${box.toFixed(0)}px`);
        p.el.style.transform = `translate3d(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px, 0)`;
      } else {
        const sc = Math.max(0.65, Math.min(1.15, 18 / pr.depth));
        p.el.style.transform = `translate3d(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px, 0) scale(${sc.toFixed(3)})`;
      }
      p.el.style.opacity = a.toFixed(3);
      p.el.style.zIndex = String(10000 - Math.round(pr.depth * 10));
      if (p === this.open) {
        const left = pr.x + 22 > cssW - 340 ? Math.max(12, pr.x - 340) : pr.x + 22;
        const top = Math.max(12, Math.min(cssH - this.card.offsetHeight - 12, pr.y - 30));
        this.card.style.transform = `translate3d(${left.toFixed(0)}px, ${top.toFixed(0)}px, 0)`;
      }
    }
  }
}
