# 故障排查手册

> 按症状查。每条都给了**判断依据**和**处理动作**，不要跳着执行。

---

## A. 反重力完全打不开（双击图标没反应 / 一闪就退）

### A1. 判断依据

```powershell
Get-Process Antigravity -ErrorAction SilentlyContinue | Select Id, StartTime
Get-Content "$env:APPDATA\Antigravity\logs\main.log" -Tail 20
Get-Content "$env:APPDATA\Antigravity\DevToolsActivePort" -ErrorAction SilentlyContinue
```

典型特征：

- 进程 `HasExited=True`、`ExitCode=0`、`StartTime` 与 `ExitTime` 同一秒；
- 没有窗口、没有崩溃事件（Application Error / WER 队列为空）；
- `main.log` 停在上一轮 `Shutting down language server…`；
- `DevToolsActivePort` 是旧时间戳。

这组特征的唯一解释：**Electron 主进程没起来就 `exit(0)` 了**。

### A2. 根因与处理

| 根因 | 验证 | 处理 |
|---|---|---|
| `ELECTRON_RUN_AS_NODE=1` 被宿主注入（DSH / VS Code / Node 工具链） | `echo %ELECTRON_RUN_AS_NODE%` | 用 `install.bat`（内部会清空）或从资源管理器双击启动 |
| `NODE_OPTIONS` 注入了不兼容参数 | `echo %NODE_OPTIONS%` | 同上 |
| `app.asar` 被写坏 | 对比 `app.asar` 与 `app.asar.pre_prompt_optimize.bak` 大小 | `rollback.bat` |
| 安全软件拦截（火绒 HipsDaemon / 360） | 查拦截日志 | 把 `Antigravity.exe` 与 `resources` 加入信任 |

> 注意：`Invalid file descriptor to ICU data received` 只出现在"把 exe 单独复制到别处运行"时，属正常现象——Electron 需要同目录的 `icudtl.dat`。

---

## B. 窗口能开，但全黑（只有一个黑框）

### B1. 判断依据

```powershell
# CDP 是否秒回？黑屏时通常 30 秒超时
curl "http://127.0.0.1:$(Get-Content "$env:APPDATA\Antigravity\DevToolsActivePort" | Select-Object -First 1)/json/list"
```

- CDP 连接超时 / `Runtime.evaluate` 不回 → 渲染主线程被同步阻塞。
- 打开开发者工具 Console 无报错、无异常栈 → 典型的**活锁**而非抛错。

### B2. 根因

旧版 widget（v1.3.0）叠了两层观察者：

```js
// 汉化器 i18n_runner.js
new MutationObserver(cb).observe(document.documentElement, {childList:true, subtree:true})
// widget v1.3.0
new MutationObserver(cb2).observe(document.documentElement, {childList:true, subtree:true})
setInterval(ensureHostAndButton, 800)   // 每次做全文档 querySelectorAll + 逐元素 getBoundingClientRect
```

汉化改写 → widget 观察 → widget 改 DOM → 汉化观察 → … 无限互触发，加上每次 800ms 强制重排，主线程被吃干。

### B3. 处理

改用本仓库 v1.4.0+ 的 widget：

- 删除 `setInterval(ensureHostAndButton, 800)`；
- 不再自建 observer，改为 `window.__AG_PROMPT_OPTIMIZE_SCHEDULE()` 被动唤醒（复用汉化环节流）；
- 布局读取走 geometry epoch 缓存（同一 tick 内每个元素只测一次）。

验证：修好后 CDP `Runtime.evaluate` 延迟应为 0–2ms（实测值：`[0,0,1,0,0,0]`）。

---

## C. 按钮在，但点了没反应 / 文本不写回

### C1. 分流

```text
点了之后按钮文字变不变？
├─ 不变 → 事件没绑上（widget 未 boot，或被别的浮层遮挡）→ C2
└─ 变成 "↩ 还原" 但文本没变 → 写回被编辑器拒绝 → C3
```

### C2. 事件没绑上

在 CDP 里执行：

```js
JSON.stringify({
  inst: !!window.__antigravityPromptOptimizeV2,
  ver: window.__antigravityPromptOptimizeV2?.version,
  btn: !!document.querySelector('[data-ag-prompt-optimize-btn]'),
  input: (()=>{const e=document.querySelector('.surface-composer-card [contenteditable=true]'); if(!e) return null;
          const r=e.getBoundingClientRect(); return [r.width|0, r.height|0];})()
})
```

- `inst=false` → widget 没加载：检查 `dist/i18n_runner.js` 末尾有没有 `/* === ANTIGRAVITY_PROMPT_OPTIMIZE_WIDGET === */`；
- `input=[950,40]` 这类正常值但 `btn=false` → 选择器不匹配，见 [AI-PROMPTS.md](AI-PROMPTS.md) 第 4 节。

### C3. 写回被 Lexical 拒绝（关键坑）

反重力输入框是 **Lexical** 编辑器。实测结论：

| 写法 | 结果 |
|---|---|
| `execCommand('selectAll')` + `execCommand('insertText')` | **返回 true，内容被回滚**（原 bug 根因） |
| `el.textContent = x` / 改 span | 被重渲染覆盖，变空 |
| `__lexicalEditor.update()` 里重建节点 | 不报错但 DOM 不更新 |
| 合成 `KeyboardEvent(ctrl+A)` + `KeyboardEvent(Backspace)` | **真能清空全篇** |
| 合成 `ClipboardEvent('paste')` + `DataTransfer` | **真能写入** |
| 真实鼠标点入 + `Input.insertText` | 可以（但这是 CDP 测试专用） |

v1.4.0 采用「合成 Ctrl+A → 合成 Backspace → 合成 paste」三步，写入后不再被回滚。

---

## D. 前缀不生效（发 `✨ 内容` 没被增强）

1. 确认插件在位：`dir "%USERPROFILE%\.gemini\config\plugins\prompt-optimize"` 应有 `plugin.json`、`hooks.json`、`hooks`；
2. 确认钩子 enabled：`hooks.json` 里 `"enabled": true`，命令是 `node ./hooks/pre_invocation.mjs`；
3. 手工跑一次看输出：

```bash
echo {"lastUserInput":"✨ 测试草稿","conversationId":"manual-test"} | node hooks/pre_invocation.mjs
```

- 输出 `{}\n` → 没匹配（前缀被编辑器吃了空格，或 settings 里 triggerPrefixes 被改过）；
- 输出带 `injectSteps` 的 JSON → 钩子正常，问题在上层（重启反重力让插件重载）。

4. 同一句话在同一个会话里只会触发一次（`hook_state.json` 的 `lastSignature` 去重）。改一个字再试。

---

## E. 自动更新把补丁冲掉了

特征：按钮突然消失，`app.asar` 大小回到 8.9MB 左右，`app.asar.pre_prompt_optimize.bak` 还在。

处理：

```bat
install.bat        :: 重新注入即可（备份不覆盖）
```

长期方案（冻结更新源）：

```powershell
$r = "$env:LOCALAPPDATA\Programs\antigravity\resources"
Copy-Item "$r\app-update.yml" "$r\app-update.yml.original" -Force
(Get-Content "$r\app-update.yml") -replace '^url:.*', 'url: http://127.0.0.1:1/disabled/' | Set-Content "$r\app-update.yml"
```

并在 `%APPDATA%\Antigravity\app_storage.json` 里加 `"autoCheckForUpdates": "false"`。

---

## F. 打包时报错

| 报错 | 原因 | 处理 |
|---|---|---|
| `i18n_runner.js 钩子锚点未找到` | 汉化包版本变了，锚点文本改过 | 用 `--out` 只生成中间包，手工确认锚点；或删掉 i18n_runner.js 让其独立运行 |
| `missing ) after argument list` | 注入串括号不配对 | 检查 patcher 注入串，末尾不要多一个 `}` |
| `npx` 卡住/超时 | 网络拉 `@electron/asar` | `cd installer && npm install` |
| `EBUSY / 拒绝访问` | 反重力还在跑 | 先 `taskkill /f /im Antigravity.exe` |

---

## G. 存档相关（重要）

本套工具**从不写** `%USERPROFILE%\.gemini\antigravity`。如果发现该目录异常（文件变少、时间戳被改）：

1. 立刻停止所有操作，不要重装、不要清理；
2. 查备份：`dir "%USERPROFILE%\Documents\Antigravity_Backup"`；
3. 从最近一次 `conversations_<时间戳>` 整目录拷回：

```bat
robocopy "%USERPROFILE%\Documents\Antigravity_Backup\conversations_20261115_043058" ^
         "%USERPROFILE%\.gemini\antigravity\conversations" /E
```

4. 复原前先关闭反重力（`taskkill /f /im Antigravity.exe`），否则 sqlite 会锁库。
