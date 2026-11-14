(() => {
  const $ = (id) => document.getElementById(id);
  const apiFetch = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;

  let state = {
    conversationId: window.sidecar?.conversationId || '',
    settings: null,
    defaults: null,
    history: [],
    lastUserPrompt: '',
    originalDraft: null,
    optimizedDraft: null,
    isOptimized: false,
    loading: false
  };

  let toastTimer = 0;
  function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  async function callApi(path, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    const res = await apiFetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  // Tabs switching
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      document.querySelectorAll('.tab').forEach((t) => {
        t.classList.toggle('active', t === btn);
        t.setAttribute('aria-selected', String(t === btn));
      });
      document.querySelectorAll('.tab-panel').forEach((p) => {
        p.classList.toggle('active', p.id === `panel-${target}`);
      });
    });
  });

  function updateComposerUI() {
    const btnOptIcon = $('btn-optimize-icon');
    const btnOptText = $('btn-optimize-text');
    const btnRestore = $('btn-restore');
    const diffBox = $('diff-box');
    const origPreview = $('orig-preview');
    const stateLabel = $('editor-state-label');

    if (state.loading) {
      btnOptIcon.textContent = '⟳';
      btnOptText.textContent = '正在调用 AI 强化中...';
      $('btn-optimize').disabled = true;
      return;
    }

    $('btn-optimize').disabled = false;
    if (state.isOptimized && state.originalDraft != null) {
      btnOptIcon.textContent = '✨';
      btnOptText.textContent = '再次优化（或右侧还原）';
      btnRestore.classList.remove('hidden');
      diffBox.classList.remove('hidden');
      origPreview.textContent = state.originalDraft;
      stateLabel.textContent = '✨ 已优化提示词（点击「还原原文」可恢复）';
      stateLabel.classList.add('optimized');
    } else {
      btnOptIcon.textContent = '✨';
      btnOptText.textContent = '一键优化提示词';
      btnRestore.classList.add('hidden');
      diffBox.classList.add('hidden');
      stateLabel.textContent = '输入提示词草稿';
      stateLabel.classList.remove('optimized');
    }
  }

  function renderBadge() {
    const badge = $('api-badge');
    if (state.settings?.hasApiKey) {
      badge.textContent = `已就绪 · ${state.settings.model}`;
      badge.className = 'badge badge-ok';
    } else {
      badge.textContent = '免Key内置模式 (可配外部API)';
      badge.className = 'badge badge-warn';
    }
  }

  function renderHistory() {
    const list = $('history-list');
    $('hist-count').textContent = String(state.history.length);
    if (!state.history.length) {
      list.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:12px 0;">暂无记录。你在对话框使用 <code>✨</code> 前缀或在此面板优化过的提示词都会保存在这里，随时可一键还原。</div>`;
      return;
    }
    list.innerHTML = '';
    for (const item of state.history) {
      const card = document.createElement('div');
      card.className = 'hist-card';
      const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : '';
      card.innerHTML = `
        <div class="hist-meta">
          <span><strong>${item.style || 'enhanced'}</strong> · ${item.model || 'builtin'}</span>
          <span>${timeStr}</span>
        </div>
        <div style="font-size:11px;color:var(--muted);">原稿：</div>
        <div class="hist-text">${escapeHtml(item.originalText || '')}</div>
        <div style="font-size:11px;color:var(--accent-fg);">优化后：</div>
        <div class="hist-text">${escapeHtml(item.optimizedText || '')}</div>
        <div class="hist-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-restore-orig="${escapeAttr(item.originalText || '')}">载入原稿</button>
          <button type="button" class="btn btn-secondary btn-sm" data-restore-opt="${escapeAttr(item.optimizedText || '')}">载入优化版</button>
        </div>
      `;
      list.appendChild(card);
    }

    list.querySelectorAll('[data-restore-orig]').forEach((b) => {
      b.addEventListener('click', () => {
        $('prompt-input').value = b.getAttribute('data-restore-orig');
        state.isOptimized = false;
        updateComposerUI();
        document.querySelector('.tab[data-tab="composer"]').click();
        showToast('已载入历史原稿');
      });
    });

    list.querySelectorAll('[data-restore-opt]').forEach((b) => {
      b.addEventListener('click', () => {
        $('prompt-input').value = b.getAttribute('data-restore-opt');
        document.querySelector('.tab[data-tab="composer"]').click();
        showToast('已载入历史优化结果');
      });
    });
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  function populateSettingsForm() {
    const s = state.settings;
    if (!s) return;
    $('cfg-auto-enhance').checked = Boolean(s.autoEnhanceAll);
    $('cfg-prefixes').value = (s.triggerPrefixes || ['✨', '++', '/opt ']).join(', ');
    $('cfg-protocol').value = s.protocol || 'openai';
    $('cfg-baseurl').value = s.baseUrl || '';
    $('cfg-apikey').value = s.apiKey || '';
    $('cfg-model').value = s.model || '';
    $('cfg-default-style').value = s.style || 'enhanced';
    $('style-select').value = s.style || 'enhanced';
    $('sp-enhanced').value = s.systemPrompts?.enhanced || '';
    $('sp-coding').value = s.systemPrompts?.coding || '';
    $('sp-structured').value = s.systemPrompts?.structured || '';
    $('sp-concise').value = s.systemPrompts?.concise || '';
  }

  // Local instant structuring when user has no external API Key or clicks 免Key结构化
  function buildLocalStructuredPrompt(draft, style) {
    const raw = draft.trim();
    if (!raw) return '';
    if (style === 'coding') {
      return [
        `✨:coding ${raw}`,
        ``,
        `### 附加工程约束`,
        `- 保持现有代码结构与命名规范，精确定位涉及的文件与函数`,
        `- 保留所有 @file 引用、路径、代码块与接口签名不变`,
        `- 完成后进行语法与边界条件自检，并简要说明改动点`
      ].join('\n');
    }
    if (style === 'structured') {
      return [
        `✨:structured ${raw}`,
        ``,
        `### 期望执行结构`,
        `1. **核心目标**：明确拆解上述需求的关键步骤`,
        `2. **上下文与约束**：严格保留原文中的文件路径、代码片段与限制条件`,
        `3. **交付格式**：提供清晰、可直接落地执行的完整方案`
      ].join('\n');
    }
    if (style === 'concise') {
      return `✨:concise ${raw}`;
    }
    return `✨ ${raw}`;
  }

  async function handleOptimize() {
    const inputEl = $('prompt-input');
    const currentText = inputEl.value.trim();
    if (!currentText) {
      showToast('请先输入提示词草稿');
      inputEl.focus();
      return;
    }

    const style = $('style-select').value || 'enhanced';

    // If external API Key is not configured, use local structuring + built-in hook trigger
    if (!state.settings?.hasApiKey) {
      state.originalDraft = currentText.replace(/^✨(?::\w+)?\s+/, '');
      const localEnhanced = buildLocalStructuredPrompt(state.originalDraft, style);
      inputEl.value = localEnhanced;
      state.optimizedDraft = localEnhanced;
      state.isOptimized = true;
      updateComposerUI();
      showToast('已生成免Key增强指令（也可在设置中配置独立 API Key）');
      return;
    }

    state.loading = true;
    $('warning-box').classList.add('hidden');
    updateComposerUI();

    try {
      const baseText = state.isOptimized && state.originalDraft ? state.originalDraft : currentText;
      const res = await callApi('/api/optimize', 'POST', {
        input: baseText,
        style,
        conversationId: state.conversationId
      });

      state.originalDraft = baseText;
      state.optimizedDraft = res.optimizedText;
      state.isOptimized = true;
      inputEl.value = res.optimizedText;

      if (res.tokenCheck?.totalProtected > 0) {
        const badge = $('token-guard-badge');
        badge.classList.remove('hidden');
        badge.textContent = res.tokenCheck.preserved
          ? `🛡️ 已完整保护 ${res.tokenCheck.totalProtected} 处代码/路径引用`
          : `⚠️ 有引用变动`;
      }

      if (res.warnings?.length) {
        const wb = $('warning-box');
        wb.textContent = '⚠️ ' + res.warnings.join('；');
        wb.classList.remove('hidden');
      }

      if (res.historyItem) {
        state.history.unshift(res.historyItem);
        renderHistory();
      }
      showToast('✨ 提示词增强完成！可点击「还原原文」恢复');
    } catch (err) {
      showToast('优化失败: ' + (err.message || err));
    } finally {
      state.loading = false;
      updateComposerUI();
    }
  }

  function handleRestore() {
    if (state.originalDraft == null) {
      showToast('没有可还原的原稿');
      return;
    }
    $('prompt-input').value = state.originalDraft;
    state.isOptimized = false;
    $('warning-box').classList.add('hidden');
    updateComposerUI();
    showToast('↩ 已还原为原始提示词');
  }

  $('btn-optimize').addEventListener('click', handleOptimize);
  $('btn-restore').addEventListener('click', handleRestore);

  $('btn-local-struct').addEventListener('click', () => {
    const inputEl = $('prompt-input');
    const raw = inputEl.value.trim();
    if (!raw) {
      showToast('请先输入提示词草稿');
      return;
    }
    const clean = raw.replace(/^✨(?::\w+)?\s+/, '');
    state.originalDraft = clean;
    const style = $('style-select').value || 'enhanced';
    const next = buildLocalStructuredPrompt(clean, style);
    inputEl.value = next;
    state.optimizedDraft = next;
    state.isOptimized = true;
    updateComposerUI();
    showToast('⚡ 已应用免Key结构化强化');
  });

  $('btn-pull-last').addEventListener('click', async () => {
    try {
      const fresh = await callApi(`/api/state?conversationId=${encodeURIComponent(state.conversationId)}`);
      if (fresh.lastUserPrompt) {
        $('prompt-input').value = fresh.lastUserPrompt;
        state.originalDraft = fresh.lastUserPrompt;
        state.isOptimized = false;
        updateComposerUI();
        showToast('📥 已提取当前对话上一条输入');
      } else {
        showToast('当前对话暂无可提取的历史输入');
      }
    } catch (e) {
      showToast('提取失败: ' + e.message);
    }
  });

  $('btn-copy').addEventListener('click', async () => {
    const val = $('prompt-input').value.trim();
    if (!val) {
      showToast('内容为空');
      return;
    }
    try {
      await navigator.clipboard.writeText(val);
      showToast('📋 已复制到剪贴板，可直接粘贴至对话框');
    } catch {
      $('prompt-input').select();
      document.execCommand('copy');
      showToast('📋 已复制到剪贴板');
    }
  });

  $('btn-copy-orig').addEventListener('click', async () => {
    if (!state.originalDraft) return;
    await navigator.clipboard.writeText(state.originalDraft).catch(() => {});
    showToast('已复制原稿');
  });

  $('btn-send-chat').addEventListener('click', async () => {
    const val = $('prompt-input').value.trim();
    if (!val) {
      showToast('请先输入或优化提示词');
      return;
    }
    try {
      if (window.sidecar?.agent?.sendMessage && state.conversationId) {
        $('btn-send-chat').disabled = true;
        await window.sidecar.agent.sendMessage(val, state.conversationId);
        showToast('🚀 已直接发送至当前反重力对话！');
      } else if (window.sidecar?.agent?.startConversation) {
        await window.sidecar.agent.startConversation(val, 'Prompt Optimize');
        showToast('🚀 已发起新对话！');
      } else {
        await navigator.clipboard.writeText(val);
        showToast('已复制到剪贴板，请在左侧对话框粘贴发送');
      }
    } catch (err) {
      await navigator.clipboard.writeText(val).catch(() => {});
      showToast('当前对话正在运行中，已为您复制到剪贴板，可直接 Ctrl+V 粘贴');
    } finally {
      $('btn-send-chat').disabled = false;
    }
  });

  $('prompt-input').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleOptimize();
    }
  });

  // Settings handlers
  $('cfg-protocol').addEventListener('change', () => {
    const p = $('cfg-protocol').value;
    if (!state.defaults) return;
    const baseUrls = Object.values(state.defaults.baseUrls || {});
    const models = Object.values(state.defaults.models || {});
    if (!$('cfg-baseurl').value.trim() || baseUrls.includes($('cfg-baseurl').value.trim())) {
      $('cfg-baseurl').value = state.defaults.baseUrls[p] || '';
    }
    if (!$('cfg-model').value.trim() || models.includes($('cfg-model').value.trim())) {
      $('cfg-model').value = state.defaults.models[p] || '';
    }
  });

  $('btn-toggle-key').addEventListener('click', () => {
    const el = $('cfg-apikey');
    const isPwd = el.type === 'password';
    el.type = isPwd ? 'text' : 'password';
    $('btn-toggle-key').textContent = isPwd ? '隐藏' : '显示';
  });

  document.querySelectorAll('[data-reset-prompt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-reset-prompt');
      if (state.defaults?.systemPrompts?.[key]) {
        $(`sp-${key}`).value = state.defaults.systemPrompts[key];
        showToast(`已恢复 ${key} 默认 System Prompt`);
      }
    });
  });

  function collectSettingsFromForm() {
    const prefixes = $('cfg-prefixes')
      .value.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      autoEnhanceAll: $('cfg-auto-enhance').checked,
      triggerPrefixes: prefixes.length ? prefixes : ['✨', '++', '/opt '],
      protocol: $('cfg-protocol').value,
      baseUrl: $('cfg-baseurl').value.trim(),
      apiKey: $('cfg-apikey').value.trim(),
      model: $('cfg-model').value.trim(),
      style: $('cfg-default-style').value,
      systemPrompts: {
        enhanced: $('sp-enhanced').value.trim(),
        coding: $('sp-coding').value.trim(),
        structured: $('sp-structured').value.trim(),
        concise: $('sp-concise').value.trim()
      }
    };
  }

  $('btn-save-settings').addEventListener('click', async () => {
    try {
      const next = collectSettingsFromForm();
      const res = await callApi('/api/settings', 'POST', { settings: next });
      state.settings = res.settings;
      $('style-select').value = state.settings.style;
      renderBadge();
      $('settings-status').textContent = '✅ 设置已保存（对话框钩子与当前面板已同步生效）';
      showToast('💾 设置已保存');
    } catch (err) {
      $('settings-status').textContent = '❌ 保存失败: ' + err.message;
    }
  });

  $('btn-test-conn').addEventListener('click', async () => {
    const statusEl = $('settings-status');
    statusEl.textContent = '⏳ 正在测试 API 连通性...';
    $('btn-test-conn').disabled = true;
    try {
      const candidate = collectSettingsFromForm();
      const res = await callApi('/api/test-connection', 'POST', { settings: candidate });
      statusEl.textContent = `✅ 连接成功！模型响应: ${res.output}`;
      showToast('⚡ API 连接测试成功');
    } catch (err) {
      statusEl.textContent = `❌ 连接失败: ${err.message}`;
    } finally {
      $('btn-test-conn').disabled = false;
    }
  });

  $('btn-clear-history').addEventListener('click', async () => {
    await callApi('/api/clear-history', 'POST');
    state.history = [];
    renderHistory();
    showToast('已清空历史记录');
  });

  async function init() {
    try {
      const data = await callApi(`/api/state?conversationId=${encodeURIComponent(state.conversationId)}`);
      state.conversationId = data.conversationId || state.conversationId;
      state.settings = data.settings;
      state.defaults = data.defaults;
      state.history = data.history || [];
      state.lastUserPrompt = data.lastUserPrompt || '';
      populateSettingsForm();
      renderBadge();
      renderHistory();
    } catch (err) {
      showToast('初始化失败: ' + err.message);
    }
  }

  init();
})();
