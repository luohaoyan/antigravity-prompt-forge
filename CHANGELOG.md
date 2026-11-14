# Changelog

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.7.0] - 2026-11-15

### 新增
- **模型下拉 + 从上游导入**：设置面板的「模型」改成「下拉 + 手动输入 + ⇩ 导入」三件套。点「导入」会用当前的 Base URL / API Key 请求 `/models`（Anthropic 走 `/v1/models` 并带 `anthropic-version`，Gemini 走 `/models` 并剥掉 `models/` 前缀），把可用模型灌进下拉，省得手打模型名拼错。

### 修复
- **窗口不再被误关**：以前点击遮罩（卡片外的半透明区域）就会关闭面板，复制粘贴时鼠标稍微拖出卡片范围就整窗消失、已填内容全丢。现在只有 ✕ 按钮、保存按钮或 Esc 才会关闭。
- **重新登录后配置不再丢失**：
  - 根因一：设置面板读的是同步缓存，`app_storage.json` 的异步回填还没完成时打开面板，字段显示为空，一按保存就把空 Key 写回去覆盖了。现在 `saveSettings` 发现「新值为空但旧值有 Key」时自动保留旧 Key。
  - 根因二：插件钩子（`PreInvocation`）读的是插件自己的 `data/settings.json`，与输入框面板写的 `app_storage.json` 是两套存储，面板里配好的 Key 钩子路径读不到。现在 `loadSettings()` 先读 `app_storage.json` 里 `antigravity.promptOptimize.settings.v2` 这一份，再用插件自己的文件补齐 `autoEnhanceAll` 等字段。
  - 回填失败不再被永久缓存：`hydrateSettings()` 的失败结果会重置，下次调用可重试。

## [1.6.0] - 2026-11-15

### 新增
- `oneclick.ps1`：全自动部署（清宿主环境变量 → 自动装 Node(winget) → 备份存档 → 体检 → 注入 → 装插件 → 冻结更新 → 启动 → 自检），支持 `-Auto` / `-NoLaunch` / `-PluginOnly` / `-SkipBackup` / `-ZipPath`。
- `doctor.bat`：一键体检（安装路径、asar 大小、备份、存档数量、环境变量、进程状态）。
- `reinstall-after-update.bat`：反重力更新后一键「回滚 + 重新注入 + 可选冻结更新」。
- `install.mjs --freeze-update`：冻结自动更新（`app-update.yml` 指向死地址 + `autoCheckForUpdates=false`）。
- `docs/OTHER-PC.md`：换机/多机部署指南，含「对方装不了 Node」时直接拷补丁 asar 的路线 C 与同步清单。
- `docs/screenshots/`：Antigravity 2.31.0 实机截图 4 张（按钮、增强结果、设置面板），README 增加实机效果图廊。

### 变更
- README 增加 Antigravity 版本徽章（2.31.0）与实机截图区块。

## [1.5.0] - 2026-11-15

### 新增
- 通用安装器 `installer/install.mjs`：自动探测 Antigravity 安装路径，支持 `--check` / `--rollback` / `--plugin-only` / `--uninstall`。
- `install.bat` / `check.bat` / `rollback.bat` 双击入口。
- 归档为完整 GitHub 仓库结构：`plugin/`、`loader/`、`installer/`、`docs/`。
- `docs/AI-PROMPTS.md`：8 组可直接喂给 AI 的安装/排障/二次开发提示词。
- `docs/TROUBLESHOOTING.md`：按症状分流的排查手册（打不开 / 黑屏 / 写不回 / 前缀失效 / 更新回滚 / 存档恢复）。
- 打包器支持 `--asar` / `--widget` / `--out` 参数，可用于任意安装路径与测试沙箱。

### 修复
- **输入框写回失效**：反重力 composer 为 Lexical 编辑器，`execCommand("insertText")` 返回 true 但内容被回滚。改用「合成 `Ctrl+A` keydown → 合成 `Backspace` keydown → 合成 `paste` (`DataTransfer` 带 `text/plain`)」的原生事件路径，实测写入与还原均精确可靠。
- 安装器清理 `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS` / `ELECTRON_NO_ATTACH_CONSOLE`，避免从 Node 宿主启动时 Electron 以纯 Node 模式 `exit(0)`。
- 打包注入器在找不到汉化锚点时降级为独立 runner，而不是直接失败。

### 变更
- `patch-composer-asar.mjs` 重写为无硬编码用户路径的 CLI，并优先使用本地 `@electron/asar`，找不到才回退 `npx`。

## [1.4.0] - 2026-11-15

### 修复
- **窗口全黑 / 渲染卡死**：删除 `setInterval(ensureHostAndButton, 800)` 全文档轮询，移除第二个 `MutationObserver`（与汉化器互触发形成活锁）。改为由汉化器节流队列通过 `window.__AG_PROMPT_OPTIMIZE_SCHEDULE()` 被动唤醒。
- 布局读取改为 geometry epoch 缓存，同一 tick 内每个元素的 `getBoundingClientRect` 只算一次。
- CDP 响应延迟从 30s 超时降到 0–2ms。

### 变更
- 按钮定位改为"composer 卡片最底一行、右半区最左侧按钮的左侧"，跟随窗口缩放自动重排。

## [1.3.0] - 2026-11-14

### 新增
- 首次实现底部输入框 `✨ 增强` 内联按钮与设置面板。

### 已知问题
- `setInterval` + 双 `MutationObserver` 导致活锁，窗口全黑（v1.4.0 修复）。
- `execCommand` 写回在 Lexical 上被静默回滚（v1.5.0 修复）。

## [1.2.0] - 2026-11-13

### 新增
- 插件运行时移植：`PreInvocation` 钩子、侧边栏面板、`/prompt-optimize` 技能、`✨`/`++`/`/opt` 前缀触发。
- 四种增强风格（enhanced / coding / structured / concise）与受保护 Token 校验。
