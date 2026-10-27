// Общие части всех страниц: шапка, нижнее меню, кнопка кошелька, всплывающие сообщения.
// Страница ставит <body data-page="home|create|remix|gallery"> и подключает kir-mint.js перед этим файлом.
window.KIRUI = (() => {
  const ICONS = {
    auction: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 3.5l6 6M12 6l6 6M10.5 7.5l6 6-3 3-6-6zM9 15l-6 6M3 21h9"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/></svg>',
    create: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/><rect x="3" y="3" width="18" height="18" rx="4"/></svg>',
    remix: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4z"/></svg>',
    gallery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  };
  const PUBLIC = !!window.KIR_CONFIG?.public;
  // на открытом сайте генератора и создания нет — только галерея
  const PAGES = PUBLIC ? [{ id: 'gallery', href: '/', label: 'Галерея' }] : [
    { id: 'home', href: '/', label: 'Главная' },
    { id: 'remix', href: '/remix/', label: 'Генератор' },
    { id: 'create', href: '/site/index.html', label: 'Создать NFT' },
    { id: 'gallery', href: '/site/gallery.html', label: 'Галерея' },
    { id: 'auction', href: '/site/auction.html', label: 'Аукцион' },
  ];
  const page = document.body.dataset.page;
  const short = a => a.slice(0, 4) + '…' + a.slice(-4);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // ---------- шапка и меню ----------
  const top = document.createElement('header');
  top.className = 'top';
  top.innerHTML = `
    <a class="logo" href="/">К<span>И</span>Р</a>
    <nav>${PAGES.map(p => `<a href="${p.href}" class="${p.id === page ? 'on' : ''}">${p.label}</a>`).join('')}</nav>
    <span class="spacer"></span>
    ${(window.KIR_CONFIG?.cluster || "devnet") === "devnet" ? '<span class="net" title="Тестовая сеть: монеты ненастоящие">Devnet</span>' : ''}
    <button class="wallet" id="kir-wallet"><span class="dot"></span><span class="lbl">Кошелёк</span></button>`;
  document.body.prepend(top);

  const tabs = document.createElement('nav');
  tabs.className = 'tabs';
  tabs.innerHTML = PAGES.map(p => `<a href="${p.href}" class="${p.id === page ? 'on' : ''}">${ICONS[p.id]}<span>${p.label}</span></a>`).join('');
  if (PUBLIC) document.body.classList.add('public'); // одна вкладка — нижнее меню не нужно
  else document.body.append(tabs);

  // подвал (на странице генератора не нужен — там всё в один экран)
  if (page !== 'remix') {
    const foot = document.createElement('footer');
    foot.className = 'foot';
    foot.innerHTML = `<div class="wrap">
      <a class="logo" href="/">К<span>И</span>Р</a>
      <nav>${PAGES.map(p => `<a href="${p.href}">${p.label}</a>`).join('')}</nav>
      <p>Новые работы из картин автора · Solana · ${new Date().getFullYear()}</p></div>`;
    document.body.append(foot);
  }

  // плавное появление блоков с классом .rv при прокрутке
  if ('IntersectionObserver' in window) {
    document.documentElement.classList.add('rv-on');
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px' });
    const watch = () => document.querySelectorAll('.rv:not(.in)').forEach(el => io.observe(el));
    watch();
    new MutationObserver(watch).observe(document.body, { childList: true, subtree: true });
  }

  const toastBox = document.createElement('div');
  toastBox.className = 'toasts';
  document.body.append(toastBox);

  function toast(text, kind = '', ms = 4500) {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.innerHTML = text;
    toastBox.append(t);
    setTimeout(() => t.remove(), ms);
  }

  // ---------- кошелёк ----------
  const btn = top.querySelector('#kir-wallet');
  async function paint(owner) {
    btn.classList.toggle('on', !!owner);
    const lbl = btn.querySelector('.lbl');
    if (!owner) { lbl.innerHTML = 'Подключить'; return; }
    lbl.innerHTML = `${short(owner)}`;
    try {
      const sol = await KIRMint.balance();
      lbl.innerHTML = `${short(owner)} <span class="bal">${sol.toFixed(2)} SOL</span>`;
    } catch {}
  }
  async function connect() {
    if (!window.phantom?.solana) {
      if (isMobile()) { // на телефоне Phantom живёт в своём приложении — открываем сайт внутри него
        location.href = `https://phantom.app/ul/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`;
        return null;
      }
      toast('Phantom не найден в этом браузере. Установи его с <a href="https://phantom.com/download" target="_blank">phantom.com</a>.', 'err', 8000);
      return null;
    }
    try { return await KIRMint.connect(); }
    catch (e) { toast('Подключение отменено', 'err'); return null; }
  }
  btn.onclick = async () => {
    if (!KIRMint.owner) return connect();
    // меню подключённого кошелька
    const choice = await sheet(`
      <div><h3 style="font-size:24px;margin-bottom:6px">Кошелёк</h3>
      <p class="mono muted" style="margin:0 0 16px">${KIRMint.owner}</p>
      <div class="btns" style="flex-direction:column">
        <button class="btn" data-v="copy">Скопировать адрес</button>
        <a class="btn" href="${KIRMint.explorer(KIRMint.owner)}" target="_blank">Открыть в блокчейне</a>
        <a class="btn" href="https://faucet.solana.com/" target="_blank">Получить тестовые SOL</a>
        <button class="btn ghost" data-v="off">Отключить</button>
      </div></div>`);
    if (choice === 'copy') { try { await navigator.clipboard.writeText(KIRMint.owner); toast('Адрес скопирован', 'ok'); } catch {} }
    if (choice === 'off') { await KIRMint.disconnect(); toast('Кошелёк отключён'); }
  };
  KIRMint.onChange(paint);
  paint(null);
  const ready = KIRMint.autoConnect();

  // ---------- окно-лист: возвращает data-v нажатой кнопки ----------
  // setup(box) — подготовить поля окна; тогда ответ { v, box }, чтобы прочитать введённое после закрытия
  function sheet(html, cls = '', setup = null) {
    return new Promise(res => {
      const bg = document.createElement('div');
      bg.className = 'sheet-bg open';
      bg.innerHTML = `<div class="sheet ${cls}"><div class="grab"></div>${html}</div>`;
      const close = v => { bg.remove(); document.removeEventListener('keydown', onKey); res(setup ? { v, box: bg } : v); };
      const onKey = e => { if (e.key === 'Escape') close(null); };
      bg.onclick = e => {
        if (e.target === bg) return close(null);
        const b = e.target.closest('[data-v]');
        if (b) close(b.dataset.v);
      };
      document.addEventListener('keydown', onKey);
      document.body.append(bg);
      if (setup) setup(bg);
    });
  }

  return { toast, sheet, connect, short, esc, ready, PUBLIC, refresh: () => paint(KIRMint.owner) };
})();
