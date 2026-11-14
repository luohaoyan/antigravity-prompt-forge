# publish.ps1 - 一键发布到 GitHub（需要 gh 已登录且 token 具备 repo 创建权限）
$ErrorActionPreference = 'Stop'
$repoDir = 'F:\pluge\antigravity-prompt-forge'
$zip     = 'F:\pluge\antigravity-prompt-forge-v1.5.0.zip'
$name    = 'antigravity-prompt-forge'

Set-Location $repoDir

Write-Host '[1/4] 检查 gh 登录状态...' -ForegroundColor Cyan
gh auth status

Write-Host '[2/4] 创建远程仓库并推送...' -ForegroundColor Cyan
gh repo create $name --public --source=. --remote=origin --push --description '反重力提示词锻造炉 · 给 Google Antigravity 桌面端焊上 增强 按钮：输入框一键强化草稿、发送瞬间钩子拦截、零配置可用'

Write-Host '[3/4] 打 tag...' -ForegroundColor Cyan
git tag v1.5.0 2>$null
git push origin v1.5.0

Write-Host '[4/4] 创建 Release 并上传 zip...' -ForegroundColor Cyan
gh release create v1.5.0 $zip --title 'v1.5.0 - Antigravity Prompt Forge 首次发布' --generate-notes

Write-Host 'DONE - published' -ForegroundColor Green
gh repo view --web
