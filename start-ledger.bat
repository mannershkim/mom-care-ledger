@echo off
cd /d "%~dp0"
echo Mom care ledger
echo http://127.0.0.1:8787
echo Keep this window open. Closing it stops the ledger.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://127.0.0.1:8787'"
py -3 server.py
if errorlevel 1 pause
