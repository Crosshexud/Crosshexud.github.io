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

const RPC = 'https://api.devnet.solana.com';
const CLUSTER = 'devnet';
const STORE_KEY = 'kir-collection-' + CLUSTER;
const COLLECTION_NAME = 'КИР';
const ROYALTY = 500; // 5% автору с каждой перепродажи

// без кошелька — только чтение (галерея); после connect() — с подписью через Phantom
let umi = createUmi(RPC, 'confirmed').use(mplCore());
let owner = null;
const listeners = new Set();
const emit = () => listeners.forEach(f => f(owner));

const explorer = (addr, kind = 'address') => `https://explorer.solana.com/${kind}/${addr}?cluster=${CLUSTER}`;
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
  umi = createUmi(RPC, 'confirmed').use(mplCore()).use(irysUploader()).use(walletAdapterIdentity(adapter));
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

function savedCollection() {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}
function setCollection(addr) {
  try { localStorage.setItem(STORE_KEY, addr); } catch {}
}

// коллекция «КИР»: адрес из памяти браузера, а если его нет — ищем в блокчейне среди коллекций
// подключённого кошелька или автора из site/js/config.js (так её находят посетители открытого сайта)
async function getCollection() {
  const addr = savedCollection();
  if (addr) {
    try { return await fetchCollection(umi, publicKey(addr)); } catch {}
  }
  const author = window.KIR_CONFIG?.author;
  const who = [...new Set([owner, author].filter(Boolean))];
  try {
    let found = null;
    for (const w of who) {
      found = (await fetchCollectionsByUpdateAuthority(umi, publicKey(w))).find(c => c.name === COLLECTION_NAME);
      if (found) break;
    }
    if (found) { setCollection(found.publicKey.toString()); return found; }
  } catch {}
  return null;
}

async function createKirCollection({ imageBytes, contentType = 'image/png', onStep = () => {} }) {
  onStep('upload', 'Загружаю обложку в вечное хранилище');
  const image = await uploadImage(imageBytes, 'kir-cover.png', contentType);
  onStep('meta', 'Сохраняю описание коллекции');
  const uri = await uploadJson({
    name: COLLECTION_NAME,
    symbol: 'KIR',
    description: 'Коллекция новых работ, созданных алгоритмом на основе картин автора КИР.',
    image,
    properties: { category: 'image', files: [{ uri: image, type: contentType }] },
  });
  onStep('chain', 'Записываю коллекцию в Solana');
  const collection = generateSigner(umi);
  const { signature } = await createCollection(umi, {
    collection, name: COLLECTION_NAME, uri,
    plugins: [{ type: 'Royalties', basisPoints: ROYALTY, creators: [{ address: umi.identity.publicKey, percentage: 100 }], ruleSet: ruleSet('None') }],
  }).sendAndConfirm(umi);
  const addr = collection.publicKey.toString();
  setCollection(addr);
  onStep('done', 'Готово');
  return { address: addr, link: explorer(addr), signature };
}

// metadata — в формате Metaplex (как скачивает генератор ремиксов), поле image подставляется само
async function mint({ imageBytes, contentType = 'image/png', fileName = 'kir.png', metadata, onStep = () => {} }) {
  const coll = await getCollection();
  if (!coll) throw new Error('Сначала создай коллекцию «КИР».');
  onStep('upload', 'Загружаю картинку в вечное хранилище');
  const image = await uploadImage(imageBytes, fileName, contentType);
  onStep('meta', 'Сохраняю описание NFT');
  const uri = await uploadJson({
    symbol: 'KIR',
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

// ---------- аукцион (программа auction/program; адрес — в site/js/config.js) ----------
const conn = new web3.Connection(RPC, 'confirmed');
const A = makeAuction(web3, window.KIR_CONFIG?.auctionProgram || 'HmsxX4gHaGzr8eWTPVXNYYN5Ye5RFRWW6VtuwTD8WP6');
const toLamports = sol => BigInt(Math.round(Number(sol) * LAMPORTS));
const toSol = lamports => Number(lamports) / LAMPORTS;

// подписать в Phantom и отправить одну команду
async function sendIx(ix) {
  const p = phantom();
  if (!owner || !p) throw new Error('Подключи кошелёк Phantom');
  const tx = new web3.Transaction().add(ix);
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
  // ставка: сначала перечитываем лот — вдруг кто-то уже перебил
  async bid(address, sol) {
    const lot = await lotOf(address);
    return sendIx(A.bid({ bidder: me(), auction: lot, amount: toLamports(sol) }));
  },
  settle: async address => sendIx(A.settle({ payer: me(), auction: await lotOf(address) })),
  cancel: async address => sendIx(A.cancel({ seller: me(), auction: await lotOf(address) })),
};

window.KIRMint = {
  connect, autoConnect, disconnect, balance, getCollection, createKirCollection, mint, collectionAssets,
  explorer, savedCollection, setCollection, auction,
  get owner() { return owner; },
  onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  cluster: CLUSTER,
};
