// Проверка JS-клиента аукциона без сети: команды кодируются ровно так, как ждёт программа
// (те же байты, что в auction/sim/tests/auction.rs), и данные лота читаются правильно.
// Запуск: node client.test.mjs
import * as web3 from '@solana/web3.js';
import assert from 'node:assert/strict';
import { makeAuction, explainError, AUCTION_SIZE, CORE_ID } from '../client/kir-auction.js';

const PID = 'HmsxX4gHaGzr8eWTPVXNYYN5Ye5RFRWW6VtuwTD8WP6';
const A = makeAuction(web3, PID);
const k = n => new web3.PublicKey(new Uint8Array(32).fill(n));
const [seller, asset, coll, bidder] = [k(1), k(2), k(3), k(4)];
const hex = b => Buffer.from(b).toString('hex');
const flags = ix => ix.keys.map(m => `${m.pubkey.toBase58().slice(0, 4)}${m.isSigner ? 's' : ''}${m.isWritable ? 'w' : ''}`).join(' ');
let n = 0; const t = (name, f) => { f(); n++; console.log('  ✓', name); };

// адрес лота — тот же, что считает программа (сверено с тестом на Rust)
const lot = A.pda(asset);
console.log('PDA лота для asset=[2;32]:', lot.toBase58());

t('выставить лот', () => {
  const ix = A.create({ seller, asset, collection: coll, minBid: 100_000_000n, minIncrement: 50_000_000n, duration: 3600 });
  assert.equal(ix.programId.toBase58(), PID);
  assert.equal(hex(ix.data), '00' + '00e1f50500000000' + '80f0fa0200000000' + '100e000000000000');
  assert.deepEqual(ix.keys.map(m => [m.isSigner, m.isWritable]), [[true, true], [false, true], [false, true], [false, false], [false, false], [false, false]]);
  assert.ok(ix.keys[1].pubkey.equals(lot) && ix.keys[3].pubkey.equals(coll) && ix.keys[4].pubkey.toBase58() === CORE_ID);
  const noColl = A.create({ seller, asset, collection: null, minBid: 1n, minIncrement: 1n, duration: 60 });
  assert.equal(noColl.keys[3].pubkey.toBase58(), CORE_ID, 'без коллекции — адрес Core');
});

// данные лота так, как их пишет программа (Auction::write)
const raw = new Uint8Array(AUCTION_SIZE);
const dv = new DataView(raw.buffer);
raw[0] = 1; raw.set(seller.toBytes(), 1); raw.set(asset.toBytes(), 33); raw.set(coll.toBytes(), 65);
dv.setBigUint64(97, 100_000_000n, true); dv.setBigUint64(105, 50_000_000n, true);
dv.setBigInt64(113, 1_800_000_000n, true); dv.setBigInt64(121, 1_800_003_600n, true);
raw.set(bidder.toBytes(), 129); dv.setBigUint64(161, 150_000_000n, true); dv.setUint32(169, 2, true); raw[173] = 254;

t('чтение лота', () => {
  const a = A.decode(lot, raw);
  assert.ok(a.seller.equals(seller) && a.asset.equals(asset) && a.collection.equals(coll) && a.highestBidder.equals(bidder));
  assert.equal(a.minBid, 100_000_000n); assert.equal(a.minIncrement, 50_000_000n); assert.equal(a.highestBid, 150_000_000n);
  assert.equal(a.startTs, 1_800_000_000); assert.equal(a.endTs, 1_800_003_600); assert.equal(a.bidCount, 2); assert.equal(a.bump, 254);
  assert.equal(A.nextMin(a), 200_000_000n, 'следующая ставка = лидер + шаг');
  const empty = A.decode(lot, Object.assign(raw.slice(), { 65: 0 }).fill(0, 65, 97).fill(0, 129, 173));
  assert.equal(empty.collection, null); assert.equal(empty.highestBidder, null); assert.equal(A.nextMin(empty), 100_000_000n);
});

const state = A.decode(lot, raw);
t('ставка', () => {
  const ix = A.bid({ bidder: seller, auction: state, amount: 200_000_000n });
  assert.equal(hex(ix.data), '01' + '00c2eb0b00000000');
  assert.equal(flags(ix), `${seller.toBase58().slice(0, 4)}sw ${lot.toBase58().slice(0, 4)}w ${bidder.toBase58().slice(0, 4)}w 1111`);
  const first = A.bid({ bidder, auction: { ...state, highestBidder: null, bidCount: 0 }, amount: 1n });
  assert.ok(first.keys[2].pubkey.equals(bidder), 'без ставок «прошлый лидер» = сам участник');
});

t('завершить', () => {
  const ix = A.settle({ payer: k(9), auction: state });
  assert.equal(hex(ix.data), '02');
  assert.deepEqual(ix.keys.map(m => [m.isSigner, m.isWritable]), [[true, true], [false, true], [false, true], [false, false], [false, true], [false, false], [false, false], [false, false]]);
  assert.ok(ix.keys[4].pubkey.equals(seller) && ix.keys[5].pubkey.equals(bidder));
  const nobids = A.settle({ payer: k(9), auction: { ...state, highestBidder: null, bidCount: 0 } });
  assert.ok(nobids.keys[5].pubkey.equals(seller), 'без ставок NFT уходит продавцу');
});

t('снять с торгов', () => {
  const ix = A.cancel({ seller, auction: state });
  assert.equal(hex(ix.data), '03');
  assert.deepEqual(ix.keys.map(m => [m.isSigner, m.isWritable]), [[true, true], [false, true], [false, true], [false, false], [false, false], [false, false]]);
});

t('понятные ошибки', () => {
  assert.equal(explainError({ message: 'Error processing Instruction 0: custom program error: 0x1776' }), 'Ставка слишком мала');
  assert.equal(explainError({ message: 'x', logs: ['Program failed: custom program error: 0x1778'] }), 'Кто-то уже перебил ставку — обнови страницу');
  assert.equal(explainError(new Error('User rejected the request.')), 'Отменено в кошельке');
  assert.equal(explainError(new Error('что-то другое')), null);
});

console.log(`\nВсё верно: ${n} проверок`);
