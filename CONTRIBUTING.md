# 参与开发

## 本地运行

```bash
# 1. 装打包依赖（只为了 @electron/asar）
cd installer && npm install && cd ..

# 2. 只生成中间包，不动已安装的反重力
node loader/patch-composer-asar.mjs --out %TEMP%/app.asar.test

# 3. 语法门禁
node --check loader/antigravity-composer-widget.js
node --check installer/install.mjs
```

## 硬性规则

1. **禁止 `setInterval` 轮询 DOM**，禁止新增第二个 `MutationObserver`。历史教训：v1.3.0 因为这两样导致窗口全黑。
2. **禁止用 `execCommand` 写 Lexical 输入框**。返回 true 是假象，内容会被回滚。用合成 `Ctrl+A` + `Backspace` + `paste`。
3. **禁止写入** `%USERPROFILE%/.gemini/antigravity`。那里是用户全部对话存档。
4. 任何 `app.asar` 写入之前必须有备份，且打包失败不得覆盖原文件。
5. 改完必须通过 `node --check` 与"真实鼠标点击"路径的端到端测试（CDP `Input.dispatchMouseEvent`）。

## 提 PR 请附上

- 改动前后的 CDP 探测输出（按钮 rect、输入框 innerText 前后对比）；
- `app.asar` 大小变化；
- 目标反重力版本号（`resources/app.asar` 里 `package.json` 的 `version`）。
