//! Проверка программы аукциона «КИР» в LiteSVM — копии блокчейна прямо внутри теста.
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

    // ---------- Metaplex Core (формат команд сверен с @metaplex-foundation/mpl-core)
    fn collection(&mut self, payer: &Keypair) -> Address {
        let coll = Keypair::new();
        // CreateCollectionV1: name «КИР», uri, плагин Royalties 5% автору, rule set None
        let mut d = vec![1u8];
        push_str(&mut d, "КИР");
        push_str(&mut d, "https://example.com/c.json");
        d.extend([1, 1, 0, 0, 0, 0]); // Some(vec из 1 плагина), тег Royalties
        d.extend(500u16.to_le_bytes());
        d.extend([1, 0, 0, 0]);
        d.extend(payer.pubkey().as_ref());
        d.extend([100, 0, 0]); // доля 100%, RuleSet::None, authority None
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

    fn nft(&mut self, payer: &Keypair, collection: Option<Address>) -> Address {
        let asset = Keypair::new();
        let mut d = vec![0u8, 0];
        push_str(&mut d, "Тест КИР");
        push_str(&mut d, "https://example.com/a.json");
        d.extend([1, 0, 0, 0, 0]); // Some(пустой список плагинов)
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
}

fn push_str(d: &mut Vec<u8>, s: &str) {
    d.extend((s.len() as u32).to_le_bytes());
    d.extend(s.as_bytes());
}

fn pda(asset: &Address) -> Address {
    Address::find_program_address(&[b"auction", asset.as_ref()], &PID).0
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

fn ix_bid(bidder: &Address, auction: &Address, previous: &Address, amount: u64) -> Instruction {
    let mut d = vec![1u8];
    d.extend(amount.to_le_bytes());
    Instruction {
        program_id: PID,
        accounts: vec![
            AccountMeta::new(*bidder, true),
            AccountMeta::new(*auction, false),
            AccountMeta::new(*previous, false),
            AccountMeta::new_readonly(SYSTEM, false),
        ],
        data: d,
    }
}

fn ix_settle(payer: &Address, auction: &Address, asset: &Address, coll: Option<Address>, seller: &Address, winner: &Address) -> Instruction {
    Instruction {
        program_id: PID,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(*auction, false),
            AccountMeta::new(*asset, false),
            AccountMeta::new_readonly(coll.unwrap_or(CORE), false),
            AccountMeta::new(*seller, false),
            AccountMeta::new_readonly(*winner, false),
            AccountMeta::new_readonly(CORE, false),
            AccountMeta::new_readonly(SYSTEM, false),
        ],
        data: vec![2],
    }
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
}
impl Lot {
    fn read(d: &[u8]) -> Self {
        assert_eq!(d.len(), 174);
        assert_eq!(d[0], 1);
        let a = |o: usize| Address::try_from(&d[o..o + 32]).unwrap();
        let u = |o: usize| u64::from_le_bytes(d[o..o + 8].try_into().unwrap());
        Lot {
            seller: a(1), asset: a(33), collection: a(65), min_bid: u(97), min_increment: u(105),
            end_ts: u(121) as i64, highest_bidder: a(129), highest_bid: u(161),
            bid_count: u32::from_le_bytes(d[169..173].try_into().unwrap()),
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
fn full_auction() {
    let mut e = Env::new();
    let seller = e.wallet(50);
    let (b1, b2, stranger) = (e.wallet(50), e.wallet(50), e.wallet(50));
    let coll = e.collection(&seller);
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
    assert_eq!(l.end_ts, e.now() + 3600);
    assert_eq!(e.owner_of(&nft), lot, "NFT на хранении у аукциона");
    let rent = e.bal(&a);
    assert!(seller_before - e.bal(&s) <= rent + 2 * FEE, "продавец заплатил только за место и комиссию");
    expect_err(e.send(&[ix_create(&s, &nft, Some(coll), SOL / 10, SOL / 20, 3600)], &[&seller]), 6001, "второй раз тот же NFT (он уже у аукциона)");

    // --- ставки
    expect_err(e.send(&[ix_bid(&b1.pubkey(), &a, &b1.pubkey(), SOL / 20)], &[&b1]), 6006, "ниже стартовой");
    expect_err(e.send(&[ix_bid(&s, &a, &s, SOL)], &[&seller]), 6007, "продавец ставит сам");
    expect_err(e.send(&[ix_bid(&b1.pubkey(), &stranger.pubkey(), &b1.pubkey(), SOL)], &[&b1]), 6011, "не лот аукциона");
    let b1_before = e.bal(&b1.pubkey());
    expect_ok(e.send(&[ix_bid(&b1.pubkey(), &a, &b1.pubkey(), SOL / 10)], &[&b1]), "первая ставка 0.1");
    assert_eq!(e.bal(&b1.pubkey()), b1_before - SOL / 10 - FEE);
    let l = e.lot(&a);
    assert_eq!((l.highest_bidder, l.highest_bid, l.bid_count), (b1.pubkey(), SOL / 10, 1));
    expect_err(e.send(&[ix_bid(&b2.pubkey(), &a, &b1.pubkey(), SOL / 10 + SOL / 20 - 1)], &[&b2]), 6006, "шаг меньше минимального");
    expect_err(e.send(&[ix_bid(&b2.pubkey(), &a, &stranger.pubkey(), SOL)], &[&b2]), 6008, "подмена прошлого лидера");
    expect_ok(e.send(&[ix_bid(&b2.pubkey(), &a, &b1.pubkey(), SOL * 15 / 100)], &[&b2]), "вторая ставка 0.15");
    assert_eq!(e.bal(&b1.pubkey()), b1_before - FEE, "первому вернули всю ставку (потрачена только комиссия)");
    assert_eq!(e.bal(&a), rent + SOL * 15 / 100, "на лоте ровно ставка лидера + плата за место");
    expect_err(e.send(&[ix_cancel(&s, &a, &nft, Some(coll))], &[&seller]), 6010, "снять лот со ставками");
    expect_err(e.send(&[ix_settle(&stranger.pubkey(), &a, &nft, Some(coll), &s, &b2.pubkey())], &[&stranger]), 6005, "завершить раньше времени");

    // --- защита от «снайпера»: ставка за 10 секунд до конца продлевает торги на 5 минут
    let end = e.lot(&a).end_ts;
    e.warp(end - e.now() - 10);
    expect_ok(e.send(&[ix_bid(&b1.pubkey(), &a, &b2.pubkey(), SOL / 2)], &[&b1]), "ставка в последние секунды");
    assert_eq!(e.lot(&a).end_ts, e.now() + 300, "торги продлены");
    e.warp(299);
    expect_err(e.send(&[ix_settle(&stranger.pubkey(), &a, &nft, Some(coll), &s, &b1.pubkey())], &[&stranger]), 6005, "ещё секунда до конца");
    e.warp(1);
    expect_err(e.send(&[ix_bid(&b2.pubkey(), &a, &b1.pubkey(), SOL)], &[&b2]), 6004, "ставка после конца");

    // --- завершение
    expect_err(e.send(&[ix_settle(&stranger.pubkey(), &a, &nft, Some(coll), &s, &b2.pubkey())], &[&stranger]), 6009, "подмена победителя");
    expect_err(e.send(&[ix_settle(&stranger.pubkey(), &a, &nft, Some(coll), &stranger.pubkey(), &b1.pubkey())], &[&stranger]), 6001, "подмена продавца");
    let other = e.nft(&seller, Some(coll));
    expect_err(e.send(&[ix_settle(&stranger.pubkey(), &a, &other, Some(coll), &s, &b1.pubkey())], &[&stranger]), 6000, "подмена NFT");
    let s_before = e.bal(&s);
    expect_ok(e.send(&[ix_settle(&stranger.pubkey(), &a, &nft, Some(coll), &s, &b1.pubkey())], &[&stranger]), "завершить");
    assert_eq!(e.owner_of(&nft), b1.pubkey(), "NFT у победителя");
    assert_eq!(e.bal(&s), s_before + SOL / 2 + rent, "продавцу: ставка + возврат платы за место");
    assert!(e.acc(&a).is_none(), "счёт лота закрыт");
    expect_err(e.send(&[ix_settle(&stranger.pubkey(), &a, &nft, Some(coll), &s, &b1.pubkey())], &[&stranger]), 6011, "завершить второй раз");
}

#[test]
fn cancel_and_no_bids() {
    let mut e = Env::new();
    let seller = e.wallet(50);
    let stranger = e.wallet(50);
    let coll = e.collection(&seller);
    let nft = e.nft(&seller, Some(coll));
    let (s, a) = (seller.pubkey(), pda(&nft));

    expect_ok(e.send(&[ix_create(&s, &nft, Some(coll), SOL / 10, SOL / 20, 3600)], &[&seller]), "выставить");
    expect_err(e.send(&[ix_cancel(&stranger.pubkey(), &a, &nft, Some(coll))], &[&stranger]), 6001, "чужой снимает лот");
    let before = e.bal(&s);
    expect_ok(e.send(&[ix_cancel(&s, &a, &nft, Some(coll))], &[&seller]), "снять с торгов");
    assert_eq!(e.owner_of(&nft), s, "NFT вернулся");
    assert!(e.bal(&s) > before, "плата за место вернулась");
    assert!(e.acc(&a).is_none());

    // тот же NFT снова; торги без ставок → NFT продавцу
    expect_ok(e.send(&[ix_create(&s, &nft, Some(coll), SOL / 10, SOL / 20, 60)], &[&seller]), "выставить снова");
    e.warp(60);
    expect_err(e.send(&[ix_settle(&stranger.pubkey(), &a, &nft, Some(coll), &s, &stranger.pubkey())], &[&stranger]), 6009, "без ставок победитель — только продавец");
    expect_ok(e.send(&[ix_settle(&stranger.pubkey(), &a, &nft, Some(coll), &s, &s)], &[&stranger]), "завершить без ставок");
    assert_eq!(e.owner_of(&nft), s);
}

#[test]
fn raise_own_bid_and_no_collection() {
    let mut e = Env::new();
    let seller = e.wallet(50);
    let b1 = e.wallet(50);
    // NFT без коллекции тоже можно выставить
    let nft = e.nft(&seller, None);
    let (s, a) = (seller.pubkey(), pda(&nft));
    expect_ok(e.send(&[ix_create(&s, &nft, None, SOL / 10, SOL / 20, 3600)], &[&seller]), "выставить без коллекции");
    assert_eq!(e.lot(&a).collection, Address::default());

    let start = e.bal(&b1.pubkey());
    expect_ok(e.send(&[ix_bid(&b1.pubkey(), &a, &b1.pubkey(), SOL / 10)], &[&b1]), "ставка");
    expect_ok(e.send(&[ix_bid(&b1.pubkey(), &a, &b1.pubkey(), SOL * 3 / 10)], &[&b1]), "поднять свою ставку");
    assert_eq!(e.bal(&b1.pubkey()), start - SOL * 3 / 10 - 2 * FEE, "списано ровно 0.3 SOL");
    e.warp(3600);
    expect_ok(e.send(&[ix_settle(&b1.pubkey(), &a, &nft, None, &s, &b1.pubkey())], &[&b1]), "победитель сам завершает");
    assert_eq!(e.owner_of(&nft), b1.pubkey());
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
}

#[test]
fn same_lot_address_as_website() {
    // то же значение печатает auction/tests/client.test.mjs — сайт и программа считают адрес лота одинаково
    assert_eq!(pda(&Address::new_from_array([2; 32])), Address::from_str_const("4effEs5qRp7Uf8nRwcBdfHZqAJEZXxYMoXZCJCPZfS4c"));
}
