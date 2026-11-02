// «Запекает» готовые работы КИР («Ван Гог», «Моди»): remix/works/vg-*.webp, modi-*.webp + превью в t/ + записи в index.json.
// Открытый генератор на сайте показывает только их — оригиналы картин туда не попадают. Работы других серий не трогает
// (их делает bake-photo.js). Самых редких добирает сверх числа — как bake-photo.js, чтобы на сайте их тоже можно было выбить.
// Нужен запущенный server.js (дома, с remix/art.js) и Chrome.  Запуск: node bake.js [сколько, по умолч. 1000]
const fs = require('fs');
const path = require('path');
const puppeteer = require('C:/Users/cross/claude-ad/node_modules/puppeteer-core');

const COUNT = Number(process.argv[2]) || 1000;
const OUT = path.resolve(__dirname, '../remix/works');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);

const Q = 0.6, QT = 0.65; // качество WebP: работа и превью (0.6 на глаз не отличить от 0.8, а весит почти вдвое меньше)
const MIN = { mythic: 3, divine: 2 }; // сколько самых редких должно быть в каждой серии как минимум

// одни и те же зёрна при каждом запуске
let a = 20251027;
const rand = () => { a = (a * 1103515245 + 12345) % 2147483648; return a; };

(async () => {
  const mine = f => f.startsWith('vg-') || f.startsWith('modi-');
  fs.mkdirSync(path.join(OUT, 't'), { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (mine(f)) fs.rmSync(path.join(OUT, f));
  for (const f of fs.readdirSync(path.join(OUT, 't'))) if (mine(f)) fs.rmSync(path.join(OUT, 't', f));
  const index = path.join(OUT, 'index.json');
  const others = fs.existsSync(index) ? JSON.parse(fs.readFileSync(index, 'utf8')).filter(w => w.s !== 'vg' && w.s !== 'modi') : [];
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:8080/remix/index.html', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => typeof current !== 'undefined' && current && typeof ART !== 'undefined');

  // зёрна: те же, что и раньше (через одну «Ван Гог» и «Моди»), плюс добор самых редких
  const used = new Set(), jobs = [];
  const next = s => { let seed; do seed = rand() % 1e9; while (used.has(s + seed)); used.add(s + seed); return seed; };
  for (let i = 0; i < COUNT; i++) { const s = i % 2 ? 'modi' : 'vg'; jobs.push([s, next(s)]); }
  const tiersOf = seeds => page.evaluate(seeds => seeds.map(kirRarity), seeds);
  for (const s of ['vg', 'modi']) {
    const have = await tiersOf(jobs.filter(j => j[0] === s).map(j => j[1]));
    for (const [id, min] of Object.entries(MIN)) {
      let n = have.filter(r => r === id).length;
      while (n < min) {
        const batch = Array.from({ length: 2000 }, () => next(s)), tiers = await tiersOf(batch);
        batch.forEach((seed, k) => { if (tiers[k] === id && n < min) { jobs.push([s, seed]); n++; } });
      }
    }
  }

  const list = [];
  for (let i = 0; i < jobs.length; i++) {
    const [s, seed] = jobs[i];
    const w = await page.evaluate((s, seed, Q, QT) => {
      window.NO_REVEAL = true; series = s; draw(seed);
      const t = document.createElement('canvas'); t.width = 300; t.height = 400;
      const x = t.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(canvas, 0, 0, 300, 400);
      return { ...current, data: canvas.toDataURL('image/webp', Q), thumb: t.toDataURL('image/webp', QT) };
    }, s, seed, Q, QT);
    fs.writeFileSync(path.join(OUT, `${s}-${seed}.webp`), Buffer.from(w.data.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, 't', `${s}-${seed}.webp`), Buffer.from(w.thumb.split(',')[1], 'base64'));
    list.push({ s, seed, title: w.title, tech: w.tech, rarity: w.rarity });
    if ((i + 1) % 100 === 0) console.log(`${i + 1} / ${jobs.length}`);
  }
  fs.writeFileSync(index, JSON.stringify([...list, ...others]));
  await browser.close();
  const mb = list.reduce((n, w) => n + fs.statSync(path.join(OUT, `${w.s}-${w.seed}.webp`)).size, 0) / 1048576;
  const rar = {}; list.forEach(w => { rar[w.rarity] = (rar[w.rarity] || 0) + 1; });
  console.log(`Готово: ${list.length} работ КИР в remix/works (${mb.toFixed(0)} МБ)`, rar);
})();
