//! Аукцион NFT «КИР» на Solana (английский аукцион в SOL для NFT стандарта Metaplex Core). Версия 2 — для mainnet.
//!
//! Как работает:
//! - `CreateAuction` (0) — продавец отдаёт NFT на хранение программе (счёт аукциона, PDA ["auction", asset]).
//!                         Проверяются плагины NFT и запоминаются роялти автора (на момент выставления).
//! - `PlaceBid`      (1) — ставка лежит на личном счёте ставки участника (PDA ["bid", аукцион, участник]).
//!                         Деньги никому «насильно» не отправляются — перебитый участник забирает их сам (`Withdraw`).
//!                         Ставка в последние 5 минут продлевает торги на 5 минут (защита от «снайперов»).
//! - `Settle`        (2) — после конца торгов кто угодно может завершить: NFT — победителю,
//!                         SOL — продавцу и авторам (роялти). Без ставок NFT возвращается продавцу.
//! - `Cancel`        (3) — продавец снимает лот, пока не было ни одной ставки.
//! - `Withdraw`      (4) — забрать свою ставку: если тебя перебили или лот закрыт. Победитель может забрать
//!                         ставку, только если лот не удалось завершить за 7 дней после конца (страховка).
//!
//! Написано на pinocchio (без лишних зависимостей), чтобы собиралось и на Windows.
//! ВАЖНО: перед запуском в основной сети (mainnet) программу нужно отдать на аудит безопасности.
#![cfg_attr(target_os = "solana", no_std)]

use pinocchio::{
    account::AccountView,
    cpi::{invoke_signed, Seed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    Address, ProgramResult,
};
use pinocchio_system::{create_account_with_minimum_balance_signed, instructions::Transfer};

#[cfg(target_os = "solana")]
mod entry {
    use pinocchio::{default_allocator, nostd_panic_handler, program_entrypoint};
    program_entrypoint!(super::process_instruction);
    default_allocator!();
    nostd_panic_handler!();
}

/// Программа Metaplex Core
pub const CORE_ID: Address = Address::from_str_const("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
pub const SYSTEM_ID: Address = pinocchio_system::ID;
pub const SEED: &[u8] = b"auction";
pub const BID_SEED: &[u8] = b"bid";

/// Ставка в последние 5 минут продлевает торги до «сейчас + 5 минут»
#[cfg(not(feature = "test-short"))]
pub const EXTEND_SECS: i64 = 300;
#[cfg(not(feature = "test-short"))]
pub const MIN_DURATION: i64 = 60;
// для автотестов: короткие торги, чтобы не ждать минутами (не для выкладки!)
#[cfg(feature = "test-short")]
pub const EXTEND_SECS: i64 = 4;
#[cfg(feature = "test-short")]
pub const MIN_DURATION: i64 = 3;
pub const MAX_DURATION: i64 = 30 * 24 * 3600;
/// Если лот не удалось завершить за 7 дней после конца, победитель может забрать свою ставку
pub const GRACE_SECS: i64 = 7 * 24 * 3600;
/// Минимальная ставка 0.001 SOL
pub const MIN_BID: u64 = 1_000_000;
/// Сколько авторов роялти помещается в лот (в Metaplex Core обычно 1–2)
pub const MAX_CREATORS: usize = 5;

// коды ошибок (совпадают с auction/client/kir-auction.js)
pub const E_WRONG_ASSET: u32 = 6000;
pub const E_NOT_OWNER: u32 = 6001;
pub const E_WRONG_COLLECTION: u32 = 6002;
pub const E_BAD_PARAMS: u32 = 6003;
pub const E_ALREADY_ENDED: u32 = 6004;
pub const E_NOT_ENDED: u32 = 6005;
pub const E_BID_TOO_LOW: u32 = 6006;
pub const E_SELLER_CANNOT_BID: u32 = 6007;
pub const E_WRONG_BID: u32 = 6008;
pub const E_WRONG_WINNER: u32 = 6009;
pub const E_HAS_BIDS: u32 = 6010;
pub const E_WRONG_AUCTION: u32 = 6011;
pub const E_OLD_BID: u32 = 6012;
pub const E_LEADER_LOCKED: u32 = 6013;
pub const E_UNSUPPORTED_NFT: u32 = 6014;
pub const E_WRONG_CREATORS: u32 = 6015;
const fn err(code: u32) -> ProgramError {
    ProgramError::Custom(code)
}

// ---------------------------------------------------------------- чтение байтов

fn addr_at(d: &[u8], o: usize) -> Result<Address, ProgramError> {
    let s = d.get(o..o + 32).ok_or(ProgramError::InvalidAccountData)?;
    let mut a = [0u8; 32];
    a.copy_from_slice(s);
    Ok(Address::new_from_array(a))
}
fn u64_at(d: &[u8], o: usize) -> Result<u64, ProgramError> {
    let s = d.get(o..o + 8).ok_or(ProgramError::InvalidAccountData)?;
    let mut b = [0u8; 8];
    b.copy_from_slice(s);
    Ok(u64::from_le_bytes(b))
}
fn u32_at(d: &[u8], o: usize) -> Result<u32, ProgramError> {
    let s = d.get(o..o + 4).ok_or(ProgramError::InvalidAccountData)?;
    let mut b = [0u8; 4];
    b.copy_from_slice(s);
    Ok(u32::from_le_bytes(b))
}
fn u8_at(d: &[u8], o: usize) -> Result<u8, ProgramError> {
    d.get(o).copied().ok_or(ProgramError::InvalidAccountData)
}

// ---------------------------------------------------------------- данные лота

/// Роялти: доля от цены (в сотых долях процента) и авторы с их процентами
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Royalty {
    pub bps: u16,
    pub count: u8,
    pub creators: [(Address, u8); MAX_CREATORS],
}

/// Счёт аукциона, 342 байта:
/// key(1)=3 seller(32) asset(32) collection(32) min_bid(8) min_increment(8) start_ts(8) end_ts(8)
/// highest_bidder(32) highest_bid(8) bid_count(4) bump(1) royalty_bps(2) creators_count(1) creators(5 × [адрес 32 + доля 1])
#[derive(Clone, Debug, PartialEq)]
pub struct Auction {
    pub seller: Address,
    pub asset: Address,
    /// Address::default(), если NFT вне коллекции
    pub collection: Address,
    pub min_bid: u64,
    pub min_increment: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    /// Address::default() — победителя нет (ставок не было или победитель забрал ставку по страховке)
    pub highest_bidder: Address,
    pub highest_bid: u64,
    pub bid_count: u32,
    pub bump: u8,
    pub royalty: Royalty,
}

pub const AUCTION_KEY: u8 = 3;
pub const AUCTION_SIZE: usize = 177 + MAX_CREATORS * 33;

impl Auction {
    pub fn read(d: &[u8]) -> Result<Self, ProgramError> {
        if d.len() != AUCTION_SIZE || d[0] != AUCTION_KEY {
            return Err(err(E_WRONG_AUCTION));
        }
        let d: &[u8; AUCTION_SIZE] = d.try_into().map_err(|_| err(E_WRONG_AUCTION))?;
        let mut royalty = Royalty { bps: u16::from_le_bytes([d[174], d[175]]), count: d[176], ..Default::default() };
        if royalty.count as usize > MAX_CREATORS {
            return Err(err(E_WRONG_AUCTION));
        }
        for (i, c) in royalty.creators.iter_mut().enumerate() {
            *c = (addr_at(d, 177 + i * 33)?, d[177 + i * 33 + 32]);
        }
        Ok(Self {
            seller: addr_at(d, 1)?,
            asset: addr_at(d, 33)?,
            collection: addr_at(d, 65)?,
            min_bid: u64_at(d, 97)?,
            min_increment: u64_at(d, 105)?,
            start_ts: u64_at(d, 113)? as i64,
            end_ts: u64_at(d, 121)? as i64,
            highest_bidder: addr_at(d, 129)?,
            highest_bid: u64_at(d, 161)?,
            bid_count: u32_at(d, 169)?,
            bump: d[173],
            royalty,
        })
    }

    pub fn write(&self, d: &mut [u8]) -> ProgramResult {
        if d.len() != AUCTION_SIZE {
            return Err(ProgramError::AccountDataTooSmall);
        }
        let d: &mut [u8; AUCTION_SIZE] = d.try_into().map_err(|_| ProgramError::AccountDataTooSmall)?;
        d[0] = AUCTION_KEY;
        d[1..33].copy_from_slice(self.seller.as_ref());
        d[33..65].copy_from_slice(self.asset.as_ref());
        d[65..97].copy_from_slice(self.collection.as_ref());
        d[97..105].copy_from_slice(&self.min_bid.to_le_bytes());
        d[105..113].copy_from_slice(&self.min_increment.to_le_bytes());
        d[113..121].copy_from_slice(&self.start_ts.to_le_bytes());
        d[121..129].copy_from_slice(&self.end_ts.to_le_bytes());
        d[129..161].copy_from_slice(self.highest_bidder.as_ref());
        d[161..169].copy_from_slice(&self.highest_bid.to_le_bytes());
        d[169..173].copy_from_slice(&self.bid_count.to_le_bytes());
        d[173] = self.bump;
        d[174..176].copy_from_slice(&self.royalty.bps.to_le_bytes());
        d[176] = self.royalty.count;
        for (i, (a, p)) in self.royalty.creators.iter().enumerate() {
            d[177 + i * 33..209 + i * 33].copy_from_slice(a.as_ref());
            d[209 + i * 33] = *p;
        }
        Ok(())
    }

    fn has_winner(&self) -> bool {
        self.highest_bidder != Address::default()
    }
}

/// Счёт ставки, 82 байта: key(1)=4 auction(32) bidder(32) auction_start(8) amount(8) bump(1).
/// На нём лежат сама ставка (amount) + плата за место (вернётся участнику).
#[derive(Clone, Debug, PartialEq)]
pub struct Bid {
    pub auction: Address,
    pub bidder: Address,
    /// время начала тех торгов, к которым относится ставка (тот же NFT могут выставить снова)
    pub auction_start: i64,
    pub amount: u64,
    pub bump: u8,
}

pub const BID_KEY: u8 = 4;
pub const BID_SIZE: usize = 82;

impl Bid {
    pub fn read(d: &[u8]) -> Result<Self, ProgramError> {
        if d.len() != BID_SIZE || d[0] != BID_KEY {
            return Err(err(E_WRONG_BID));
        }
        Ok(Self {
            auction: addr_at(d, 1)?,
            bidder: addr_at(d, 33)?,
            auction_start: u64_at(d, 65)? as i64,
            amount: u64_at(d, 73)?,
            bump: d[81],
        })
    }

    pub fn write(&self, d: &mut [u8]) -> ProgramResult {
        if d.len() != BID_SIZE {
            return Err(ProgramError::AccountDataTooSmall);
        }
        d[0] = BID_KEY;
        d[1..33].copy_from_slice(self.auction.as_ref());
        d[33..65].copy_from_slice(self.bidder.as_ref());
        d[65..73].copy_from_slice(&self.auction_start.to_le_bytes());
        d[73..81].copy_from_slice(&self.amount.to_le_bytes());
        d[81] = self.bump;
        Ok(())
    }
}

fn u64_arg(d: &[u8], o: usize) -> Result<u64, ProgramError> {
    u64_at(d, o).map_err(|_| ProgramError::InvalidInstructionData)
}

// ---------------------------------------------------------------- вход

pub fn process_instruction(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    match data.first() {
        // CreateAuction { min_bid: u64, min_increment: u64, duration: i64 }
        Some(0) if data.len() == 25 => {
            create_auction(program_id, accounts, u64_arg(data, 1)?, u64_arg(data, 9)?, u64_arg(data, 17)? as i64)
        }
        // PlaceBid { amount: u64 } — новая сумма ставки целиком (не прибавка)
        Some(1) if data.len() == 9 => place_bid(program_id, accounts, u64_arg(data, 1)?),
        Some(2) if data.len() == 1 => settle(program_id, accounts),
        Some(3) if data.len() == 1 => cancel(program_id, accounts),
        Some(4) if data.len() == 1 => withdraw(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// ---------------------------------------------------------------- выставить лот
// счета: 0 [s,w] продавец, 1 [w] аукцион (PDA), 2 [w] NFT, 3 [] коллекция (или CORE_ID, если её нет),
//        4 [] Metaplex Core, 5 [] System Program

fn create_auction(program_id: &Address, accounts: &mut [AccountView], min_bid: u64, min_increment: u64, duration: i64) -> ProgramResult {
    let [seller, auction, asset, collection, core, system, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !seller.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    check_programs(core, system)?;
    if min_bid < MIN_BID || min_increment == 0 || !(MIN_DURATION..=MAX_DURATION).contains(&duration) {
        return Err(err(E_BAD_PARAMS));
    }

    // NFT должен быть настоящим Core-ассетом продавца без опасных плагинов
    let (owner, collection_of_asset, asset_royalty) = read_asset(asset)?;
    if owner != *seller.address() {
        return Err(err(E_NOT_OWNER));
    }
    check_collection(collection, collection_of_asset.as_ref())?;
    // роялти NFT важнее роялти коллекции (так считает и сам Metaplex Core)
    let royalty = match (asset_royalty, collection_of_asset) {
        (Some(r), _) => r,
        (None, Some(_)) => read_collection(collection)?.unwrap_or_default(),
        (None, None) => Royalty::default(),
    };
    if collection_of_asset.is_some() {
        read_collection(collection)?; // и у коллекции не должно быть опасных плагинов
    }

    let (pda, bump) = Address::find_program_address(&[SEED, asset.address().as_ref()], program_id);
    if pda != *auction.address() {
        return Err(err(E_WRONG_AUCTION));
    }
    if !auction.is_data_empty() || !auction.owned_by(&SYSTEM_ID) {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    // счёт аукциона: место оплачивает продавец (вернётся ему при закрытии лота)
    let bump_ref = [bump];
    let seeds = [Seed::from(SEED), Seed::from(asset.address().as_ref()), Seed::from(&bump_ref)];
    create_account_with_minimum_balance_signed(auction, AUCTION_SIZE, program_id, seller, None, &[Signer::from(&seeds)])?;

    let now = Clock::get()?.unix_timestamp;
    let state = Auction {
        seller: seller.address().clone(),
        asset: asset.address().clone(),
        collection: collection_of_asset.unwrap_or_default(),
        min_bid,
        min_increment,
        start_ts: now,
        end_ts: now.checked_add(duration).ok_or(err(E_BAD_PARAMS))?,
        highest_bidder: Address::default(),
        highest_bid: 0,
        bid_count: 0,
        bump,
        royalty,
    };
    state.write(&mut auction.try_borrow_mut()?)?;

    // NFT → на хранение аукциону (продавец подписывает сам)
    core_transfer(asset, collection, seller, seller, auction, core, system, &[])
}

// ---------------------------------------------------------------- ставка
// счета: 0 [s,w] участник, 1 [w] аукцион, 2 [w] счёт ставки участника (PDA ["bid", аукцион, участник]), 3 [] System Program

fn place_bid(program_id: &Address, accounts: &mut [AccountView], amount: u64) -> ProgramResult {
    let [bidder, auction, bid, system, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !bidder.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if system.address() != &SYSTEM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    let mut state = load(program_id, auction)?;
    let now = Clock::get()?.unix_timestamp;
    if now >= state.end_ts {
        return Err(err(E_ALREADY_ENDED));
    }
    if *bidder.address() == state.seller {
        return Err(err(E_SELLER_CANNOT_BID));
    }
    let need = if state.has_winner() {
        state.highest_bid.checked_add(state.min_increment).ok_or(ProgramError::ArithmeticOverflow)?
    } else {
        state.min_bid
    };
    if amount < need {
        return Err(err(E_BID_TOO_LOW));
    }

    let (pda, bump) = Address::find_program_address(&[BID_SEED, auction.address().as_ref(), bidder.address().as_ref()], program_id);
    if pda != *bid.address() {
        return Err(err(E_WRONG_BID));
    }
    let mut mine = if bid.owned_by(program_id) {
        let b = Bid::read(&bid.try_borrow()?)?;
        if b.auction_start != state.start_ts {
            return Err(err(E_OLD_BID)); // ставка от прошлых торгов этого NFT — сначала забрать её
        }
        b
    } else {
        // первая ставка: место под счёт оплачивает участник (вернётся ему)
        let bump_ref = [bump];
        let seeds = [Seed::from(BID_SEED), Seed::from(auction.address().as_ref()), Seed::from(bidder.address().as_ref()), Seed::from(&bump_ref)];
        create_account_with_minimum_balance_signed(bid, BID_SIZE, program_id, bidder, None, &[Signer::from(&seeds)])?;
        Bid { auction: auction.address().clone(), bidder: bidder.address().clone(), auction_start: state.start_ts, amount: 0, bump }
    };

    // доплатить разницу до новой суммы
    let extra = amount.checked_sub(mine.amount).ok_or(err(E_BID_TOO_LOW))?;
    Transfer { from: bidder, to: bid, lamports: extra }.invoke()?;
    mine.amount = amount;
    mine.write(&mut bid.try_borrow_mut()?)?;

    state.highest_bidder = bidder.address().clone();
    state.highest_bid = amount;
    state.bid_count = state.bid_count.checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?;
    if state.end_ts - now < EXTEND_SECS {
        state.end_ts = now + EXTEND_SECS;
    }
    state.write(&mut auction.try_borrow_mut()?)
}

// ---------------------------------------------------------------- завершить торги
// счета: 0 [s,w] кто завершает (платит комиссию сети), 1 [w] аукцион, 2 [w] NFT, 3 [] коллекция (или CORE_ID),
//        4 [w] продавец, 5 [w] победитель (без победителя — продавец), 6 [w] счёт ставки победителя (без победителя — продавец),
//        7 [] Metaplex Core, 8 [] System Program, 9.. [w] авторы роялти по порядку (только если есть победитель и роялти)

fn settle(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [payer, auction, asset, collection, seller, winner, winner_bid, core, system, creators @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    check_programs(core, system)?;
    let state = load(program_id, auction)?;
    if Clock::get()?.unix_timestamp < state.end_ts {
        return Err(err(E_NOT_ENDED));
    }
    check_lot(&state, asset, collection, seller)?;
    let to = if state.has_winner() { &state.highest_bidder } else { &state.seller };
    if winner.address() != to {
        return Err(err(E_WRONG_WINNER));
    }

    let bump_ref = [state.bump];
    let seeds = [Seed::from(SEED), Seed::from(state.asset.as_ref()), Seed::from(&bump_ref)];
    core_transfer(asset, collection, payer, auction, winner, core, system, &[Signer::from(&seeds)])?;

    if state.has_winner() {
        let b = load_bid(program_id, winner_bid, auction.address(), winner.address())?;
        if b.auction_start != state.start_ts || b.amount != state.highest_bid {
            return Err(err(E_WRONG_BID));
        }
        // роялти авторам (по данным на момент выставления); если автору нельзя зачислить — его доля продавцу
        let n = state.royalty.count as usize;
        let paid_creators = state.royalty.bps > 0 && n > 0;
        if paid_creators && creators.len() < n {
            return Err(err(E_WRONG_CREATORS));
        }
        let royalty = part(state.highest_bid, state.royalty.bps as u64, 10_000);
        let mut left = state.highest_bid;
        if paid_creators {
            for (i, c) in creators.iter_mut().take(n).enumerate() {
                let (address, pct) = &state.royalty.creators[i];
                if c.address() != address || !c.is_writable() {
                    return Err(err(E_WRONG_CREATORS));
                }
                let share = part(royalty, *pct as u64, 100);
                if share > 0 && can_receive(c, share)? {
                    move_lamports(winner_bid, c, share)?;
                    left = left.checked_sub(share).ok_or(ProgramError::ArithmeticOverflow)?;
                }
            }
        }
        move_lamports(winner_bid, seller, left)?;
        // остаток (плата за место) — победителю, а если ему нельзя зачислить — продавцу
        let rest = winner_bid.lamports();
        if can_receive(winner, rest)? {
            move_lamports(winner_bid, winner, rest)?;
        } else {
            move_lamports(winner_bid, seller, rest)?;
        }
        winner_bid.close()?;
    }
    close(auction, seller)
}

// ---------------------------------------------------------------- снять с торгов
// счета: 0 [s,w] продавец, 1 [w] аукцион, 2 [w] NFT, 3 [] коллекция (или CORE_ID), 4 [] Metaplex Core, 5 [] System Program

fn cancel(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [seller, auction, asset, collection, core, system, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !seller.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    check_programs(core, system)?;
    let state = load(program_id, auction)?;
    check_lot(&state, asset, collection, seller)?;
    if state.bid_count > 0 {
        return Err(err(E_HAS_BIDS));
    }
    let bump_ref = [state.bump];
    let seeds = [Seed::from(SEED), Seed::from(state.asset.as_ref()), Seed::from(&bump_ref)];
    core_transfer(asset, collection, seller, auction, seller, core, system, &[Signer::from(&seeds)])?;
    close(auction, seller)
}

// ---------------------------------------------------------------- забрать свою ставку
// счета: 0 [s,w] участник, 1 [w] аукцион (может быть уже закрыт), 2 [w] счёт ставки участника

fn withdraw(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [bidder, auction, bid, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !bidder.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mine = load_bid(program_id, bid, auction.address(), bidder.address())?;

    // лот ещё открыт и это те же торги — лидер забрать ставку не может (кроме страховки через 7 дней)
    if auction.owned_by(program_id) && !auction.is_data_empty() {
        let mut state = load(program_id, auction)?;
        if state.start_ts == mine.auction_start && state.highest_bidder == *bidder.address() {
            if Clock::get()?.unix_timestamp < state.end_ts.saturating_add(GRACE_SECS) {
                return Err(err(E_LEADER_LOCKED));
            }
            // страховка: лот так и не завершили — победитель забирает деньги, NFT потом вернётся продавцу
            state.highest_bidder = Address::default();
            state.highest_bid = 0;
            state.write(&mut auction.try_borrow_mut()?)?;
        }
    }
    let all = bid.lamports();
    move_lamports(bid, bidder, all)?;
    bid.close()
}

// ---------------------------------------------------------------- плагины Metaplex Core

/// Плагины, которые не могут увести NFT со счёта лота или помешать торгам:
/// Royalties, UpdateDelegate, Attributes, Edition, MasterEdition, AddBlocker, ImmutableMetadata, VerifiedCreators, Autograph.
/// Остальные (делегаты заморозки/передачи/сжигания, в т.ч. «постоянные», и всё новое) — отклоняем.
const SAFE_PLUGINS: [u8; 9] = [0, 4, 6, 9, 10, 11, 12, 13, 14];

/// Пропустить строку Borsh (u32 длина + байты)
fn skip_str(d: &[u8], pos: usize) -> Result<usize, ProgramError> {
    let len = u32_at(d, pos)? as usize;
    let end = pos.checked_add(4 + len).ok_or(ProgramError::InvalidAccountData)?;
    if end > d.len() {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(end)
}

/// Разобрать плагины после основных данных (`base_end`): проверить, что все безопасные, и вернуть роялти, если есть
fn read_plugins(d: &[u8], base_end: usize) -> Result<Option<Royalty>, ProgramError> {
    if base_end == d.len() {
        return Ok(None); // плагинов нет
    }
    // PluginHeaderV1: key(1)=3, plugin_registry_offset(8)
    if u8_at(d, base_end)? != 3 {
        return Err(err(E_UNSUPPORTED_NFT));
    }
    let reg = u64_at(d, base_end + 1)? as usize;
    // PluginRegistryV1: key(1)=4, registry: Vec<{plugin_type(1), authority(1 или 1+32), offset(8)}>, external_registry: Vec<…>
    if u8_at(d, reg)? != 4 {
        return Err(err(E_UNSUPPORTED_NFT));
    }
    let count = u32_at(d, reg + 1)? as usize;
    let mut pos = reg + 5;
    let mut royalty = None;
    for _ in 0..count {
        let plugin_type = u8_at(d, pos)?;
        let authority = u8_at(d, pos + 1)?;
        pos += 2 + if authority == 3 { 32 } else { 0 };
        let offset = u64_at(d, pos)? as usize;
        pos += 8;
        if !SAFE_PLUGINS.contains(&plugin_type) {
            return Err(err(E_UNSUPPORTED_NFT));
        }
        if plugin_type == 0 {
            royalty = Some(read_royalties(d, offset)?);
        }
    }
    // внешние плагины (Oracle, LifecycleHook, AppData…) могут запретить передачу NFT — не принимаем
    if u32_at(d, pos)? != 0 {
        return Err(err(E_UNSUPPORTED_NFT));
    }
    Ok(royalty)
}

/// Plugin::Royalties: тег(1)=0, basis_points(2), creators: Vec<{address(32), percentage(1)}>, rule_set
fn read_royalties(d: &[u8], o: usize) -> Result<Royalty, ProgramError> {
    if u8_at(d, o)? != 0 {
        return Err(err(E_UNSUPPORTED_NFT));
    }
    let bps = u16::from_le_bytes([u8_at(d, o + 1)?, u8_at(d, o + 2)?]);
    let n = u32_at(d, o + 3)? as usize;
    if bps > 10_000 || n > MAX_CREATORS {
        return Err(err(E_UNSUPPORTED_NFT));
    }
    let mut r = Royalty { bps, count: n as u8, ..Default::default() };
    for i in 0..n {
        let at = o + 7 + i * 33;
        r.creators[i] = (addr_at(d, at)?, u8_at(d, at + 32)?);
    }
    Ok(r)
}

/// Core-ассет: владелец, коллекция, роялти самого NFT.
/// AssetV1: key(1)=1, owner(32), update_authority(тег 1 [+32]; тег 2 = коллекция), name, uri, seq(Option<u64>), затем плагины
fn read_asset(asset: &AccountView) -> Result<(Address, Option<Address>, Option<Royalty>), ProgramError> {
    if !asset.owned_by(&CORE_ID) {
        return Err(err(E_WRONG_ASSET));
    }
    let d = asset.try_borrow()?;
    if d.len() < 66 || d[0] != 1 {
        return Err(err(E_WRONG_ASSET));
    }
    let owner = addr_at(&d, 1)?;
    let ua = d[33];
    let collection = if ua == 2 { Some(addr_at(&d, 34)?) } else { None };
    let mut pos = 34 + if ua == 0 { 0 } else { 32 };
    pos = skip_str(&d, pos)?; // name
    pos = skip_str(&d, pos)?; // uri
    pos += 1 + if u8_at(&d, pos)? == 1 { 8 } else { 0 }; // seq
    let royalty = read_plugins(&d, pos).map_err(|_| err(E_UNSUPPORTED_NFT))?;
    Ok((owner, collection, royalty))
}

/// Core-коллекция: роялти и проверка плагинов.
/// CollectionV1: key(1)=5, update_authority(32), name, uri, num_minted(4), current_size(4), затем плагины
fn read_collection(collection: &AccountView) -> Result<Option<Royalty>, ProgramError> {
    if !collection.owned_by(&CORE_ID) {
        return Err(err(E_WRONG_COLLECTION));
    }
    let d = collection.try_borrow()?;
    if d.first() != Some(&5) {
        return Err(err(E_WRONG_COLLECTION));
    }
    let mut pos = skip_str(&d, 33)?;
    pos = skip_str(&d, pos)? + 8;
    read_plugins(&d, pos).map_err(|_| err(E_UNSUPPORTED_NFT))
}

// ---------------------------------------------------------------- помощники

fn check_programs(core: &AccountView, system: &AccountView) -> ProgramResult {
    if core.address() != &CORE_ID || system.address() != &SYSTEM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}

/// Передан правильный счёт коллекции: сама коллекция или CORE_ID вместо «нет коллекции»
fn check_collection(collection: &AccountView, expected: Option<&Address>) -> ProgramResult {
    if collection.address() != expected.unwrap_or(&CORE_ID) {
        return Err(err(E_WRONG_COLLECTION));
    }
    Ok(())
}

fn check_lot(state: &Auction, asset: &AccountView, collection: &AccountView, seller: &AccountView) -> ProgramResult {
    if asset.address() != &state.asset {
        return Err(err(E_WRONG_ASSET));
    }
    let none = Address::default();
    check_collection(collection, if state.collection == none { None } else { Some(&state.collection) })?;
    if seller.address() != &state.seller {
        return Err(err(E_NOT_OWNER));
    }
    Ok(())
}

fn load(program_id: &Address, auction: &AccountView) -> Result<Auction, ProgramError> {
    if !auction.owned_by(program_id) || !auction.is_writable() {
        return Err(err(E_WRONG_AUCTION));
    }
    let state = Auction::read(&auction.try_borrow()?)?;
    let pda = Address::create_program_address(&[SEED, state.asset.as_ref(), &[state.bump]], program_id)
        .map_err(|_| err(E_WRONG_AUCTION))?;
    if pda != *auction.address() {
        return Err(err(E_WRONG_AUCTION));
    }
    Ok(state)
}

/// Счёт ставки именно этого участника на именно этом лоте
fn load_bid(program_id: &Address, bid: &AccountView, auction: &Address, bidder: &Address) -> Result<Bid, ProgramError> {
    if !bid.owned_by(program_id) || !bid.is_writable() {
        return Err(err(E_WRONG_BID));
    }
    let b = Bid::read(&bid.try_borrow()?)?;
    if b.auction != *auction || b.bidder != *bidder {
        return Err(err(E_WRONG_BID));
    }
    let pda = Address::create_program_address(&[BID_SEED, auction.as_ref(), bidder.as_ref(), &[b.bump]], program_id)
        .map_err(|_| err(E_WRONG_BID))?;
    if pda != *bid.address() {
        return Err(err(E_WRONG_BID));
    }
    Ok(b)
}

/// amount * num / den без переполнения (num <= den)
fn part(amount: u64, num: u64, den: u64) -> u64 {
    amount / den * num + amount % den * num / den
}

/// Можно ли зачислить SOL на счёт: не программа, доступен для записи и после зачисления не ниже платы за место
fn can_receive(to: &AccountView, amount: u64) -> Result<bool, ProgramError> {
    if to.executable() || !to.is_writable() {
        return Ok(false);
    }
    let after = to.lamports().checked_add(amount).ok_or(ProgramError::ArithmeticOverflow)?;
    Ok(after >= Rent::get()?.try_minimum_balance(to.data_len())?)
}

fn move_lamports(from: &mut AccountView, to: &mut AccountView, amount: u64) -> ProgramResult {
    if from.address() == to.address() || amount == 0 {
        return Ok(());
    }
    let f = from.lamports().checked_sub(amount).ok_or(ProgramError::InsufficientFunds)?;
    let t = to.lamports().checked_add(amount).ok_or(ProgramError::ArithmeticOverflow)?;
    from.set_lamports(f);
    to.set_lamports(t);
    Ok(())
}

/// Закрыть счёт аукциона: все оставшиеся SOL (плата за место) — продавцу
fn close(auction: &mut AccountView, to: &mut AccountView) -> ProgramResult {
    let all = auction.lamports();
    move_lamports(auction, to, all)?;
    auction.close()
}

/// Metaplex Core TransferV1 (дискриминатор 14, compression_proof = None).
/// Порядок счетов: asset, collection, payer, authority, new_owner, system_program, log_wrapper (нет → CORE_ID)
#[allow(clippy::too_many_arguments)]
fn core_transfer(
    asset: &AccountView,
    collection: &AccountView,
    payer: &AccountView,
    authority: &AccountView,
    new_owner: &AccountView,
    core: &AccountView,
    system: &AccountView,
    signers: &[Signer],
) -> ProgramResult {
    let metas = [
        InstructionAccount::writable(asset.address()),
        InstructionAccount::readonly(collection.address()),
        InstructionAccount::writable_signer(payer.address()),
        InstructionAccount::readonly_signer(authority.address()),
        InstructionAccount::readonly(new_owner.address()),
        InstructionAccount::readonly(system.address()),
        InstructionAccount::readonly(&CORE_ID),
    ];
    let ix = InstructionView { program_id: &CORE_ID, data: &[14, 0], accounts: &metas };
    invoke_signed(&ix, &[asset, collection, payer, authority, new_owner, system, core], signers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_roundtrip() {
        let mut royalty = Royalty { bps: 500, count: 2, ..Default::default() };
        royalty.creators[0] = (Address::new_from_array([5; 32]), 70);
        royalty.creators[1] = (Address::new_from_array([6; 32]), 30);
        let a = Auction {
            seller: Address::new_from_array([1; 32]), asset: Address::new_from_array([2; 32]),
            collection: Address::new_from_array([3; 32]), min_bid: 100, min_increment: 7, start_ts: 1_700_000_000,
            end_ts: 1_700_000_060, highest_bidder: Address::new_from_array([4; 32]), highest_bid: 555, bid_count: 3, bump: 254,
            royalty,
        };
        let mut d = [0u8; AUCTION_SIZE];
        a.write(&mut d).unwrap();
        assert_eq!(Auction::read(&d).unwrap(), a);
        assert_eq!((d[97], d[173], d[176], d[209]), (100, 254, 2, 70));
        assert_eq!(AUCTION_SIZE, 342);

        let b = Bid { auction: Address::new_from_array([7; 32]), bidder: Address::new_from_array([8; 32]), auction_start: 5, amount: 9, bump: 250 };
        let mut d = [0u8; BID_SIZE];
        b.write(&mut d).unwrap();
        assert_eq!(Bid::read(&d).unwrap(), b);
    }

    #[test]
    fn core_id_parses() {
        assert_eq!(CORE_ID.as_ref()[0], 0xaf);
    }
}
