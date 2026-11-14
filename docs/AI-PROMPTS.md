# 用 AI 辅助安装与改造（提示词合集）

> 用法：直接把整段提示词复制给任意 AI 编码助手（Claude Code / Cursor / Copilot Chat / DeepSeek / 反重力自己）。
> 提示词里已经写好了「不要动存档」「先体检再动手」「失败要回滚」这些硬约束，AI 拿到就能干活。

---

## 0. 一键安装（最常用）

```text
我在 Windows 上装了 Google Antigravity 桌面端，想把本项目（路径：F:\pluge\antigravity-prompt-forge）装上去，
让输入框右下角出现「✨ 增强」按钮。

硬约束：
1. 绝对不要删除或写入 %USERPROFILE%\.gemini\antigravity 下的任何文件（那里是我的全部对话存档）；
2. 每一步改动前先说明你要动哪个文件，改完立刻验证；
3. 打包/注入失败时必须保持原始 app.asar 不变。

执行顺序：
1) 先跑 node installer/install.mjs --check，把输出逐条解释给我；
2) 若无 Antigravity 安装目录或 app.asar 异常，先停下来说明；
3) 正常则跑 node installer/install.mjs，等待它自动重启；
4) 重启后用 check.bat 复验，确认：app.asar 大小变大、备份存在、插件目录存在、
   %APPDATA%\Antigravity\DevToolsActivePort 存在且进程数 >= 5；
5) 告诉我怎么点 ✨ 增强 做一次真机验证（打草稿→点按钮→看文本是否变成 "✨:enhanced 原草稿"→再点还原）。
```

---

## 1. 只装插件，不碰 app.asar（保守模式）

```text
我暂时不想改 Antigravity 的 app.asar（怕影响自动更新），只想用插件方式：
请运行 node installer/install.mjs --plugin-only，
然后告诉我：① 插件装到了哪里；② 用 ✨ / ++ 前缀发消息会发生什么；
③ 侧边栏面板怎么打开（sidecar://prompt-optimize/panel/）；
④ 不配 API Key 时的实际链路是什么。不要修改任何 app.asar。
```

---

## 2. 环境体检（装不上时先跑这个）

```text
反重力的 ✨ 增强 按钮没出现 / 装不上。请按下面顺序帮我定位，每步把命令和输出都贴出来：

1) node -v；where node（确认 Node >= 18）
2) node installer/install.mjs --check（脚本自带体检）
3) dir "%LOCALAPPDATA%\Programs\antigravity\resources"（看 app.asar 与 *.bak 大小）
4) tasklist /fi "imagename eq Antigravity.exe"（进程在不在）
5) type "%APPDATA%\Antigravity\DevToolsActivePort"（有没有 CDP 端口）
6) echo %ELECTRON_RUN_AS_NODE% %NODE_OPTIONS%（是否被宿主注入）

判断规则：
- 进程秒退且 ExitCode=0 → 大概率是 ELECTRON_RUN_AS_NODE=1，需从干净环境启动；
- 进程在但窗口全黑 → 渲染进程被 widget 拖死，检查 i18n_runner.js 里有没有 setInterval(800)；
- 进程正常、按钮不在 → app.asar 被自动更新覆盖，或 composer 选择器与当前版本不匹配。

不要改动 %USERPROFILE%\.gemini\antigravity 下的文件。
```

---

## 3. 版本升级后按钮消失（Re-patch）

```text
Antigravity 升级到了新版本，✨ 增强 按钮消失了。请：
1) 比对 resources/app.asar 与 app.asar.pre_prompt_optimize.bak 的大小和时间戳，确认是被升级覆盖；
2) 如果是，重新运行 node installer/install.mjs（它会自动重新打包并保留旧备份）；
3) 打包完成后用 node loader/patch-composer-asar.mjs --out %TEMP%\t.asar 单独验证一次，
   确认 node --check 四个文件都通过；
4) 重启后告诉我按钮位置是否还贴在「请求审核」左侧、输入框右下角。
不要动存档目录。
```

---

## 4. 适配新版本的输入框（DOM 变了）

```text
新版 Antigravity 改了 composer 的 DOM，✨ 增强 按钮位置不对（或点不动）。
请用 CDP 帮我重新采样选择器：
1) 从 %APPDATA%\Antigravity\DevToolsActivePort 读端口；
2) 用 websocket 连 http://127.0.0.1:<port>/json/list 里 url 以 https://127.0.0.1: 开头的 target（注意 suppress_origin=True，否则 403）；
3) 在页面里执行：
   Array.from(document.querySelectorAll("[contenteditable='true'],textarea"))
     .map(e=>({tag:e.tagName, cls:e.className, ph:e.getAttribute('data-placeholder')||e.placeholder,
               r:(b=>[b.x|0,b.y|0,b.width|0,b.height|0])(e.getBoundingClientRect())}))
4) 把结果和 loader/antigravity-composer-widget.js 里的 INPUT_SELECTORS / COMPOSER_SELECTORS 对照，
   给出需要新增的选择器，并说明为什么（可见性门槛 width>=220、height>=18、bottom>=视口 35%）。
只改选择器，不要引入 setInterval 或新的 MutationObserver。
```

---

## 5. 点击按钮写不回输入框（Lexical 又变招了）

```text
点 ✨ 增强 后按钮变成 ↩ 还原、toast 也正常，但输入框文本没有变成 "✨:enhanced 原草稿"。
已知反重力的输入框是 Lexical 编辑器，这些方式都无效（返回 true 但被回滚）：
- document.execCommand("selectAll") + execCommand("insertText")
- 直接改 textContent / innerHTML
- __lexicalEditor.update() 里重建节点
现在有效的是「合成事件」路径：
  el.focus()
  dispatch KeyboardEvent("keydown",{key:"a",keyCode:65,ctrlKey:true})
  dispatch KeyboardEvent("keydown",{key:"Backspace",keyCode:8})
  new DataTransfer().setData("text/plain", text)
  dispatch ClipboardEvent("paste",{clipboardData:dt})
请先用 CDP 在当前版本上逐条验证上面四行是否仍然有效（读 innerText 前后对比），
无效则给出这一版的替代方案，并说清依据（哪种事件被 preventDefault、哪种被 Lexical 接受）。
改完后要在真实鼠标点击路径下验证，而不是只在控制台里跑。
```

---

## 6. 二次开发（加功能）

```text
我想给 Antigravity Prompt Optimize 加一个功能：<在这里写你的需求，例如「历史记录下拉」「快捷键 Ctrl+Shift+P 触发」>。
约束：
1) 只能改 loader/antigravity-composer-widget.js 和 plugin/ 下的文件，不要动 app.asar 的其它部分；
2) 不允许使用 setInterval 轮询 DOM，不允许新建第二个 MutationObserver（会触发活锁把窗口拖黑）；
3) 所有 DOM 布局读取必须在同一个 geometry epoch 内缓存，避免强制重排；
4) 改完跑 node --check，并重新执行 node loader/patch-composer-asar.mjs --out %TEMP%\t.asar 验证；
5) 给我一段 3 行以内的安装说明。
```

---

## 7. 发布到 GitHub（维护者用）

```text
我要把 F:\pluge\antigravity-prompt-forge 发布成一个开源仓库。
请按下面规则整理并给出需要执行的 git 命令（不要直接 push）：
1) .gitignore 必须排除：installer/node_modules、plugin/data、*.asar、*.bak-*、*.log；
2) 检查有没有硬编码的个人路径（我的用户名、C:\Users\...），有就改成占位符或自动探测；
3) 生成一份 Conventional Commits 风格的初始提交信息；
4) 生成 release 说明（面向普通用户：一句话卖点 + 三步安装 + 已知限制）；
5) 告诉我打 tag 与上传 zip 资产的具体命令。

提交信息用中文，代码注释保持中文。
```

---

## 8. 让反重力自己修自己（元用法）

```text
你现在运行在 Antigravity 里，并且我已经装了 prompt-optimize 插件。
请先用 ✨:structured 把下面这个需求改写成结构化规格，再直接执行：

需求：我点了输入框右下角的 ✨ 增强，按钮状态（↩ 还原）和提示气泡都正常，但文本没变。
仓库在 F:\pluge\antigravity-prompt-forge。

要求：
- 先用 CDP 连上当前窗口（DevToolsActivePort + suppress_origin=True）复现；
- 打印按下按钮前后输入框的 innerText、以及 widget 内部 state.mode；
- 定位到 writeInputText 的哪一步被反重力拒绝；
- 给出补丁（只改 loader/antigravity-composer-widget.js），改完重新打包并重启验证；
- 全程不要写入 %USERPROFILE%\.gemini\antigravity。
```
