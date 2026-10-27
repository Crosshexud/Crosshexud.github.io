// Передача работы из генератора ремиксов в мастерскую NFT (через IndexedDB — картинка слишком большая для localStorage)
window.KIRPending = (() => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('kir', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('pending');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const run = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const tx = db.transaction('pending', mode), req = fn(tx.objectStore('pending'));
    tx.oncomplete = () => res(req.result);
    tx.onerror = () => rej(tx.error);
  }));
  return {
    put: work => run('readwrite', s => s.put(work, 'work')),
    // забирает работу и сразу стирает, чтобы она не всплывала повторно
    take: async () => {
      try {
        const w = await run('readonly', s => s.get('work'));
        if (w) await run('readwrite', s => s.delete('work'));
        return w || null;
      } catch { return null; }
    },
  };
})();
