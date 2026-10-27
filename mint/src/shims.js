// библиотеки Irys писались под Node.js — подкладываем им Buffer и process в браузере
import { Buffer } from 'buffer';
export { Buffer };
export const process = { env: {}, browser: true, version: '', versions: {}, nextTick: (f, ...a) => queueMicrotask(() => f(...a)) };
