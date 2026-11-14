@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_NO_ATTACH_CONSOLE="
set "NODE_OPTIONS="
node "installer\install.mjs" --rollback
echo.
pause
popd
