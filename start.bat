@echo off
cd /d "%~dp0"
set CULTE_LOOP=1
:loop
node server.js
if %errorlevel%==42 goto loop
pause
