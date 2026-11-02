@echo off
rem Файл в кодировке 866 (DOS, русская) - редактировать в ней, иначе русский текст сломается.
cd /d "%~dp0mint"
rem Где открыть сайт: в Chrome, если там уже стоит Phantom, иначе в Firefox (профиль "claude", где Phantom стоит сейчас).
rem Phantom перестал поддерживать Firefox - как только он появится в Chrome, этот файл сам начнёт открывать Chrome.
set "PROFILE="
for /d %%P in ("%LOCALAPPDATA%\Google\Chrome\User Data\*") do (
  if exist "%%P\Extensions\bfnaelmomeimhlpmgjnjophhpkkoljpa" if not defined PROFILE set "PROFILE=%%~nxP"
)
if defined PROFILE (
  start "" chrome --profile-directory="%PROFILE%" http://localhost:8080/
  echo Сайт открыт в Chrome - там стоит Phantom.
) else (
  start "" firefox -P claude http://localhost:8080/
  echo Сайт открыт в Firefox. Phantom перестал поддерживать Firefox - лучше поставить его в Chrome: https://phantom.com/download
  echo После этого файл сам будет открывать Chrome.
)
echo Сайт КИР работает: http://localhost:8080
echo Не закрывай это окно, пока пользуешься сайтом.
node server.js
