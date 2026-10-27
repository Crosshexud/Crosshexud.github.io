// Маленькие копии готовых работ (300×400) для главной и галереи: remix/works/t/*.webp
// Нужен запущенный server.js и Chrome.  Запуск: node thumbs.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('C:/Users/cross/claude-ad/node_modules/puppeteer-core');

const DIR = path.resolve(__dirname, '../remix/works');
const OUT = path.join(DIR, 't');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const list = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:8080/remix/works/index.json');
  for (let i = 0; i < list.length; i += 20) {
    const names = list.slice(i, i + 20).map(w => `${w.s}-${w.seed}.webp`);
    const out = await page.evaluate(names => Promise.all(names.map(n => new Promise(res => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas'); c.width = 300; c.height = 400;
        const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, 300, 400);
        res(c.toDataURL('image/webp', 0.72));
      };
      im.src = '/remix/works/' + n;
    }))), names);
    names.forEach((n, k) => fs.writeFileSync(path.join(OUT, n), Buffer.from(out[k].split(',')[1], 'base64')));
  }
  await browser.close();
  const mb = fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0) / 1048576;
  console.log(`Готово: ${list.length} превью (${mb.toFixed(1)} МБ)`);
})();
