#!/usr/bin/env node
/**
 * Antigravity Prompt Optimize — 自动解析、验证与装载程序 (install-loader.mjs)
 *
 * 功能：
 * 1. 校验并装载反重力原生插件包 (~/.gemini/config/plugins/prompt-optimize)
 *    - 包含 PreInvocation 对话框自动拦截强化钩子 (hooks.json + hooks/pre_invocation.mjs)
 *    - 包含 Sidecar 对话侧边栏交互面板 (sidecars/panel/)
 *    - 包含 /prompt-optimize 对话框斜杠命令 (skills/prompt-optimize/SKILL.md)
 * 2. 对所有 JS/MJS 脚本执行 `node --check` 静态语法门禁校验
 * 3. 对对话框钩子 (PreInvocation) 执行模拟输入自检测试
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PLUGIN_DIR = join(homedir(), '.gemini', 'config', 'plugins', 'prompt-optimize');
const SCRATCH_DIR = join(homedir(), '.gemini', 'antigravity', 'scratch', 'antigravity-prompt-optimize');

const FILES_TO_CHECK = [
  join(PLUGIN_DIR, 'shared', 'core.mjs'),
  join(PLUGIN_DIR, 'hooks', 'pre_invocation.mjs'),
  join(PLUGIN_DIR, 'sidecars', 'panel', 'main.mjs'),
  join(PLUGIN_DIR, 'sidecars', 'panel', 'app.js'),
  join(SCRATCH_DIR, 'antigravity-composer-widget.js')
];

console.log('====================================================');
console.log('🚀 Antigravity Prompt Optimize 装载与自检程序 v1.2.0');
console.log('====================================================\n');

// Step 1: Check files & syntax gatekeeper (node --check)
console.log('[1/3] 正在执行静态语法门禁校验 (node --check)...');
for (const file of FILES_TO_CHECK) {
  if (!existsSync(file)) {
    console.error(`❌ 缺失核心文件: ${file}`);
    process.exit(1);
  }
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  console.log(`  ✅ 语法校验通过: ${file}`);
}

// Step 2: Validate JSON manifests
console.log('\n[2/3] 正在校验插件清单与配置文件 (JSON)...');
for (const jsonFile of [
  join(PLUGIN_DIR, 'plugin.json'),
  join(PLUGIN_DIR, 'hooks.json'),
  join(PLUGIN_DIR, 'sidecars', 'panel', 'sidecar.json'),
  join(PLUGIN_DIR, 'sidecars', 'panel', 'package.json')
]) {
  JSON.parse(readFileSync(jsonFile, 'utf-8'));
  console.log(`  ✅ JSON 校验通过: ${jsonFile}`);
}

// Step 3: Self-test PreInvocation dialog hook
console.log('\n[3/3] 正在测试对话框 PreInvocation 钩子响应...');
const testPayload = JSON.stringify({
  conversationId: 'test-conv-' + Date.now(),
  invocationNum: 1,
  lastUserInput: '✨:coding 帮我写一个防抖函数'
});

const hookRun = spawnSync(process.execPath, [join(PLUGIN_DIR, 'hooks', 'pre_invocation.mjs')], {
  cwd: PLUGIN_DIR,
  input: testPayload,
  encoding: 'utf-8'
});

if (hookRun.status !== 0) {
  console.error('❌ 钩子自检失败:', hookRun.stderr);
  process.exit(1);
}

const hookOut = JSON.parse(hookRun.stdout.trim() || '{}');
if (Array.isArray(hookOut.injectSteps) && hookOut.injectSteps.length > 0) {
  console.log('  ✅ 对话框钩子拦截与强化注入测试通过！');
} else {
  console.error('❌ 钩子未返回预期的 injectSteps:', hookRun.stdout);
  process.exit(1);
}

console.log('\n🎉 装载与验证全部完成！插件已激活于:', PLUGIN_DIR);
