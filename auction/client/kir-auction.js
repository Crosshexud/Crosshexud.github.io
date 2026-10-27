// Клиент программы аукциона «КИР»: собирает команды для блокчейна и читает лоты.
// Не импортирует библиотеки сам — получает @solana/web3.js снаружи, чтобы им пользовались и сайт, и тесты.
// Формат совпадает с auction/program/src/lib.rs.

export const CORE_ID = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
export const AUCTION_SIZE = 174;
export const LAMPORTS = 1_000_000_000;

// коды ошибок программы → понятный текст
export const ERRORS = {
  6000: 'Это не NFT Metaplex Core',
  6001: 'NFT принадлежит не тебе',
  6002: 'Неверная коллекция',
  6003: 'Неверные параметры торгов',
  6004: 'Торги уже закончились',
  6005: 'Торги ещё идут',
  6006: 'Ставка слишком мала',
  6007: 'Продавец не может делать ставки на свой лот',
  6008: 'Кто-то уже перебил ставку — обнови страницу',
  6009: 'Неверный победитель',
  6010: 'На лот уже есть ставки — снять нельзя',
  6011: 'Это не лот аукциона КИР',
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

  const pda = asset => PublicKey.findProgramAddressSync([new TextEncoder().encode('auction'), key(asset).toBytes()], PID)[0];

  function decode(address, data) {
    const d = data instanceof Uint8Array ? data : new Uint8Array(data);
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const pk = o => new PublicKey(d.slice(o, o + 32));
    const collection = pk(65);
    return {
      address: key(address),
      seller: pk(1), asset: pk(33), collection: collection.equals(NONE) ? null : collection,
      minBid: v.getBigUint64(97, true), minIncrement: v.getBigUint64(105, true),
      startTs: Number(v.getBigInt64(113, true)), endTs: Number(v.getBigInt64(121, true)),
      highestBidder: v.getUint32(169, true) ? pk(129) : null,
      highestBid: v.getBigUint64(161, true), bidCount: v.getUint32(169, true), bump: d[173],
    };
  }

  // сколько минимум можно поставить сейчас (в лампортах)
  const nextMin = a => (a.bidCount ? a.highestBid + a.minIncrement : a.minBid);

  return {
    PID, pda, decode, nextMin,

    create({ seller, asset, collection, minBid, minIncrement, duration }) {
      return new TransactionInstruction({
        programId: PID,
        keys: [meta(seller, true, true), meta(pda(asset), false, true), meta(asset, false, true),
               meta(collection || CORE, false, false), meta(CORE, false, false), meta(SystemProgram.programId, false, false)],
        data: bytes([0], u64(minBid), u64(minIncrement), i64(duration)),
      });
    },

    bid({ bidder, auction, amount }) {
      return new TransactionInstruction({
        programId: PID,
        keys: [meta(bidder, true, true), meta(auction.address, false, true),
               meta(auction.highestBidder || bidder, false, true), meta(SystemProgram.programId, false, false)],
        data: bytes([1], u64(amount)),
      });
    },

    settle({ payer, auction }) {
      return new TransactionInstruction({
        programId: PID,
        keys: [meta(payer, true, true), meta(auction.address, false, true), meta(auction.asset, false, true),
               meta(auction.collection || CORE, false, false), meta(auction.seller, false, true),
               meta(auction.highestBidder || auction.seller, false, false), meta(CORE, false, false),
               meta(SystemProgram.programId, false, false)],
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

    async fetchOne(connection, address) {
      const acc = await connection.getAccountInfo(key(address));
      return acc && acc.owner.equals(PID) && acc.data.length === AUCTION_SIZE ? decode(address, acc.data) : null;
    },

    // все идущие и завершившиеся (но ещё не закрытые) лоты
    async fetchAll(connection) {
      const list = await connection.getProgramAccounts(PID, { filters: [{ dataSize: AUCTION_SIZE }, { memcmp: { offset: 0, bytes: '2' } }] });
      return list.map(a => decode(a.pubkey, a.account.data));
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
