import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DATA_DIR,
  DEFAULT_SYSTEM_PROMPTS,
  appendHistory,
  callLLM,
  ensureDataDir,
  loadSettings
} from '../shared/core.mjs';

const STATE_FILE = join(DATA_DIR, 'hook_state.json');

function loadHookState() {
  try {
    if (!existsSync(STATE_FILE)) return {};
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8')) || {};
  } catch {
    return {};
  }
}

function saveHookState(state) {
  try {
    ensureDataDir();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

function matchTrigger(rawInput, settings) {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return null;

  // Ignore slash commands except explicit /opt
  if (trimmed.startsWith('/') && !/^\/opt(?:imize)?\b/i.test(trimmed)) {
    return null;
  }

  // Check explicit style prefixes like ✨:coding, ++:concise, ++:structured, ✨:enhanced
  const styleMatch = trimmed.match(/^(?:✨|\+\+|\/opt(?:imize)?)(?::(enhanced|coding|structured|concise))?\s+([\s\S]+)$/i);
  if (styleMatch) {
    return {
      styleOverride: styleMatch[1] ? styleMatch[1].toLowerCase() : settings.style,
      draft: styleMatch[2].trim(),
      explicit: true
    };
  }

  // Check custom trigger prefixes from settings
  for (const prefix of settings.triggerPrefixes || ['✨', '++']) {
    if (prefix && trimmed.startsWith(prefix)) {
      const rest = trimmed.slice(prefix.length).trim();
      if (rest) {
        return {
          styleOverride: settings.style,
          draft: rest,
          explicit: true
        };
      }
    }
  }

  if (settings.autoEnhanceAll && trimmed.length >= 6) {
    return {
      styleOverride: settings.style,
      draft: trimmed,
      explicit: false
    };
  }

  return null;
}

async function main() {
  let stdinText = '';
  for await (const chunk of process.stdin) {
    stdinText += chunk;
  }

  let payload = {};
  try {
    payload = stdinText ? JSON.parse(stdinText) : {};
  } catch {
    process.stdout.write('{}\n');
    return;
  }

  const lastUserInput = typeof payload.lastUserInput === 'string' ? payload.lastUserInput : '';
  const convId = String(payload.conversationId || 'default');
  if (!lastUserInput.trim()) {
    process.stdout.write('{}\n');
    return;
  }

  const settings = loadSettings();
  const matched = matchTrigger(lastUserInput, settings);
  if (!matched) {
    process.stdout.write('{}\n');
    return;
  }

  // Deduplicate across multi-step tool invocations in the same turn
  const hookState = loadHookState();
  const signature = `${convId}::${lastUserInput.trim()}`;
  if (hookState.lastSignature === signature) {
    process.stdout.write('{}\n');
    return;
  }
  hookState.lastSignature = signature;
  hookState.updatedAt = new Date().toISOString();
  saveHookState(hookState);

  const { draft, styleOverride } = matched;

  // Case 1: External LLM API is configured -> call external LLM just like Codex++ Prompt Optimize
  if (settings.apiKey && settings.baseUrl) {
    try {
      const result = await callLLM({
        settings,
        input: draft,
        styleOverride,
        timeoutMs: 35000
      });

      appendHistory({
        source: 'dialog-hook',
        conversationId: convId,
        style: result.style,
        model: result.model,
        protocol: result.protocol,
        originalText: draft,
        optimizedText: result.output,
        warnings: result.warnings
      });

      const quotedOptimized = result.output
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');

      const warnLine =
        result.warnings && result.warnings.length
          ? `\n>\n> ⚠️ *提示: ${result.warnings.join('；')}*`
          : '';

      const userMarkdown = [
        `> **✨ Prompt Optimize 已强化您的提示词** (\`${result.style}\` · \`${result.model}\`) · [打开面板与还原](sidecar://prompt-optimize/panel/)`,
        `>`,
        quotedOptimized + warnLine
      ].join('\n');

      const response = {
        injectSteps: [
          {
            systemMessage: {
              systemMessage: [
                `[Prompt Optimize Plugin - Enhanced User Prompt]`,
                `The user's original draft ("${draft}") was automatically enhanced by the Prompt Optimize plugin (${result.style} mode) into the following specification.`,
                `Follow and fulfill this enhanced prompt while preserving all original constraints, @file references, paths, and code blocks:`,
                ``,
                result.output
              ].join('\n'),
              metadata: {
                user_markdown: userMarkdown
              }
            }
          }
        ]
      };

      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    } catch (err) {
      const errMsg = err?.message || String(err);
      const fallbackMarkdown = `> ⚠️ **Prompt Optimize 外部 API 调用未成功**（${errMsg}），已为您回退为内置 AI 提示词强化模式 · [点击检查 API 设置](sidecar://prompt-optimize/panel/)`;
      const ruleText = DEFAULT_SYSTEM_PROMPTS[styleOverride] || DEFAULT_SYSTEM_PROMPTS.enhanced;
      const response = {
        injectSteps: [
          {
            systemMessage: {
              systemMessage: [
                `[Prompt Optimize Built-in Fallback]`,
                `The user requested prompt enhancement (${styleOverride} mode) for their draft: "${draft}".`,
                `First mentally expand and structure their request according to these prompt-engineering guidelines:`,
                ruleText,
                `Then briefly show the enhanced prompt in a blockquote at the very top of your response, and immediately proceed to execute the task thoroughly.`
              ].join('\n'),
              metadata: {
                user_markdown: fallbackMarkdown
              }
            }
          }
        ]
      };
      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    }
  }

  // Case 2: No external API Key configured yet -> Zero-config built-in Antigravity AI enhancement!
  const ruleText = DEFAULT_SYSTEM_PROMPTS[styleOverride] || DEFAULT_SYSTEM_PROMPTS.enhanced;
  appendHistory({
    source: 'dialog-builtin',
    conversationId: convId,
    style: styleOverride,
    model: 'antigravity-builtin',
    protocol: 'builtin',
    originalText: draft,
    optimizedText: `[内置 AI 自动增强模式 (${styleOverride})] ${draft}`,
    warnings: []
  });

  const userMarkdown = `> **✨ Prompt Optimize (内置免配置增强已触发 · \`${styleOverride}\`)** — 如需在发送前用独立外部模型预改写，请点此打开 [✨ Prompt Optimize 设置面板](sidecar://prompt-optimize/panel/)`;
  const response = {
    injectSteps: [
      {
        systemMessage: {
          systemMessage: [
            `[Prompt Optimize Plugin - Built-in Prompt Enhancement Active (${styleOverride} mode)]`,
            `The user prefixed their message with a Prompt Optimize trigger for the draft:`,
            `"""`,
            draft,
            `"""`,
            `Step 1: Rewrite and strengthen this draft using the Codex++ Prompt Optimize (${styleOverride}) specification below, and display the strengthened prompt inside a concise \`> **✨ 强化后提示词：** ...\` blockquote at the beginning of your reply.`,
            `Step 2: Immediately execute the strengthened prompt thoroughly without waiting for another turn.`,
            ``,
            `Enhancement Specification:`,
            ruleText
          ].join('\n'),
          metadata: {
            user_markdown: userMarkdown
          }
        }
      }
    ]
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

main().catch(() => {
  process.stdout.write('{}\n');
});
