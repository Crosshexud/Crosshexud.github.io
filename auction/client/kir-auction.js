// Клиент программы аукциона «КИР» (версия 2): собирает команды для блокчейна и читает лоты и ставки.
// Не импортирует библиотеки сам — получает @solana/web3.js снаружи, чтобы им пользовались и сайт, и тесты.
// Формат совпадает с auction/program/src/lib.rs.

export const CORE_ID = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
export const AUCTION_SIZE = 342;
export const BID_SIZE = 82;
export const MAX_CREATORS = 5;
export const LAMPORTS = 1_000_000_000;
// первый байт счетов (AUCTION_KEY = 3, BID_KEY = 4) в base58 — для фильтра getProgramAccounts
const KEY_B58 = { auction: '4', bid: '5' };

// коды ошибок программы → понятный текст
export const ERRORS = {
  6000: 'Это не NFT Metaplex Core',
  6001: 'NFT принадлежит не тебе',
  6002: 'Неверная коллекция',
  6003: 'Неверные параметры торгов',
  6004: 'Торги уже закончились',
  6005: 'Торги ещё идут',
  6006: 'Ставка слишком мала — кто-то уже поставил больше, обнови страницу',
  6007: 'Продавец не может делать ставки на свой лот',
  6008: 'Неверный счёт ставки',
  6009: 'Неверный победитель',
  6010: 'На лот уже есть ставки — снять нельзя',
  6011: 'Это не лот аукциона КИР',
  6012: 'Сначала забери свою ставку с прошлых торгов этого NFT',
  6013: 'Ты лидер торгов — ставку можно забрать, только если тебя перебьют',
  6014: 'Этот NFT нельзя выставить: у него плагины, которые позволяют забрать его с аукциона',
  6015: 'Неверный список авторов роялти',
};

export function makeAuction(web3, programId) {
  const { PublicKey, TransactionInstruction, SystemProgram } = web3;
  const PID = new PublicKey(programId);
  const CORE = new PublicKey(CORE_ID);
  const NONE = new PublicKey(new Uint8Array(32));
  const key = k => (k instanceof PublicKey ? k : new PublicKey(k));

  const u64 = n => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
  const i64 = n => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(n), true); return b; };
  const bytes = (...parts) => Buffer.from(parts.flatMap(p => [...p]));
  const meta = (pubkey, isSigner, isWritable) => ({ pubkey: key(pubkey), isSigner, isWritable });
  const enc = s => new TextEncoder().encode(s);

  const pda = asset => PublicKey.findProgramAddressSync([enc('auction'), key(asset).toBytes()], PID)[0];
  const bidPda = (auction, bidder) => PublicKey.findProgramAddressSync([enc('bid'), key(auction).toBytes(), key(bidder).toBytes()], PID)[0];

  const view = data => {
    const d = data instanceof Uint8Array ? data : new Uint8Array(data);
    return [d, new DataView(d.buffer, d.byteOffset, d.byteLength), o => new PublicKey(d.slice(o, o + 32))];
  };

  function decode(address, data) {
    const [d, v, pk] = view(data);
    const collection = pk(65);
    const highest = pk(129);
    const creators = [];
    for (let i = 0; i < Math.min(d[176], MAX_CREATORS); i++) creators.push({ address: pk(177 + i * 33), percentage: d[209 + i * 33] });
    return {
      address: key(address),
      seller: pk(1), asset: pk(33), collection: collection.equals(NONE) ? null : collection,
      minBid: v.getBigUint64(97, true), minIncrement: v.getBigUint64(105, true),
      startTs: Number(v.getBigInt64(113, true)), endTs: Number(v.getBigInt64(121, true)),
      // null — победителя нет (ставок не было или победитель забрал ставку по страховке)
      highestBidder: highest.equals(NONE) ? null : highest,
      highestBid: v.getBigUint64(161, true), bidCount: v.getUint32(169, true), bump: d[173],
      royaltyBps: v.getUint16(174, true), creators,
    };
  }

  function decodeBid(address, data) {
    const [d, v, pk] = view(data);
    return { address: key(address), auction: pk(1), bidder: pk(33), auctionStart: Number(v.getBigInt64(65, true)), amount: v.getBigUint64(73, true), bump: d[81] };
  }

  // сколько минимум можно поставить сейчас (в лампортах)
  const nextMin = a => (a.highestBidder ? a.highestBid + a.minIncrement : a.minBid);

  return {
    PID, pda, bidPda, decode, decodeBid, nextMin,

    create({ seller, asset, collection, minBid, minIncrement, duration }) {
      return new TransactionInstruction({
        programId: PID,
        keys: [meta(seller, true, true), meta(pda(asset), false, true), meta(asset, false, true),
               meta(collection || CORE, false, false), meta(CORE, false, false), meta(SystemProgram.programId, false, false)],
        data: bytes([0], u64(minBid), u64(minIncrement), i64(duration)),
      });
    },

    // amount — вся новая сумма ставки (программа сама доплатит разницу к уже поставленному)
    bid({ bidder, auction, amount }) {
      const lot = key(auction.address || auction);
      return new TransactionInstruction({
        programId: PID,
        keys: [meta(bidder, true, true), meta(lot, false, true), meta(bidPda(lot, bidder), false, true),
               meta(SystemProgram.programId, false, false)],
        data: bytes([1], u64(amount)),
      });
    },

    settle({ payer, auction }) {
      const a = auction;
      const winner = a.highestBidder || a.seller;
      const winnerBid = a.highestBidder ? bidPda(a.address, a.highestBidder) : a.seller;
      const creators = a.highestBidder && a.royaltyBps > 0 ? a.creators.map(c => meta(c.address, false, true)) : [];
      return new TransactionInstruction({
        programId: PID,
        keys: [meta(payer, true, true), meta(a.address, false, true), meta(a.asset, false, true),
               meta(a.collection || CORE, false, false), meta(a.seller, false, true),
               meta(winner, false, true), meta(winnerBid, false, true), meta(CORE, false, false),
               meta(SystemProgram.programId, false, false), ...creators],
        data: bytes([2]),
      });
    },

    cancel({ seller, auction }) {
      return new TransactionInstruction({
        programId: PID,
        keys: [meta(seller, true, true), meta(auction.address, false, true), meta(auction.asset, false, true),
               meta(auction.collection || CORE, false, false), meta(CORE, false, false), meta(SystemProgram.programId, false, false)],
        data: bytes([3]),
      });
    },

    // забрать свою ставку (перебили, лот закрыт или страховка через 7 дней)
    withdraw({ bidder, auction }) {
      const lot = key(auction.address || auction);
      return new TransactionInstruction({
        programId: PID,
        keys: [meta(bidder, true, true), meta(lot, false, true), meta(bidPda(lot, bidder), false, true)],
        data: bytes([4]),
      });
    },

    async fetchOne(connection, address) {
      const acc = await connection.getAccountInfo(key(address));
      return acc && acc.owner.equals(PID) && acc.data.length === AUCTION_SIZE ? decode(address, acc.data) : null;
    },

    // все идущие и завершившиеся (но ещё не закрытые) лоты
    async fetchAll(connection) {
      const list = await connection.getProgramAccounts(PID, { filters: [{ dataSize: AUCTION_SIZE }, { memcmp: { offset: 0, bytes: KEY_B58.auction } }] });
      return list.map(a => decode(a.pubkey, a.account.data));
    },

    // все ставки участника (в т.ч. перебитые и на закрытых лотах — их можно забрать)
    async fetchBids(connection, bidder) {
      const list = await connection.getProgramAccounts(PID, { filters: [
        { dataSize: BID_SIZE }, { memcmp: { offset: 0, bytes: KEY_B58.bid } }, { memcmp: { offset: 33, bytes: key(bidder).toBase58() } },
      ] });
      return list.map(a => decodeBid(a.pubkey, a.account.data));
    },
  };
}

// текст ошибки программы из исключения web3.js (если код наш)
export function explainError(e) {
  const m = String(e?.message || e) + ' ' + (e?.logs || []).join(' ');
  const hex = m.match(/custom program error: 0x([0-9a-f]+)/i);
  if (hex && ERRORS[parseInt(hex[1], 16)]) return ERRORS[parseInt(hex[1], 16)];
  if (/insufficient (funds|lamports)/i.test(m)) return 'Не хватает SOL на кошельке';
  if (/User rejected|rejected the request/i.test(m)) return 'Отменено в кошельке';
  return null;
}
