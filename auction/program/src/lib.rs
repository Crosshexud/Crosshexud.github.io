//! Аукцион NFT «КИР» на Solana (английский аукцион в SOL для NFT стандарта Metaplex Core).
//!
//! Как работает:
//! - `CreateAuction` (0) — продавец отдаёт NFT на хранение программе (счёт аукциона, PDA ["auction", asset]).
//! - `PlaceBid`      (1) — ставка в SOL лежит на счёте аукциона; прошлому лидеру ставка сразу возвращается.
//!                         Ставка в последние 5 минут продлевает торги на 5 минут (защита от «снайперов»).
//! - `Settle`        (2) — после конца торгов кто угодно может завершить: NFT уходит победителю, SOL — продавцу.
//!                         Если ставок не было — NFT возвращается продавцу.
//! - `Cancel`        (3) — продавец снимает лот, пока не было ни одной ставки.
//!
//! Написано на pinocchio (без лишних зависимостей), чтобы собиралось и на Windows.
//! ВАЖНО: перед запуском в основной сети (mainnet) программу нужно отдать на аудит безопасности.
#![cfg_attr(target_os = "solana", no_std)]

use pinocchio::{
    account::AccountView,
    cpi::{invoke_signed, Seed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    sysvars::{clock::Clock, Sysvar},
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
/// Минимальная ставка 0.001 SOL: больше платы за пустой счёт, поэтому возврат ставки всегда проходит
pub const MIN_BID: u64 = 1_000_000;

// коды ошибок (совпадают с auction/client/kir-auction.js)
pub const E_WRONG_ASSET: u32 = 6000;
pub const E_NOT_OWNER: u32 = 6001;
pub const E_WRONG_COLLECTION: u32 = 6002;
pub const E_BAD_PARAMS: u32 = 6003;
pub const E_ALREADY_ENDED: u32 = 6004;
pub const E_NOT_ENDED: u32 = 6005;
pub const E_BID_TOO_LOW: u32 = 6006;
pub const E_SELLER_CANNOT_BID: u32 = 6007;
pub const E_WRONG_PREVIOUS: u32 = 6008;
pub const E_WRONG_WINNER: u32 = 6009;
pub const E_HAS_BIDS: u32 = 6010;
pub const E_WRONG_AUCTION: u32 = 6011;
const fn err(code: u32) -> ProgramError {
    ProgramError::Custom(code)
}

// ---------------------------------------------------------------- данные лота

/// Счёт аукциона, 174 байта:
/// key(1) seller(32) asset(32) collection(32) min_bid(8) min_increment(8) start_ts(8) end_ts(8)
/// highest_bidder(32) highest_bid(8) bid_count(4) bump(1)
#[derive(Clone, Debug, PartialEq)]
pub struct Auction {
    pub key: u8,
    pub seller: Address,
    pub asset: Address,
    /// Address::default(), если NFT вне коллекции
    pub collection: Address,
    pub min_bid: u64,
    pub min_increment: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    /// Address::default(), пока ставок нет
    pub highest_bidder: Address,
    pub highest_bid: u64,
    pub bid_count: u32,
    pub bump: u8,
}

pub const AUCTION_KEY: u8 = 1;
pub const AUCTION_SIZE: usize = 174;

impl Auction {
    pub fn read(d: &[u8]) -> Result<Self, ProgramError> {
        if d.len() != AUCTION_SIZE || d[0] != AUCTION_KEY {
            return Err(err(E_WRONG_AUCTION));
        }
        let addr = |o: usize| {
            let mut a = [0u8; 32];
            a.copy_from_slice(&d[o..o + 32]);
            Address::new_from_array(a)
        };
        let u64_at = |o: usize| {
            let mut b = [0u8; 8];
            b.copy_from_slice(&d[o..o + 8]);
            u64::from_le_bytes(b)
        };
        let mut c = [0u8; 4];
        c.copy_from_slice(&d[169..173]);
        Ok(Self {
            key: d[0],
            seller: addr(1),
            asset: addr(33),
            collection: addr(65),
            min_bid: u64_at(97),
            min_increment: u64_at(105),
            start_ts: u64_at(113) as i64,
            end_ts: u64_at(121) as i64,
            highest_bidder: addr(129),
            highest_bid: u64_at(161),
            bid_count: u32::from_le_bytes(c),
            bump: d[173],
        })
    }

    pub fn write(&self, d: &mut [u8]) -> ProgramResult {
        if d.len() != AUCTION_SIZE {
            return Err(ProgramError::AccountDataTooSmall);
        }
        d[0] = self.key;
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
        Ok(())
    }
}

fn u64_arg(d: &[u8], o: usize) -> Result<u64, ProgramError> {
    let s = d.get(o..o + 8).ok_or(ProgramError::InvalidInstructionData)?;
    let mut b = [0u8; 8];
    b.copy_from_slice(s);
    Ok(u64::from_le_bytes(b))
}

// ---------------------------------------------------------------- вход

pub fn process_instruction(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    match data.first() {
        // CreateAuction { min_bid: u64, min_increment: u64, duration: i64 }
        Some(0) if data.len() == 25 => {
            create_auction(program_id, accounts, u64_arg(data, 1)?, u64_arg(data, 9)?, u64_arg(data, 17)? as i64)
        }
        // PlaceBid { amount: u64 }
        Some(1) if data.len() == 9 => place_bid(program_id, accounts, u64_arg(data, 1)?),
        Some(2) if data.len() == 1 => settle(program_id, accounts),
        Some(3) if data.len() == 1 => cancel(program_id, accounts),
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

    // NFT должен быть настоящим Core-ассетом продавца
    let (owner, collection_of_asset) = read_asset(asset)?;
    if owner != *seller.address() {
        return Err(err(E_NOT_OWNER));
    }
    check_collection(collection, collection_of_asset.as_ref())?;

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
        key: AUCTION_KEY,
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
    };
    state.write(&mut auction.try_borrow_mut()?)?;

    // NFT → на хранение аукциону (продавец подписывает сам)
    core_transfer(asset, collection, seller, seller, auction, core, system, &[])
}

// ---------------------------------------------------------------- ставка
// счета: 0 [s,w] участник, 1 [w] аукцион, 2 [w] прошлый лидер (если ставок не было — любой, например сам участник),
//        3 [] System Program

fn place_bid(program_id: &Address, accounts: &mut [AccountView], amount: u64) -> ProgramResult {
    let [bidder, auction, previous, system, ..] = accounts else {
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
    let need = if state.bid_count == 0 {
        state.min_bid
    } else {
        state.highest_bid.checked_add(state.min_increment).ok_or(ProgramError::ArithmeticOverflow)?
    };
    if amount < need {
        return Err(err(E_BID_TOO_LOW));
    }
    if state.bid_count > 0 && *previous.address() != state.highest_bidder {
        return Err(err(E_WRONG_PREVIOUS));
    }

    // деньги участника → на счёт аукциона
    Transfer { from: bidder, to: auction, lamports: amount }.invoke()?;
    // прошлому лидеру — его ставку назад
    if state.bid_count > 0 {
        move_lamports(auction, previous, state.highest_bid)?;
    }

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
//        4 [w] продавец, 5 [] победитель (или продавец, если ставок не было), 6 [] Metaplex Core, 7 [] System Program

fn settle(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [payer, auction, asset, collection, seller, winner, core, system, ..] = accounts else {
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
    let to = if state.bid_count > 0 { &state.highest_bidder } else { &state.seller };
    if winner.address() != to {
        return Err(err(E_WRONG_WINNER));
    }

    let bump_ref = [state.bump];
    let seeds = [Seed::from(SEED), Seed::from(state.asset.as_ref()), Seed::from(&bump_ref)];
    core_transfer(asset, collection, payer, auction, winner, core, system, &[Signer::from(&seeds)])?;
    if state.bid_count > 0 {
        move_lamports(auction, seller, state.highest_bid)?;
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

// ---------------------------------------------------------------- помощники

fn check_programs(core: &AccountView, system: &AccountView) -> ProgramResult {
    if core.address() != &CORE_ID || system.address() != &SYSTEM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}

/// Владелец и коллекция Core-ассета. Начало данных AssetV1: key(1)=1, owner(32), update_authority(тег 1 + 32; тег 2 = коллекция)
fn read_asset(asset: &AccountView) -> Result<(Address, Option<Address>), ProgramError> {
    if !asset.owned_by(&CORE_ID) {
        return Err(err(E_WRONG_ASSET));
    }
    let d = asset.try_borrow()?;
    if d.len() < 66 || d[0] != 1 {
        return Err(err(E_WRONG_ASSET));
    }
    let addr = |o: usize| {
        let mut a = [0u8; 32];
        a.copy_from_slice(&d[o..o + 32]);
        Address::new_from_array(a)
    };
    Ok((addr(1), if d[33] == 2 { Some(addr(34)) } else { None }))
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
        let a = Auction {
            key: 1, seller: Address::new_from_array([1; 32]), asset: Address::new_from_array([2; 32]),
            collection: Address::new_from_array([3; 32]), min_bid: 100, min_increment: 7, start_ts: 1_700_000_000,
            end_ts: 1_700_000_060, highest_bidder: Address::new_from_array([4; 32]), highest_bid: 555, bid_count: 3, bump: 254,
        };
        let mut d = [0u8; AUCTION_SIZE];
        a.write(&mut d).unwrap();
        assert_eq!(Auction::read(&d).unwrap(), a);
        assert_eq!(d[97], 100);
        assert_eq!(d[173], 254);
    }

    #[test]
    fn core_id_parses() {
        assert_eq!(CORE_ID.as_ref()[0], 0xaf);
    }
}
