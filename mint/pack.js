// Собирает папку ../dist — ОТКРЫТУЮ версию сайта для Cloudflare Pages.
// В неё попадает только галерея: без генератора, без картин автора (art.js) и без создания NFT.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

fs.rmSync(DIST, { recursive: true, force: true });
const copy = (from, to) => fs.cpSync(path.join(ROOT, from), path.join(DIST, to), { recursive: true });

copy('site/gallery.html', 'index.html'); // главная = галерея
copy('site/gallery.html', 'site/gallery.html');
copy('site/css', 'site/css');
for (const f of ['kir-mint.js', 'ui.js']) copy('site/js/' + f, 'site/js/' + f);

// настройки: включаем открытый режим
const cfg = fs.readFileSync(path.join(ROOT, 'site/js/config.js'), 'utf8').replace(/public:\s*false/, 'public: true');
if (!/public: true/.test(cfg)) throw new Error('не удалось включить public в config.js');
fs.writeFileSync(path.join(DIST, 'site/js/config.js'), cfg);

// старые ссылки на генератор и создание ведут на галерею
fs.writeFileSync(path.join(DIST, '_redirects'), '/remix/* / 302\n/site/index.html / 302\n');

// проверка: ничего лишнего не утекло
const files = [];
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  const p = path.join(d, e.name);
  e.isDirectory() ? walk(p) : files.push(p);
});
walk(DIST);
const leak = files.filter(p => /art\.js$|\.jpe?g$|remix|pending\.js/i.test(path.relative(DIST, p)));
if (leak.length) throw new Error('В открытую версию попали лишние файлы: ' + leak.join(', '));

let size = 0;
for (const p of files) { size += fs.statSync(p).size; console.log(' ', path.relative(DIST, p)); }
console.log(`Готово: ${DIST} (${(size / 1048576).toFixed(1)} МБ)`);
