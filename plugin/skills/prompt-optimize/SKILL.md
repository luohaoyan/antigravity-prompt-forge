---
name: prompt-optimize
description: AI 提示词增强器 (移植自 Codex++ Prompt Optimize & 增强提示词)。当用户输入 /prompt-optimize、使用 ✨ 或 ++ 前缀、或需要强化/润色/结构化提示词、打开提示词增强侧边面板时激活。
---

# Prompt Optimize (提示词智能增强工作流)

本技能由 `prompt-optimize` 插件提供，融合了 **Codex++ Script Market** 中的 `Prompt Optimize` (v1.0.4) 与 `增强提示词` (v1.0.1 by Meowv)。

## 核心行为准则

1. **打开侧边交互面板**：
   - 当用户希望可视化编辑、一键优化、一键还原或配置外部 LLM API（OpenAI / Anthropic / Gemini / DeepSeek）时，向用户输出以下一键开启胶囊链接：
     `[✨ 提示词增强面板 (Prompt Optimize)](sidecar://prompt-optimize/panel/)`
2. **命令行调用外部 AI 优化脚本**：
   - 插件内置了独立 CLI 与 Node 核心模块：`~/.gemini/config/plugins/prompt-optimize/shared/core.mjs`。
3. **内置提示词强化规范（四种模式）**：
   - **🌟 智能增强 (`enhanced`)**：保持输入语言完全一致（中文输入必输出中文），明确任务范围、边界条件与期望输出，原样保留所有 `@file` 引用、代码块、文件路径与 URL。
   - **💻 编程任务 (`coding`)**：明确拆解：任务目标、涉及文件/模块范围、验收标准 (Acceptance Criteria)、非目标 (Non-goals) 与验证步骤。
   - **📐 结构化 (`structured`)**：按 Role、Goal、Context、Constraints、Output Format 组织提示词。
   - **⚡ 简洁 (`concise`)**：剔除冗余寒暄，保留核心意图与硬性约束。
