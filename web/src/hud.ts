// HUD: «колесо»-миникарта (пользователь всегда внизу, колесо крутится) + отладка.
import type { Poi } from './pois';

const SVGNS = 'http://www.w3.org/2000/svg';

export interface HudChapter {
  start: number;
  len: number;
  title: string;
}

export class WheelHud {
  private svg: SVGSVGElement;
  private rot: SVGGElement;
  private ticks: SVGGElement;
  private arcs: SVGPathElement[] = [];
  private labels: SVGTextElement[] = [];
  private center: SVGTextElement;
  private L: number;
  private R = 46;
  onPick?: (p: Poi) => void;
  onChapter?: (i: number) => void;

  constructor(root: HTMLElement, L: number, sMax: number, seamWidth: number) {
    this.L = L;
    const R = this.R;
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('viewBox', '-64 -64 128 128');
    this.svg.classList.add('wheel-hud');
    this.svg.innerHTML = `
      <circle r="${R}" class="wh-rim"/>
      <g class="wh-rot"><path class="wh-seam"/><g class="wh-arcs"></g><g class="wh-ticks"></g><g class="wh-labels"></g></g>
      <circle r="3.2" cy="${R}" class="wh-me"/>
      <text class="wh-center" text-anchor="middle" dominant-baseline="central"></text>`;
    root.appendChild(this.svg);
    this.rot = this.svg.querySelector('.wh-rot')!;
    this.ticks = this.svg.querySelector('.wh-ticks')!;
    this.center = this.svg.querySelector('.wh-center')!;
    const a0 = ((sMax - seamWidth) / L) * Math.PI * 2;
    const a1 = ((sMax + seamWidth) / L) * Math.PI * 2;
    this.svg.querySelector('.wh-seam')!.setAttribute('d', this.arc(a0, a1, R));
  }

  private pt(a: number, r: number) {
    return `${(Math.sin(a) * r).toFixed(2)} ${(Math.cos(a) * r).toFixed(2)}`;
  }

  private arc(a0: number, a1: number, r: number) {
    return `M ${this.pt(a0, r)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 0 ${this.pt(a1, r)}`;
  }

  /** главы рассказа — дуги на колесе */
  setChapters(ch: HudChapter[]) {
    const g = this.svg.querySelector('.wh-arcs')!;
    const gl = this.svg.querySelector('.wh-labels')!;
    g.innerHTML = '';
    gl.innerHTML = '';
    this.arcs = [];
    this.labels = [];
    const k = (Math.PI * 2) / this.L;
    ch.forEach((c, i) => {
      const a0 = c.start * k + 0.05;
      const a1 = (c.start + c.len) * k - 0.05;
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', this.arc(a0, a1, this.R));
      path.classList.add('wh-arc');
      const t = document.createElementNS(SVGNS, 'title');
      t.textContent = `${String(i + 1).padStart(2, '0')} ${c.title}`;
      path.appendChild(t);
      path.addEventListener('click', () => this.onChapter?.(i));
      g.appendChild(path);
      this.arcs.push(path);
      const am = (a0 + a1) / 2;
      const lab = document.createElementNS(SVGNS, 'text');
      lab.setAttribute('x', (Math.sin(am) * (this.R + 10)).toFixed(2));
      lab.setAttribute('y', (Math.cos(am) * (this.R + 10)).toFixed(2));
      lab.setAttribute('text-anchor', 'middle');
      lab.setAttribute('dominant-baseline', 'central');
      lab.classList.add('wh-num');
      lab.textContent = String(i + 1).padStart(2, '0');
      lab.addEventListener('click', () => this.onChapter?.(i));
      gl.appendChild(lab);
      this.labels.push(lab);
    });
  }

  setPois(pois: Poi[]) {
    this.ticks.innerHTML = '';
    for (const p of pois) {
      const a = (p.s / this.L) * Math.PI * 2;
      const c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', (Math.sin(a) * (this.R - 7)).toFixed(2));
      c.setAttribute('cy', (Math.cos(a) * (this.R - 7)).toFixed(2));
      c.setAttribute('r', '1.4');
      c.classList.add('wh-poi', `wh-poi--${p.kind ?? 'info'}`);
      const t = document.createElementNS(SVGNS, 'title');
      t.textContent = p.title;
      c.appendChild(t);
      c.addEventListener('click', () => this.onPick?.(p));
      this.ticks.appendChild(c);
    }
  }

  update(sCam: number, active = -1, streetLap = true) {
    // точка s рисуется под углом a=s/L·2π от «низа»; поворачиваем так, чтобы sCam была внизу
    const deg = (sCam / this.L) * 360;
    this.rot.setAttribute('transform', `rotate(${deg.toFixed(2)})`);
    this.arcs.forEach((a, i) => a.classList.toggle('is-active', streetLap && i === active));
    this.labels.forEach((l, i) => {
      // подписи не переворачиваются вместе с колесом
      l.setAttribute('transform', `rotate(${(-deg).toFixed(2)} ${l.getAttribute('x')} ${l.getAttribute('y')})`);
      l.classList.toggle('is-active', streetLap && i === active);
    });
    const txt = streetLap && active >= 0 ? String(active + 1).padStart(2, '0') : '∞';
    if (this.center.textContent !== txt) this.center.textContent = txt;
    this.svg.classList.toggle('is-landing', !streetLap);
  }
}

export class DebugHud {
  private el: HTMLElement;
  constructor(root: HTMLElement) {
    this.el = document.createElement('pre');
    this.el.className = 'debug';
    root.appendChild(this.el);
  }
  set(lines: Record<string, string | number>) {
    this.el.textContent = Object.entries(lines)
      .map(([k, v]) => `${k.padEnd(10)} ${v}`)
      .join('\n');
  }
  toggle() {
    this.el.hidden = !this.el.hidden;
  }
  get visible() {
    return !this.el.hidden;
  }
}
