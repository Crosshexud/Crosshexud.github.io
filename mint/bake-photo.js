// Готовые работы серий с редкостью («Богомол», «Хом», «Шумеры») для сайта: remix/works/<серия>-*.webp + превью в t/,
// дописывает их в remix/works/index.json (старые работы этой серии оттуда убираются, остальные не трогаются).
// Самых редких добирает сверх числа, чтобы на сайте их тоже можно было выбить: генератор сначала выбирает редкость
// с честными шансами, а потом — готовую работу этой редкости.
// Нужен запущенный server.js, фото (bogomol/src, hom/src) и Chrome.  Запуск: node bake-photo.js bogomol|hom|shumer [сколько, по умолч. 500]
const fs = require('fs');
const path = require('path');
const puppeteer = require('C:/Users/cross/claude-ad/node_modules/puppeteer-core');

const S = process.argv[2];
if (!['bogomol', 'hom', 'shumer'].includes(S)) { console.log('Укажи серию: bogomol, hom или shumer'); process.exit(1); }
const COUNT = Number(process.argv[3]) || 500;
const OUT = path.resolve(__dirname, '../remix/works');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);

// одни и те же зёрна при каждом запуске
let a = { bogomol: 20261103, hom: 20261104, shumer: 20261105 }[S];
const rand = () => { a = (a * 1103515245 + 12345) % 2147483648; return a; };
const MIN = { mythic: 3, divine: 2 }; // сколько самых редких должно быть в наборе как минимум
const Q = 0.6, QT = 0.65; // качество WebP: работа и превью (0.6 на глаз не отличить от 0.8, а весит почти вдвое меньше)

(async () => {
  for (const f of fs.readdirSync(OUT)) if (f.startsWith(S + '-')) fs.rmSync(path.join(OUT, f));
  for (const f of fs.readdirSync(path.join(OUT, 't'))) if (f.startsWith(S + '-')) fs.rmSync(path.join(OUT, 't', f));
  const old = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8')).filter(w => w.s !== S);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('Ошибка на странице:', e.message));
  await page.goto('http://localhost:8080/remix/index.html', { waitUntil: 'networkidle0' });
  await page.waitForFunction(S => typeof current !== 'undefined' && current && LIVE[S], {}, S);

  const used = new Set(), seeds = [];
  const next = () => { let s; do s = rand() % 1e9; while (used.has(s)); used.add(s); return s; };
  const tiersOf = list => page.evaluate((list, S) => list.map(s => PHOTO[S].E().randomWork(s).rarity), list, S);
  for (let i = 0; i < COUNT; i++) seeds.push(next());
  const have = await tiersOf(seeds);
  for (const [id, min] of Object.entries(MIN)) {
    let n = have.filter(r => r === id).length;
    while (n < min) {
      const batch = Array.from({ length: 2000 }, next), tiers = await tiersOf(batch);
      batch.forEach((s, k) => { if (tiers[k] === id && n < min) { seeds.push(s); n++; } });
    }
  }

  const list = [];
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const w = await page.evaluate((seed, S, Q, QT) => {
      window.NO_REVEAL = true; series = S; draw(seed);
      const t = document.createElement('canvas'); t.width = 300; t.height = 400;
      const x = t.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(canvas, 0, 0, 300, 400);
      return { ...current, data: canvas.toDataURL('image/webp', Q), thumb: t.toDataURL('image/webp', QT) };
    }, seed, S, Q, QT);
    fs.writeFileSync(path.join(OUT, `${S}-${seed}.webp`), Buffer.from(w.data.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, 't', `${S}-${seed}.webp`), Buffer.from(w.thumb.split(',')[1], 'base64'));
    list.push({ s: S, seed, title: w.title, tech: w.tech, palette: w.palette, rarity: w.rarity, ...(w.form && { form: w.form, stone: w.stone }) });
    if ((i + 1) % 50 === 0) console.log(`${i + 1} / ${seeds.length}`);
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify([...old, ...list]));
  await browser.close();
  const mb = list.reduce((n, w) => n + fs.statSync(path.join(OUT, `${S}-${w.seed}.webp`)).size, 0) / 1048576;
  const tech = {}, rar = {};
  list.forEach(w => { tech[w.tech] = (tech[w.tech] || 0) + 1; rar[w.rarity] = (rar[w.rarity] || 0) + 1; });
  console.log(`Готово: ${list.length} работ серии ${S} (${mb.toFixed(0)} МБ)`, tech, rar);
})();
