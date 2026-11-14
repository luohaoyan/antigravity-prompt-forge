@echo off
setlocal
chcp 65001 >nul
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_NO_ATTACH_CONSOLE="
set "NODE_OPTIONS="
pushd "%~dp0"
echo ==========================================================
echo   Antigravity Prompt Forge - 体检 / 诊断
echo ==========================================================
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] 未安装 Node.js，请先装 LTS: https://nodejs.org/
  pause
  exit /b 1
)
node "installer\install.mjs" --check
echo.
echo --- Windows 版本 / 反重力进程 ---
ver
tasklist /fi "imagename eq Antigravity.exe" 2>nul | findstr /i Antigravity || echo   [!] Antigravity.exe 未运行
echo.
pause
popd
