import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';
import {
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  DEFAULT_SYSTEM_PROMPTS,
   HISTORY_FILE,
  appendHistory,
  callLLM,
  checkTokenPreservation,
  defaultSettings,
  ensureDataDir,
  loadHistory,
  loadSettings,
  saveSettings
} from '../../shared/core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findAppDataDir() {
  const dataDir = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (dataDir) {
    for (let d = dataDir; d !== dirname(d); d = dirname(d)) {
      if (basename(d) === 'sidecar_data') {
        return dirname(d);
      }
    }
  }
  const fallback = join(homedir(), '.gemini', 'antigravity');
  return existsSync(fallback) ? fallback : null;
}

function getLastUserPromptFromTranscript(convId) {
  if (!convId || !/^[0-9a-f-]{8,}$/i.test(convId)) return '';
  const appData = findAppDataDir();
  if (!appData) return '';
  const transcriptPath = join(appData, 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl');
  if (!existsSync(transcriptPath)) return '';
  try {
    const lines = readFileSync(transcriptPath, 'utf-8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      const step = JSON.parse(lines[i]);
      if (step?.type === 'USER_INPUT' && typeof step.content === 'string' && step.content.trim()) {
        // Strip <USER_REQUEST> wrapper if present
        let txt = step.content.trim();
        const m = txt.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
        if (m) txt = m[1].trim();
        return txt;
      }
    }
  } catch {
    // ignore
  }
  return '';
}

const app = new SidecarApp();

app.page('/', () => readFileSync(join(__dirname, 'index.html'), 'utf-8'));

app.api('/styles.css', () => new Response(readFileSync(join(__dirname, 'styles.css'), 'utf-8'), { contentType: 'text/css' }), 'GET');
app.api('/app.js', () => new Response(readFileSync(join(__dirname, 'app.js'), 'utf-8'), { contentType: 'application/javascript' }), 'GET');

app.api('/api/state', (data) => {
  const convId = data.conversationId || app.config.conversationId || '';
  const settings = loadSettings();
  const history = loadHistory();
  const lastUserPrompt = getLastUserPromptFromTranscript(convId);
  return {
    conversationId: convId,
    settings: {
      ...settings,
      hasApiKey: Boolean(settings.apiKey && settings.apiKey.trim())
    },
    defaults: {
      models: DEFAULT_MODELS,
      baseUrls: DEFAULT_BASE_URLS,
      systemPrompts: DEFAULT_SYSTEM_PROMPTS
    },
    history: history.slice(0, 15),
    lastUserPrompt
  };
}, 'GET');

app.api('/api/settings', (data) => {
  const saved = saveSettings(data.settings || {});
  return {
    ok: true,
    settings: {
      ...saved,
      hasApiKey: Boolean(saved.apiKey && saved.apiKey.trim())
    }
  };
}, 'POST');

app.api('/api/test-connection', async (data) => {
  const candidate = data.settings || loadSettings();
  const res = await callLLM({
    settings: candidate,
    input: 'OK',
    testing: true,
    timeoutMs: 25000
  });
  return {
    ok: true,
    output: res.output
  };
}, 'POST');

app.api('/api/optimize', async (data) => {
  const input = String(data.input || '').trim();
  if (!input) {
    throw new Error('请先输入需要优化的提示词草稿');
  }
  const settings = loadSettings();
  const styleOverride = data.style || settings.style || 'enhanced';
  const convId = data.conversationId || app.config.conversationId || '';

  const res = await callLLM({
    settings,
    input,
    styleOverride,
    timeoutMs: 90000
  });

  const histItem = appendHistory({
    source: 'panel',
    conversationId: convId,
    style: res.style,
    model: res.model,
    protocol: res.protocol,
    originalText: input,
    optimizedText: res.output,
    warnings: res.warnings
  });

  return {
    ok: true,
    originalText: input,
    optimizedText: res.output,
    style: res.style,
    model: res.model,
    protocol: res.protocol,
    warnings: res.warnings,
    tokenCheck: res.tokenCheck,
    historyItem: histItem
  };
}, 'POST');

app.api('/api/clear-history', () => {
  ensureDataDir();
  writeFileSync(HISTORY_FILE, '[]', 'utf-8');
  return { ok: true };
}, 'POST');

app.run();
