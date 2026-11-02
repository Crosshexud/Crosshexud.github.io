// Ролл редкости, как в играх: по картине быстро перебираются редкости с шансами, перебор замедляется и останавливается
// на выпавшей. Если выпало очень редкое (легендарная и выше) — сцена на весь экран со вспышкой, лучами, искрами и звуком.
// Подключается после /bogomol/engine.js (список редкостей — BOGO.RARITIES); стили — /site/css/roll.css. На странице — window.KIRRoll.
window.KIRRoll = (() => {
  const TIERS = BOGO.RARITIES; // от самой редкой: divine, mythic, legend, rare, common
  const byId = id => TIERS.find(t => t.id === id) || TIERS[TIERS.length - 1];
  const byName = name => TIERS.find(t => t.name === name) || TIERS[TIERS.length - 1];
  const BIG = ["legend", "mythic", "divine"]; // для них — сцена на весь экран
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // шанс словами: «1 к 25»; у обычной — проценты (всё, что осталось)
  function odds(id) {
    const t = byId(id);
    if (t.in > 1) return `1 к ${t.in.toLocaleString("ru-RU")}`;
    const rest = 1 - TIERS.filter(x => x.in > 1).reduce((s, x) => s + 1 / x.in, 0);
    return `${(rest * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
  }

  // ---------- настройки: ролл и звук можно выключить, браузер это помнит ----------
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === "1"; } catch { return d; } };
  const opt = { roll: load("kir-roll", true), sound: load("kir-sound", true) };
  function toggle(name) {
    opt[name] = !opt[name];
    try { localStorage.setItem("kir-" + name, opt[name] ? "1" : "0"); } catch {}
    return opt[name];
  }

  // ---------- звук: синтезируется на лету, файлов нет ----------
  let ac = null;
  function audio() {
    if (!opt.sound) return null;
    try {
      ac ||= new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === "suspended") ac.resume();
      return ac;
    } catch { return null; }
  }
  function tone(f, at, dur, { type = "sine", vol = 0.1, attack = 0.01 } = {}) {
    const c = audio(); if (!c) return;
    const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  function whoosh(at, dur, vol = 0.12) {
    const c = audio(); if (!c) return;
    const t = c.currentTime + at, n = Math.ceil(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; f.type = "bandpass"; f.Q.value = 1.4;
    f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(3000, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(c.destination); src.start(t); src.stop(t + dur);
  }
  const SFX = {
    tick: i => tone(520 + i * 24, 0, 0.045, { type: "square", vol: 0.03 }),
    common: () => tone(523, 0, 0.2, { type: "triangle", vol: 0.08 }),
    rare: () => { tone(659, 0, 0.2, { type: "triangle" }); tone(988, 0.09, 0.35, { type: "triangle" }); },
    charge: () => whoosh(0, 0.65),
    // золотое арпеджио и аккорд
    legend: () => {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.08, 0.9, { type: "triangle", vol: 0.11 }));
      [262, 392, 523].forEach(f => tone(f, 0.3, 1.8, { vol: 0.06, attack: 0.08 }));
    },
    // быстрое переливчатое арпеджио, гул и звёздочки сверху
    mythic: () => {
      [587, 740, 880, 1175, 1480, 1760].forEach((f, i) => tone(f, i * 0.06, 1, { type: "triangle", vol: 0.09 }));
      [147, 220, 294].forEach(f => tone(f, 0.2, 2.6, { type: "sawtooth", vol: 0.02, attack: 0.3 }));
      for (let i = 0; i < 9; i++) tone(2000 + Math.random() * 2200, 0.5 + i * 0.13, 0.25, { vol: 0.03 });
    },
    // божественный: медленно нарастающий хор, потом удар и колокольчики (звучит с самого начала сцены)
    divine: () => {
      [131, 196, 262, 330, 392].forEach(f => tone(f, 0, 3.8, { vol: 0.045, attack: 1.2 }));
      tone(65, 1.25, 2.6, { type: "triangle", vol: 0.16 });
      [1047, 1319, 1568, 2093, 2637].forEach((f, i) => tone(f, 1.3 + i * 0.15, 1.8, { vol: 0.07 }));
    },
  };

  // ---------- пропуск: повторное нажатие во время ролла ----------
  let fast = false, wake = null, closeCine = null;
  function skip() {
    if (closeCine) return closeCine();
    fast = true; if (wake) wake();
  }
  // пауза, которую нажатие обрывает
  function pause(ms) {
    if (fast) return Promise.resolve();
    return new Promise(res => {
      const id = setTimeout(done, ms);
      function done() { clearTimeout(id); wake = null; res(); }
      wake = done;
    });
  }

  // в переборе редкие мелькают чаще, чем выпадают на самом деле, — ради азарта
  const SHOWN = { common: 3, rare: 3, legend: 2.2, mythic: 1.6, divine: 1.2 };
  function shownTier() {
    let r = Math.random() * TIERS.reduce((s, t) => s + SHOWN[t.id], 0);
    for (const t of TIERS) { r -= SHOWN[t.id]; if (r < 0) return t; }
    return TIERS[TIERS.length - 1];
  }

  // 1) сразу закрыть картину «барабаном», пока она рисуется
  function begin(frame) {
    fast = false;
    const box = document.createElement("div");
    box.className = "roll";
    box.innerHTML = `<div class="roll-in"><small>ролл</small><b>…</b><span>&nbsp;</span></div>`;
    frame.append(box);
    return box;
  }

  // 2) перебор и остановка на выпавшей редкости; у очень редких — сцена. Обещание выполняется, когда всё закончилось
  async function finish(box, { rarity, canvas, title, collection }) {
    const final = byId(rarity), b = box.querySelector("b"), s = box.querySelector("span"), inner = box.querySelector(".roll-in");
    const show = t => {
      box.dataset.t = t.id; b.textContent = t.name; s.textContent = "шанс " + odds(t.id);
      inner.classList.remove("pop"); void inner.offsetWidth; inner.classList.add("pop");
    };
    if (!reduced()) {
      const seq = [];
      for (let i = 0; i < 15; i++) { let t; do t = shownTier(); while (t === seq[seq.length - 1]); seq.push(t); }
      // «почти!»: перед обычной или редкой часто мелькает что-то очень редкое
      if (!BIG.includes(final.id) && Math.random() < 0.55) seq[seq.length - 1] = byId(BIG[Math.floor(Math.random() * BIG.length)]);
      if (seq[seq.length - 1] === final) seq.pop();
      seq.push(final);
      let delay = 55; // интервал растёт — барабан замедляется
      for (let i = 0; i < seq.length && !fast; i++) {
        show(seq[i]); SFX.tick(i);
        if (i < seq.length - 1) { await pause(delay); delay = Math.min(delay * 1.17, 300); }
      }
    }
    show(final);
    box.classList.add("land");
    const frame = box.parentElement;

    if (!BIG.includes(final.id)) {
      SFX[final.id]();
      if (final.id === "rare") {
        const p = document.createElement("i"); p.className = "roll-pulse"; frame.append(p);
        setTimeout(() => p.remove(), 1000);
      }
      fast = false;
      await pause(final.id === "rare" ? 700 : 380);
      box.classList.add("out"); await sleep(320); box.remove();
      return;
    }

    // очень редкое: надпись разгорается — и сцена на весь экран
    fast = false;
    box.classList.add("charge"); SFX.charge();
    await pause(650);
    if (reduced()) {
      box.remove();
      window.KIRUI?.toast(`${esc(final.name)}! Шанс ${odds(final.id)}`, "ok", 5000);
      return;
    }
    const scene = cinematic(final, canvas, title, collection);
    setTimeout(() => box.remove(), 400); // картина в рамке откроется, когда сцена закроется
    await scene;
  }

  // ---------- сцена ----------
  const CINE = {
    legend: { build: 420, life: 4300, burst: 150, colors: ["#ffd36b", "#fff3c8", "#f0b13d", "#ffffff"] },
    mythic: { build: 650, life: 5300, burst: 220, colors: null }, // null — все цвета радуги
    divine: { build: 1250, life: 7200, burst: 280, colors: ["#ffffff", "#fff8e1", "#ffe7a8", "#f6d27a"] },
  };
  function cinematic(t, canvas, title, collection) {
    return new Promise(res => {
      const cfg = CINE[t.id];
      const el = document.createElement("div");
      el.className = `cine c-${t.id}`;
      el.innerHTML = `<canvas class="fx"></canvas><div class="rays"></div><div class="beam"></div><div class="ring"></div><div class="ring r2"></div>
        <div class="stage"><div class="card"><img alt=""></div>
          <div class="ttl"><b>${[...t.name.toUpperCase()].map((ch, i) => `<i style="--i:${i}">${ch}</i>`).join("")}</b>
            <span>шанс ${odds(t.id)} · ${esc(collection)}</span><em>«${esc(title)}»</em></div></div>
        <div class="flash"></div><div class="tap">нажми, чтобы продолжить</div>`;
      el.querySelector("img").src = canvas.toDataURL("image/jpeg", 0.92);
      document.body.append(el);
      const scroll = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";

      const fx = sparks(el.querySelector(".fx"), cfg);
      const timers = [], at = (ms, f) => timers.push(setTimeout(f, ms));
      requestAnimationFrame(() => el.classList.add("on"));
      fx.charge(cfg.build);
      if (t.id === "divine") SFX.divine(); // у божественного звук нарастает вместе с лучом
      at(cfg.build, () => { el.classList.add("boom"); fx.burst(cfg.burst); if (t.id !== "divine") SFX[t.id](); });
      at(cfg.build + 1400, () => el.classList.add("idle"));

      let closed = false;
      const t0 = performance.now();
      const close = () => {
        if (closed || performance.now() - t0 < 600) return; // случайный двойной клик не пропускает всё сразу
        closed = true; closeCine = null;
        timers.forEach(clearTimeout); el.classList.add("out");
        setTimeout(() => { fx.stop(); el.remove(); document.documentElement.style.overflow = scroll; res(); }, 450);
      };
      closeCine = close;
      el.addEventListener("click", close);
      at(cfg.life, close);
    });
  }

  // искры на холсте: втягиваются к центру перед вспышкой, разлетаются взрывом и потом поднимаются снизу
  function sparks(cv, cfg) {
    const dpr = Math.min(2, devicePixelRatio || 1), ctx = cv.getContext("2d");
    let W, H, cx, cy;
    const fit = () => { W = cv.width = innerWidth * dpr; H = cv.height = innerHeight * dpr; cx = W / 2; cy = H * 0.45; };
    fit(); addEventListener("resize", fit);
    const list = [], add = p => { if (list.length < 900) list.push(p); };
    const color = () => cfg.colors ? cfg.colors[Math.floor(Math.random() * cfg.colors.length)] : `hsl(${Math.floor(Math.random() * 360)},100%,72%)`;
    let chargeUntil = 0, ambient = false, raf = 0;

    function star(x, y, r) {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * 0.25 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      ctx.fill();
    }
    function frame(now) {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      if (now < chargeUntil) for (let k = 0; k < 6; k++) {
        const a = Math.random() * Math.PI * 2, r = Math.max(W, H) * (0.3 + Math.random() * 0.25);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        add({ x, y, vx: (cx - x) / 36, vy: (cy - y) / 36, life: 36, max: 36, size: (1 + Math.random() * 2) * dpr, c: color() });
      }
      if (ambient && Math.random() < 0.7) add({
        x: Math.random() * W, y: H + 10, vx: (Math.random() - 0.5) * 0.5 * dpr, vy: -(0.6 + Math.random() * 1.8) * dpr,
        life: 260, max: 260, size: (1 + Math.random() * 2.4) * dpr, c: color(), star: Math.random() < 0.3, tw: Math.random() * 6,
      });
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.x += p.vx; p.y += p.vy;
        if (p.g) { p.vy += p.g; p.vx *= 0.985; p.vy *= 0.985; }
        if (--p.life <= 0) { list.splice(i, 1); continue; }
        const a = Math.min(1, p.life / p.max * 1.6) * (p.tw === undefined ? 1 : 0.55 + 0.45 * Math.sin(now / 180 + p.tw));
        ctx.fillStyle = p.c;
        if (p.star) { ctx.globalAlpha = a; star(p.x, p.y, p.size * 3.2); }
        else {
          ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
          ctx.globalAlpha = a * 0.22; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 3.2, 0, 7); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return {
      charge(ms) { chargeUntil = performance.now() + ms; },
      burst(n) {
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2, v = (3 + Math.random() * 13) * dpr;
          add({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2 * dpr, g: 0.12 * dpr, life: 70 + Math.random() * 80, max: 150,
                size: (1.4 + Math.random() * 2.6) * dpr, c: color(), star: Math.random() < 0.35 });
        }
        ambient = true;
      },
      stop() { cancelAnimationFrame(raf); removeEventListener("resize", fit); },
    };
  }

  return { begin, finish, skip, odds, byName, toggle, TIERS, BIG, get on() { return opt.roll; }, get sound() { return opt.sound; } };
})();
