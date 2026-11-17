import './style.css';
import { Camera } from './camera';
import type { Manifest } from './data';
import { Controls } from './controls';
import { DebugHud, WheelHud } from './hud';
import { PoiLayer } from './pois';
import { Adaptive, detectQuality, PROFILES } from './quality';
import { SplatRenderer, type FrameUniforms } from './renderer';
import { DEFAULT_REVEAL, smoothstep, wrap, type RevealParams } from './ring';
import { Streamer } from './streamer';
import type { SortIn, SortOut, SortRequest } from './sort.worker';
import { loadSettings, TunePanel } from './tune';
import { Story, type StoryDef } from './story';
import { buildLanding, pageBounds, type PageSpec } from './landing';

const params = new URLSearchParams(location.search);
// ?data=имя_папки — A/B-сравнение разных сборок данных из public/
// абсолютный URL: воркеры резолвят относительные пути от своего файла (/assets/), а не от страницы
const DATA = new URL(import.meta.env.BASE_URL + (params.get('data')?.replace(/[^\w-]/g, '') || 'data') + '/', location.href).href;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- настройки сцены. Живые — в панели (кнопка в правом верхнем углу), см. tune.ts;
// через URL: ?eye=3&pitch=0.4&fov=78&exp=1.2, а также ?lane=-8&s=55
const S = loadSettings(params);
const LOOK = {
  lane: Number(params.get('lane') ?? -8),
  startS: Number(params.get('s') ?? 0),
  bg: [0.0, 0.0, 0.0] as [number, number, number],
};

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

async function main() {
  const canvas = $('#gl') as HTMLCanvasElement;
  const ui = $('#ui');
  const loader = $('#loader');
  const bar = $('#loader-bar');
  const status = $('#loader-status');

  const manifest: Manifest = await (await fetch(DATA + 'manifest.json')).json();
  const street = { sMin: manifest.street.sMin, sMax: manifest.street.sMax, length: manifest.street.length };
  const L = street.length;
  const kFull = (2 * Math.PI) / L;

  const q = detectQuality();
  const profile = PROFILES[q.name];
  let renderer: SplatRenderer;
  try {
    renderer = new SplatRenderer(canvas, profile.poolSplats);
  } catch (e) {
    status.textContent = 'Your browser does not support WebGL2, so the scene cannot be shown.';
    throw e;
  }
  // ---- рассказ (story.json) и лендинг-полотно на каждом втором круге
  let storyDef: StoryDef | null = null;
  try {
    storyDef = await (await fetch(import.meta.env.BASE_URL + 'story.json')).json();
  } catch (e) {
    console.warn('story.json', e);
  }
  const pageSpec: PageSpec = {
    sFrom: street.sMin + 25,
    sTo: street.sMax - 42, // заканчиваем до того, как город начнёт возвращаться
    width: 36,
    wLeft: LOOK.lane - 18,
    // разрешение текста: точка на 2.5 см — мелкие подписи остаются чёткими
    mpp: q.name === 'low' ? 0.045 : q.name === 'mid' ? 0.032 : 0.025,
    segId: manifest.segments.length + 1,
    scaleLogMin: manifest.quant.scaleLogMin,
    scaleLogMax: manifest.quant.scaleLogMax,
  };
  const landingOn = !!storyDef && !params.has('nolanding');
  renderer.setSegments(manifest, landingOn ? [{ id: pageSpec.segId, ...pageBounds(pageSpec), flag: 2 }] : []);

  // ---- воркер сортировки
  const sorter = new Worker(new URL('./sort.worker.ts', import.meta.url), { type: 'module' });
  sorter.postMessage({ type: 'init', street } satisfies SortIn);
  let reqId = 1;
  let sortBusy = false;
  let lastSortMs: number | null = null;
  let sortStats = { candidates: 0, kept: 0, ms: 0 };
  const picks = new Map<number, (hit: { s: number; h: number; w: number } | null) => void>();

  const streamer = new Streamer(manifest, renderer, sorter, DATA, profile.maxRank, () => reqId);

  sorter.onmessage = (e: MessageEvent<SortOut>) => {
    const m = e.data;
    if (m.type === 'sorted') {
      renderer.setIndices(new Uint32Array(m.buf), m.count);
      sorter.postMessage({ type: 'recycle', buf: m.buf } satisfies SortIn, [m.buf]);
      streamer.onSorted(m.reqId);
      lastSortMs = m.ms;
      sortStats = { candidates: m.candidates, kept: m.kept, ms: m.ms };
      sortBusy = false;
    } else if (m.type === 'picked') {
      picks.get(m.reqId)?.(m.hit);
      picks.delete(m.reqId);
    }
  };

  // ---- стартовая загрузка (редкие частицы всего кольца)
  status.textContent = 'Assembling the street…';
  await streamer.loadBase((f) => (bar.style.transform = `scaleX(${(0.1 + f * 0.9).toFixed(3)})`));

  const cam = new Camera();
  cam.eye = [0, S.eye, LOOK.lane];
  cam.fovY = (S.fov * Math.PI) / 180;
  const controls = new Controls(canvas);
  controls.basePitch = S.pitch;
  controls.s = controls.sTarget = params.has('s') ? LOOK.startS : storyDef?.startS ?? LOOK.startS;
  controls.mouseLook = !params.has('edit');
  const adaptive = new Adaptive();

  // ---- метки на объектах + рассказ
  const pois = new PoiLayer($('#pois'), manifest, cam);
  const hud = new WheelHud(ui, L, street.sMax, manifest.street.seamWidth);
  const goToPoi = (id: string) => {
    const p = pois.byId(id);
    if (!p) return;
    controls.goTo(p.s - 14, L);
    setTimeout(() => pois.select(p), 1100);
  };
  hud.onPick = (p) => goToPoi(p.id);
  pois.onOpen = (p) => document.body.classList.toggle('poi-open', !!p);
  let story: Story | null = null;
  if (storyDef) {
    story = new Story(ui, storyDef, L);
    pois.set(storyDef.markers);
    hud.setPois(pois.pois);
    hud.setChapters(story.chapters.map((c, i) => ({ start: c.start, len: ((story!.chapters[(i + 1) % story!.chapters.length].start - c.start) % L + L) % L || L, title: c.title })));
    hud.onChapter = (i) => controls.goTo(story!.chapterStart(i) + 3, L);
    story.onGo = (s) => controls.goTo(s, L);
    story.onHover = (id) => pois.highlight(id);
    story.onOpenMarker = goToPoi;
    $('#hint')?.remove();
  }
  // какой круг лендинговый: стартовый круг — всегда улица
  const lapOf = (sAbs: number) => Math.floor(((((sAbs - street.sMax) % (2 * L)) + 2 * L) % (2 * L)) / L);
  const landingParity = landingOn ? 1 - lapOf(controls.s) : -1;
  // ?landing — сразу на круг-лендинг, чуть перед началом полотна
  if (landingOn && params.has('landing')) controls.s = controls.sTarget = pageSpec.sFrom - 6 + L;
  if (landingOn) {
    // полотно строится, пока человек идёт первый круг
    setTimeout(async () => {
      try {
        const { chunk, texture } = await buildLanding(pageSpec, storyDef!);
        renderer.setPageTexture(texture);
        const pb = pageBounds(pageSpec);
        streamer.addPage(chunk, pb.bmin[0], pb.bmin[0] + pb.ext[0]);
      } catch (e) {
        console.warn('landing', e);
      }
    }, 2500);
  }

  // любая правка в панели → пересортировка с новыми параметрами
  let tuneVersion = 0;
  if (!params.has('notune')) new TunePanel(ui, S, () => tuneVersion++);

  // ?clean — только сцена, без интерфейса (для чистых кадров)
  document.body.classList.toggle('clean', params.has('clean'));
  const debug = new DebugHud(ui);
  if (!params.has('debug')) debug.toggle();

  // ---- режим разметки сносок: E → клик по сцене → координаты в буфер обмена
  let editMode = params.has('edit');
  const toast = $('#toast');
  const showToast = (html: string, ms = 4000) => {
    toast.innerHTML = html;
    toast.hidden = false;
    clearTimeout((showToast as unknown as { t?: number }).t);
    (showToast as unknown as { t?: number }).t = window.setTimeout(() => (toast.hidden = true), ms);
  };
  document.body.classList.toggle('edit', editMode);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'e' || e.key === 'E' || e.key === 'у' || e.key === 'У') {
      editMode = !editMode;
      controls.mouseLook = !editMode;
      document.body.classList.toggle('edit', editMode);
      showToast(editMode ? 'Edit mode: click an object to copy its coordinates' : 'Edit mode off', 2200);
    }
    if (e.key === 'd' && e.shiftKey) debug.toggle();
  });
  canvas.addEventListener('click', (e) => {
    if (!editMode) return;
    const r = cam.ray(e.clientX, e.clientY, innerWidth, innerHeight);
    const id = reqId++;
    picks.set(id, (hit) => {
      if (!hit) return showToast('Nothing under the cursor. Try clicking closer to an object.');
      const json = `{ "id": "poi-${Date.now().toString(36)}", "title": "New point", "text": "", "street": [${hit.s.toFixed(2)}, ${hit.h.toFixed(2)}, ${hit.w.toFixed(2)}] }`;
      navigator.clipboard?.writeText(json).catch(() => {});
      console.log(json);
      showToast(`<b>Copied</b><code>${json}</code>`, 6000);
    });
    sorter.postMessage({ type: 'pick', reqId: id, sCam: sCamOf(controls.s), kappa, lap: lapParams(), origin: r.origin, dir: r.dir, reveal: currentReveal() } satisfies SortIn);
  });

  // ---- интро: прямая улица сворачивается в колесо
  let introT = reduceMotion || params.has('nointro') ? 1 : 0;
  let kappa = introT >= 1 ? kFull : 0;
  let globalAlpha = introT >= 1 ? 1 : 0;
  const INTRO_DELAY = 0.6, INTRO_DUR = 5.5;
  let clock = 0;
  let animClock = 0;
  let landingBlend = 0;
  // лента — финал: на круге-улице она начинает собираться, когда человек доходит до конца рассказа
  let landingGate = 0;
  // полотно открывается только после того, как человек прошёл все шесть глав (?landing — сразу)
  const visited = new Set<number>();
  let visitedAll = params.has('landing');
  const finaleFrom = (storyDef ? [...storyDef.chapters].sort((a, b) => a.start - b.start).at(-1)?.start ?? street.sMax - 40 : street.sMax - 40) - street.sMin; // время анимации парения (скорость регулируется, при reduced motion стоит)

  const sCamOf = (s: number) => street.sMin + (((s - street.sMin) % L) + L) % L;
  const lapParams = () => ({
    u: ((((controls.s - street.sMax) % (2 * L)) + 2 * L) % (2 * L)),
    parity: landingParity,
    pageNear: 60 * Math.max(0.75, profile.radius * adaptive.detail),
    pageFloor: 0.03,
    morphRamp: 40,
    ribbonC: LOOK.lane,
    ribbonHW: pageSpec.width / 2,
    cap: 0.3,
    gate: landingGate,
  });

  const currentReveal = (): RevealParams => {
    const k = profile.radius * adaptive.detail;
    return {
      ...DEFAULT_REVEAL,
      densNear: S.densNear * k,
      densPow: S.densPow,
      farDensity: S.farDensity,
      partNear: S.partNear * k,
      partFar: Math.max(S.partNear * k + 1, S.partFar * Math.max(0.75, k)),
      seamWidth: manifest.street.seamWidth,
    };
  };

  // ---- размеры
  let cssW = 0, cssH = 0, dpr = 1;
  const resize = () => {
    cssW = innerWidth;
    cssH = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, profile.dprMax) * adaptive.renderScale;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
  };
  resize();
  window.addEventListener('resize', resize);
  let lastScale = adaptive.renderScale;

  // ---- сортировка: держим один запрос «в полёте», шлём только если что-то поменялось
  let lastSortKey = '';
  const requestSort = (sCam: number, reveal: RevealParams, force: boolean) => {
    if (sortBusy) return;
    const key = [sCam.toFixed(3), kappa.toFixed(6), cam.yaw.toFixed(3), cam.pitch.toFixed(3), reveal.densNear.toFixed(2), cam.aspect.toFixed(3), cam.eye[1], tuneVersion, landingGate.toFixed(3)].join('|');
    if (!force && key === lastSortKey) return;
    lastSortKey = key;
    streamer.dirty = false;
    sortBusy = true;
    const req: SortRequest = {
      type: 'sort',
      reqId: reqId++,
      sCam,
      kappa,
      eye: [...cam.eye],
      fwd: cam.fwd,
      right: cam.right,
      up: cam.up,
      // запас по фрустуму: камера успевает повернуться, пока идёт сортировка
      tanX: cam.tanX * 1.18,
      tanY: cam.tanY * 1.18,
      // парящие точки сдвинуты шейдером с настоящих мест — расширяем отсечение на величину сдвига
      pad: [2 + S.scatterBase + (reduceMotion ? 0 : S.driftFar + S.driftNear), S.scatterPerM],
      lap: lapParams(),
      reveal,
      maxSorted: profile.maxSorted,
    };
    sorter.postMessage(req);
  };

  loader.classList.add('done');
  setTimeout(() => loader.remove(), 1200);
  const hint = $('#hint');

  let last = performance.now();
  let streamTimer = 0;
  const uni: FrameUniforms = {
    view: cam.view,
    proj: cam.proj,
    focal: [1, 1],
    viewport: [1, 1],
    ring: [0, 0, L, street.sMin],
    ring2: [street.sMax, manifest.street.seamWidth, 0, 1],
    dens: [0, 0, 0, 0],
    part: [0, 0, 0, 0],
    seam: [0, 0, 0, 0],
    seamP: [0, 0, 0, 0],
    lat: [0, 0, 0, 0],
    misc: [manifest.quant.scaleLogMin, (manifest.quant.scaleLogMax - manifest.quant.scaleLogMin) / 255, 0.012, 0],
    // «лимбо»: базовый разлёт несобранной частицы (м), + м на метр расстояния, парение рядом / вдали (м)
    float: [0, 0, 0, 0],
    motion: [1, 0.25, 0, 0],
    lap: [0, -1, 30, 0.05],
    lap2: [40, LOOK.lane, 18, 0.3],
    pageRect: [pageSpec.sFrom, pageSpec.sTo, pageSpec.wLeft, pageSpec.width],
  };

  const frame = (now: number) => {
    const rawDt = now - last;
    const dtMs = Math.min(100, rawDt);
    last = now;
    const dt = dtMs / 1000;
    clock += dt;
    animClock += dt * (reduceMotion ? 0 : S.speed);

    // интро
    if (introT < 1) {
      introT = Math.min(1, Math.max(0, (clock - INTRO_DELAY) / INTRO_DUR));
      const e = introT < 0.5 ? 4 * introT ** 3 : 1 - (-2 * introT + 2) ** 3 / 2;
      kappa = kFull * e;
      globalAlpha = smoothstep(0, 1.6, clock);
      controls.basePitch = S.pitch * (0.15 + 0.85 * e);
    } else {
      kappa = kFull;
      globalAlpha = 1;
      controls.basePitch = S.pitch;
    }
    {
      const onLanding = landingParity >= 0 && lapOf(controls.s) === landingParity;
      const camX = ((((controls.s - street.sMax) % L) + L) % L); // место камеры внутри круга, от шва
      const target = landingParity < 0 || !visitedAll ? 0 : onLanding ? 1 : smoothstep(finaleFrom, finaleFrom + 28, camX);
      landingGate += (target - landingGate) * Math.min(1, dt * 2.5);
      if (Math.abs(target - landingGate) < 1e-3) landingGate = target;
    }
    // на круге-лендинге взгляд чуть выше: в кадре поднимающееся полотно
    landingBlend += ((landingParity >= 0 && lapOf(controls.s) === landingParity ? 1 : 0) - landingBlend) * Math.min(1, dt * 1.2);
    controls.basePitch += 0.06 * landingBlend; // панели стоят вертикально — смотрим почти прямо
    controls.wheelGain = S.wheelGain;
    controls.smoothing = S.smoothing;
    controls.invert = S.invertScroll > 0.5;
    cam.eye[1] = S.eye;
    cam.fovY = (S.fov * Math.PI) / 180;

    controls.update(dt);
    if (controls.interacted && hint && !hint.classList.contains('gone')) hint.classList.add('gone');
    const sCam = sCamOf(controls.s);
    cam.yaw = controls.yaw;
    cam.pitch = controls.pitch;

    adaptive.frame(rawDt, lastSortMs, streamer.busy);
    lastSortMs = null;
    if (Math.abs(adaptive.renderScale - lastScale) > 1e-3) {
      lastScale = adaptive.renderScale;
      resize();
    }
    cam.update(canvas.width, canvas.height);
    const reveal = currentReveal();

    streamTimer += dt;
    if (streamTimer > 0.15) {
      streamTimer = 0;
      streamer.update(sCam, controls.velocity, reveal, lapParams());
    }
    streamer.processUploads();
    requestSort(sCam, reveal, streamer.dirty);

    // uniforms
    const fy = canvas.height / 2 / cam.tanY;
    uni.focal = [fy, fy];
    uni.viewport = [canvas.width, canvas.height];
    uni.ring = [sCam, kappa, L, street.sMin];
    uni.ring2 = [street.sMax, manifest.street.seamWidth, animClock, globalAlpha];
    uni.misc[3] = clock;
    renderer.clock = clock;
    uni.dens = [reveal.densNear, reveal.densFar, reveal.farDensity, reveal.densPow];
    uni.part = [reveal.partNear, reveal.partFar, S.dotPx * dpr, S.partAlpha];
    uni.seam = [reveal.seamInner, reveal.seamOuter, reveal.seamDensity, reduceMotion ? 0 : S.twinkle];
    uni.seamP = [reveal.seamPDensNear, reveal.seamPDensFar, S.exposure, canvas.height * 0.45];
    // «лимбо»: разлёт несобранной частицы (м + м на метр дали), парение рядом / вдали (м)
    uni.float = [S.scatterBase, S.scatterPerM, reduceMotion ? 0 : S.driftNear, reduceMotion ? 0 : S.driftFar];
    uni.motion = [1.45 / Math.max(0.05, S.arrive), S.emBand, landingGate, 0];
    const lp = lapParams();
    uni.lap = [lp.u, lp.parity, lp.pageNear, lp.pageFloor];
    uni.lap2 = [lp.morphRamp, lp.ribbonC, lp.ribbonHW, lp.cap];
    uni.lat = [reveal.latCenter, reveal.latInner, reveal.latOuter, reveal.latDensity];
    renderer.render(uni, LOOK.bg);

    // рассказ привязан к позиции на кольце; на круге-лендинге его ведёт само полотно
    // круг считается лендингом, только если полотно на нём действительно показано
    const streetLap = landingParity < 0 || lapOf(controls.s) !== landingParity || landingGate < 0.5;
    const st = story?.update(sCam, controls.s, streetLap, dt, clock);
    if (st && streetLap && st.chapterAlpha[st.active] > 0.5) {
      visited.add(st.active);
      if (story && visited.size >= story.chapters.length) visitedAll = true;
    }
    // метки появляются, когда улица уже свернулась в колесо и собралась из частиц
    pois.update(sCam, kappa, cssW, cssH, globalAlpha * smoothstep(0.75, 1, introT), (p) => {
      if (!st || !p.chapter) return streetLap ? 1 : 0;
      if ((p.kind === 'detection' || p.kind === 'asset') && !story!.revealed.has(p.id)) return 0;
      return st.chapterAlpha[story!.chapterIndex(p.chapter)] ?? 0;
    });
    hud.update(sCam, st?.active ?? -1, streetLap);

    if (debug.visible) {
      const ss = streamer.stats();
      debug.set({
        quality: `${profile.name} (${q.gpu.slice(0, 28)})`,
        fps: adaptive.fps.toFixed(0),
        splats: `${(renderer.count / 1e6).toFixed(2)}M drawn / ${(sortStats.kept / 1e6).toFixed(2)}M kept / ${(sortStats.candidates / 1e6).toFixed(2)}M tested`,
        loaded: `${(ss.loadedSplats / 1e6).toFixed(2)}M in ${ss.loadedChunks} chunks, ${ss.inflight} loading`,
        pool: `${(ss.poolUsed * 100).toFixed(0)}% of ${(renderer.capacity / 1e6).toFixed(1)}M`,
        network: `${(ss.bytes / 1e6).toFixed(1)} MB`,
        lap: streetLap ? 'street' : 'landing',
        sort: `${sortStats.ms.toFixed(0)} ms`,
        scale: `${adaptive.renderScale.toFixed(2)} res, ${adaptive.detail.toFixed(2)} detail, dpr ${dpr.toFixed(2)}`,
        s: `${sCam.toFixed(1)} (d to seam ${Math.abs(wrap(sCam - street.sMax, L)).toFixed(0)} m)`,
      });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (params.has('debug')) {
    // ручной замер GPU-времени кадра: __wheel.bench()
    const gl = renderer.gl;
    Object.assign(window, {
      __wheel: {
        renderer,
        controls,
        cam,
        pick(x: number, y: number) {
          const r = cam.ray(x, y, innerWidth, innerHeight);
          const id = reqId++;
          return new Promise((res) => {
            picks.set(id, (hit) => res({ hit, ray: r, sCam: sCamOf(controls.s), kappa }));
            sorter.postMessage({ type: 'pick', reqId: id, sCam: sCamOf(controls.s), kappa, lap: lapParams(), origin: r.origin, dir: r.dir, reveal: currentReveal() } satisfies SortIn);
          });
        },
        bench(n = 20) {
          const px = new Uint8Array(4);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const t0 = performance.now();
          for (let i = 0; i < n; i++) renderer.render(uni, LOOK.bg);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return { msPerFrame: (performance.now() - t0) / n, splats: renderer.count, px: [canvas.width, canvas.height] };
        },
      },
    });
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    status.textContent = 'The graphics context was lost. Reloading…';
    setTimeout(() => location.reload(), 800);
  });
}

main().catch((e) => {
  console.error(e);
  const s = document.querySelector('#loader-status');
  if (s && !s.textContent?.includes('WebGL')) s.textContent = 'Could not load the scene: ' + (e?.message ?? e);
});
