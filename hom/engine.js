// «Хом»: алгоритм заново «перерисовывает» фото камней — мазками, треугольниками, гравюрой, точками…
// Получается своя картина, похожая на снимок. Нужен /bogomol/engine.js (рамка, табличка, редкость).
const HOM = (() => {
  const PHOTOS = {
    kamni: { file: "/hom/src/kamni.jpg", title: "Камни" },
  };
  const TECHS = {
    oil: "Мазки", poly: "Полигоны", glass: "Витраж", engrave: "Гравюра", dots: "Пуантилизм", print: "Трафарет", ascii: "Символы",
  };
  const PALETTES = [
    { name: "Степь",   paper: "#efe6d2", ink: "#2b2118", a: "#3a2a1e", b: "#b5552e", c: "#d9a441" },
    { name: "Мох",     paper: "#e9ecdf", ink: "#1d2a1f", a: "#24382a", b: "#6f8f3a", c: "#c9cf6a" },
    { name: "Небо",    paper: "#eef2f6", ink: "#14213d", a: "#14213d", b: "#2f6fd6", c: "#f2a541" },
    { name: "Глина",   paper: "#f3e3d3", ink: "#3b1f17", a: "#5a2a1c", b: "#c8553d", c: "#f28f3b" },
    { name: "Уголь",   paper: "#f4f1ea", ink: "#111111", a: "#111111", b: "#555555", c: "#d23c3c" },
    { name: "Сумерки", paper: "#ece6f2", ink: "#1e1433", a: "#2a1d4a", b: "#7a4fd1", c: "#ff8fa3" },
  ];
  const WORDS_A = ["Камень", "Дом", "Голос", "Путь", "Сон", "Тишина", "Память", "Корень", "Ветер", "Порог", "Хранитель", "Дыхание"];
  const WORDS_B = ["степи", "валуна", "дома", "земли", "осени", "предков", "полудня", "ветра", "камня", "тропы", "холма", "лишайника"];

  function randomWork(seed) {
    const R = BOGO.rng(seed ^ 0x27d4eb2f); for (let i = 0; i < 8; i++) R();
    const pick = a => a[Math.floor(R() * a.length)];
    R(); const r = R(); // первое число раньше выбирало фото — оставлено, чтобы остальное не сдвинулось
    return {
      seed, photo: "kamni",
      tech: pick(Object.keys(TECHS)), palette: pick(PALETTES).name,
      rarity: BOGO.rarityOf(r),
      title: `${pick(WORDS_A)} ${pick(WORDS_B)}`,
    };
  }

  const IMG = {};
  const load = src => new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = src; });
  const ready = () => Promise.all([
    document.fonts.load("700 26px Unbounded"), document.fonts.load("500 20px Unbounded"),
    ...Object.entries(PHOTOS).map(async ([k, p]) => { IMG[k] = await load(p.file); }),
  ]);

  let W, H;
  const mk = (w = W, h = H) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rgb = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

  function render(work, out, w = 900, h = 1200, label = "") {
    W = w; H = h;
    const R = BOGO.rng(work.seed);
    const rnd = (a, b) => a + R() * (b - a);
    const img = IMG[work.photo];
    const pal = PALETTES.find(p => p.name === work.palette);

    // кусок фото с пропорциями работы
    const z = rnd(1, 1.7);
    let rw = img.width / z, rh = rw * H / W;
    if (rh > img.height / z) { rh = img.height / z; rw = rh * W / H; }
    let rx = rnd(0, img.width - rw), ry = rnd(0, img.height - rh);
    const src = mk(), sc = src.getContext("2d");
    sc.drawImage(img, rx, ry, rw, rh, 0, 0, W, H);
    const sd = sc.getImageData(0, 0, W, H).data;
    const at = (x, y) => { x = Math.max(0, Math.min(W - 1, x | 0)); y = Math.max(0, Math.min(H - 1, y | 0)); const i = (y * W + x) * 4; return [sd[i], sd[i + 1], sd[i + 2]]; };
    const lumAt = (x, y) => { const c = at(x, y); return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; };
    // яркость, растянутая на весь диапазон: самые тёмные места — 0, самые светлые — 1
    const sample = Array.from({ length: 3000 }, () => lumAt(rnd(0, W), rnd(0, H))).sort((a, b) => a - b);
    const lo = sample[150], hi = sample[2850];
    const toneAt = (x, y) => Math.max(0, Math.min(1, (lumAt(x, y) - lo) / (hi - lo || 1)));

    out.width = W; out.height = H;
    const ctx = out.getContext("2d");
    ctx.save();
    TECH[work.tech]({ ctx, src, at, lumAt, toneAt, pal, R, rnd });
    ctx.restore();
    paper(ctx, R);
    BOGO.plate(ctx, work, label, "ХОМ", W, H);
  }

  const TECH = {
    // масляные мазки по направлению контуров, от крупных к мелким
    oil({ ctx, src, at, lumAt, rnd }) {
      ctx.filter = "blur(20px) saturate(1.3)"; ctx.drawImage(src, 0, 0); ctx.filter = "none";
      ctx.lineCap = "round";
      for (const size of [44, 28, 16, 10]) {
        const step = size * 0.75;
        for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
          const px = x + rnd(-step, step) / 2, py = y + rnd(-step, step) / 2;
          const gx = lumAt(px + 3, py) - lumAt(px - 3, py), gy = lumAt(px, py + 3) - lumAt(px, py - 3);
          if (size < 28 && Math.hypot(gx, gy) < (size < 16 ? 0.12 : 0.06)) continue; // мелкие мазки — только на деталях
          const a = Math.atan2(gy, gx) + Math.PI / 2, len = size * rnd(1.2, 2.4);
          const c0 = at(px, py), m = (c0[0] + c0[1] + c0[2]) / 3, c = c0.map(v => m + (v - m) * 1.35 + rnd(-18, 18));
          ctx.strokeStyle = rgb(c); ctx.lineWidth = size * 0.6;
          ctx.beginPath(); ctx.moveTo(px - Math.cos(a) * len / 2, py - Math.sin(a) * len / 2);
          ctx.lineTo(px + Math.cos(a) * len / 2, py + Math.sin(a) * len / 2); ctx.stroke();
        }
      }
    },
    poly(o) { triangles(o, false); },
    glass(o) { triangles(o, true); },
    // гравюра: волнистые линии, толще там, где темнее
    engrave({ ctx, toneAt, pal, rnd }) {
      ctx.fillStyle = pal.paper; ctx.fillRect(0, 0, W, H);
      const gap = Math.round(rnd(7, 11)), wave = rnd(2, 6), freq = rnd(0.01, 0.03), tilt = rnd(-0.15, 0.15);
      ctx.fillStyle = pal.ink;
      for (let y0 = -H * 0.2; y0 < H * 1.2; y0 += gap) {
        const top = [], bot = [];
        for (let x = 0; x <= W; x += 3) {
          const y = y0 + x * tilt + Math.sin(x * freq + y0 * 0.05) * wave;
          const t = Math.max(0.5, Math.pow(1 - toneAt(x, y), 1.6) * gap * 0.95);
          top.push([x, y - t / 2]); bot.push([x, y + t / 2]);
        }
        ctx.beginPath(); top.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
        ctx.fill();
      }
    },
    // точки чистого цвета, как у Сёра
    dots({ ctx, at, pal, rnd }) {
      ctx.fillStyle = pal.paper; ctx.fillRect(0, 0, W, H);
      const n = W * H / 12;
      for (let k = 0; k < n; k++) {
        const x = rnd(0, W), y = rnd(0, H), c = at(x, y), m = (c[0] + c[1] + c[2]) / 3;
        ctx.fillStyle = rgb(c.map(v => m + (v - m) * 1.6 + rnd(-20, 20))); // ярче оригинала
        ctx.beginPath(); ctx.arc(x, y, rnd(3, 6), 0, 7); ctx.fill();
      }
    },
    // трафаретная печать: три краски, каждая чуть сдвинута
    print({ ctx, toneAt, pal, rnd }) {
      const inks = [[pal.c, 0.72], [pal.b, 0.5], [pal.a, 0.3]].map(([c, t]) => ({ c: hex(c), t, dx: rnd(-6, 6) | 0, dy: rnd(-6, 6) | 0 }));
      const L = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) L[y * W + x] = toneAt(x, y);
      const im = ctx.createImageData(W, H), d = im.data, p = hex(pal.paper);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let c = p.slice();
        for (const k of inks) {
          const sx = Math.max(0, Math.min(W - 1, x + k.dx)), sy = Math.max(0, Math.min(H - 1, y + k.dy));
          if (L[sy * W + sx] < k.t) c = c.map((v, j) => v * k.c[j] / 255);
        }
        const i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
      ctx.putImageData(im, 0, 0);
    },
    // картина из букв: чем темнее место, тем «тяжелее» знак
    ascii({ ctx, at, toneAt, pal, rnd }) {
      ctx.fillStyle = pal.ink; ctx.fillRect(0, 0, W, H);
      const cell = Math.round(rnd(15, 21)), CH = " .·:-=+*хомХОМ#@";
      ctx.font = `700 ${cell + 2}px Consolas, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (let y = 0; y < H; y += cell) for (let x = 0; x < W; x += cell * 0.75) {
        const l = toneAt(x + cell / 2, y + cell / 2), ch = CH[Math.min(CH.length - 1, (l * CH.length) | 0)];
        if (ch === " ") continue;
        const c = at(x + cell / 2, y + cell / 2), m = (c[0] + c[1] + c[2]) / 3;
        ctx.fillStyle = rgb(c.map(v => (m + (v - m) * 1.6) * 0.6 + 110 * l + 40));
        ctx.fillText(ch, x + cell * 0.375, y + cell / 2);
      }
    },
  };

  // мозаика из треугольников; витраж — с тёмными свинцовыми швами
  function triangles({ ctx, at, rnd, R }, lead) {
    const g = lead ? rnd(55, 85) : rnd(28, 50), cols = Math.ceil(W / g) + 1, rows = Math.ceil(H / g) + 1;
    const pt = [];
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const edge = i === 0 || j === 0 || i === cols || j === rows;
      pt.push([i * g + (edge ? 0 : rnd(-g, g) * 0.4), j * g + (edge ? 0 : rnd(-g, g) * 0.4)]);
    }
    const P = (i, j) => pt[j * (cols + 1) + i];
    const tri = (a, b, c) => {
      const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3;
      const s = [at(cx, cy), at((a[0] + cx) / 2, (a[1] + cy) / 2), at((b[0] + cx) / 2, (b[1] + cy) / 2), at((c[0] + cx) / 2, (c[1] + cy) / 2)];
      let col = [0, 1, 2].map(k => s.reduce((n, v) => n + v[k], 0) / 4);
      if (lead) { const m = (col[0] + col[1] + col[2]) / 3; col = col.map(v => m + (v - m) * 1.5 + 15); }
      ctx.fillStyle = ctx.strokeStyle = rgb(col);
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 1; ctx.stroke();
      if (lead) { // блик на стекле
        const gr = ctx.createLinearGradient(a[0], a[1], c[0], c[1]);
        gr.addColorStop(0, "rgba(255,255,255,.18)"); gr.addColorStop(1, "rgba(0,0,0,.12)"); ctx.fillStyle = gr; ctx.fill();
        ctx.strokeStyle = "#16130f"; ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.stroke(); // свинцовый шов
      }
    };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      if (R() < 0.5) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
    }
  }

  // фактура бумаги/холста
  function paper(ctx, R) {
    const im = ctx.getImageData(0, 0, W, H), d = im.data;
    for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    ctx.putImageData(im, 0, 0);
  }

  const traits = w => [
    { trait_type: "Фото", value: PHOTOS[w.photo].title },
    { trait_type: "Техника", value: TECHS[w.tech] },
    { trait_type: "Палитра", value: w.palette },
    { trait_type: "Редкость", value: BOGO.RARITY_NAME[w.rarity] },
  ];

  return { PHOTOS, TECHS, PALETTES, IMG, ready, render, randomWork, traits };
})();
