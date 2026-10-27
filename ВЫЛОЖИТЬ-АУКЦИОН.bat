@echo off
chcp 65001 >nul
rem Выкладывает программу аукциона «КИР» в тестовую сеть Solana (Devnet).
rem Перед запуском переведи 0.5 SOL из Phantom (Devnet) на служебный кошелёк — его адрес покажется ниже.
cd /d "%~dp0auction"
set PATH=C:\Users\cross\tools\solana\solana-release\bin;%PATH%
echo.
echo Служебный кошелёк для выкладки (переведи на него 0.5 SOL из Phantom, сеть Devnet):
solana address -k keys\deployer.json
echo Баланс:
solana balance -k keys\deployer.json -u devnet
echo.
echo Выкладываю программу аукциона...
solana program deploy program\target\deploy\kir_auction.so --program-id keys\program.json -k keys\deployer.json -u devnet
if errorlevel 1 (
  echo.
  echo Не получилось. Скорее всего, на служебном кошельке мало SOL — переведи 0.5 SOL и запусти ещё раз.
) else (
  echo.
  echo Готово! Аукцион работает: открой сайт, раздел «Аукцион».
)
pause
