// Домашний сервер: отдаёт папку avangard-nft на http://localhost:8080
// (Phantom не подключается к страницам, открытым прямо из файла).
// `node server.js --lan` — открыть сайт и для телефона в той же Wi-Fi сети.
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8080;
const LAN = process.argv.includes('--lan');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/site/home.html';
  let file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || file.includes('node_modules')) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('нет такой страницы'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Сайт КИР: http://localhost:${PORT}`);
  if (!LAN) return;
  // адреса компьютера в домашней сети — их открывать на телефоне
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list) if (a.family === 'IPv4' && !a.internal) console.log(`С телефона (та же Wi-Fi): http://${a.address}:${PORT}`);
});
