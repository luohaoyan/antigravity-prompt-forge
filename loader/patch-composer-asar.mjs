#!/usr/bin/env node
/**
 * patch-composer-asar.mjs — 把「✨ 增强」按钮挂进 Antigravity 的 app.asar（通用版 v1.5.0）
 *
 * 做了什么:
 *   1. 解包 app.asar 到临时目录；
 *   2. 把 antigravity-composer-widget.js 写成 dist/prompt_optimize_runner.js；
 *   3. 若存在 dist/i18n_runner.js（汉化包的注入器），在它的 observer 回调 finally 里加一个被动唤醒钩子，
 *      并在文件尾部追加 widget 本体 —— widget 复用汉化器的节流队列，绝不新建 MutationObserver/轮询；
 *   4. 对 main.js / utils.js / i18n_runner.js / prompt_optimize_runner.js 全量 node --check；
 *   5. 打包 → 二次解包 → 再校验，全部通过才写出目标 asar。任何一步失败都不会覆盖原文件。
 *
 * 用法:
 *   node patch-composer-asar.mjs                              # 自动探测安装路径，写入 app.asar
 *   node patch-composer-asar.mjs --out /tmp/app.asar.patched   # 只生成中间包
 *   node patch-composer-asar.mjs --asar <path> --widget <path> --out <path>
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function detectAsar() {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  const candidates = [
    join(local, 'Programs', 'antigravity', 'resources', 'app.asar'),
    join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Antigravity', 'resources', 'app.asar'),
    join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Antigravity', 'resources', 'app.asar')
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

const ASAR_PATH = arg('--asar') || detectAsar();
const WIDGET_SRC = arg('--widget') || join(REPO_ROOT, 'loader', 'antigravity-composer-widget.js');
const OUT_PATH = arg('--out') || ASAR_PATH;

if (!ASAR_PATH || !existsSync(ASAR_PATH)) {
  console.error('\u274c 未找到 app.asar，请用 --asar 指定路径');
  process.exit(1);
}
if (!existsSync(WIDGET_SRC)) {
  console.error('\u274c 未找到 widget 脚本: ' + WIDGET_SRC);
  process.exit(1);
}

const WORK_DIR = join(tmpdir(), 'ag-prompt-optimize-asar-' + Date.now());
const EXTRACT_DIR = join(WORK_DIR, 'src');
const TEST_ASAR = join(WORK_DIR, 'out.asar');
const VERIFY_DIR = join(WORK_DIR, 'verify');

const NODE = process.execPath;
const CLEAN_ENV = { ...process.env };
delete CLEAN_ENV.ELECTRON_RUN_AS_NODE;
delete CLEAN_ENV.NODE_OPTIONS;
delete CLEAN_ENV.ELECTRON_NO_ATTACH_CONSOLE;

function asarCli(args) {
  const localCli = join(REPO_ROOT, 'installer', 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
  if (existsSync(localCli)) execFileSync(NODE, [localCli, ...args], { stdio: 'inherit', env: CLEAN_ENV });
  else execFileSync('npx.cmd', ['--yes', '@electron/asar', ...args], { stdio: 'inherit', shell: true, env: CLEAN_ENV });
}

const MARKER = '/* === ANTIGRAVITY_PROMPT_OPTIMIZE_WIDGET === */';
const HOOK_MARKER = '// === AG_PROMPT_OPTIMIZE_NOOP_HOOK ===';

function injectIntoRunner(file, widgetCode) {
  let code = readFileSync(file, 'utf-8');
  if (code.includes(MARKER)) code = code.split(MARKER)[0].trimEnd();
  if (code.includes(HOOK_MARKER)) code = code.split(HOOK_MARKER)[0].trimEnd();

  const anchorLine = '            isTranslating = false;';
  const anchorCtx = '        } finally {';
  let anchor = null;
  const lines = code.split('\n');
  for (let li = 0; li < lines.length - 1; li++) {
    if (lines[li].trim() === anchorCtx.trim() && lines[li + 1].trim() === anchorLine.trim()) {
      anchor = lines[li] + '\n' + lines[li + 1];
      break;
    }
  }
  if (!anchor) {
    const idx = code.lastIndexOf(anchorLine);
    if (idx > 0) {
      const start = code.lastIndexOf('\n', idx - 1);
      anchor = code.slice(code.lastIndexOf('\n', start - 1) + 1, idx + anchorLine.length);
    }
  }

  if (anchor && code.includes(anchor)) {
    code = code.replace(
      anchor,
      anchor +
        '\n' +
        '            try {\n' +
        '                if (typeof window.__AG_PROMPT_OPTIMIZE_SCHEDULE === "function") window.__AG_PROMPT_OPTIMIZE_SCHEDULE();\n' +
        '            } catch (_eAgHook) {}'
    );
    code = code + '\n\n' + HOOK_MARKER + '\n';
    console.log('  \u2705 已注入被动唤醒钩子（复用汉化器节流队列）');
  } else {
    console.log('  \u2139\ufe0f  未找到汉化器锚点，改为独立启动（widget 自带 rAF 调度）');
  }
  code = code + '\n' + MARKER + '\n' + widgetCode + '\n';
  writeFileSync(file, code, 'utf-8');
}

console.log('==========================================================');
console.log('  Antigravity Composer [✨ ] Button ASAR Patcher');
console.log('==========================================================\n');
console.log('  源 asar : ' + ASAR_PATH);
console.log('  目标    : ' + OUT_PATH + '\n');

mkdirSync(WORK_DIR, { recursive: true });
try {
  console.log('[1/5] 解包 app.asar ...');
  asarCli(['extract', ASAR_PATH, EXTRACT_DIR]);

  const distDir = join(EXTRACT_DIR, 'dist');
  copyFileSync(WIDGET_SRC, join(distDir, 'prompt_optimize_runner.js'));

  const widgetCode = readFileSync(WIDGET_SRC, 'utf-8');
  const i18nRunner = join(distDir, 'i18n_runner.js');
  if (existsSync(i18nRunner)) {
    console.log('  检测到 i18n_runner.js，合并挂载中 ...');
    injectIntoRunner(i18nRunner, widgetCode);
  } else {
    console.log('  未检测到 i18n_runner.js，写入独立 runner ...');
    writeFileSync(i18nRunner, widgetCode, 'utf-8');
  }

  console.log('\n[2/5] node --check 语法门禁 ...');
  for (const f of ['main.js', 'utils.js', 'i18n_runner.js', 'prompt_optimize_runner.js']) {
    const p = join(distDir, f);
    if (existsSync(p)) {
      execFileSync(NODE, ['--check', p], { stdio: 'inherit', env: CLEAN_ENV });
      console.log('  \u2705 ' + f);
    }
  }

  console.log('\n[3/5] 沙箱打包 ...');
  asarCli(['pack', EXTRACT_DIR, TEST_ASAR]);

  console.log('\n[4/5] 二次解包闭环校验 ...');
  asarCli(['extract', TEST_ASAR, VERIFY_DIR]);
  execFileSync(NODE, ['--check', join(VERIFY_DIR, 'dist', 'i18n_runner.js')], { stdio: 'inherit', env: CLEAN_ENV });
  console.log('  \u2705 校验通过');

  console.log('\n[5/5] 写出 ' + OUT_PATH + ' ...');
  copyFileSync(TEST_ASAR, OUT_PATH);
  console.log('  \ud83c\udf89 完成');
} finally {
  rmSync(WORK_DIR, { recursive: true, force: true });
}
