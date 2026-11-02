// Мост «картинка → хранилище Arweave (Irys) → NFT Metaplex Core в Solana», подпись через Phantom.
// Собирается в ../site/js/kir-mint.js командой `npm run build`; на странице доступен как window.KIRMint.
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import {
  mplCore, create, createCollection, fetchCollection, fetchAssetsByCollection, fetchCollectionsByUpdateAuthority, ruleSet,
} from '@metaplex-foundation/mpl-core';
import { generateSigner, createGenericFile, publicKey } from '@metaplex-foundation/umi';
import * as web3 from '@solana/web3.js';
import { makeAuction, explainError, LAMPORTS } from '../../auction/client/kir-auction.js';

// сеть берётся из site/js/config.js: 'devnet' (тестовая) или 'mainnet-beta' (настоящие деньги)
const CLUSTER = window.KIR_CONFIG?.cluster || 'devnet';
const RPC = window.KIR_CONFIG?.rpc || (CLUSTER === 'devnet' ? 'https://api.devnet.solana.com' : 'https://api.mainnet-beta.solana.com');
// коллекции сайта: у каждой серии генератора своя (vg и modi — это «КИР»)
const COLLECTIONS = {
  kir:     { name: 'КИР',     symbol: 'KIR',  description: 'Коллекция новых работ, созданных алгоритмом на основе картин автора КИР.' },
  bogomol: { name: 'Богомол', symbol: 'BOGO', description: 'Настоящий богомол с осенней фотографии — а мир вокруг него каждый раз рисует алгоритм.' },
  hom:     { name: 'Хом',     symbol: 'HOM',  description: 'Камни степи, заново перерисованные алгоритмом: мазками, витражом, гравюрой, точками.' },
  shumer:  { name: 'Шумеры',  symbol: 'SHUM', description: 'Каменные маски, идолы и звери, которых алгоритм «вырезает» сам — в духе древних шумерских фигурок.' },
};
// адрес коллекции «КИР» хранится под старым ключом — чтобы браузеры, где она уже записана, не искали её заново
const storeKey = key => key === 'kir' ? 'kir-collection-' + CLUSTER : `kir-collection-${key}-${CLUSTER}`;
const ROYALTY = 500; // 5% автору с каждой перепродажи
// хранилище картинок выбираем по нашей настройке сети, а не по адресу узла: в тестовой сети — бесплатное временное
// (файлы живут около 60 дней), в основной — постоянное Arweave (≈ 0.00006 SOL за картинку 2 МБ)
const STORAGE = CLUSTER === 'devnet' ? 'https://devnet.irys.xyz' : 'https://uploader.irys.xyz';

// без кошелька — только чтение (галерея); после connect() — с подписью через Phantom
let umi = createUmi(RPC, 'confirmed').use(mplCore());
let owner = null;
const listeners = new Set();
const emit = () => listeners.forEach(f => f(owner));

const explorer = (addr, kind = 'address') => `https://explorer.solana.com/${kind}/${addr}${CLUSTER === 'devnet' ? '?cluster=devnet' : ''}`;
// библиотека отдаёт ссылки на основной шлюз, а файлы тестовой сети лежат на devnet-узле
const fixUri = uri => CLUSTER === 'devnet' ? uri.replace('https://gateway.irys.xyz/', 'https://devnet.irys.xyz/') : uri;
const phantom = () => window.phantom?.solana?.isPhantom ? window.phantom.solana : null;

function attach(p) {
  const adapter = {
    publicKey: p.publicKey,
    signTransaction: tx => p.signTransaction(tx),
    signAllTransactions: txs => p.signAllTransactions(txs),
    signMessage: async msg => (await p.signMessage(msg)).signature,
  };
  umi = createUmi(RPC, 'confirmed').use(mplCore()).use(irysUploader({ address: STORAGE })).use(walletAdapterIdentity(adapter));
  owner = umi.identity.publicKey.toString();
  emit();
  return owner;
}

async function connect() {
  const p = phantom();
  if (!p) throw new Error('Phantom не найден. Открой сайт в браузере, где установлен Phantom.');
  await p.connect();
  return attach(p);
}

// тихое подключение, если сайт уже разрешён в Phantom (без окна)
async function autoConnect() {
  const p = phantom();
  if (!p) return null;
  try { await p.connect({ onlyIfTrusted: true }); return attach(p); } catch { return null; }
}

async function disconnect() {
  try { await phantom()?.disconnect(); } catch {}
  umi = createUmi(RPC, 'confirmed').use(mplCore());
  owner = null;
  emit();
}

async function balance() {
  if (!owner) return 0;
  const b = await umi.rpc.getBalance(publicKey(owner));
  return Number(b.basisPoints) / 1e9;
}

async function uploadImage(bytes, fileName, contentType) {
  const file = createGenericFile(bytes, fileName, { contentType });
  const [uri] = await umi.uploader.upload([file]);
  return fixUri(uri);
}
const uploadJson = async json => fixUri(await umi.uploader.uploadJson(json));

function savedCollection(key = 'kir') {
  try { return localStorage.getItem(storeKey(key)); } catch { return null; }
}
function setCollection(addr, key = 'kir') {
  try { localStorage.setItem(storeKey(key), addr); } catch {}
}

// наши коллекции в блокчейне — по названию среди коллекций подключённого кошелька
// или автора из site/js/config.js (так их находят посетители без кошелька): { kir: коллекция, … }
async function findCollections() {
  const author = window.KIR_CONFIG?.author;
  const found = {};
  for (const w of [...new Set([owner, author].filter(Boolean))]) {
    let list = [];
    try { list = await fetchCollectionsByUpdateAuthority(umi, publicKey(w)); } catch {}
    for (const [key, c] of Object.entries(COLLECTIONS)) found[key] ||= list.find(x => x.name === c.name);
  }
  return found;
}

// коллекция серии: адрес из памяти браузера, а если его нет — ищем в блокчейне
async function getCollection(key = 'kir') {
  const addr = savedCollection(key);
  if (addr) {
    try { return await fetchCollection(umi, publicKey(addr)); } catch {}
  }
  const found = (await findCollections())[key];
  if (found) { setCollection(found.publicKey.toString(), key); return found; }
  return null;
}

// адреса всех уже созданных коллекций: { kir: 'адрес', … }
async function allCollections() {
  const out = {};
  for (const key of Object.keys(COLLECTIONS)) { const a = savedCollection(key); if (a) out[key] = a; }
  if (Object.keys(out).length < Object.keys(COLLECTIONS).length) {
    for (const [key, c] of Object.entries(await findCollections())) {
      if (c && !out[key]) { out[key] = c.publicKey.toString(); setCollection(out[key], key); }
    }
  }
  return out;
}

async function createCollectionFor({ key = 'kir', imageBytes, contentType = 'image/png', onStep = () => {} }) {
  const c = COLLECTIONS[key];
  onStep('upload', 'Загружаю обложку в вечное хранилище');
  const image = await uploadImage(imageBytes, `${key}-cover.png`, contentType);
  onStep('meta', 'Сохраняю описание коллекции');
  const uri = await uploadJson({
    name: c.name,
    symbol: c.symbol,
    description: c.description,
    image,
    properties: { category: 'image', files: [{ uri: image, type: contentType }] },
  });
  onStep('chain', 'Записываю коллекцию в Solana');
  const collection = generateSigner(umi);
  const { signature } = await createCollection(umi, {
    collection, name: c.name, uri,
    plugins: [{ type: 'Royalties', basisPoints: ROYALTY, creators: [{ address: umi.identity.publicKey, percentage: 100 }], ruleSet: ruleSet('None') }],
  }).sendAndConfirm(umi);
  const addr = collection.publicKey.toString();
  setCollection(addr, key);
  onStep('done', 'Готово');
  return { address: addr, link: explorer(addr), signature };
}

// metadata — в формате Metaplex (как скачивает генератор ремиксов), поле image подставляется само;
// collection — ключ коллекции серии ('kir', 'bogomol', 'hom', 'shumer')
async function mint({ collection = 'kir', imageBytes, contentType = 'image/png', fileName = 'kir.png', metadata, onStep = () => {} }) {
  const c = COLLECTIONS[collection];
  const coll = await getCollection(collection);
  if (!coll) throw new Error(`Сначала создай коллекцию «${c.name}».`);
  onStep('upload', 'Загружаю картинку в вечное хранилище');
  const image = await uploadImage(imageBytes, fileName, contentType);
  onStep('meta', 'Сохраняю описание NFT');
  const uri = await uploadJson({
    symbol: c.symbol,
    ...metadata,
    image,
    properties: { category: 'image', files: [{ uri: image, type: contentType }] },
  });
  onStep('chain', 'Записываю NFT в Solana');
  const asset = generateSigner(umi);
  await create(umi, { asset, collection: coll, name: metadata.name, uri }).sendAndConfirm(umi);
  const addr = asset.publicKey.toString();
  onStep('done', 'Готово');
  return { address: addr, link: explorer(addr), image, uri };
}

// все NFT коллекции прямо из блокчейна, новые первыми; описание (картинка, свойства) подгружается из хранилища
async function collectionAssets(addr = savedCollection()) {
  if (!addr) return [];
  const assets = await fetchAssetsByCollection(umi, publicKey(addr), { skipDerivePlugins: true });
  const items = await Promise.all(assets.map(async a => {
    let meta = {};
    try { meta = await (await fetch(fixUri(a.uri))).json(); } catch {}
    return {
      address: a.publicKey.toString(), owner: a.owner.toString(), name: a.name, uri: a.uri,
      image: meta.image ? fixUri(meta.image) : null, description: meta.description || '', attributes: meta.attributes || [],
    };
  }));
  return items.reverse();
}

// NFT всех коллекций; у каждого — адрес коллекции, её ключ и название
async function allAssets() {
  const cols = await allCollections();
  const lists = await Promise.all(Object.keys(COLLECTIONS).filter(k => cols[k]).map(async key =>
    (await collectionAssets(cols[key])).map(n => ({ ...n, collection: cols[key], series: key, collectionName: COLLECTIONS[key].name }))));
  return lists.flat();
}

// ---------- аукцион (программа auction/program; адрес — в site/js/config.js) ----------
const conn = new web3.Connection(RPC, 'confirmed');
const A = makeAuction(web3, window.KIR_CONFIG?.auctionProgram || 'HmsxX4gHaGzr8eWTPVXNYYN5Ye5RFRWW6VtuwTD8WP6');
const toLamports = sol => BigInt(Math.round(Number(sol) * LAMPORTS));
const toSol = lamports => Number(lamports) / LAMPORTS;

// подписать в Phantom и отправить команды одной транзакцией
async function sendIx(...ixs) {
  const p = phantom();
  if (!owner || !p) throw new Error('Подключи кошелёк Phantom');
  const tx = new web3.Transaction().add(...ixs);
  tx.feePayer = new web3.PublicKey(owner);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  try {
    const signed = await p.signTransaction(tx);
    const signature = await conn.sendRawTransaction(signed.serialize());
    await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    return signature;
  } catch (e) {
    const text = explainError(e);
    throw text ? new Error(text) : e;
  }
}

const me = () => new web3.PublicKey(owner);
const lotOf = async address => {
  const lot = await A.fetchOne(conn, address);
  if (!lot) throw new Error('Лот уже закрыт');
  return lot;
};

const auction = {
  programId: A.PID.toBase58(),
  toSol, toLamports,
  // программа уже выложена в сеть?
  async ready() {
    try { return (await conn.getAccountInfo(A.PID))?.executable === true; } catch { return false; }
  },
  lots: () => A.fetchAll(conn),
  lot: address => A.fetchOne(conn, address),
  addressOf: asset => A.pda(new web3.PublicKey(asset)).toBase58(),
  nextMin: lot => A.nextMin(lot),
  // выставить свой NFT: цены в SOL, длительность в секундах
  create: ({ asset, collection, minBid, step, duration }) => sendIx(A.create({
    seller: me(), asset: new web3.PublicKey(asset), collection: collection ? new web3.PublicKey(collection) : null,
    minBid: toLamports(minBid), minIncrement: toLamports(step), duration,
  })),
  // ставка: сначала перечитываем лот — вдруг кто-то уже перебил.
  // Если на этом адресе лежит ставка с прошлых торгов того же NFT — забираем её в той же транзакции.
  async bid(address, sol) {
    const lot = await lotOf(address);
    const old = await auction.myBid(address);
    const ixs = old && old.auctionStart !== lot.startTs ? [A.withdraw({ bidder: me(), auction: lot })] : [];
    return sendIx(...ixs, A.bid({ bidder: me(), auction: lot, amount: toLamports(sol) }));
  },
  settle: async address => sendIx(A.settle({ payer: me(), auction: await lotOf(address) })),
  cancel: async address => sendIx(A.cancel({ seller: me(), auction: await lotOf(address) })),
  // забрать свою ставку (перебили или лот закрыт)
  withdraw: address => sendIx(A.withdraw({ bidder: me(), auction: address })),
  // моя ставка на этом лоте (или null)
  async myBid(address) {
    if (!owner) return null;
    const pda = A.bidPda(new web3.PublicKey(address), me());
    const acc = await conn.getAccountInfo(pda);
    return acc && acc.owner.equals(A.PID) ? A.decodeBid(pda, acc.data) : null;
  },
  // все мои ставки: { bid, lot (null — лот закрыт), leading, canWithdraw }
  async myBids() {
    if (!owner) return [];
    const bids = await A.fetchBids(conn, me());
    return Promise.all(bids.map(async bid => {
      const lot = await A.fetchOne(conn, bid.auction);
      const same = lot && lot.startTs === bid.auctionStart;
      const leading = !!(same && lot.highestBidder?.equals(me()));
      return { bid, lot, leading, canWithdraw: !leading };
    }));
  },
};

window.KIRMint = {
  connect, autoConnect, disconnect, balance, getCollection, createCollection: createCollectionFor, mint, collectionAssets,
  allCollections, allAssets, explorer, savedCollection, setCollection, auction, COLLECTIONS,
  get owner() { return owner; },
  onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  cluster: CLUSTER,
};
