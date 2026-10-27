@echo off
chcp 65001 >nul
cd /d "%~dp0mint"
start "" firefox -P claude http://localhost:8080/
echo Сайт КИР работает: http://localhost:8080
echo Не закрывай это окно, пока пользуешься сайтом.
node server.js
