//! Проверка программы аукциона «КИР» (версия 2) в LiteSVM — копии блокчейна прямо внутри теста.
//! Используется НАСТОЯЩАЯ сборка для выкладки (auction/program/target/deploy/kir_auction.so)
//! и настоящая программа Metaplex Core (скачана с devnet в fixtures/mpl_core.so).
//! Время в тестах «перематывается», поэтому ждать конца торгов не нужно.
//!
//! Запуск: сначала `cargo-build-sbf` в auction/program, потом `cargo test` здесь.

use litesvm::{types::TransactionMetadata, LiteSVM};
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_instruction_error::InstructionError;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;

const CORE: Address = Address::from_str_const("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const SYSTEM: Address = Address::from_str_const("11111111111111111111111111111111");
const PID: Address = Address::from_str_const("HmsxX4gHaGzr8eWTPVXNYYN5Ye5RFRWW6VtuwTD8WP6");
const SOL: u64 = 1_000_000_000;
const FEE: u64 = 5_000; // комиссия сети за одну подпись
const GRACE: i64 = 7 * 24 * 3600;
const AUCTION_SIZE: usize = 342;

// ------------------------------------------------------------------ окружение

struct Env {
    svm: LiteSVM,
}

type Res = Result<TransactionMetadata, (Option<u32>, String)>;

impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let dir = env!("CARGO_MANIFEST_DIR");
        let core = std::fs::read(format!("{dir}/fixtures/mpl_core.so")).expect("нет fixtures/mpl_core.so (solana program dump)");
        let ours = std::fs::read(format!("{dir}/../program/target/deploy/kir_auction.so")).expect("сначала собери программу: cargo-build-sbf");
        svm.add_program(CORE, &core).unwrap();
        svm.add_program(PID, &ours).unwrap();
        let mut c: Clock = svm.get_sysvar();
        c.unix_timestamp = 1_800_000_000;
        svm.set_sysvar(&c);
        Self { svm }
    }

    fn wallet(&mut self, sol: u64) -> Keypair {
        let k = Keypair::new();
        self.svm.airdrop(&k.pubkey(), sol * SOL).unwrap();
        k
    }

    fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> Res {
        let msg = Message::new(ixs, Some(&signers[0].pubkey()));
        let tx = Transaction::new(signers, msg, self.svm.latest_blockhash());
        let r = self.svm.send_transaction(tx);
        self.svm.expire_blockhash(); // одинаковые транзакции подряд не считаются повтором
        r.map_err(|f| {
            let code = match f.err {
                TransactionError::InstructionError(_, InstructionError::Custom(c)) => Some(c),
                _ => None,
            };
            (code, format!("{:?}\n{}", f.err, f.meta.logs.join("\n")))
        })
    }

    fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }
    fn warp(&mut self, secs: i64) {
        let mut c: Clock = self.svm.get_sysvar();
        c.unix_timestamp += secs;
        c.slot += 1;
        self.svm.set_sysvar(&c);
    }
    fn to_end(&mut self, lot: &Address) {
        let end = self.lot(lot).end_ts;
        self.warp(end - self.now());
    }
    fn bal(&self, a: &Address) -> u64 {
        self.svm.get_balance(a).unwrap_or(0)
    }
    fn acc(&self, a: &Address) -> Option<Account> {
        self.svm.get_account(a).filter(|x| x.lamports > 0)
    }
    fn owner_of(&self, asset: &Address) -> Address {
        let d = self.svm.get_account(asset).unwrap().data;
        Address::try_from(&d[1..33]).unwrap()
    }
    fn lot(&self, auction: &Address) -> Lot {
        Lot::read(&self.svm.get_account(auction).expect("нет лота").data)
    }
    fn bid_amount(&self, bid: &Address) -> u64 {
        let d = self.svm.get_account(bid).expect("нет ставки").data;
        assert_eq!((d.len(), d[0]), (82, 4));
        u64::from_le_bytes(d[73..81].try_into().unwrap())
    }

    // ---------- Metaplex Core (формат команд сверен с @metaplex-foundation/mpl-core)
    /// CreateCollectionV1 с заданными плагинами (байты списка PluginAuthorityPair)
    fn collection_with(&mut self, payer: &Keypair, plugins: &[Vec<u8>]) -> Address {
        let coll = Keypair::new();
        let mut d = vec![1u8];
        push_str(&mut d, "КИР");
        push_str(&mut d, "https://example.com/c.json");
        push_plugins(&mut d, plugins);
        let ix = Instruction {
            program_id: CORE,
            accounts: vec![
                AccountMeta::new(coll.pubkey(), true),
                AccountMeta::new_readonly(CORE, false),
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new_readonly(SYSTEM, false),
            ],
            data: d,
        };
        self.send(&[ix], &[payer, &coll]).expect("коллекция");
        coll.pubkey()
    }

    /// коллекция «КИР»: роялти 5% одному автору (как на сайте)
    fn collection(&mut self, payer: &Keypair) -> Address {
        let me = payer.pubkey();
        self.collection_with(payer, &[royalties(500, &[(me, 100)])])
    }

    /// CreateV1 с заданными плагинами
    fn nft_with(&mut self, payer: &Keypair, collection: Option<Address>, plugins: &[Vec<u8>]) -> Address {
        let asset = Keypair::new();
        let mut d = vec![0u8, 0];
        push_str(&mut d, "Тест КИР");
        push_str(&mut d, "https://example.com/a.json");
        push_plugins(&mut d, plugins);
        let ix = Instruction {
            program_id: CORE,
            accounts: vec![
                AccountMeta::new(asset.pubkey(), true),
                match collection { Some(c) => AccountMeta::new(c, false), None => AccountMeta::new_readonly(CORE, false) },
                AccountMeta::new_readonly(CORE, false),
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new_readonly(CORE, false),
                AccountMeta::new_readonly(CORE, false),
                AccountMeta::new_readonly(SYSTEM, false),
                AccountMeta::new_readonly(CORE, false),
            ],
            data: d,
        };
        self.send(&[ix], &[payer, &asset]).expect("NFT");
        asset.pubkey()
    }

    fn nft(&mut self, payer: &Keypair, collection: Option<Address>) -> Address {
        self.nft_with(payer, collection, &[])
    }

    /// передать NFT (Core TransferV1) — чтобы перепродать его на новом аукционе
    fn give(&mut self, owner: &Keypair, asset: &Address, coll: Option<Address>, to: &Address) {
        let ix = Instruction {
            program_id: CORE,
            accounts: vec![
                AccountMeta::new(*asset, false),
                AccountMeta::new_readonly(coll.unwrap_or(CORE), false),
                AccountMeta::new(owner.pubkey(), true),
                AccountMeta::new_readonly(CORE, false),
                AccountMeta::new_readonly(*to, false),
                AccountMeta::new_readonly(CORE, false),
                AccountMeta::new_readonly(CORE, false),
            ],
            data: vec![14, 0],
        };
        self.send(&[ix], &[owner]).expect("передать NFT");
    }
}

fn push_str(d: &mut Vec<u8>, s: &str) {
    d.extend((s.len() as u32).to_le_bytes());
    d.extend(s.as_bytes());
}

/// Some(Vec<PluginAuthorityPair>), у каждого плагина authority = None (по умолчанию)
fn push_plugins(d: &mut Vec<u8>, plugins: &[Vec<u8>]) {
    d.push(1);
    d.extend((plugins.len() as u32).to_le_bytes());
    for p in plugins {
        d.extend(p);
        d.push(0);
    }
}

/// Plugin::Royalties { basis_points, creators, rule_set: None }
fn royalties(bps: u16, creators: &[(Address, u8)]) -> Vec<u8> {
    let mut d = vec![0u8];
    d.extend(bps.to_le_bytes());
    d.extend((creators.len() as u32).to_le_bytes());
    for (a, p) in creators {
        d.extend(a.as_ref());
        d.push(*p);
    }
    d.push(0);
    d
}

fn pda(asset: &Address) -> Address {
    Address::find_program_address(&[b"auction", asset.as_ref()], &PID).0
}
fn bid_pda(auction: &Address, bidder: &Address) -> Address {
    Address::find_program_address(&[b"bid", auction.as_ref(), bidder.as_ref()], &PID).0
}

// ------------------------------------------------------------------ команды аукциона (как в client/kir-auction.js)

fn ix_create(seller: &Address, asset: &Address, coll: Option<Address>, min_bid: u64, inc: u64, dur: i64) -> Instruction {
    let mut d = vec![0u8];
    d.extend(min_bid.to_le_bytes());
    d.extend(inc.to_le_bytes());
    d.extend(dur.to_le_bytes());
    Instruction {
        program_id: PID,
        accounts: vec![
            AccountMeta::new(*seller, true),
            AccountMeta::new(pda(asset), false),
            AccountMeta::new(*asset, false),
            AccountMeta::new_readonly(coll.unwrap_or(CORE), false),
            AccountMeta::new_readonly(CORE, false),
            AccountMeta::new_readonly(SYSTEM, false),
        ],
        data: d,
    }
}

fn ix_bid(bidder: &Address, auction: &Address, amount: u64) -> Instruction {
    let mut d = vec![1u8];
    d.extend(amount.to_le_bytes());
    Instruction {
        program_id: PID,
        accounts: vec![
            AccountMeta::new(*bidder, true),
            AccountMeta::new(*auction, false),
            AccountMeta::new(bid_pda(auction, bidder), false),
            AccountMeta::new_readonly(SYSTEM, false),
        ],
        data: d,
    }
}

struct Settle<'a> {
    payer: &'a Address,
    lot: &'a Address,
    asset: &'a Address,
    coll: Option<Address>,
    seller: &'a Address,
    /// None — победителя нет (тогда на его месте продавец)
    winner: Option<&'a Address>,
    creators: Vec<Address>,
}
fn ix_settle(s: Settle) -> Instruction {
    let w = s.winner.copied().unwrap_or(*s.seller);
    let wb = s.winner.map(|w| bid_pda(s.lot, w)).unwrap_or(*s.seller);
    let mut accounts = vec![
        AccountMeta::new(*s.payer, true),
        AccountMeta::new(*s.lot, false),
        AccountMeta::new(*s.asset, false),
        AccountMeta::new_readonly(s.coll.unwrap_or(CORE), false),
        AccountMeta::new(*s.seller, false),
        AccountMeta::new(w, false),
        AccountMeta::new(wb, false),
        AccountMeta::new_readonly(CORE, false),
        AccountMeta::new_readonly(SYSTEM, false),
    ];
    accounts.extend(s.creators.iter().map(|c| AccountMeta::new(*c, false)));
    Instruction { program_id: PID, accounts, data: vec![2] }
}

fn ix_cancel(seller: &Address, auction: &Address, asset: &Address, coll: Option<Address>) -> Instruction {
    Instruction {
        program_id: PID,
        accounts: vec![
            AccountMeta::new(*seller, true),
            AccountMeta::new(*auction, false),
            AccountMeta::new(*asset, false),
            AccountMeta::new_readonly(coll.unwrap_or(CORE), false),
            AccountMeta::new_readonly(CORE, false),
            AccountMeta::new_readonly(SYSTEM, false),
        ],
        data: vec![3],
    }
}

fn ix_withdraw(bidder: &Address, auction: &Address) -> Instruction {
    Instruction {
        program_id: PID,
        accounts: vec![
            AccountMeta::new(*bidder, true),
            AccountMeta::new(*auction, false),
            AccountMeta::new(bid_pda(auction, bidder), false),
        ],
        data: vec![4],
    }
}

#[derive(Debug)]
struct Lot {
    seller: Address,
    asset: Address,
    collection: Address,
    min_bid: u64,
    min_increment: u64,
    end_ts: i64,
    highest_bidder: Address,
    highest_bid: u64,
    bid_count: u32,
    royalty_bps: u16,
    creators: Vec<(Address, u8)>,
}
impl Lot {
    fn read(d: &[u8]) -> Self {
        assert_eq!(d.len(), AUCTION_SIZE);
        assert_eq!(d[0], 3);
        let a = |o: usize| Address::try_from(&d[o..o + 32]).unwrap();
        let u = |o: usize| u64::from_le_bytes(d[o..o + 8].try_into().unwrap());
        Lot {
            seller: a(1), asset: a(33), collection: a(65), min_bid: u(97), min_increment: u(105),
            end_ts: u(121) as i64, highest_bidder: a(129), highest_bid: u(161),
            bid_count: u32::from_le_bytes(d[169..173].try_into().unwrap()),
            royalty_bps: u16::from_le_bytes([d[174], d[175]]),
            creators: (0..d[176] as usize).map(|i| (a(177 + i * 33), d[209 + i * 33])).collect(),
        }
    }
}

#[track_caller]
fn expect_err(r: Res, code: u32, what: &str) {
    match r {
        Ok(_) => panic!("{what}: прошло, а должна быть ошибка {code}"),
        Err((c, logs)) => assert_eq!(c, Some(code), "{what}: ждали ошибку {code}\n{logs}"),
    }
}
#[track_caller]
fn expect_ok(r: Res, what: &str) -> TransactionMetadata {
    r.unwrap_or_else(|(_, logs)| panic!("{what}: не прошло\n{logs}"))
}

// ------------------------------------------------------------------ сами проверки

#[test]
fn full_auction_with_royalties() {
    let mut e = Env::new();
    let seller = e.wallet(50);
    let (b1, b2, stranger) = (e.wallet(50), e.wallet(50), e.wallet(50));
    let (author1, author2) = (e.wallet(1).pubkey(), e.wallet(1).pubkey());
    // коллекция: роялти 5%, авторы 70% / 30%
    let coll = e.collection_with(&seller, &[royalties(500, &[(author1, 70), (author2, 30)])]);
    let nft = e.nft(&seller, Some(coll));
    let lot = pda(&nft);
    let (s, a) = (seller.pubkey(), lot);

    // --- выставить лот: ошибки
    expect_err(e.send(&[ix_create(&stranger.pubkey(), &nft, Some(coll), SOL / 10, SOL / 20, 3600)], &[&stranger]), 6001, "чужой NFT");
    expect_err(e.send(&[ix_create(&s, &nft, Some(coll), 999_999, SOL / 20, 3600)], &[&seller]), 6003, "стартовая цена < 0.001 SOL");
    expect_err(e.send(&[ix_create(&s, &nft, Some(coll), SOL / 10, 0, 3600)], &[&seller]), 6003, "шаг 0");
    expect_err(e.send(&[ix_create(&s, &nft, Some(coll), SOL / 10, SOL / 20, 59)], &[&seller]), 6003, "торги короче минуты");
    expect_err(e.send(&[ix_create(&s, &nft, Some(coll), SOL / 10, SOL / 20, 31 * 86400)], &[&seller]), 6003, "торги дольше 30 дней");
    expect_err(e.send(&[ix_create(&s, &nft, None, SOL / 10, SOL / 20, 3600)], &[&seller]), 6002, "не та коллекция");
    expect_err(e.send(&[ix_create(&s, &stranger.pubkey(), Some(coll), SOL / 10, SOL / 20, 3600)], &[&seller]), 6000, "поддельный NFT");

    // --- кто-то заранее закинул SOL на адрес лота — выставить всё равно можно
    e.svm.airdrop(&lot, 1_000_000).unwrap();
    let seller_before = e.bal(&s);
    expect_ok(e.send(&[ix_create(&s, &nft, Some(coll), SOL / 10, SOL / 20, 3600)], &[&seller]), "выставить лот");
    let l = e.lot(&a);
    assert_eq!((l.seller, l.asset, l.collection, l.min_bid, l.min_increment, l.bid_count), (s, nft, coll, SOL / 10, SOL / 20, 0));
    assert_eq!((l.royalty_bps, l.creators.clone()), (500, vec![(author1, 70), (author2, 30)]), "роялти запомнены");
    assert_eq!(l.end_ts, e.now() + 3600);
    assert_eq!(e.owner_of(&nft), lot, "NFT на хранении у аукциона");
    let rent = e.bal(&a);
    assert!(seller_before - e.bal(&s) <= rent + 2 * FEE, "продавец заплатил только за место и комиссию");
    expect_err(e.send(&[ix_create(&s, &nft, Some(coll), SOL / 10, SOL / 20, 3600)], &[&seller]), 6001, "второй раз тот же NFT (он уже у аукциона)");

    // --- ставки
    expect_err(e.send(&[ix_bid(&b1.pubkey(), &a, SOL / 20)], &[&b1]), 6006, "ниже стартовой");
    expect_err(e.send(&[ix_bid(&s, &a, SOL)], &[&seller]), 6007, "продавец ставит сам");
    expect_err(e.send(&[ix_bid(&b1.pubkey(), &stranger.pubkey(), SOL)], &[&b1]), 6011, "не лот аукциона");
    let mut wrong = ix_bid(&b1.pubkey(), &a, SOL);
    wrong.accounts[2] = AccountMeta::new(bid_pda(&a, &b2.pubkey()), false);
    expect_err(e.send(&[wrong], &[&b1]), 6008, "чужой счёт ставки");

    let b1_start = e.bal(&b1.pubkey());
    expect_ok(e.send(&[ix_bid(&b1.pubkey(), &a, SOL / 10)], &[&b1]), "первая ставка 0.1");
    let bid_rent = e.bal(&bid_pda(&a, &b1.pubkey())) - SOL / 10;
    assert_eq!(e.bal(&b1.pubkey()), b1_start - SOL / 10 - bid_rent - FEE);
    assert_eq!(e.bid_amount(&bid_pda(&a, &b1.pubkey())), SOL / 10);
    let l = e.lot(&a);
    assert_eq!((l.highest_bidder, l.highest_bid, l.bid_count), (b1.pubkey(), SOL / 10, 1));
    expect_err(e.send(&[ix_withdraw(&b1.pubkey(), &a)], &[&b1]), 6013, "лидер не может забрать ставку");
    expect_err(e.send(&[ix_bid(&b2.pubkey(), &a, SOL / 10 + SOL / 20 - 1)], &[&b2]), 6006, "шаг меньше минимального");
    expect_ok(e.send(&[ix_bid(&b2.pubkey(), &a, SOL * 15 / 100)], &[&b2]), "вторая ставка 0.15");
    assert_eq!(e.bal(&a), rent, "на счёте лота только плата за место — ставки лежат на счетах участников");
    expect_err(e.send(&[ix_cancel(&s, &a, &nft, Some(coll))], &[&seller]), 6010, "снять лот со ставками");
    let settle = |payer, winner, creators: &[Address]| Settle { payer, lot: &lot, asset: &nft, coll: Some(coll), seller: &s, winner, creators: creators.to_vec() };
    let (sp, b1p, b2p) = (stranger.pubkey(), b1.pubkey(), b2.pubkey());
    expect_err(e.send(&[ix_settle(settle(&sp, Some(&b2p), &[author1, author2]))], &[&stranger]), 6005, "завершить раньше времени");

    // --- защита от «снайпера»: b1 поднимает свою ставку (доплачивает разницу) за 10 секунд до конца
    let end = e.lot(&a).end_ts;
    e.warp(end - e.now() - 10);
    let b1_before = e.bal(&b1p);
    expect_ok(e.send(&[ix_bid(&b1p, &a, SOL / 2)], &[&b1]), "ставка в последние секунды");
    assert_eq!(e.bal(&b1p), b1_before - (SOL / 2 - SOL / 10) - FEE, "доплачена только разница");
    assert_eq!(e.lot(&a).end_ts, e.now() + 300, "торги продлены");
    // перебитый b2 забирает свою ставку сам, не дожидаясь конца
    let b2_before = e.bal(&b2p);
    expect_ok(e.send(&[ix_withdraw(&b2p, &a)], &[&b2]), "перебитый забирает ставку");
    assert_eq!(e.bal(&b2p), b2_before + SOL * 15 / 100 + bid_rent - FEE, "вернулась ставка и плата за место");
    assert!(e.acc(&bid_pda(&a, &b2p)).is_none());
    e.warp(299);
    expect_err(e.send(&[ix_settle(settle(&sp, Some(&b1p), &[author1, author2]))], &[&stranger]), 6005, "ещё секунда до конца");
    e.warp(1);
    expect_err(e.send(&[ix_bid(&b2p, &a, SOL)], &[&b2]), 6004, "ставка после конца");

    // --- завершение: подмены
    expect_err(e.send(&[ix_settle(settle(&sp, Some(&b2p), &[author1, author2]))], &[&stranger]), 6009, "подмена победителя");
    let mut ix = ix_settle(settle(&sp, Some(&b1p), &[author1, author2]));
    ix.accounts[4] = AccountMeta::new(sp, false);
    expect_err(e.send(&[ix], &[&stranger]), 6001, "подмена продавца");
    let other = e.nft(&seller, Some(coll));
    let mut ix = ix_settle(settle(&sp, Some(&b1p), &[author1, author2]));
    ix.accounts[2] = AccountMeta::new(other, false);
    expect_err(e.send(&[ix], &[&stranger]), 6000, "подмена NFT");
    expect_err(e.send(&[ix_settle(settle(&sp, Some(&b1p), &[author2, author1]))], &[&stranger]), 6015, "авторы не в том порядке");
    expect_err(e.send(&[ix_settle(settle(&sp, Some(&b1p), &[author1]))], &[&stranger]), 6015, "не все авторы");
    expect_err(e.send(&[ix_settle(settle(&sp, Some(&b1p), &[author1, sp]))], &[&stranger]), 6015, "подменённый автор");
    let mut ix = ix_settle(settle(&sp, Some(&b1p), &[author1, author2]));
    ix.accounts[6] = AccountMeta::new(bid_pda(&a, &b2p), false);
    expect_err(e.send(&[ix], &[&stranger]), 6008, "чужой счёт ставки вместо ставки победителя");

    // --- завершение
    let (s_before, a1, a2, w_before) = (e.bal(&s), e.bal(&author1), e.bal(&author2), e.bal(&b1p));
    expect_ok(e.send(&[ix_settle(settle(&sp, Some(&b1p), &[author1, author2]))], &[&stranger]), "завершить");
    assert_eq!(e.owner_of(&nft), b1p, "NFT у победителя");
    let royalty = SOL / 2 * 5 / 100;
    assert_eq!(e.bal(&author1) - a1, royalty * 70 / 100, "автору 1: 70% от 5%");
    assert_eq!(e.bal(&author2) - a2, royalty * 30 / 100, "автору 2: 30% от 5%");
    assert_eq!(e.bal(&s), s_before + SOL / 2 - royalty + rent, "продавцу: ставка − роялти + плата за место лота");
    assert_eq!(e.bal(&b1p), w_before + bid_rent, "победителю вернулась плата за место ставки");
    assert!(e.acc(&a).is_none(), "счёт лота закрыт");
    assert!(e.acc(&bid_pda(&a, &b1p)).is_none(), "счёт ставки победителя закрыт");
    expect_err(e.send(&[ix_settle(settle(&sp, Some(&b1p), &[author1, author2]))], &[&stranger]), 6011, "завершить второй раз");
}

#[test]
fn cancel_and_no_bids() {
    let mut e = Env::new();
    let seller = e.wallet(50);
    let stranger = e.wallet(50);
    let coll = e.collection(&seller);
    let nft = e.nft(&seller, Some(coll));
    let (s, a, sp) = (seller.pubkey(), pda(&nft), stranger.pubkey());

    expect_ok(e.send(&[ix_create(&s, &nft, Some(coll), SOL / 10, SOL / 20, 3600)], &[&seller]), "выставить");
    expect_err(e.send(&[ix_cancel(&sp, &a, &nft, Some(coll))], &[&stranger]), 6001, "чужой снимает лот");
    let before = e.bal(&s);
    expect_ok(e.send(&[ix_cancel(&s, &a, &nft, Some(coll))], &[&seller]), "снять с торгов");
    assert_eq!(e.owner_of(&nft), s, "NFT вернулся");
    assert!(e.bal(&s) > before, "плата за место вернулась");
    assert!(e.acc(&a).is_none());

    // тот же NFT снова; торги без ставок → NFT продавцу
    expect_ok(e.send(&[ix_create(&s, &nft, Some(coll), SOL / 10, SOL / 20, 60)], &[&seller]), "выставить снова");
    e.warp(60);
    let base = Settle { payer: &sp, lot: &a, asset: &nft, coll: Some(coll), seller: &s, winner: Some(&sp), creators: vec![] };
    expect_err(e.send(&[ix_settle(base)], &[&stranger]), 6009, "без ставок победитель — только продавец");
    let ok = Settle { payer: &sp, lot: &a, asset: &nft, coll: Some(coll), seller: &s, winner: None, creators: vec![] };
    expect_ok(e.send(&[ix_settle(ok)], &[&stranger]), "завершить без ставок");
    assert_eq!(e.owner_of(&nft), s);
}

#[test]
fn nft_royalty_without_collection_and_tiny_share() {
    let mut e = Env::new();
    let seller = e.wallet(50);
    let b1 = e.wallet(50);
    let author = e.wallet(1).pubkey();
    let fresh = Keypair::new().pubkey(); // пустой адрес: маленькую долю на него зачислить нельзя
    // NFT без коллекции, роялти 10% на самом NFT: 50% автору, 50% пустому адресу
    let nft = e.nft_with(&seller, None, &[royalties(1000, &[(author, 50), (fresh, 50)])]);
    let (s, a, bp) = (seller.pubkey(), pda(&nft), b1.pubkey());
    expect_ok(e.send(&[ix_create(&s, &nft, None, SOL / 200, SOL / 200, 3600)], &[&seller]), "выставить без коллекции");
    let l = e.lot(&a);
    assert_eq!((l.collection, l.royalty_bps), (Address::default(), 1000));

    expect_ok(e.send(&[ix_bid(&bp, &a, SOL / 200)], &[&b1]), "ставка 0.005");
    expect_ok(e.send(&[ix_bid(&bp, &a, SOL / 100)], &[&b1]), "поднять свою ставку до 0.01");
    assert_eq!(e.bid_amount(&bid_pda(&a, &bp)), SOL / 100);
    e.to_end(&a);
    let (s_before, au) = (e.bal(&s), e.bal(&author));
    let rent = e.bal(&a);
    let st = Settle { payer: &bp, lot: &a, asset: &nft, coll: None, seller: &s, winner: Some(&bp), creators: vec![author, fresh] };
    expect_ok(e.send(&[ix_settle(st)], &[&b1]), "победитель сам завершает");
    assert_eq!(e.owner_of(&nft), bp);
    let half = SOL / 100 / 10 / 2; // 0.0005 SOL — меньше платы за пустой счёт
    assert_eq!(e.bal(&author) - au, half, "автору его доля");
    assert_eq!(e.bal(&fresh), 0, "на пустой адрес не зачислили (иначе вся транзакция бы упала)");
    assert_eq!(e.bal(&s), s_before + SOL / 100 - half + rent, "непереданная доля — продавцу");
}

#[test]
fn dangerous_plugins_rejected() {
    let mut e = Env::new();
    let seller = e.wallet(50);
    let s = seller.pubkey();
    // NFT с «постоянным делегатом передачи» — его могли бы забрать со счёта лота
    let nft = e.nft_with(&seller, None, &[vec![7]]);
    expect_err(e.send(&[ix_create(&s, &nft, None, SOL / 10, SOL / 20, 3600)], &[&seller]), 6014, "PermanentTransferDelegate");
    // NFT с делегатом заморозки
    let nft = e.nft_with(&seller, None, &[vec![1, 0]]);
    expect_err(e.send(&[ix_create(&s, &nft, None, SOL / 10, SOL / 20, 3600)], &[&seller]), 6014, "FreezeDelegate");
    // коллекция с постоянным делегатом сжигания — любой её NFT не принимаем
    let bad = e.collection_with(&seller, &[vec![8]]);
    let nft = e.nft(&seller, Some(bad));
    expect_err(e.send(&[ix_create(&s, &nft, Some(bad), SOL / 10, SOL / 20, 3600)], &[&seller]), 6014, "PermanentBurnDelegate у коллекции");
    // безопасные плагины (Attributes, ImmutableMetadata) — можно
    let attrs = { let mut d = vec![6u8]; d.extend(1u32.to_le_bytes()); push_str(&mut d, "серия"); push_str(&mut d, "Моди"); d };
    let nft = e.nft_with(&seller, None, &[attrs, vec![12]]);
    expect_ok(e.send(&[ix_create(&s, &nft, None, SOL / 10, SOL / 20, 3600)], &[&seller]), "Attributes + ImmutableMetadata");
    assert_eq!(e.lot(&pda(&nft)).royalty_bps, 0);
}

#[test]
fn winner_refund_after_grace() {
    let mut e = Env::new();
    let seller = e.wallet(50);
    let b1 = e.wallet(50);
    let coll = e.collection(&seller);
    let nft = e.nft(&seller, Some(coll));
    let (s, a, bp) = (seller.pubkey(), pda(&nft), b1.pubkey());
    expect_ok(e.send(&[ix_create(&s, &nft, Some(coll), SOL / 10, SOL / 20, 3600)], &[&seller]), "выставить");
    expect_ok(e.send(&[ix_bid(&bp, &a, SOL)], &[&b1]), "ставка 1 SOL");
    e.to_end(&a);
    e.warp(GRACE - 1);
    expect_err(e.send(&[ix_withdraw(&bp, &a)], &[&b1]), 6013, "до конца страховки — нельзя");
    e.warp(1);
    // лот так и не завершили 7 дней — победитель забирает деньги
    let before = e.bal(&bp);
    expect_ok(e.send(&[ix_withdraw(&bp, &a)], &[&b1]), "страховка: забрать ставку");
    assert!(e.bal(&bp) > before + SOL - FEE, "вернулся 1 SOL и плата за место");
    let l = e.lot(&a);
    assert_eq!((l.highest_bidder, l.highest_bid), (Address::default(), 0));
    // теперь завершение возвращает NFT продавцу, без оплаты
    let st = Settle { payer: &s, lot: &a, asset: &nft, coll: Some(coll), seller: &s, winner: None, creators: vec![] };
    expect_ok(e.send(&[ix_settle(st)], &[&seller]), "завершить без победителя");
    assert_eq!(e.owner_of(&nft), s);
}

#[test]
fn old_bid_from_previous_auction() {
    let mut e = Env::new();
    let seller = e.wallet(50);
    let (b1, b2) = (e.wallet(50), e.wallet(50));
    let coll = e.collection(&seller);
    let nft = e.nft(&seller, Some(coll));
    let (s, a, b1p, b2p) = (seller.pubkey(), pda(&nft), b1.pubkey(), b2.pubkey());
    let me = s;

    // торги 1: b1 ставит, b2 перебивает и выигрывает; b1 свою ставку не забирает
    expect_ok(e.send(&[ix_create(&s, &nft, Some(coll), SOL / 10, SOL / 20, 3600)], &[&seller]), "торги 1");
    expect_ok(e.send(&[ix_bid(&b1p, &a, SOL / 10)], &[&b1]), "b1");
    expect_ok(e.send(&[ix_bid(&b2p, &a, SOL / 5)], &[&b2]), "b2");
    e.to_end(&a);
    let st = Settle { payer: &s, lot: &a, asset: &nft, coll: Some(coll), seller: &s, winner: Some(&b2p), creators: vec![me] };
    expect_ok(e.send(&[ix_settle(st)], &[&seller]), "завершить торги 1");

    // торги 2: b2 перепродаёт тот же NFT — адрес лота тот же
    expect_ok(e.send(&[ix_create(&b2p, &nft, Some(coll), SOL / 10, SOL / 20, 3600)], &[&b2]), "торги 2");
    expect_err(e.send(&[ix_bid(&b1p, &a, SOL)], &[&b1]), 6012, "старая ставка с прошлых торгов");
    let before = e.bal(&b1p);
    expect_ok(e.send(&[ix_withdraw(&b1p, &a)], &[&b1]), "забрать старую ставку");
    assert!(e.bal(&b1p) > before + SOL / 10 - FEE);
    expect_ok(e.send(&[ix_bid(&b1p, &a, SOL)], &[&b1]), "новая ставка");
    // и ставку на закрытом лоте тоже можно забрать
    e.to_end(&a);
    let st = Settle { payer: &b1p, lot: &a, asset: &nft, coll: Some(coll), seller: &b2p, winner: Some(&b1p), creators: vec![me] };
    expect_ok(e.send(&[ix_settle(st)], &[&b1]), "завершить торги 2");
    assert_eq!(e.owner_of(&nft), b1p);
    // b1 передаёт NFT дальше — проверка, что NFT свободен
    let c = Keypair::new().pubkey();
    e.give(&b1, &nft, Some(coll), &c);
    assert_eq!(e.owner_of(&nft), c);
}

#[test]
fn wrong_inputs() {
    let mut e = Env::new();
    let seller = e.wallet(50);
    let coll = e.collection(&seller);
    let nft = e.nft(&seller, Some(coll));
    // мусор вместо команды
    let bad = Instruction { program_id: PID, accounts: vec![AccountMeta::new(seller.pubkey(), true)], data: vec![9, 9] };
    assert!(e.send(&[bad], &[&seller]).is_err());
    // неправильный адрес лота
    let mut ix = ix_create(&seller.pubkey(), &nft, Some(coll), SOL / 10, SOL / 20, 3600);
    ix.accounts[1] = AccountMeta::new(Keypair::new().pubkey(), false);
    expect_err(e.send(&[ix], &[&seller]), 6011, "чужой адрес лота");
    // подсунутая «программа Core»
    let mut ix = ix_create(&seller.pubkey(), &nft, Some(coll), SOL / 10, SOL / 20, 3600);
    ix.accounts[4] = AccountMeta::new_readonly(SYSTEM, false);
    assert!(e.send(&[ix], &[&seller]).is_err(), "поддельная программа Core");
    // забрать несуществующую ставку
    let lot = pda(&nft);
    expect_ok(e.send(&[ix_create(&seller.pubkey(), &nft, Some(coll), SOL / 10, SOL / 20, 3600)], &[&seller]), "выставить");
    let x = e.wallet(1);
    expect_err(e.send(&[ix_withdraw(&x.pubkey(), &lot)], &[&x]), 6008, "нет ставки");
}

#[test]
fn same_addresses_as_website() {
    // те же значения печатает auction/tests/client.test.mjs — сайт и программа считают адреса одинаково
    let asset = Address::new_from_array([2; 32]);
    let lot = pda(&asset);
    assert_eq!(lot, Address::from_str_const("4effEs5qRp7Uf8nRwcBdfHZqAJEZXxYMoXZCJCPZfS4c"));
    println!("bid PDA (лот [2;32], участник [4;32]): {}", bid_pda(&lot, &Address::new_from_array([4; 32])));
}
