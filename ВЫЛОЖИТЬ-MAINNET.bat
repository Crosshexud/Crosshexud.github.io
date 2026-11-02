@echo off
rem Файл в кодировке 866 (DOS, русская) - редактировать в ней, иначе русский текст сломается.
rem Выкладывает программу аукциона "КИР" в ОСНОВНУЮ сеть Solana (mainnet) - НАСТОЯЩИЕ ДЕНЬГИ.
rem Запускать только после аудита! Подробности - auction\MAINNET.md
cd /d "%~dp0auction"
set PATH=C:\Users\cross\tools\solana\solana-release\bin;%PATH%
echo.
echo  ВНИМАНИЕ: это ОСНОВНАЯ сеть Solana. Будут потрачены настоящие SOL (около 0.45, часть вернётся).
echo  Программу перед этим должен проверить аудитор (auction\MAINNET.md).
echo.
set /p A=Аудит пройден и ты хочешь выложить? Напиши ДА (или DA): 
set OK=
for %%w in (ДА DA YES) do if /i "%A%"=="%%w" set OK=1
if not defined OK goto stop
echo.
echo Служебный кошелёк (на него нужно перевести около 0.5 SOL в основной сети):
solana address -k keys\deployer.json
echo Баланс в основной сети:
solana balance -k keys\deployer.json -u mainnet-beta
echo.
set /p B=Точно выкладываю в mainnet? Напиши ДА ещё раз (или DA): 
set OK=
for %%w in (ДА DA YES) do if /i "%B%"=="%%w" set OK=1
if not defined OK goto stop
solana program deploy program\target\deploy\kir_auction.so --program-id keys\program.json -k keys\deployer.json -u mainnet-beta --with-compute-unit-price 20000 --max-sign-attempts 30 --use-rpc
if errorlevel 1 (
  echo.
  echo Не получилось. Проверь баланс служебного кошелька и запусти ещё раз - уже загруженная часть не потеряется.
) else (
  echo.
  echo Готово! Дальше - шаги 4-9 в auction\MAINNET.md: права на обновление, ключ RPC, cluster: 'mainnet-beta' в site\js\config.js.
)
goto end
:stop
echo Отменено, ничего не сделано.
:end
pause
