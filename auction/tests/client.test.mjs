// Проверка JS-клиента аукциона (версия 2) без сети: команды кодируются ровно так, как ждёт программа
// (те же байты и счета, что в auction/sim/tests/auction.rs), и данные лота/ставки читаются правильно.
// Запуск: node client.test.mjs
import * as web3 from '@solana/web3.js';
import assert from 'node:assert/strict';
import { makeAuction, explainError, AUCTION_SIZE, BID_SIZE, CORE_ID } from '../client/kir-auction.js';

const PID = 'HmsxX4gHaGzr8eWTPVXNYYN5Ye5RFRWW6VtuwTD8WP6';
const A = makeAuction(web3, PID);
const k = n => new web3.PublicKey(new Uint8Array(32).fill(n));
const [seller, asset, coll, bidder, author1, author2] = [k(1), k(2), k(3), k(4), k(5), k(6)];
const hex = b => Buffer.from(b).toString('hex');
const sw = ix => ix.keys.map(m => [m.isSigner, m.isWritable]);
let n = 0; const t = (name, f) => { f(); n++; console.log('  ✓', name); };

// адреса — те же, что считает программа (сверено с тестом на Rust: same_addresses_as_website)
const lot = A.pda(asset);
t('адреса лота и ставки как в программе', () => {
  assert.equal(lot.toBase58(), '4effEs5qRp7Uf8nRwcBdfHZqAJEZXxYMoXZCJCPZfS4c');
  assert.equal(A.bidPda(lot, bidder).toBase58(), '9fKmrkWL8MmPvhdd8n2R9TcDkNvoAp25TwLtgMKpFyZo');
});

t('выставить лот', () => {
  const ix = A.create({ seller, asset, collection: coll, minBid: 100_000_000n, minIncrement: 50_000_000n, duration: 3600 });
  assert.equal(ix.programId.toBase58(), PID);
  assert.equal(hex(ix.data), '00' + '00e1f50500000000' + '80f0fa0200000000' + '100e000000000000');
  assert.deepEqual(sw(ix), [[true, true], [false, true], [false, true], [false, false], [false, false], [false, false]]);
  assert.ok(ix.keys[1].pubkey.equals(lot) && ix.keys[3].pubkey.equals(coll) && ix.keys[4].pubkey.toBase58() === CORE_ID);
  const noColl = A.create({ seller, asset, collection: null, minBid: 1n, minIncrement: 1n, duration: 60 });
  assert.equal(noColl.keys[3].pubkey.toBase58(), CORE_ID, 'без коллекции — адрес Core');
});

// данные лота так, как их пишет программа (Auction::write)
const raw = new Uint8Array(AUCTION_SIZE);
const dv = new DataView(raw.buffer);
raw[0] = 3; raw.set(seller.toBytes(), 1); raw.set(asset.toBytes(), 33); raw.set(coll.toBytes(), 65);
dv.setBigUint64(97, 100_000_000n, true); dv.setBigUint64(105, 50_000_000n, true);
dv.setBigInt64(113, 1_800_000_000n, true); dv.setBigInt64(121, 1_800_003_600n, true);
raw.set(bidder.toBytes(), 129); dv.setBigUint64(161, 150_000_000n, true); dv.setUint32(169, 2, true); raw[173] = 254;
dv.setUint16(174, 500, true); raw[176] = 2;
raw.set(author1.toBytes(), 177); raw[209] = 70; raw.set(author2.toBytes(), 210); raw[242] = 30;

const state = A.decode(lot, raw);
t('чтение лота', () => {
  const a = state;
  assert.ok(a.seller.equals(seller) && a.asset.equals(asset) && a.collection.equals(coll) && a.highestBidder.equals(bidder));
  assert.equal(a.minBid, 100_000_000n); assert.equal(a.minIncrement, 50_000_000n); assert.equal(a.highestBid, 150_000_000n);
  assert.equal(a.startTs, 1_800_000_000); assert.equal(a.endTs, 1_800_003_600); assert.equal(a.bidCount, 2); assert.equal(a.bump, 254);
  assert.equal(a.royaltyBps, 500);
  assert.deepEqual(a.creators.map(c => [c.address.toBase58(), c.percentage]), [[author1.toBase58(), 70], [author2.toBase58(), 30]]);
  assert.equal(A.nextMin(a), 200_000_000n, 'следующая ставка = лидер + шаг');
  const empty = A.decode(lot, raw.slice().fill(0, 65, 97).fill(0, 129, 161));
  assert.equal(empty.collection, null); assert.equal(empty.highestBidder, null); assert.equal(A.nextMin(empty), 100_000_000n);
});

t('чтение ставки', () => {
  const b = new Uint8Array(BID_SIZE); const v = new DataView(b.buffer);
  b[0] = 4; b.set(lot.toBytes(), 1); b.set(bidder.toBytes(), 33); v.setBigInt64(65, 1_800_000_000n, true); v.setBigUint64(73, 7n, true); b[81] = 253;
  const x = A.decodeBid(A.bidPda(lot, bidder), b);
  assert.ok(x.auction.equals(lot) && x.bidder.equals(bidder));
  assert.equal(x.auctionStart, 1_800_000_000); assert.equal(x.amount, 7n); assert.equal(x.bump, 253);
});

t('ставка', () => {
  const ix = A.bid({ bidder, auction: state, amount: 200_000_000n });
  assert.equal(hex(ix.data), '01' + '00c2eb0b00000000');
  assert.deepEqual(sw(ix), [[true, true], [false, true], [false, true], [false, false]]);
  assert.ok(ix.keys[1].pubkey.equals(lot) && ix.keys[2].pubkey.equals(A.bidPda(lot, bidder)));
});

t('завершить с победителем и роялти', () => {
  const ix = A.settle({ payer: k(9), auction: state });
  assert.equal(hex(ix.data), '02');
  assert.deepEqual(sw(ix), [[true, true], [false, true], [false, true], [false, false], [false, true], [false, true], [false, true], [false, false], [false, false], [false, true], [false, true]]);
  assert.ok(ix.keys[4].pubkey.equals(seller) && ix.keys[5].pubkey.equals(bidder) && ix.keys[6].pubkey.equals(A.bidPda(lot, bidder)));
  assert.ok(ix.keys[9].pubkey.equals(author1) && ix.keys[10].pubkey.equals(author2), 'авторы по порядку');
});

t('завершить без победителя', () => {
  const ix = A.settle({ payer: k(9), auction: { ...state, highestBidder: null, bidCount: 0 } });
  assert.equal(ix.keys.length, 9, 'без авторов');
  assert.ok(ix.keys[5].pubkey.equals(seller) && ix.keys[6].pubkey.equals(seller), 'NFT уходит продавцу');
});

t('снять с торгов и забрать ставку', () => {
  const c = A.cancel({ seller, auction: state });
  assert.equal(hex(c.data), '03');
  assert.deepEqual(sw(c), [[true, true], [false, true], [false, true], [false, false], [false, false], [false, false]]);
  const w = A.withdraw({ bidder, auction: lot });
  assert.equal(hex(w.data), '04');
  assert.deepEqual(sw(w), [[true, true], [false, true], [false, true]]);
  assert.ok(w.keys[2].pubkey.equals(A.bidPda(lot, bidder)));
});

t('понятные ошибки', () => {
  assert.match(explainError({ message: 'Error processing Instruction 0: custom program error: 0x1776' }), /Ставка слишком мала/);
  assert.match(explainError({ message: 'x', logs: ['Program failed: custom program error: 0x177c'] }), /прошлых торгов/);
  assert.match(explainError({ message: 'custom program error: 0x177e' }), /плагины/);
  assert.equal(explainError(new Error('User rejected the request.')), 'Отменено в кошельке');
  assert.equal(explainError(new Error('что-то другое')), null);
});

console.log(`\nВсё верно: ${n} проверок`);
