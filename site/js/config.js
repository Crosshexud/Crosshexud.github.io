// Настройки сайта. Для открытой версии pack.js записывает сюда public: true.
window.KIR_CONFIG = {
  public: false, // true — открытый сайт: только галерея, без генератора и создания NFT
  author: '62vdChKaBEvtCDXLHzuT6M7pgs3RUW8AXet7VLT8EJJB', // кошелёк автора: по нему галерея находит коллекцию «КИР»
  auctionProgram: 'HmsxX4gHaGzr8eWTPVXNYYN5Ye5RFRWW6VtuwTD8WP6', // программа аукциона в Solana (auction/program)
  // сеть: 'devnet' — тестовая (монеты ненастоящие), 'mainnet-beta' — настоящие деньги (см. auction/MAINNET.md)
  cluster: 'devnet',
  // свой адрес RPC (для mainnet лучше бесплатный ключ Helius/QuickNode — публичный узел медленный и с лимитами)
  rpc: null,
};
