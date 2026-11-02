// «Шумеры»: алгоритм сам «вырезает из камня» идолов, маски и зверей в духе древних шумерских фигурок.
// Фото не нужны — всё рисуется с нуля, поэтому работает и на сайте. Рамка и табличка — из /bogomol/engine.js.
const SHUMER = (() => {
  const FORMS = { mask: "Маска", idol: "Идол", beast: "Зверь", bird: "Птица", owl: "Сова", bull: "Бык" };
  const TECHS = { ...BOGO.TECHS, warhol: "Четыре идола" }; // оформление — как у «Богомола»: неон, поп-арт, пиксели…
  const STONES = [
    { name: "Змеевик",   base: "#1f2420", mid: "#3c4639", light: "#b9b59a", vein: "#d8d2b8" },
    { name: "Известняк", base: "#b7ab92", mid: "#d9cfb8", light: "#efe8d6", vein: "#3a342b" },
    { name: "Яшма",      base: "#4a1d12", mid: "#7a3420", light: "#e9d9c4", vein: "#f2e6d3" },
    { name: "Базальт",   base: "#1b1a1a", mid: "#2f2d2b", light: "#6a645c", vein: "#a39a8c" },
    { name: "Лазурит",   base: "#10205a", mid: "#22409a", light: "#d9b65a", vein: "#e8cf7a", rare: true },
    { name: "Золото",    base: "#6b4a12", mid: "#b98a2e", light: "#f6e2a6", vein: "#fff3c8", rare: true },
  ];
  const BGS = { clay: "Глиняная табличка", desert: "Зиккурат", night: "Ночь Нанны", lapis: "Штандарт Ура", museum: "Музей" };
  const EYES = { inlay: "Инкрустация", hollow: "Пустые", slit: "Щёлки" };
  const WORDS_A = ["Страж", "Жрец", "Идол", "Лик", "Хранитель", "Писец", "Царь", "Дух", "Молящийся", "Голос", "Сон", "Тень"];
  const WORDS_B = ["Ура", "Урука", "Лагаша", "Ниппура", "Эриду", "Киша", "Шуруппака", "Энлиля", "Инанны", "Нанны", "Ларсы", "Умы"];

  function randomWork(seed) {
    const R = BOGO.rng(seed ^ 0x1b873593); for (let i = 0; i < 8; i++) R();
    const pick = a => a[Math.floor(R() * a.length)];
    const r = R();
    const rarity = BOGO.rarityOf(r), top = ["legend", "mythic", "divine"].includes(rarity);
    const common = STONES.filter(s => !s.rare);
    // золото — у легендарных и выше (у божественных всегда), лазурит — у редких и выше
    const stone = rarity === "divine" ? "Золото" : top ? (R() < 0.6 ? "Золото" : "Лазурит") : rarity === "rare" && R() < 0.4 ? "Лазурит" : pick(common).name;
    return {
      seed, form: pick(Object.keys(FORMS)), stone, bg: pick(Object.keys(BGS)), eyes: pick(Object.keys(EYES)),
      rarity, title: `${pick(WORDS_A)} ${pick(WORDS_B)}`,
      tech: pick(Object.keys(TECHS)), palette: pick(BOGO.PALETTES).name,
    };
  }

  const ready = () => Promise.all([document.fonts.load("700 26px Unbounded"), document.fonts.load("500 20px Unbounded")]);

  let W, H, ctx, R, rnd, tex, st;
  const mk = (w = W, h = H) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const P = fn => { const p = new Path2D(); fn(p); return p; };

  function render(work, out, w = 900, h = 1200, label = "") {
    W = w; H = h; R = BOGO.rng(work.seed); rnd = (a, b) => a + R() * (b - a);
    st = STONES.find(s => s.name === work.stone);
    tex = stoneTexture();
    // сцена и фигура отдельно: фон уйдёт в неон/поп-арт…, а камень фигуры останется настоящим
    const scene = mk(), hero = mk();
    ctx = scene.getContext("2d"); BG[work.bg](); grain(8);
    ctx = hero.getContext("2d"); FIG[work.form](work);
    BOGO.styleScene(work, out, scene, hero, W, H, label, "ШУМЕРЫ");
  }

  // ---------- камень: шум в несколько слоёв + крапинки + прожилки ----------
  function noiseLayer(cell) {
    const s = mk(Math.ceil(W / cell) + 1, Math.ceil(H / cell) + 1), x = s.getContext("2d"), im = x.createImageData(s.width, s.height);
    for (let i = 0; i < im.data.length; i += 4) { const v = R() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    x.putImageData(im, 0, 0); return s;
  }
  function stoneTexture() {
    const c = mk(), x = c.getContext("2d");
    x.fillStyle = "#808080"; x.fillRect(0, 0, W, H);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
    [[90, 0.6], [40, 0.45], [16, 0.35], [5, 0.3], [2, 0.25]].forEach(([cell, a]) => { x.globalAlpha = a; x.drawImage(noiseLayer(cell), 0, 0, W + cell, H + cell); });
    x.globalAlpha = 1;
    const im = x.getImageData(0, 0, W, H), d = im.data;
    const B = hex(st.base), M = hex(st.mid), L = hex(st.light);
    const cut = rnd(0.56, 0.64); // где начинаются светлые пятна
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] / 255;
      const c = v > cut ? mix(M, L, Math.min(1, (v - cut) * 6)) : mix(B, M, Math.max(0, Math.min(1, (v - 0.3) / (cut - 0.3))));
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
    x.putImageData(im, 0, 0);
    // прожилки
    x.strokeStyle = st.vein; x.lineCap = "round"; x.filter = "blur(1.5px)";
    for (let k = 0, n = rnd(2, 5); k < n; k++) {
      x.globalAlpha = rnd(0.12, 0.3); x.lineWidth = rnd(1, 3.5);
      // прожилка идёт в одну сторону, слегка изгибаясь
      const y0 = rnd(0, H), dy = rnd(-H * 0.4, H * 0.4);
      x.beginPath(); x.moveTo(-50, y0);
      x.bezierCurveTo(W * 0.33, y0 + dy * 0.3 + rnd(-60, 60), W * 0.66, y0 + dy * 0.7 + rnd(-60, 60), W + 50, y0 + dy);
      x.stroke();
    }
    x.filter = "none"; x.globalAlpha = 1;
    return c;
  }

  // ---------- объём: выпуклая часть, вырезанная часть, инкрустация ----------
  const LX = -0.45, LY = -0.6; // свет сверху слева
  function raised(path, b, lift = 1) {
    // тень под деталью
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 14 * lift; ctx.shadowOffsetX = 5 * lift; ctx.shadowOffsetY = 8 * lift;
    ctx.fillStyle = st.base; ctx.fill(path); ctx.restore();
    ctx.save(); ctx.clip(path);
    ctx.drawImage(tex, 0, 0);
    // свет и тень по форме
    const [x, y, w, h] = b, cx = x + w / 2, cy = y + h / 2, r = Math.max(w, h);
    const g = ctx.createRadialGradient(cx + LX * w * 0.35, cy + LY * h * 0.35, 0, cx, cy, r * 0.75);
    g.addColorStop(0, "rgba(255,250,235,.32)"); g.addColorStop(0.45, "rgba(255,250,235,0)"); g.addColorStop(1, "rgba(0,0,0,.55)");
    ctx.fillStyle = g; ctx.fillRect(x - 10, y - 10, w + 20, h + 20);
    innerShadow(path, "rgba(0,0,0,.6)", 18 * lift, -4 * lift, -6 * lift);
    innerShadow(path, "rgba(255,245,220,.35)", 6, 3, 4); // светлая кромка
    ctx.restore();
  }
  function carved(path, depth = 1) {
    ctx.save(); ctx.clip(path);
    ctx.fillStyle = `rgba(10,6,4,${Math.min(0.55, 0.15 + depth * 0.3)})`; ctx.fill(path);
    innerShadow(path, "rgba(0,0,0,.85)", 10 * depth, 6 * depth, 8 * depth);
    ctx.restore();
  }
  function innerShadow(path, color, blur, dx, dy) {
    const outer = new Path2D(); outer.rect(-W, -H, W * 3, H * 3); outer.addPath(path);
    ctx.save(); ctx.clip(path);
    ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.shadowOffsetX = dx; ctx.shadowOffsetY = dy;
    ctx.fillStyle = "#000"; ctx.fill(outer, "evenodd");
    ctx.restore();
  }
  // путь с запомненными границами
  function shape(x, y, w, h, fn) { const p = P(fn); p.__b = [x, y, w, h]; return p; }
  const ellipse = (cx, cy, rx, ry, rot = 0) => shape(cx - rx, cy - ry, rx * 2, ry * 2, p => p.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2));

  // белёсые следы времени в углублениях (как на фото маски)
  function weather(path, b, n) {
    ctx.save(); ctx.clip(path); ctx.strokeStyle = "rgba(240,232,215,.55)"; ctx.lineCap = "round"; ctx.filter = "blur(2px)";
    const [x, y, w, h] = b;
    for (let k = 0; k < n; k++) {
      ctx.lineWidth = rnd(1, 4); ctx.globalAlpha = rnd(0.2, 0.7);
      const sx = x + rnd(0, w), sy = y + rnd(0, h);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + rnd(-30, 30), sy + rnd(-8, 8)); ctx.stroke();
    }
    ctx.restore();
  }

  // глаза: инкрустация (ракушка + битум, как у статуй из Телль-Асмара), пустые глазницы или щёлки
  function eyes(work, cx, cy, gap, rx, ry, tilt = 0.08) {
    const almond = (ex, rx, ry, a) => shape(ex - rx, cy - ry, rx * 2, ry * 2, p => {
      const c = Math.cos(a), s = Math.sin(a), pt = (x, y) => [ex + x * c - y * s, cy + x * s + y * c];
      p.moveTo(...pt(-rx, 0)); p.quadraticCurveTo(...pt(0, -ry * 2), ...pt(rx, 0)); p.quadraticCurveTo(...pt(0, ry * 2), ...pt(-rx, 0)); p.closePath();
    });
    const pupil = R() < 0.3 ? "#1b2f7a" : "#14100d", pr = ry * rnd(0.8, 0.95); // оба глаза одинаковые
    for (const s of [-1, 1]) {
      const ex = cx + s * gap, e = almond(ex, rx, ry, s * tilt);
      if (work.eyes === "inlay") {
        carved(almond(ex, rx * 1.12, ry * 1.3, s * tilt), 1.2);
        ctx.save(); ctx.clip(e);
        const g = ctx.createLinearGradient(ex, cy - ry, ex, cy + ry); g.addColorStop(0, "#f7f1e2"); g.addColorStop(1, "#cfc4ab");
        ctx.fillStyle = g; ctx.fill(e);
        // зрачок из битума или лазурита, крупный — взгляд «в вечность»
        ctx.fillStyle = pupil;
        ctx.beginPath(); ctx.arc(ex + s * rx * 0.04, cy, pr, 0, 7); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.beginPath(); ctx.ellipse(ex - pr * 0.3, cy - pr * 0.45, pr * 0.35, pr * 0.15, -0.4, 0, 7); ctx.fill();
        innerShadow(e, "rgba(0,0,0,.6)", 8, 3, 5);
        ctx.restore();
      } else if (work.eyes === "hollow") {
        carved(e, 1.4);
      } else {
        carved(almond(ex, rx * 1.05, ry * 0.32, s * tilt), 0.8);
      }
    }
  }
  // круглый глаз (птица, сова): инкрустация с янтарной радужкой, пустая глазница или прищур
  function roundEye(work, ex, ey, r) {
    carved(ellipse(ex, ey, r * 1.22, r * 1.22), 1.1);
    const e = ellipse(ex, ey, r, r);
    if (work.eyes === "inlay") {
      ctx.save(); ctx.clip(e);
      const g = ctx.createRadialGradient(ex - r * 0.3, ey - r * 0.3, r * 0.1, ex, ey, r);
      g.addColorStop(0, "#fbf3dc"); g.addColorStop(1, "#c9b98f"); ctx.fillStyle = g; ctx.fill(e);
      ctx.fillStyle = "#c58a2a"; ctx.beginPath(); ctx.arc(ex, ey, r * 0.62, 0, 7); ctx.fill();
      ctx.fillStyle = "#14100d"; ctx.beginPath(); ctx.arc(ex, ey, r * 0.38, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.beginPath(); ctx.ellipse(ex - r * 0.25, ey - r * 0.3, r * 0.18, r * 0.1, -0.5, 0, 7); ctx.fill();
      innerShadow(e, "rgba(0,0,0,.55)", 8, 3, 5);
      ctx.restore();
    } else if (work.eyes === "hollow") carved(e, 1.5);
    else carved(ellipse(ex, ey, r * 1.05, r * 0.28), 0.9);
  }
  // губы/рот из нескольких «валиков» (как у зверя на фото)
  function ribbedMouth(cx, cy, w, h, n) {
    for (let i = 0; i < n; i++) {
      const y = cy + (i - (n - 1) / 2) * h * 0.95, ww = w * (1 - Math.abs(i - (n - 1) / 2) * 0.12);
      const lip = shape(cx - ww / 2, y - h / 2, ww, h, p => {
        p.moveTo(cx - ww / 2, y); p.bezierCurveTo(cx - ww / 2, y - h * 0.7, cx + ww / 2, y - h * 0.7, cx + ww / 2, y);
        p.bezierCurveTo(cx + ww / 2, y + h * 0.7, cx - ww / 2, y + h * 0.7, cx - ww / 2, y); p.closePath();
      });
      raised(lip, lip.__b, 0.6);
    }
  }

  // ---------- образы ----------
  const FIG = {
    // маска-подвеска с золотым шнурком
    mask(work) {
      const cx = W / 2 + rnd(-25, 25), cy = H * rnd(0.47, 0.52), w = W * rnd(0.56, 0.66), h = H * rnd(0.6, 0.68), top = cy - h / 2;
      cord(cx, top, w);
      const head = shape(cx - w / 2, top, w, h, p => {
        p.moveTo(cx - w / 2, top + h * 0.22);
        p.bezierCurveTo(cx - w / 2, top - h * 0.02, cx + w / 2, top - h * 0.02, cx + w / 2, top + h * 0.22);
        p.bezierCurveTo(cx + w / 2, top + h * 0.62, cx + w * 0.22, top + h, cx, top + h);
        p.bezierCurveTo(cx - w * 0.22, top + h, cx - w / 2, top + h * 0.62, cx - w / 2, top + h * 0.22); p.closePath();
      });
      // рожки/ушки на макушке
      if (R() < 0.7) for (const s of [-1, 1]) { const e = ellipse(cx + s * w * 0.36, top + h * 0.06, w * 0.1, h * 0.07, s * 0.5); raised(e, e.__b, 0.8); }
      raised(head, head.__b, 1.6);
      // надбровье и нос одним выступом
      const by = top + h * 0.3;
      const brow = shape(cx - w * 0.42, by - h * 0.06, w * 0.84, h * 0.4, p => {
        p.moveTo(cx - w * 0.42, by); p.quadraticCurveTo(cx - w * 0.2, by - h * 0.08, cx - w * 0.07, by - h * 0.02);
        p.lineTo(cx - w * 0.09, by + h * 0.3); p.quadraticCurveTo(cx, by + h * 0.34, cx + w * 0.09, by + h * 0.3);
        p.lineTo(cx + w * 0.07, by - h * 0.02); p.quadraticCurveTo(cx + w * 0.2, by - h * 0.08, cx + w * 0.42, by);
        p.lineTo(cx + w * 0.4, by + h * 0.05); p.quadraticCurveTo(cx + w * 0.2, by + h * 0.0, cx + w * 0.05, by + h * 0.05);
        p.lineTo(cx - w * 0.05, by + h * 0.05); p.quadraticCurveTo(cx - w * 0.2, by + h * 0.0, cx - w * 0.4, by + h * 0.05); p.closePath();
      });
      eyes(work, cx, by + h * 0.1, w * 0.22, w * 0.12, h * 0.05, 0.12);
      raised(brow, brow.__b, 0.9);
      // ноздри
      for (const s of [-1, 1]) carved(ellipse(cx + s * w * 0.045, by + h * 0.3, w * 0.022, h * 0.012), 0.6);
      ribbedMouth(cx, top + h * rnd(0.72, 0.76), w * rnd(0.5, 0.62), h * 0.08, R() < 0.5 ? 2 : 1);
      weather(head, head.__b, 40);
    },
    // молящийся идол со сложенными руками и огромными глазами
    idol(work) {
      const cx = W / 2 + rnd(-20, 20), base = H * 0.9, hw = W * rnd(0.29, 0.34), hh = hw * rnd(1.1, 1.22);
      const bodyTop = base - H * rnd(0.42, 0.48), headCy = bodyTop - hh * 0.38;
      pedestal(cx, base, W * 0.5);
      // юбка-колокол
      const sw = W * rnd(0.36, 0.44), skirt = shape(cx - sw / 2, bodyTop, sw, base - bodyTop, p => {
        p.moveTo(cx - sw * 0.32, bodyTop); p.lineTo(cx + sw * 0.32, bodyTop);
        p.quadraticCurveTo(cx + sw * 0.5, base - (base - bodyTop) * 0.4, cx + sw / 2, base);
        p.lineTo(cx - sw / 2, base); p.quadraticCurveTo(cx - sw * 0.5, base - (base - bodyTop) * 0.4, cx - sw * 0.32, bodyTop); p.closePath();
      });
      raised(skirt, skirt.__b, 1.4);
      // складки юбки
      for (let i = 1; i < 6; i++) { const y = bodyTop + (base - bodyTop) * (0.35 + i * 0.11); carved(shape(cx - sw / 2, y, sw, 6, p => p.rect(cx - sw * (0.38 + i * 0.022), y, sw * (0.76 + i * 0.044), 3)), 0.15); }
      // плечи и сложенные руки
      const tw = sw * 0.9, chest = bodyTop - (base - bodyTop) * 0.05;
      const torso = shape(cx - tw / 2, chest - hh * 0.1, tw, (base - bodyTop) * 0.45, p => p.roundRect(cx - tw / 2, chest - hh * 0.1, tw, (base - bodyTop) * 0.45, [tw * 0.3, tw * 0.3, 20, 20]));
      raised(torso, torso.__b, 1.2);
      for (const s of [-1, 1]) {
        const arm = shape(cx - tw / 2, chest, tw, hh * 0.6, p => {
          p.moveTo(cx + s * tw * 0.48, chest); p.quadraticCurveTo(cx + s * tw * 0.5, chest + hh * 0.5, cx + s * tw * 0.05, chest + hh * 0.42);
          p.lineTo(cx + s * tw * 0.05, chest + hh * 0.28); p.quadraticCurveTo(cx + s * tw * 0.3, chest + hh * 0.3, cx + s * tw * 0.3, chest); p.closePath();
        });
        raised(arm, arm.__b, 0.8);
      }
      const hands = ellipse(cx, chest + hh * 0.36, tw * 0.13, hh * 0.1); raised(hands, hands.__b, 0.9);
      // голова: борода у половины
      if (R() < 0.5) {
        const bw = hw * 0.75, beard = shape(cx - bw / 2, headCy + hh * 0.2, bw, hh * 0.65, p => p.roundRect(cx - bw / 2, headCy + hh * 0.2, bw, hh * 0.65, [10, 10, bw * 0.4, bw * 0.4]));
        raised(beard, beard.__b, 1);
        for (let i = 0; i < 5; i++) carved(shape(0, 0, 1, 1, p => p.rect(cx - bw * 0.42, headCy + hh * (0.42 + i * 0.09), bw * 0.84, 3)), 0.15);
      }
      const head = ellipse(cx, headCy, hw / 2, hh / 2); raised(head, head.__b, 1.3);
      // волосы/шапочка
      const cap = shape(cx - hw / 2, headCy - hh / 2, hw, hh * 0.32, p => { p.ellipse(cx, headCy - hh * 0.12, hw * 0.52, hh * 0.42, 0, Math.PI, 0); p.closePath(); });
      raised(cap, cap.__b, 0.7);
      eyes(work.eyes === "slit" ? { eyes: "inlay" } : work, cx, headCy + hh * 0.04, hw * 0.21, hw * 0.17, hh * 0.1, 0.05);
      const nose = shape(cx - hw * 0.06, headCy, hw * 0.12, hh * 0.22, p => p.roundRect(cx - hw * 0.05, headCy + hh * 0.02, hw * 0.1, hh * 0.2, 6)); raised(nose, nose.__b, 0.5);
      carved(ellipse(cx, headCy + hh * 0.32, hw * 0.14, hh * 0.025), 0.6);
      weather(skirt, skirt.__b, 25);
    },
    // сидящий зверь с ушами и полосатой пастью
    beast(work) {
      const cx = W / 2 + rnd(-20, 20), base = H * 0.9, bw = W * rnd(0.5, 0.58), bh = H * rnd(0.3, 0.34);
      pedestal(cx, base, W * 0.62);
      const bodyTop = base - bh;
      const body = shape(cx - bw / 2, bodyTop, bw, bh, p => p.roundRect(cx - bw / 2, bodyTop, bw, bh, [bw * 0.3, bw * 0.3, 30, 30]));
      raised(body, body.__b, 1.4);
      // лапы
      for (const s of [-1, 1]) {
        const lw = bw * 0.2, leg = shape(cx + s * bw * 0.22 - lw / 2, base - bh * 0.7, lw, bh * 0.7, p => p.roundRect(cx + s * bw * 0.22 - lw / 2, base - bh * 0.7, lw, bh * 0.7, lw * 0.45));
        raised(leg, leg.__b, 0.9);
        for (let t = -1; t <= 1; t++) carved(shape(0, 0, 1, 1, p => p.rect(cx + s * bw * 0.22 + t * lw * 0.22 - 1.5, base - bh * 0.12, 3, bh * 0.1)), 0.4);
      }
      // голова
      const hw = bw * rnd(0.82, 0.95), hh = hw * rnd(0.85, 1), hcy = bodyTop - hh * 0.28;
      for (const s of [-1, 1]) {
        const ear = ellipse(cx + s * hw * 0.34, hcy - hh * 0.48, hw * 0.13, hh * rnd(0.22, 0.3), s * 0.25);
        raised(ear, ear.__b, 1); carved(ellipse(cx + s * hw * 0.34, hcy - hh * 0.46, hw * 0.06, hh * 0.15, s * 0.25), 0.6);
      }
      const head = shape(cx - hw / 2, hcy - hh / 2, hw, hh, p => p.roundRect(cx - hw / 2, hcy - hh / 2, hw, hh, hw * 0.38));
      raised(head, head.__b, 1.5);
      eyes(work, cx, hcy - hh * 0.14, hw * 0.22, hw * 0.12, hh * 0.08, 0.1);
      const snout = ellipse(cx, hcy + hh * 0.02, hw * 0.12, hh * 0.1); raised(snout, snout.__b, 0.6);
      ribbedMouth(cx, hcy + hh * 0.26, hw * 0.62, hh * 0.09, 3);
      weather(head, head.__b, 30); weather(body, body.__b, 20);
    },
    // птица в профиль, как фигурка на фото: тело-столбик, большая голова, крючковатый клюв; смотрит вправо или влево
    bird(work) {
      const flip = R() < 0.5;
      const cx = W / 2 + rnd(-20, 20), base = H * 0.9, bw = W * rnd(0.3, 0.35), bh = H * rnd(0.38, 0.43);
      pedestal(cx, base, W * 0.5);
      ctx.save();
      if (flip) { ctx.translate(W, 0); ctx.scale(-1, 1); } // зеркально: тени и свет остаются как у остальных
      const x = flip ? W - cx : cx;
      const tail = shape(x - bw, base - bh * 0.35, bw * 0.8, bh * 0.35, p => {
        p.moveTo(x - bw * 0.3, base - bh * 0.32); p.lineTo(x - bw * 0.95, base - bh * 0.07); p.lineTo(x - bw * 0.28, base - bh * 0.03); p.closePath();
      });
      raised(tail, tail.__b, 0.8);
      const body = shape(x - bw / 2, base - bh * 0.8, bw, bh * 0.8, p => {
        p.moveTo(x - bw / 2, base); p.lineTo(x + bw / 2, base);
        p.quadraticCurveTo(x + bw * 0.58, base - bh * 0.45, x + bw * 0.3, base - bh * 0.78);
        p.lineTo(x - bw * 0.2, base - bh * 0.8);
        p.quadraticCurveTo(x - bw * 0.58, base - bh * 0.45, x - bw / 2, base); p.closePath();
      });
      raised(body, body.__b, 1.4);
      // крыло с перьями
      const wcx = x - bw * 0.04, wcy = base - bh * 0.42;
      const wing = ellipse(wcx, wcy, bw * 0.4, bh * 0.2, -0.45); raised(wing, wing.__b, 0.9);
      for (let k = 0; k < 3; k++) {
        const yy = wcy + (k - 1) * bh * 0.07;
        carved(shape(wcx - bw * 0.3, yy - 6, bw * 0.6, 12, p => { p.moveTo(wcx - bw * 0.28, yy + bw * 0.08); p.quadraticCurveTo(wcx, yy - 10, wcx + bw * 0.28, yy - bw * 0.14); p.lineTo(wcx + bw * 0.28, yy - bw * 0.14 + 4); p.quadraticCurveTo(wcx, yy - 5, wcx - bw * 0.28, yy + bw * 0.08 + 4); p.closePath(); }), 0.35);
      }
      // кольца на шее
      for (let k = 0; k < 2; k++) { const yy = base - bh * (0.7 - k * 0.05); carved(shape(x - bw * 0.3, yy, bw * 0.6, 4, p => p.rect(x - bw * 0.26, yy, bw * 0.52, 3)), 0.3); }
      // голова, хохолок, клюв, глаз
      const hcx = x + bw * 0.12, hcy = base - bh * 0.93, rx = bw * 0.5, ry = bw * 0.4;
      const crest = ellipse(hcx - rx * 0.62, hcy - ry * 0.72, rx * 0.36, ry * 0.24, -0.6); raised(crest, crest.__b, 0.7);
      const head = ellipse(hcx, hcy, rx, ry, -0.15); raised(head, head.__b, 1.3);
      const beak = shape(hcx + rx * 0.6, hcy - ry * 0.4, rx * 1.0, ry * 1.0, p => {
        p.moveTo(hcx + rx * 0.72, hcy - ry * 0.28);
        p.quadraticCurveTo(hcx + rx * 1.55, hcy - ry * 0.22, hcx + rx * 1.42, hcy + ry * 0.48); // кончик загнут вниз
        p.quadraticCurveTo(hcx + rx * 1.18, hcy + ry * 0.18, hcx + rx * 0.78, hcy + ry * 0.3); p.closePath();
      });
      raised(beak, beak.__b, 0.8);
      carved(shape(hcx + rx * 0.75, hcy, rx * 0.6, 4, p => { p.moveTo(hcx + rx * 0.78, hcy + ry * 0.05); p.quadraticCurveTo(hcx + rx * 1.1, hcy + ry * 0.02, hcx + rx * 1.3, hcy + ry * 0.2); p.lineTo(hcx + rx * 1.3, hcy + ry * 0.26); p.quadraticCurveTo(hcx + rx * 1.1, hcy + ry * 0.09, hcx + rx * 0.78, hcy + ry * 0.12); p.closePath(); }), 0.5);
      roundEye(work, hcx + rx * 0.22, hcy - ry * 0.14, ry * 0.3);
      weather(body, body.__b, 25);
      ctx.restore();
    },
    // сова: круглое лицо, огромные круглые глаза, ушки-пёрышки, крылья и грудка «ёлочкой»
    owl(work) {
      const cx = W / 2 + rnd(-20, 20), base = H * 0.9, bw = W * rnd(0.46, 0.54), bh = H * rnd(0.52, 0.58);
      pedestal(cx, base, W * 0.58);
      const top = base - bh, bcy = base - bh * 0.5;
      for (const s of [-1, 1]) {
        const ear = shape(cx - bw / 2, top - bh * 0.08, bw, bh * 0.24, p => {
          p.moveTo(cx + s * bw * 0.16, top + bh * 0.09); p.lineTo(cx + s * bw * 0.4, top - bh * 0.07); p.lineTo(cx + s * bw * 0.4, top + bh * 0.15); p.closePath();
        });
        raised(ear, ear.__b, 0.8);
      }
      const body = ellipse(cx, bcy, bw / 2, bh / 2); raised(body, body.__b, 1.5);
      for (const s of [-1, 1]) {
        const wing = shape(cx - bw / 2, bcy - bh * 0.1, bw, bh * 0.6, p => {
          p.moveTo(cx + s * bw * 0.46, bcy - bh * 0.05);
          p.quadraticCurveTo(cx + s * bw * 0.52, bcy + bh * 0.3, cx + s * bw * 0.2, bcy + bh * 0.47);
          p.quadraticCurveTo(cx + s * bw * 0.3, bcy + bh * 0.15, cx + s * bw * 0.3, bcy - bh * 0.02); p.closePath();
        });
        raised(wing, wing.__b, 0.9);
      }
      for (let row = 0; row < 4; row++) for (let k = -1; k <= 1; k++) {
        const fx = cx + k * bw * 0.11 + (row % 2 ? bw * 0.055 : 0), fy = bcy + bh * (0.1 + row * 0.08);
        carved(shape(fx - 14, fy - 6, 28, 14, p => { p.moveTo(fx - 13, fy - 5); p.quadraticCurveTo(fx, fy + 10, fx + 13, fy - 5); p.quadraticCurveTo(fx, fy + 3, fx - 13, fy - 5); p.closePath(); }), 0.45);
      }
      const fy = top + bh * 0.3, face = ellipse(cx, fy, bw * 0.43, bh * 0.2); raised(face, face.__b, 0.7);
      for (const s of [-1, 1]) roundEye(work, cx + s * bw * 0.19, fy - bh * 0.01, bw * 0.12);
      const beak = shape(cx - bw * 0.05, fy, bw * 0.1, bh * 0.12, p => {
        p.moveTo(cx - bw * 0.045, fy + bh * 0.02); p.lineTo(cx + bw * 0.045, fy + bh * 0.02);
        p.quadraticCurveTo(cx + bw * 0.012, fy + bh * 0.08, cx, fy + bh * 0.11); p.quadraticCurveTo(cx - bw * 0.012, fy + bh * 0.08, cx - bw * 0.045, fy + bh * 0.02); p.closePath();
      });
      raised(beak, beak.__b, 0.6);
      for (const s of [-1, 1]) { const f = ellipse(cx + s * bw * 0.14, base - 8, bw * 0.08, 14); raised(f, f.__b, 0.6); }
      weather(body, body.__b, 30);
    },
    // голова быка, как на лире из Ура: длинная морда, рога, завитки на лбу и борода из завитков
    bull(work) {
      const cx = W / 2 + rnd(-15, 15), hw = W * rnd(0.36, 0.41), hh = H * rnd(0.4, 0.44), top = H * rnd(0.22, 0.26);
      for (const s of [-1, 1]) { // рога — сзади головы
        const x0 = cx + s * hw * 0.26, y0 = top + hh * 0.1;
        const horn = shape(cx - W / 2, top - hh * 0.45, W, hh * 0.65, p => {
          p.moveTo(x0, y0 + hh * 0.07);
          p.quadraticCurveTo(cx + s * hw * 1.0, y0 + hh * 0.04, cx + s * hw * 1.02, y0 - hh * 0.36);
          p.quadraticCurveTo(cx + s * hw * 0.8, y0 - hh * 0.06, x0, y0 - hh * 0.05); p.closePath();
        });
        raised(horn, horn.__b, 1.1);
      }
      for (const s of [-1, 1]) { const ear = ellipse(cx + s * hw * 0.62, top + hh * 0.24, hw * 0.2, hh * 0.065, s * 0.35); raised(ear, ear.__b, 0.8); }
      const bw = hw * 0.64, by = top + hh * 0.84, bhh = H * 0.92 - by;
      const beard = shape(cx - bw / 2, by, bw, bhh, p => p.roundRect(cx - bw / 2, by, bw, bhh, [14, 14, bw * 0.3, bw * 0.3]));
      raised(beard, beard.__b, 1);
      const rows = 6, cols = 4;
      for (let r = 0; r < rows; r++) for (let k = 0; k < cols - (r % 2); k++) {
        const ccx = cx - bw * 0.36 + (k + (r % 2) * 0.5) * (bw * 0.72 / (cols - 1)), ccy = by + bhh * (0.16 + r * 0.13);
        if (ccy > by + bhh - 18) continue;
        carved(ellipse(ccx, ccy, bw * 0.07, bw * 0.05), 0.55);
      }
      const head = shape(cx - hw / 2, top, hw, hh, p => {
        p.moveTo(cx - hw * 0.42, top + hh * 0.05);
        p.quadraticCurveTo(cx, top - hh * 0.06, cx + hw * 0.42, top + hh * 0.05);
        p.quadraticCurveTo(cx + hw * 0.52, top + hh * 0.4, cx + hw * 0.33, top + hh * 0.7);
        p.quadraticCurveTo(cx + hw * 0.36, top + hh * 0.98, cx, top + hh);
        p.quadraticCurveTo(cx - hw * 0.36, top + hh * 0.98, cx - hw * 0.33, top + hh * 0.7);
        p.quadraticCurveTo(cx - hw * 0.52, top + hh * 0.4, cx - hw * 0.42, top + hh * 0.05); p.closePath();
      });
      raised(head, head.__b, 1.5);
      for (let r = 0; r < 2; r++) for (let k = -1; k <= 1 - r; k++) {
        carved(ellipse(cx + k * hw * 0.13 + r * hw * 0.065, top + hh * (0.11 + r * 0.075), hw * 0.045, hw * 0.045), 0.5);
      }
      eyes(work, cx, top + hh * 0.37, hw * 0.25, hw * 0.11, hh * 0.035, 0.18);
      const muzzle = ellipse(cx, top + hh * 0.84, hw * 0.3, hh * 0.13); raised(muzzle, muzzle.__b, 0.8);
      for (const s of [-1, 1]) carved(ellipse(cx + s * hw * 0.12, top + hh * 0.86, hw * 0.05, hh * 0.034, s * 0.4), 0.9);
      weather(head, head.__b, 30);
    },
  };

  function cord(cx, top, w) {
    ctx.save(); ctx.lineCap = "round";
    for (const s of [-1, 1]) {
      const p = new Path2D(); p.moveTo(cx + s * w * 0.34, top + 20); p.bezierCurveTo(cx + s * w * 0.5, top - 120, cx + s * w * 0.2, -80, cx + s * 60, -40);
      ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 9; ctx.filter = "blur(4px)"; ctx.translate(6, 8); ctx.stroke(p); ctx.translate(-6, -8); ctx.filter = "none";
      ctx.strokeStyle = "#b8892c"; ctx.lineWidth = 7; ctx.stroke(p);
      ctx.strokeStyle = "#f7df8a"; ctx.lineWidth = 2.5; ctx.setLineDash([5, 6]); ctx.stroke(p); ctx.setLineDash([]);
    }
    ctx.restore();
  }
  function pedestal(cx, base, w) {
    const h = H - base + 40, p = shape(cx - w / 2, base - 10, w, h, q => q.rect(cx - w / 2, base - 10, w, h));
    const keep = tex; tex = stoneTexture2(); raised(p, p.__b, 1.2); tex = keep;
  }
  // постамент — тёмный камень, чтобы не сливался с фигуркой
  function stoneTexture2() {
    const keep = st; st = STONES[3]; const t = stoneTexture(); st = keep; return t;
  }

  // ---------- фоны ----------
  const BG = {
    clay() {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#c89f72"); g.addColorStop(1, "#9c7350");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // клинопись рядами
      const rowH = rnd(46, 60);
      for (let y = 30; y < H; y += rowH) {
        ctx.fillStyle = "rgba(60,35,18,.35)"; ctx.fillRect(0, y + rowH - 4, W, 2);
        for (let x = 20; x < W; x += rnd(18, 34)) wedge(x, y + rnd(6, 14), rnd(10, 22), R() < 0.7 ? 0 : R() < 0.5 ? Math.PI / 2 : Math.PI / 4);
      }
      vignette(0.5);
    },
    desert() {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#2b1640"); g.addColorStop(0.45, "#c2502a"); g.addColorStop(0.7, "#f2b05e"); g.addColorStop(1, "#d9a25c");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,230,170,.9)"; ctx.beginPath(); ctx.arc(rnd(0.2, 0.8) * W, H * rnd(0.28, 0.4), rnd(60, 110), 0, 7); ctx.fill();
      // зиккурат
      const zx = rnd(0.25, 0.75) * W, zb = H * 0.74; ctx.fillStyle = "#3a1e1a";
      for (let i = 0; i < 4; i++) { const w = 520 - i * 110, h = 55; ctx.fillRect(zx - w / 2, zb - (i + 1) * h, w, h + 1); }
      ctx.fillRect(zx - 12, zb - 260, 24, 50);
      ctx.fillStyle = "#b9824a"; ctx.fillRect(0, zb, W, H - zb);
    },
    night() {
      const g = ctx.createRadialGradient(W / 2, H * 0.3, 50, W / 2, H / 2, H); g.addColorStop(0, "#1c2550"); g.addColorStop(1, "#05060f");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (let k = 0; k < 220; k++) { ctx.fillStyle = `rgba(255,255,240,${rnd(0.2, 0.9)})`; ctx.beginPath(); ctx.arc(rnd(0, W), rnd(0, H), rnd(0.5, 2), 0, 7); ctx.fill(); }
      // полумесяц Нанны и звезда Инанны
      const mx = rnd(0.15, 0.85) * W, my = H * rnd(0.1, 0.2);
      const m = mk(120, 120), mc = m.getContext("2d");
      mc.fillStyle = "#f3e7c0"; mc.beginPath(); mc.arc(60, 60, 50, 0, 7); mc.fill();
      mc.globalCompositeOperation = "destination-out"; mc.beginPath(); mc.arc(82, 48, 46, 0, 7); mc.fill();
      ctx.save(); ctx.shadowColor = "rgba(243,231,192,.6)"; ctx.shadowBlur = 30; ctx.drawImage(m, mx - 60, my - 60); ctx.restore();
      star8(W - mx, my + 30, 34, "#f2d27a");
    },
    lapis() {
      ctx.fillStyle = "#13286b"; ctx.fillRect(0, 0, W, H);
      for (let k = 0; k < 900; k++) { ctx.fillStyle = `rgba(230,195,100,${rnd(0.2, 0.8)})`; ctx.fillRect(rnd(0, W), rnd(0, H), rnd(1, 3), rnd(1, 3)); }
      // пояса из треугольников, как на штандарте из Ура
      for (const y of [40, H - 90]) {
        ctx.fillStyle = "#e8c86a"; ctx.fillRect(0, y, W, 50);
        ctx.fillStyle = "#8a2a1a";
        for (let x = 0; x < W; x += 50) { ctx.beginPath(); ctx.moveTo(x, y + 50); ctx.lineTo(x + 25, y); ctx.lineTo(x + 50, y + 50); ctx.fill(); }
      }
      vignette(0.45);
    },
    museum() {
      const g = ctx.createRadialGradient(W / 2, H * 0.35, 40, W / 2, H * 0.5, H * 0.8); g.addColorStop(0, "#3d3530"); g.addColorStop(1, "#0b0908");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // луч прожектора
      const s = ctx.createLinearGradient(0, 0, 0, H); s.addColorStop(0, "rgba(255,240,210,.18)"); s.addColorStop(1, "rgba(255,240,210,0)");
      ctx.fillStyle = s; ctx.beginPath(); ctx.moveTo(W * 0.4, 0); ctx.lineTo(W * 0.6, 0); ctx.lineTo(W * 0.95, H); ctx.lineTo(W * 0.05, H); ctx.fill();
    },
  };
  function wedge(x, y, s, a) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = "rgba(70,40,20,.55)";
    ctx.beginPath(); ctx.moveTo(-s * 0.35, 0); ctx.lineTo(s * 0.35, 0); ctx.lineTo(0, s * 0.45); ctx.closePath(); ctx.fill();
    ctx.fillRect(-1.2, s * 0.3, 2.4, s * 0.9);
    ctx.fillStyle = "rgba(255,225,180,.35)"; ctx.fillRect(-s * 0.35, -1.5, s * 0.7, 1.5);
    ctx.restore();
  }
  function star8(x, y, r, c) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = c; ctx.beginPath();
    for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, rr = i % 2 ? r * 0.42 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.fill(); ctx.restore();
  }
  function vignette(a) {
    const g = ctx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${a})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function grain(amt) {
    const im = ctx.getImageData(0, 0, W, H), d = im.data;
    for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    ctx.putImageData(im, 0, 0);
  }

  const traits = w => [
    { trait_type: "Образ", value: FORMS[w.form] },
    { trait_type: "Техника", value: TECHS[w.tech] },
    { trait_type: "Палитра", value: w.palette },
    { trait_type: "Камень", value: w.stone },
    { trait_type: "Фон", value: BGS[w.bg] },
    { trait_type: "Глаза", value: EYES[w.eyes] },
    { trait_type: "Редкость", value: BOGO.RARITY_NAME[w.rarity] },
  ];

  return { TECHS, FORMS, STONES, BGS, EYES, ready, render, randomWork, traits };
})();
