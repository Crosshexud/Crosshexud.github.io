// Шифрует картины автора (remix/art.js) паролем → remix/art.enc.json.
// Зашифрованный файл можно выкладывать куда угодно: без пароля из него картины не достать.
// Запуск: node lock.js "пароль"   (пароль нигде не сохраняется)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const pass = process.argv[2];
if (!pass || pass.length < 8) throw new Error('Укажи пароль (не короче 8 символов): node lock.js "пароль"');

const ROOT = path.resolve(__dirname, '..');
const ART = vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'remix/art.js'), 'utf8') + ';ART');

// ключ из пароля (PBKDF2, 600 000 повторов — подбор пароля очень медленный), шифр AES-256-GCM
const ITER = 600000;
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(pass, salt, ITER, 32, 'sha256');
const c = crypto.createCipheriv('aes-256-gcm', key, iv);
const data = Buffer.concat([c.update(JSON.stringify(ART), 'utf8'), c.final(), c.getAuthTag()]); // как в WebCrypto: метка в конце

const out = { v: 1, iter: ITER, salt: salt.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64') };
fs.writeFileSync(path.join(ROOT, 'remix/art.enc.json'), JSON.stringify(out));

// проверка: расшифровывается обратно
const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
d.setAuthTag(data.subarray(-16));
const back = Buffer.concat([d.update(data.subarray(0, -16)), d.final()]).toString('utf8');
if (back !== JSON.stringify(ART)) throw new Error('проверка расшифровки не прошла');
console.log(`Готово: remix/art.enc.json (${Object.keys(ART).length} картин, ${(data.length / 1048576).toFixed(1)} МБ)`);
