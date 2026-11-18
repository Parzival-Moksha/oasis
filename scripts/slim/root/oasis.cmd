@echo off
rem Starts the Oasis (Windows). The same as: node scripts\oasis.mjs start
cd /d "%~dp0"
node scripts\oasis.mjs start %*
if errorlevel 1 pause
