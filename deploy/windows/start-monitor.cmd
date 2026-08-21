@echo off
setlocal
cd /d "%~dp0..\..\apps\monitor"
set NODE_ENV=production
if not defined DATA_DIRECTORY set DATA_DIRECTORY=%~dp0..\..\data
"%ProgramFiles%\nodejs\node.exe" ".\node_modules\next\dist\bin\next" start -H 127.0.0.1 -p 3000
