// «Запекает» готовые работы генератора: remix/works/*.webp + remix/works/index.json.
// Открытый генератор на сайте показывает только их — оригиналы картин туда не попадают.
// Нужен запущенный server.js (дома, с remix/art.js) и Chrome.  Запуск: node bake.js [сколько, по умолч. 1000]
const fs = require('fs');
const path = require('path');
const puppeteer = require('C:/Users/cross/claude-ad/node_modules/puppeteer-core');

const COUNT = Number(process.argv[2]) || 1000;
const OUT = path.resolve(__dirname, '../remix/works');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);

// одни и те же зёрна при каждом запуске
let a = 20251027;
const rand = () => { a = (a * 1103515245 + 12345) % 2147483648; return a; };

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:8080/remix/index.html', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => typeof current !== 'undefined' && current && typeof ART !== 'undefined');

  const list = [], used = new Set();
  for (let i = 0; i < COUNT; i++) {
    const s = i % 2 ? 'modi' : 'vg';
    let seed; do seed = rand() % 1e9; while (used.has(s + seed)); used.add(s + seed);
    const w = await page.evaluate((s, seed) => {
      window.NO_REVEAL = true; series = s; draw(seed);
      return { ...current, data: canvas.toDataURL('image/webp', 0.75) };
    }, s, seed);
    fs.writeFileSync(path.join(OUT, `${s}-${seed}.webp`), Buffer.from(w.data.split(',')[1], 'base64'));
    list.push({ s, seed, title: w.title, tech: w.tech });
    if ((i + 1) % 100 === 0) console.log(`${i + 1} / ${COUNT}`);
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(list));
  await browser.close();
  const mb = fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0) / 1048576;
  console.log(`Готово: ${COUNT} работ в remix/works (${mb.toFixed(0)} МБ)`);
})();
