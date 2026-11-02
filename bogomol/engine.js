// «Богомол»: рисует работу по фото богомола. Общий код для страницы коллекции (bogomol/)
// и для генератора (remix/). Богомол остаётся настоящим, меняется всё вокруг него.
const BOGO = (() => {
  const PHOTOS = {
    // где на фото богомол (в пикселях исходника 843×1920)
    // mask — точная маска богомола (белое — он сам), её строит mint/bogomol-mask.py
    ruka:  { file: "/bogomol/src/bogomol-1.jpg", mask: "/bogomol/src/bogomol-1-mask.png", title: "На кулаке", box: [105, 770, 405, 990] },
    palcy: { file: "/bogomol/src/bogomol-2.jpg", mask: "/bogomol/src/bogomol-2-mask.png", title: "На пальцах", box: [190, 935, 535, 1225] },
  };
  const TECHS = {
    neon: "Неон", pop: "Поп-арт", pixel: "Пиксели", glitch: "Глитч", holo: "Голограмма", night: "Ночь",
    warhol: "Четыре богомола", thermal: "Тепловизор",
  };
  const PALETTES = [
    { name: "Кислота",  a: "#1b0f3a", b: "#ff3fa4", c: "#ffe14d", d: "#20e3b2" },
    { name: "Закат",    a: "#2a0c12", b: "#ff6b4f", c: "#ffd08a", d: "#7a2cff" },
    { name: "Океан",    a: "#04122b", b: "#1f7bff", c: "#7ff0ff", d: "#ff4fa0" },
    { name: "Ржавчина", a: "#1a1410", b: "#c2502a", c: "#f1d3a1", d: "#3fae8f" },
    { name: "Мята",     a: "#0c2420", b: "#2fbf9b", c: "#e9ffd6", d: "#ff7a59" },
    { name: "Лаванда",  a: "#1d1433", b: "#9a7bff", c: "#ffe6f5", d: "#ffb13d" },
    { name: "Кровь",    a: "#120406", b: "#d8102c", c: "#ffd9c2", d: "#2ad1ff" },
    { name: "Лимон",    a: "#18210a", b: "#c6e000", c: "#fffbe0", d: "#ff3d7f" },
  ];
  // редкости от самой редкой; in — шанс «1 к N», обычной достаётся всё остальное
  const RARITIES = [
    { id: "divine", name: "Божественный", in: 1000 },
    { id: "mythic", name: "Мифический", in: 100 },
    { id: "legend", name: "Легендарный", in: 25 },
    { id: "rare", name: "Редкий", in: 5 },
    { id: "common", name: "Обычный", in: 1 },
  ];
  const RARITY_NAME = Object.fromEntries(RARITIES.map(x => [x.id, x.name]));
  // число 0…1 → редкость: 0,1% божественная, 1% мифическая, 4% легендарная, 20% редкая, остальное — обычная
  function rarityOf(r) {
    let acc = 0;
    for (const x of RARITIES) { if (x.in === 1) return x.id; acc += 1 / x.in; if (r < acc) return x.id; }
  }
  const WORDS_A = ["Страж", "Молитва", "Охотник", "Танец", "Взгляд", "Король", "Пророк", "Гость", "Призрак", "Тишина", "Хозяин", "Сон"];
  const WORDS_B = ["осени", "кулака", "листопада", "сада", "ветра", "октября", "неба", "ладони", "клёна", "костра", "тропы", "дождя"];

  function rng(seed) {
    return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  // случайная работа для генератора: всё решает зерно
  function randomWork(seed) {
    const R = rng(seed ^ 0x5bd1e995); for (let i = 0; i < 8; i++) R();
    const pick = a => a[Math.floor(R() * a.length)];
    const r = R();
    return {
      seed, photo: R() < 0.5 ? "ruka" : "palcy",
      tech: pick(Object.keys(TECHS)), palette: pick(PALETTES).name,
      rarity: rarityOf(r),
      title: `${pick(WORDS_A)} ${pick(WORDS_B)}`,
    };
  }

  const IMG = {}, MASK = {};
  const load = src => new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = src; });
  // фото есть только дома; на сайте генератор показывает готовые работы
  const ready = () => Promise.all([
    document.fonts.load("700 26px Unbounded"), document.fonts.load("500 20px Unbounded"),
    ...Object.entries(PHOTOS).map(async ([k, p]) => {
      IMG[k] = await load(p.file);
      MASK[k] = await load(p.mask).catch(() => null); // нет маски — найдём богомола по цвету, как раньше
    }),
  ]);

  let W = 1000, H = 1000;
  const mk = (w = W, h = H) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const lum = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // work: { seed, photo, tech, palette, rarity }; label — вторая надпись на табличке
  function render(work, out, w = 1000, h = 1000, label = "") {
    W = w; H = h;
    const R = rng(work.seed);
    const rnd = (a, b) => a + R() * (b - a);
    const P = PHOTOS[work.photo], img = IMG[work.photo];
    const pal = PALETTES.find(p => p.name === work.palette);

    // кадр вокруг богомола с пропорциями работы
    const [x1, y1, x2, y2] = P.box;
    const side = Math.min(img.width, rnd(560, 843)), sideH = side * H / W;
    const cx = (x1 + x2) / 2 + rnd(-60, 60), cy = (y1 + y2) / 2 + rnd(-side * 0.18, side * 0.12);
    const sx = Math.max(0, Math.min(img.width - side, cx - side / 2));
    const sy = Math.max(0, Math.min(img.height - sideH, cy - sideH / 2));
    const k = W / side;
    const photo = mk(); const pc = photo.getContext("2d");
    pc.drawImage(img, sx, sy, side, sideH, 0, 0, W, H);

    // маска богомола: зелёные пиксели внутри его рамки
    const mask = MASK[work.photo] ? cropMask(MASK[work.photo], sx, sy, side, sideH)
      : makeMask(pc, (x1 - sx) * k - 30, (y1 - sy) * k - 30, (x2 - sx) * k + 30, (y2 - sy) * k + 30);
    const mantis = mk(); const mc = mantis.getContext("2d");
    mc.drawImage(photo, 0, 0); mc.globalCompositeOperation = "destination-in"; mc.drawImage(mask, 0, 0);

    stylize(out, photo, mantis, mask, work, pal, R, rnd, label);
  }

  // фон в выбранной технике, герой (богомол, идол…) поверх — настоящий
  function stylize(out, photo, hero, mask, work, pal, R, rnd, label, title) {
    out.width = W; out.height = H;
    const ctx = out.getContext("2d");
    ctx.save();
    BG[work.tech](ctx, photo, pal, R, rnd, hero, mask);
    FG[work.tech](ctx, hero, mask, pal, R, rnd);
    ctx.restore();
    grain(ctx, R, work.tech === "pixel" ? 0 : 10);
    frame(ctx, work, label, title);
  }

  // то же оформление для любой нарисованной сцены: scene — фон, hero — фигура на прозрачном холсте
  function styleScene(work, out, scene, hero, w, h, label, title) {
    W = w; H = h;
    const R = rng(work.seed ^ 0x9e3779b9), rnd = (a, b) => a + R() * (b - a);
    const pal = PALETTES.find(p => p.name === work.palette);
    const photo = mk(), pc = photo.getContext("2d"); pc.drawImage(scene, 0, 0); pc.drawImage(hero, 0, 0);
    // маска — только плотная часть фигуры, без мягких теней
    const m = mk(), mc = m.getContext("2d"); mc.drawImage(hero, 0, 0);
    const im = mc.getImageData(0, 0, W, H), d = im.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = d[i + 3] > 200 ? 255 : 0; }
    mc.putImageData(im, 0, 0);
    const solid = mk(), sc = solid.getContext("2d"); sc.drawImage(photo, 0, 0); sc.globalCompositeOperation = "destination-in"; sc.drawImage(m, 0, 0);
    stylize(out, photo, solid, m, work, pal, R, rnd, label, title);
  }

  // готовая маска (белое — богомол) того же кадра → чёрный силуэт с прозрачностью, как у makeMask
  function cropMask(img, sx, sy, sw, sh) {
    const m = mk(), x = m.getContext("2d");
    x.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
    const im = x.getImageData(0, 0, W, H), d = im.data;
    for (let i = 0; i < d.length; i += 4) { d[i + 3] = d[i]; d[i] = d[i + 1] = d[i + 2] = 0; }
    x.putImageData(im, 0, 0);
    return m;
  }

  function makeMask(pc, x1, y1, x2, y2) {
    const d = pc.getImageData(0, 0, W, H).data;
    const m = mk(), mctx = m.getContext("2d"), md = mctx.createImageData(W, H);
    for (let y = Math.max(0, y1 | 0); y < Math.min(H, y2); y++) for (let x = Math.max(0, x1 | 0); x < Math.min(W, x2); x++) {
      const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      if (g > r + 10 && g > b + 28 && g > 95) md.data[i + 3] = 255;
    }
    mctx.putImageData(md, 0, 0);
    // сглаживаем края и закрываем дырочки
    const s = mk(); const sc = s.getContext("2d");
    sc.filter = "blur(3px)"; sc.drawImage(m, 0, 0); sc.drawImage(m, 0, 0); sc.filter = "none";
    sc.globalCompositeOperation = "source-in"; sc.fillStyle = "#000"; sc.fillRect(0, 0, W, H);
    return s;
  }

  // силуэт маски одним цветом
  function silhouette(mask, color) {
    const c = mk(), x = c.getContext("2d");
    x.drawImage(mask, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, W, H);
    return c;
  }

  function eachPixel(ctx, fn) {
    const im = ctx.getImageData(0, 0, W, H), d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = fn(d[i], d[i + 1], d[i + 2]);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    ctx.putImageData(im, 0, 0);
  }

  // ---------- фон: техники ----------
  const BG = {
    neon(ctx, photo, pal) {
      ctx.drawImage(photo, 0, 0);
      const A = hex(pal.a), B = hex(pal.b), C = hex(pal.c);
      eachPixel(ctx, (r, g, b) => { const l = lum(r, g, b); return l < 0.5 ? mix(A, B, l * 2) : mix(B, C, (l - 0.5) * 2); });
    },
    pop(ctx, photo, pal) {
      ctx.drawImage(photo, 0, 0);
      const cols = [pal.a, pal.b, pal.d, pal.c].map(hex);
      eachPixel(ctx, (r, g, b) => cols[Math.min(3, lum(r, g, b) * 4 | 0)]);
      // крупный растр, как в комиксах
      const step = 16, px = ctx.getImageData(0, 0, W, H).data; ctx.fillStyle = "rgba(0,0,0,.28)";
      for (let y = 0; y < H; y += step) for (let x = (y / step) % 2 ? step / 2 : 0; x < W; x += step) {
        const i = (y * W + x) * 4, rr = (1 - lum(px[i], px[i + 1], px[i + 2])) * step * 0.42;
        ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.fill();
      }
    },
    pixel(ctx, photo, pal, R, rnd) {
      const cell = Math.round(rnd(18, 30)), nx = Math.ceil(W / cell), ny = Math.ceil(H / cell);
      const t = mk(nx, ny), tc = t.getContext("2d"); tc.drawImage(photo, 0, 0, nx, ny);
      ctx.imageSmoothingEnabled = false; ctx.drawImage(t, 0, 0, nx * cell, ny * cell); ctx.imageSmoothingEnabled = true;
      // сетка между клетками
      ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i <= nx; i++) { ctx.moveTo(i * cell + .5, 0); ctx.lineTo(i * cell + .5, H); }
      for (let j = 0; j <= ny; j++) { ctx.moveTo(0, j * cell + .5); ctx.lineTo(W, j * cell + .5); }
      ctx.stroke();
    },
    glitch(ctx, photo, pal, R, rnd) {
      // разъезд каналов
      const src = photo.getContext("2d").getImageData(0, 0, W, H).data;
      const im = ctx.createImageData(W, H), d = im.data, dx = Math.round(rnd(10, 22));
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, ir = (y * W + Math.min(W - 1, x + dx)) * 4, ib = (y * W + Math.max(0, x - dx)) * 4;
        d[i] = src[ir]; d[i + 1] = src[i + 1]; d[i + 2] = src[ib + 2]; d[i + 3] = 255;
      }
      ctx.putImageData(im, 0, 0);
      // сдвинутые полосы
      for (let k = 0; k < 14; k++) {
        const y = rnd(0, H), h = rnd(4, 40), off = rnd(-80, 80);
        ctx.drawImage(ctx.canvas, 0, y, W, h, off, y, W, h);
      }
      ctx.fillStyle = pal.b; ctx.globalAlpha = 0.18; ctx.globalCompositeOperation = "screen";
      for (let k = 0; k < 5; k++) ctx.fillRect(0, rnd(0, H), W, rnd(2, 12));
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      scanlines(ctx, 0.16);
    },
    holo(ctx, photo, pal, R, rnd) {
      ctx.drawImage(photo, 0, 0);
      eachPixel(ctx, (r, g, b) => { const l = lum(r, g, b) * 255; return [l * 0.9 + 20, l * 0.9 + 20, l * 0.95 + 25]; });
      const a = rnd(0, Math.PI), L = Math.max(W, H);
      const g = ctx.createLinearGradient(W / 2 - Math.cos(a) * L, H / 2 - Math.sin(a) * L, W / 2 + Math.cos(a) * L, H / 2 + Math.sin(a) * L);
      ["#ff5ec4", "#ffd36b", "#7dffb0", "#6bd6ff", "#a879ff", "#ff5ec4", "#ffd36b"].forEach((c, i, arr) => g.addColorStop(i / (arr.length - 1), c));
      ctx.globalCompositeOperation = "color"; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "soft-light"; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      sparkles(ctx, rnd, 40, "#fff");
    },
    night(ctx, photo, pal, R, rnd) {
      ctx.drawImage(photo, 0, 0);
      const A = hex("#050816"), B = hex(pal.d);
      eachPixel(ctx, (r, g, b) => mix(A, B, Math.pow(lum(r, g, b), 1.6) * 0.55));
      // огоньки-боке
      ctx.globalCompositeOperation = "lighter";
      for (let k = 0; k < 60; k++) {
        const x = rnd(0, W), y = rnd(0, H * 0.7), r = rnd(6, 34);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,${200 + rnd(0, 55) | 0},150,${rnd(0.15, 0.45)})`); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      vignette(ctx, 0.75);
    },
    // как у Уорхола: четыре копии в разных цветах
    warhol(ctx, photo, pal, R, rnd, mantis, mask) {
      const pals = [pal, ...PALETTES.filter(p => p !== pal).sort(() => R() - 0.5)].slice(0, 4);
      const hw = W / 2, hh = H / 2;
      pals.forEach((p, i) => {
        const tile = mk(); const tc = tile.getContext("2d");
        tc.drawImage(photo, 0, 0);
        const A = hex(p.a), B = hex(p.b), C = hex(p.c);
        const im = tc.getImageData(0, 0, W, H), d = im.data;
        for (let j = 0; j < d.length; j += 4) {
          const l = lum(d[j], d[j + 1], d[j + 2]), c = l < 0.42 ? A : l < 0.62 ? B : C;
          d[j] = c[0]; d[j + 1] = c[1]; d[j + 2] = c[2];
        }
        tc.putImageData(im, 0, 0);
        tc.drawImage(silhouette(mask, p.d), 0, 0);
        tc.globalCompositeOperation = "multiply"; tc.drawImage(mantis, 0, 0);
        ctx.drawImage(tile, (i % 2) * hw, (i >> 1) * hh, hw, hh);
      });
      ctx.fillStyle = "#0b0a09"; ctx.fillRect(hw - 3, 0, 6, H); ctx.fillRect(0, hh - 3, W, 6);
    },
    thermal(ctx, photo) {
      ctx.drawImage(photo, 0, 0);
      const stops = ["#000010", "#2a0a6e", "#a0127a", "#f0502a", "#ffd23a", "#ffffe0"].map(hex);
      eachPixel(ctx, (r, g, b) => {
        const l = Math.min(0.999, lum(r, g, b) * 1.1), t = l * (stops.length - 1), i = t | 0;
        return mix(stops[i], stops[i + 1], t - i);
      });
      scanlines(ctx, 0.08);
    },
  };

  // ---------- богомол поверх фона ----------
  function glow(ctx, mask, color, blur, times) {
    const s = silhouette(mask, color);
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.filter = `blur(${blur}px)`;
    for (let i = 0; i < times; i++) ctx.drawImage(s, 0, 0);
    ctx.restore();
  }
  function outline(ctx, mask, color, w) {
    const s = silhouette(mask, color);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) ctx.drawImage(s, Math.cos(a) * w, Math.sin(a) * w);
  }
  const FG = {
    neon(ctx, mantis, mask) { glow(ctx, mask, "#39ff7a", 22, 3); glow(ctx, mask, "#b6ffcf", 6, 1); ctx.drawImage(mantis, 0, 0); },
    pop(ctx, mantis, mask) { outline(ctx, mask, "#fff", 10); outline(ctx, mask, "#000", 4); ctx.drawImage(mantis, 0, 0); },
    pixel(ctx, mantis, mask) {
      // богомол тоже пиксельный, но мельче фона
      const t = mk(W / 6, H / 6), tc = t.getContext("2d"); tc.drawImage(mantis, 0, 0, W / 6, H / 6);
      outline(ctx, mask, "#000", 5);
      ctx.imageSmoothingEnabled = false; ctx.drawImage(t, 0, 0, W, H); ctx.imageSmoothingEnabled = true;
    },
    glitch(ctx, mantis, mask) {
      ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.7;
      ctx.drawImage(silhouette(mask, "#ff0040"), -9, 0); ctx.drawImage(silhouette(mask, "#00e5ff"), 9, 0);
      ctx.restore(); ctx.drawImage(mantis, 0, 0);
    },
    holo(ctx, mantis, mask) { glow(ctx, mask, "#ffffff", 16, 2); ctx.drawImage(mantis, 0, 0); },
    night(ctx, mantis, mask) { glow(ctx, mask, "#b8ff6a", 30, 3); glow(ctx, mask, "#eaffc8", 8, 1); ctx.drawImage(mantis, 0, 0); },
    warhol() {}, // богомолы уже в каждой из четырёх клеток
    thermal(ctx, mantis, mask) { glow(ctx, mask, "#7dff4a", 14, 2); ctx.drawImage(mantis, 0, 0); },
  };

  // ---------- мелочи ----------
  function scanlines(ctx, a) { ctx.fillStyle = `rgba(0,0,0,${a})`; for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2); }
  function vignette(ctx, a) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${a})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function sparkles(ctx, rnd, n, color) {
    ctx.save(); ctx.fillStyle = color; ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < n; k++) {
      const x = rnd(0, W), y = rnd(0, H), r = rnd(3, 11); ctx.globalAlpha = rnd(0.3, 0.9);
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * .22, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * .22, y); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x, y + r * .22); ctx.lineTo(x + r, y); ctx.lineTo(x, y - r * .22); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function grain(ctx, R, amt) {
    if (!amt) return;
    eachPixel(ctx, (r, g, b) => { const n = (R() - 0.5) * amt; return [r + n, g + n, b + n]; });
  }

  // четырёхлучевая искра — на углах рамок самых редких работ
  function star(ctx, x, y, r, color) {
    ctx.save(); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = r;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2, rr = i % 2 ? r * 0.22 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.fill(); ctx.restore();
  }
  const PLATE = { divine: "#fff3c8", mythic: "#ff9be6", legend: "#f0d58c", rare: "#9cccff" };

  // рамка по редкости + табличка
  function frame(ctx, work, label, t1 = "БОГОМОЛ") {
    border(ctx, work);
    ctx.font = "700 26px Unbounded"; const w1 = ctx.measureText(t1).width;
    ctx.font = "500 20px Unbounded"; const w2 = label ? ctx.measureText(label).width : 0;
    const pad = 18, h = 52, w = w1 + pad * 2 + (label ? w2 + pad : 0), x = 44, y = H - 44 - h;
    ctx.fillStyle = "rgba(10,10,12,.72)"; ctx.beginPath(); ctx.roundRect(x, y, w, h, 26); ctx.fill();
    ctx.strokeStyle = PLATE[work.rarity] || "rgba(255,255,255,.35)";
    ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.textBaseline = "middle";
    ctx.font = "700 26px Unbounded"; ctx.fillText(t1, x + pad, y + h / 2 + 1);
    if (label) { ctx.fillStyle = ctx.strokeStyle; ctx.font = "500 20px Unbounded"; ctx.fillText(label, x + pad * 2 + w1, y + h / 2 + 1); }
  }

  // только рамка редкости (у обычной — никакой)
  function border(ctx, work) {
    if (work.rarity === "divine") {
      // свет сверху и сияющая бело-золотая рама
      const light = ctx.createRadialGradient(W / 2, -H * 0.1, 0, W / 2, -H * 0.1, H * 0.9);
      light.addColorStop(0, "rgba(255,248,225,.55)"); light.addColorStop(1, "rgba(255,248,225,0)");
      ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.fillStyle = light; ctx.fillRect(0, 0, W, H); ctx.restore();
      ctx.save(); ctx.shadowColor = "rgba(255,236,190,1)"; ctx.shadowBlur = 36;
      const g = ctx.createLinearGradient(0, 0, W, H);
      ["#fffaf0", "#f3d999", "#ffffff", "#e9c873", "#fffaf0"].forEach((c, i) => g.addColorStop(i / 4, c));
      ctx.strokeStyle = g; ctx.lineWidth = 32; ctx.strokeRect(16, 16, W - 32, H - 32); ctx.restore();
      ctx.strokeStyle = "rgba(160,118,40,.85)"; ctx.lineWidth = 2; ctx.strokeRect(34, 34, W - 68, H - 68);
      for (const [x, y] of [[16, 16], [W - 16, 16], [16, H - 16], [W - 16, H - 16]]) star(ctx, x, y, 34, "#fff8e1");
      star(ctx, W / 2, 16, 44, "#ffffff");
    } else if (work.rarity === "mythic") {
      // радужная рама с искрами по углам
      const g = ctx.createLinearGradient(0, 0, W, H);
      ["#ff5ec4", "#a879ff", "#6bd6ff", "#7dffb0", "#ffd36b", "#ff5ec4"].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
      ctx.strokeStyle = g; ctx.lineWidth = 28; ctx.strokeRect(14, 14, W - 28, H - 28);
      ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 2; ctx.strokeRect(29, 29, W - 58, H - 58);
      for (const [x, y] of [[14, 14], [W - 14, 14], [14, H - 14], [W - 14, H - 14]]) star(ctx, x, y, 26, "#ffffff");
    } else if (work.rarity === "legend") {
      const g = ctx.createLinearGradient(0, 0, W, H);
      ["#8a6420", "#f6e2a6", "#b98a2e", "#fff3c8", "#8a6420"].forEach((c, i) => g.addColorStop(i / 4, c));
      ctx.strokeStyle = g; ctx.lineWidth = 26; ctx.strokeRect(13, 13, W - 26, H - 26);
      ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 2; ctx.strokeRect(27, 27, W - 54, H - 54);
    } else if (work.rarity === "rare") {
      ctx.strokeStyle = "#cfe6ff"; ctx.lineWidth = 10; ctx.strokeRect(5, 5, W - 10, H - 10);
      ctx.strokeStyle = "rgba(111,183,255,.8)"; ctx.lineWidth = 3; ctx.strokeRect(18, 18, W - 36, H - 36);
    }
  }

  // свойства для NFT (attributes в метаданных)
  const traits = w => [
    { trait_type: "Фото", value: PHOTOS[w.photo].title },
    { trait_type: "Техника", value: TECHS[w.tech] },
    { trait_type: "Палитра", value: w.palette },
    { trait_type: "Редкость", value: RARITY_NAME[w.rarity] },
  ];

  // рамка и табличка нужны и коллекции «Хом» (hom/engine.js); одна рамка без таблички — картинам КИР
  const plate = (ctx, work, label, title, w, h) => { W = w; H = h; frame(ctx, work, label, title); };
  const rarityBorder = (ctx, work, w, h) => { W = w; H = h; border(ctx, work); };

  return { PHOTOS, TECHS, PALETTES, RARITIES, RARITY_NAME, rarityOf, IMG, ready, render, randomWork, traits, plate, rarityBorder, rng, styleScene };
})();
