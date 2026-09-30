@echo off
chcp 65001 > nul
cd /d "%~dp0"
where node > nul 2>&1
if errorlevel 1 (
  echo Не найден Node.js. Установите версию 22.13 или новее: https://nodejs.org
  pause
  exit /b 1
)
rem браузер откроется через пару секунд, когда сервер уже поднимется
start "" /b cmd /c "timeout /t 2 > nul & start http://localhost:3000"
node --disable-warning=ExperimentalWarning server/server.js
pause
