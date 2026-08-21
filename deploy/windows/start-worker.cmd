@echo off
setlocal
cd /d "%~dp0..\..\apps\worker"
set NODE_ENV=production
if not defined ENV_FILE set ENV_FILE=%~dp0..\..\.env
"%ProgramFiles%\nodejs\node.exe" ".\node_modules\tsx\dist\cli.mjs" src\main.ts
