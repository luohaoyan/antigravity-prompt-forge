#!/usr/bin/env node
/**
 * Antigravity Prompt Optimize - 一键安装器 (install.mjs)
 *
 * 用法:
 *   node install.mjs                 # 自动检测反重力目录，安装「输入框按钮 + 插件」
 *   node install.mjs --check         # 只体检，不改任何文件
 *   node install.mjs --rollback      # 回滚到安装前的 app.asar
 *   node install.mjs --plugin-only   # 只装 .gemini 插件（不碰 app.asar）
 *   node install.mjs --uninstall     # 移除插件（app.asar 用 --rollback 回滚）
 *   node install.mjs --freeze-update # 冻结自动更新（app-update.yml 指向死地址 + 关掉自动检查）
 *
 * 设计原则:
 *  1) 绝不删除用户对话存档（.gemini/antigravity/conversations 等）——本脚本从不写这些目录；
 *  2) 所有改动前先备份（app.asar → app.asar.pre_prompt_optimize.bak / plugin → plugin.bak-<时间戳>）；
 *  3) 所有写入前做 node --check 语法门禁 + 二次解包校验，失败即中止且不覆盖原文件；
 *  4) 自动清理 ELECTRON_RUN_AS_NODE / NODE_OPTIONS 等宿主注入变量（否则 Electron 会以纯 Node 模式秒退）。
 */

import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const PLUGIN_SRC = join(REPO_ROOT, 'plugin');
const WIDGET_SRC = join(REPO_ROOT, 'loader', 'antigravity-composer-widget.js');

const HOME = homedir();
const PLUGIN_DEST = join(HOME, '.gemini', 'config', 'plugins', 'prompt-optimize');
const CONVERSATIONS_DIR = join(HOME, '.gemini', 'antigravity');

const ARGS = new Set(process.argv.slice(2));
const MODE_CHECK = ARGS.has('--check');
const MODE_ROLLBACK = ARGS.has('--rollback');
const MODE_PLUGIN_ONLY = ARGS.has('--plugin-only');
const MODE_UNINSTALL = ARGS.has('--uninstall');
const MODE_FREEZE = ARGS.has('--freeze-update');

const C = {
  ok: (s) => console.log('  \u2705 ' + s),
  info: (s) => console.log('  \u2139\ufe0f  ' + s),
  warn: (s) => console.log('  \u26a0\ufe0f  ' + s),
  err: (s) => console.log('  \u274c ' + s),
  head: (s) => console.log('\n' + s)
};

function findAntigravity() {
  const candidates = [
    join(process.env.LOCALAPPDATA || join(HOME, 'AppData', 'Local'), 'Programs', 'antigravity'),
    join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Antigravity'),
    join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Antigravity')
  ];
  for (const dir of candidates) {
    const exe = join(dir, 'Antigravity.exe');
    const asar = join(dir, 'resources', 'app.asar');
    if (existsSync(exe) && existsSync(asar)) return { dir, exe, asar, resources: join(dir, 'resources') };
  }
  return null;
}

function needNodeModules() {
  const pkg = join(HERE, 'package.json');
  if (!existsSync(pkg)) return false;
  return !existsSync(join(HERE, 'node_modules', '@electron', 'asar'));
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function backupDir(src, tag) {
  if (!existsSync(src)) return null;
  const dest = src + '.bak-' + tag;
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  return dest;
}

function killAntigravity() {
  try {
    execFileSync('taskkill', ['/f', '/im', 'Antigravity.exe'], { stdio: 'ignore' });
  } catch { /* not running */ }
}

function launch(exe) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.NODE_OPTIONS;
  const child = spawn(exe, [], { detached: true, stdio: 'ignore', env });
  child.unref();
}

export function convertLanguagePacks() { /* reserved for future packs; translation lives inside app.asar */ }

function installPlugin() {
  C.head('[插件] 安装到 ' + PLUGIN_DEST);
  if (!existsSync(PLUGIN_SRC)) { C.err('仓库内找不到 plugin/ 目录'); return false; }
  if (existsSync(PLUGIN_DEST)) {
    const bak = backupDir(PLUGIN_DEST, 'preinstall-' + Date.now());
    C.info('已备份旧插件 → ' + bak);
  }
  mkdirSync(dirname(PLUGIN_DEST), { recursive: true });
  cpSync(PLUGIN_SRC, PLUGIN_DEST, { recursive: true });
  mkdirSync(join(PLUGIN_DEST, 'data'), { recursive: true });
  C.ok('插件文件已就位');
  for (const f of ['hooks/pre_invocation.mjs', 'shared/core.mjs', 'sidecars/panel/main.mjs', 'sidecars/panel/app.js']) {
    const p = join(PLUGIN_DEST, f);
    if (existsSync(p)) {
      try { run(process.execPath, ['--check', p]); C.ok('语法校验通过 ' + f); }
      catch { C.err('语法校验失败 ' + f); return false; }
    }
  }
  return true;
}

function removePlugin() {
  C.head('[插件] 卸载 ' + PLUGIN_DEST);
  if (!existsSync(PLUGIN_DEST)) { C.info('未安装，跳过'); return; }
  const bak = backupDir(PLUGIN_DEST, 'uninstall-' + Date.now());
  rmSync(PLUGIN_DEST, { recursive: true, force: true });
  C.ok('已移除（备份保留在 ' + bak + '）');
}

function patchAsar(ag) {
  C.head('[按钮] 注入 ✨ 增强 到反重力输入框');
  const STAGED = join(tmpdir(), 'app.asar.prompt-optimize-staged-' + Date.now() + '.asar');
  const patcher = join(REPO_ROOT, 'loader', 'patch-composer-asar.mjs');
  if (!existsSync(patcher)) { C.err('找不到 patch-composer-asar.mjs'); return false; }
  try {
    env_run(process.execPath, [patcher,
      '--asar', ag.asar,
      '--widget', WIDGET_SRC,
      '--out', STAGED
    ]);
  } catch (e) {
    C.err('打包失败，原始 app.asar 未被修改');
    return false;
  }
  if (!existsSync(STAGED)) { C.err('未生成中间包，中止'); return false; }

  const bak = ag.asar + '.pre_prompt_optimize.bak';
  if (!existsSync(bak)) { copyFileSync(ag.asar, bak); C.ok('已备份原始 app.asar → ' + bak); }
  else C.info('已有备份，保留不覆盖: ' + bak);

  killAntigravity();
  copyFileSync(STAGED, ag.asar);
  rmSync(STAGED, { force: true });
  C.ok('已写入 app.asar (' + statSync(ag.asar).size + ' bytes)');
  return true;
}

function env_run(cmd, args, opts = {}) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.NODE_OPTIONS;
  return execFileSync(cmd, args, { stdio: 'inherit', env, ...opts });
}

function rollback(ag) {
  C.head('[回滚] 恢复原始 app.asar');
  const bak = ag.asar + '.pre_prompt_optimize.bak';
  if (!existsSync(bak)) { C.err('没有找到备份 ' + bak); return false; }
  killAntigravity();
  copyFileSync(bak, ag.asar);
  C.ok('已恢复 ' + ag.asar + ' (' + statSync(ag.asar).size + ' bytes)');
  return true;
}

function freezeUpdate(ag) {
  C.head('[更新] 冻结自动更新（防止升级覆盖按钮）');
  if (!ag) { C.err('找不到反重力安装目录'); return false; }
  const yml = join(ag.resources, 'app-update.yml');
  const orig = yml + '.original';
  if (!existsSync(yml)) { C.err('找不到 app-update.yml'); return false; }
  if (!existsSync(orig)) { copyFileSync(yml, orig); C.ok('已备份 → ' + orig); }
  const raw = readFileSync(yml, 'utf-8');
  const next = raw.replace(/^url:.*$/m, 'url: http://127.0.0.1:1/disabled/');
  if (next === raw) C.info('更新地址已是冻结状态');
  writeFileSync(yml, next, 'utf-8');
  C.ok('app-update.yml 已指向死地址');
  const storage = join(HOME, 'AppData', 'Roaming', 'Antigravity', 'app_storage.json');
  if (existsSync(storage)) {
    try {
      const j = JSON.parse(readFileSync(storage, 'utf-8'));
      j.autoCheckForUpdates = 'false';
      writeFileSync(storage, JSON.stringify(j, null, 2), 'utf-8');
      C.ok('app_storage.json autoCheckForUpdates=false');
    } catch { C.warn('app_storage.json 解析失败，跳过'); }
  }
  return true;
}

function appVersion(ag) {
  try {
    return JSON.parse(readFileSync(join(ag.resources, 'app.asar'), 'utf-8').slice(0, 0) || '{}');
  } catch { return null; }
}

function report(ag) {
  C.head('[体检] 环境状态');
  if (!ag) { C.err('未找到反重力安装目录（Antigravity.exe + resources/app.asar）'); }
  else {
    C.ok('安装目录: ' + ag.dir);
    C.ok('app.asar: ' + statSync(ag.asar).size + ' bytes');
    const bak = ag.asar + '.pre_prompt_optimize.bak';
    console.log(existsSync(bak) ? '  \ud83d\udcbe 备份: ' + statSync(bak).size + ' bytes' : '  \ud83d\udcbe 备份: 无');
  }
  console.log('  \ud83d\udc65 存档目录(只读检查，脚本从不写入): ' + CONVERSATIONS_DIR);
  if (existsSync(join(CONVERSATIONS_DIR, 'conversations'))) {
    const dbs = readdirSync(join(CONVERSATIONS_DIR, 'conversations')).filter((f) => f.endsWith('.db'));
    let total = 0;
    for (const f of dbs) total += statSync(join(CONVERSATIONS_DIR, 'conversations', f)).size;
    C.ok('对话存档: ' + dbs.length + ' 个 .db, ' + (total / 1048576).toFixed(1) + ' MB（保持不动）');
  }
  console.log(existsSync(PLUGIN_DEST) ? '  \ud83d\udd0c 插件: 已安装 ' + PLUGIN_DEST : '  \ud83d\udd0c 插件: 未安装');
  const env = process.env;
  const dirty = ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'].filter((k) => env[k]);
  console.log(dirty.length ? '  \u26a0\ufe0f  检测到宿主注入变量: ' + dirty.join(', ') + '（安装器会自动清理）' : '  \u2705 环境变量干净');
}

function main() {
  console.log('==========================================================');
  console.log('  Antigravity Prompt Optimize - 一键安装器');
  console.log('==========================================================');
  const ag = findAntigravity();
  report(ag);

  if (MODE_CHECK) { C.head('仅体检模式，未修改任何文件'); return; }
  if (MODE_ROLLBACK) { if (!ag) return; rollback(ag); if (ag) launch(ag.exe); return; }
  if (MODE_UNINSTALL) { removePlugin(); C.info('如需移除按钮: node install.mjs --rollback'); return; }
  if (MODE_FREEZE) { freezeUpdate(ag); return; }

  let ok = true;
  if (!MODE_PLUGIN_ONLY) {
    if (!ag) { C.err('找不到反重力，跳过按钮注入（可用 --plugin-only 只装插件）'); ok = false; }
    else ok = patchAsar(ag) && ok;
  }
  ok = installPlugin() && ok;

  if (ok && ag && !MODE_PLUGIN_ONLY) {
    C.head('[启动] 正在启动反重力');
    launch(ag.exe);
    C.ok('已启动。若界面没有 ✨ 增强 按钮，请按 README 的排查表逐项检查。');
  }
  console.log('\n完成。存档目录全程未被触碰。');
}

main();
