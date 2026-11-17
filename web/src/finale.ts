// Финал рассказа — обычная текстовая плашка поверх сцены. Её прокручивает тот же скролл, что ведёт
// колесо: на круге-финале город рассыпан в абстрактные частицы. Сначала идут надписи из частиц
// (заголовок посреди улицы и две строки на стенах, particletext.ts), потом снизу въезжает плашка,
// проезжает и уходит вверх; дальше на асфальте — «The loop goes on.», город собирается обратно,
// и рассказ начинается заново.

// ---------------------------------------------------------------------------------------------
// COPY — текст финала (по документу City World Model). Правится свободно, вёрстка подстроится.
// ---------------------------------------------------------------------------------------------
// заголовок «Every kilometre counts.» и строки про поток кадров — из частиц, в particletext.ts
const COPY = {
  pipelineTitle: 'Observation first.',
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
  life: { kicker: 'The life of one street light', id: '7f3a', chain: 'Look → Object → State → Event' },
  episodes: [
    ['t0 · first pass', 'appeared', 'knowledge', 'We only just learned it exists.'],
    ['t1 · taxi, 12 frames', 'one look, not twelve', '', 'Same sensor, same light, same second. State confirmed, no event.'],
    ['t3 · resident report', 'waits', '', 'GPS ±20 m instead of 0.4 m, three candidate poles. It waits for a machine look.'],
    ['t4 · own fleet', 'degraded', 'world', 'Tilt 8°, over the 5° threshold. The city really changed.'],
    ['t5 · night pass', 'no vote', '', 'Too dark to measure. The look counts neither for nor against.'],
    ['t6–t8 · three clear looks', 'disappeared', 'world', 'Three good looks, no pole: K = 3.'],
  ] as [string, string, string, string][],
  eventCost: 'An event is expensive: it creates work orders and contractor deadlines. Four of six episodes create none. A false disappearance costs more than a delay.',
  delta: 'A delta is not “the city changed”. First pass: images with coordinates. First recognition: everything appears, cause knowledge. New classes: more appears, back-dated. Only the second pass shows the world.',
  bitemporal: 'Seen in August. Known in October. Both dates kept.',
  principlesTitle: 'Principles',
  principles: ['Many frames, one look.', 'Not seeing it is not seeing it gone.', 'A resident report waits for a machine look.', 'Protect the event.'],
  // финальная строка «The loop goes on.» — не здесь, а на асфальте после плашки (particletext.ts)
};

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n2 = (i: number) => String(i + 1).padStart(2, '0');

export class Finale {
  readonly el: HTMLElement;
  private h = 0;
  private shown = false;
  private lastY = -1e9;

  constructor(root: HTMLElement) {
    const c = COPY;
    const el = document.createElement('article');
    el.className = 'finale';
    el.setAttribute('aria-label', 'City world model: inside the loop');
    el.innerHTML = `
      <section class="fi-sec">
        <h3>${esc(c.pipelineTitle)}</h3>
        <ol class="fi-steps">
          ${c.pipeline.map(([t, b], i) => `<li><span class="fi-n">${n2(i)}</span><div><b>${esc(t)}</b><p>${esc(b)}</p></div></li>`).join('')}
        </ol>
        <p class="fi-muted">${esc(c.rejected)}</p>
      </section>
      <section class="fi-sec">
        <p class="fi-kicker">${esc(c.life.kicker)}</p>
        <h3 class="fi-id">${esc(c.life.id)}</h3>
        <p class="fi-muted">${esc(c.life.chain)}</p>
        <ol class="fi-episodes">
          ${c.episodes
            .map(
              ([when, verb, cause, note]) =>
                `<li><span class="fi-when">${esc(when)}</span><b class="fi-verb${verb === 'disappeared' ? ' is-gone' : verb === 'degraded' ? ' is-warn' : ''}">${esc(verb)}</b>${
                  cause ? `<span class="fi-cause${cause === 'world' ? ' is-world' : ''}">cause: ${esc(cause)}</span>` : ''
                }<p>${esc(note)}</p></li>`,
            )
            .join('')}
        </ol>
        <p>${esc(c.eventCost)}</p>
        <p>${esc(c.delta)}</p>
        <p class="fi-big">${esc(c.bitemporal)}</p>
      </section>
      <section class="fi-sec">
        <p class="fi-kicker">${esc(c.principlesTitle)}</p>
        <ol class="fi-principles">
          ${c.principles.map((t, i) => `<li><span class="fi-n">${n2(i)}</span>${esc(t)}</li>`).join('')}
        </ol>
      </section>`;
    root.prepend(el); // под шкалой глав, колесом-схемой и настройками
    this.el = el;
    const measure = () => (this.h = el.offsetHeight);
    measure();
    new ResizeObserver(measure).observe(el);
    void document.fonts?.ready.then(measure);
  }

  /** путь плашки в пикселях: от «верх у нижнего края экрана» до «низ у верхнего края» */
  get travel(): number {
    return innerHeight + this.h;
  }

  /** t: 0 — плашка целиком под экраном, 1 — целиком над ним; a — общая видимость (0..1) */
  update(t: number, a: number) {
    const y = innerHeight - t * this.travel;
    const show = a > 0.01 && y < innerHeight && y > -this.h;
    if (show !== this.shown) {
      this.shown = show;
      this.el.style.visibility = show ? 'visible' : 'hidden';
    }
    if (!show) return;
    if (Math.abs(y - this.lastY) > 0.05) {
      this.lastY = y;
      this.el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
    }
    this.el.style.opacity = a.toFixed(3);
  }
}
