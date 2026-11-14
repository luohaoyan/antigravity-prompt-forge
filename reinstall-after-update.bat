@echo off
setlocal
chcp 65001 >nul
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_NO_ATTACH_CONSOLE="
set "NODE_OPTIONS="
pushd "%~dp0"
echo ==========================================================
echo   反重力更新后修复 - 按钮消失 / 打不开
echo ==========================================================
echo 1) 先用备份恢复成原版（避免和旧补丁叠加）
node "installer\install.mjs" --rollback
echo.
echo 2) 重新注入到新版本 app.asar
node "installer\install.mjs"
echo.
echo 3) 冻结自动更新（可选，输入 1 执行 / 直接回车跳过）
set /p FREEZE= 选择:
if "%FREEZE%"=="1" node "installer\install.mjs" --freeze-update
echo.
pause
popd
