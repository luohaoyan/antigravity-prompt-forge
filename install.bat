@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"
echo ==========================================================
echo   Antigravity Prompt Optimize - 一键安装 / 修复
echo ==========================================================
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_NO_ATTACH_CONSOLE="
set "NODE_OPTIONS="
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Windows 上没有 Node.js。请先安装 LTS 版本: https://nodejs.org/
  pause
  exit /b 1
)
node "installer\install.mjs" %*
echo.
pause
popd
