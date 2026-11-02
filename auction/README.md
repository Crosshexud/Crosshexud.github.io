# Аукцион «КИР» — программа Solana

Английский аукцион в SOL для NFT стандарта Metaplex Core. **Версия 2** — подготовлена к mainnet, см. [MAINNET.md](MAINNET.md). Сайт: `site/auction.html`, кнопка «Выставить на аукцион» в галерее.

| Папка | Что внутри |
|---|---|
| `program/` | сама программа (Rust, [pinocchio](https://github.com/anza-xyz/pinocchio) — без лишних зависимостей, поэтому собирается и на Windows) |
| `sim/` | проверка в LiteSVM: копия блокчейна внутри теста + настоящий Metaplex Core |
| `client/kir-auction.js` | команды и чтение лотов для сайта (`mint/src/kir-mint.js` → `KIRMint.auction`) |
| `tests/client.test.mjs` | проверка, что сайт кодирует команды байт в байт как программа |
| `keys/` | **ключи — не в git, хранить резервную копию!** `program.json` — адрес программы, `deployer.json` — служебный кошелёк (он же может обновлять программу) |

## Как работает

1. **Выставить** (`CreateAuction`): NFT переходит на хранение счёту лота — адрес `PDA["auction", NFT]`. Продавец задаёт стартовую цену (≥ 0.001 SOL), шаг и срок (1 минута … 30 дней). Программа проверяет плагины NFT и запоминает роялти авторов.
2. **Ставка** (`PlaceBid`): SOL лежат на личном счёте ставки участника `PDA["bid", лот, участник]`. Поднять свою ставку — доплатить разницу. Ставка в последние 5 минут продлевает торги до «сейчас + 5 минут».
3. **Забрать ставку** (`Withdraw`): перебитый участник — в любой момент; после закрытия лота — всегда; победитель — только если лот не завершён за 7 дней после конца (страховка).
4. **Завершить** (`Settle`): после конца — кто угодно. NFT → победителю, SOL → продавцу и авторам (роялти), плата за место → продавцу и победителю. Без победителя NFT возвращается продавцу.
5. **Снять** (`Cancel`): продавец, пока нет ставок.

## Сборка и проверка (Windows)

```sh
export PATH="$HOME/.cargo/bin:/c/Users/cross/tools/solana/solana-release/bin:/c/Users/cross/tools/mingw64/bin:$PATH"
cd auction/program && cargo-build-sbf          # → target/deploy/kir_auction.so (~32 КБ)
cd ../sim && cargo test                         # 8 сценариев: торги, роялти, «снайпер», страховка, плагины, подмены
cd ../tests && npm install && node client.test.mjs
```
`sim/fixtures/mpl_core.so` (не в git): `solana program dump CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d sim/fixtures/mpl_core.so -u devnet`.

В Devnet программа уже выложена. Обновить её после правок (нужно ~0.5 SOL на служебном кошельке `solana address -k keys/deployer.json`):
`solana program deploy program/target/deploy/kir_auction.so --program-id keys/program.json -k keys/deployer.json -u devnet` (из папки `auction`).

## Перед mainnet — обязательно аудит

Что исправлено в версии 2, что осталось проверить аудитору и как запускать — в [MAINNET.md](MAINNET.md).
