# Prompt Optimize (提示词增强) — Antigravity 插件版

本插件完整解析并移植自 [CodexPlusPlusScriptMarket](https://github.com/BigPizzaV3/CodexPlusPlusScriptMarket) 中的两款核心提示词插件：
1. **Prompt Optimize (`scripts/prompt-optimize.js` v1.0.4)** — 三种风格（简洁 / 结构化 / 编程）自定义 System Prompt、一键优化与一键还原。
2. **增强提示词 (`scripts/prompt-enhancement.js` v1.0.1 by Meowv)** — 严格语言一致性保障、`@file` / 代码块 / URL / 路径 Token 完整性校验、API 连通性测试。

## 在反重力 (Antigravity) 对话框中的 3 种使用方式

### 方式一：对话框直接前缀触发（最快捷，无需离开输入框）
在反重力底部对话框输入内容时：
- 以 `✨ ` 或 `++ ` 开头发送消息（例如：`✨ 帮我写一个带缓存的接口请求工具`）
- 或者在侧边面板中开启 **「对话框发送时自动增强所有提示词」**
- 插件的 `PreInvocation` 钩子会在发送瞬间自动调用你配置的外部 AI 模型强化提示词，在对话框内展示优化后的提示词卡片，并将强化后的完整指令直接交给反重力执行！

### 方式二：对话侧边交互面板（一键优化 / 还原 / 配置 API）
- 点击对话中的快捷胶囊 `[✨ Prompt Optimize](sidecar://prompt-optimize/panel/)` 或对话右上角 `+` 按钮打开 **Prompt Optimize** 侧边栏。
- 支持输入草稿、点击 **✨ 增强提示词**、点击 **↩ 还原原文**、对比受保护的 `@file`/代码块 Token、一键复制并填入对话框，以及配置 OpenAI 兼容 / Anthropic / Gemini API Key。

### 方式三：对话框 `/` 斜杠命令
- 在对话框直接输入 `/prompt-optimize` 即可快速唤起提示词增强工作流或打开面板。
