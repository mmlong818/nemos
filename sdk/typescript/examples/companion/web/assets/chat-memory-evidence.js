/* Evidence references only: never persist a second copy of forgotten memory text. */
(() => {
  const layerName = { personal_semantic: '个人事实', semantic: '知识', episodic: '经历', procedural: '习惯与偏好' };

  function memoryItem(item, index, box) {
    const row = document.createElement('details');
    row.className = 'chat-memory-item';
    const summary = document.createElement('summary');
    const label = layerName[item.layer] || '个人记忆';
    summary.textContent = `第 ${index + 1} 条 · ${label}`;
    summary.setAttribute('aria-label', `查看第 ${index + 1} 条来源 · ${label}`);
    const body = document.createElement('div');
    body.className = 'chat-memory-item-body';
    row.append(summary, body);
    let request;

    function status(state, message) {
      body.dataset.memoryDetailState = state;
      const note = document.createElement('p');
      note.setAttribute('role', 'status');
      note.textContent = message;
      body.replaceChildren(note);
    }

    function close() {
      request?.abort();
      request = undefined;
      delete body.dataset.memoryDetailState;
      body.replaceChildren();
    }

    async function load() {
      if (!box.open || !row.open || request) return;
      const pending = new AbortController();
      request = pending;
      const current = () => request === pending && row.isConnected && row.open && box.open;
      status('loading', '正在读取这条记忆…');
      try {
        const response = await fetch('/api/memory/item?id=' + encodeURIComponent(item.id), {
          cache: 'no-store', signal: pending.signal,
        });
        if (!response.ok) throw new Error('Memory details unavailable');
        const data = await response.json();
        if (!current()) return;
        if (data?.status === 'inactive') {
          status('inactive', '这条记忆已失效。');
          return;
        }
        if (data?.status === 'unavailable') {
          status('unavailable', '这条记忆当前不可查看。');
          return;
        }
        if (data?.status !== 'active' || data.fact?.id !== item.id || typeof data.fact.content !== 'string') {
          throw new Error('Unexpected memory details');
        }
        const fact = data.fact;
        const record = document.createElement('p');
        record.textContent = '当前记忆：' + fact.content;
        const excerpt = document.createElement('blockquote');
        excerpt.textContent = typeof fact.source?.excerpt === 'string' && fact.source.excerpt
          ? (fact.source.kind === 'confirmed-learning' ? '确认时的摘录：' : '来源摘录：') + fact.source.excerpt
          : '没有可展示的来源摘录。';
        const link = document.createElement('a');
        link.href = '/memory?memoryId=' + encodeURIComponent(item.id);
        link.textContent = '在记忆页查看与管理';
        body.dataset.memoryDetailState = 'active';
        body.replaceChildren(record, excerpt);
        if (item.contentTruncated || item.contentIsExcerpt) {
          const note = document.createElement('p');
          note.textContent = '当时载入的是节选。';
          body.append(note);
        }
        body.append(link);
      } catch {
        if (!current()) return;
        status('error', '暂时无法读取这条记忆。');
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.setAttribute('data-memory-detail-retry', '');
        retry.textContent = '重试';
        retry.onclick = () => { summary.focus({ preventScroll: true }); void load(); };
        body.append(retry);
      } finally {
        if (request === pending) request = undefined;
      }
    }

    row.addEventListener('toggle', () => {
      if (!row.open) close();
      else if (!body.dataset.memoryDetailState) void load();
    });
    box.addEventListener('toggle', () => {
      if (box.open || !row.open) return;
      row.open = false;
      close();
    });
    return row;
  }

  function append(root, receipt) {
    if (!root || receipt === null) return; // Earlier bubbles in the same turn.
    const box = document.createElement('details');
    box.className = 'chat-memory-evidence';
    const title = document.createElement('summary');
    const records = receipt?.version === 1 && Array.isArray(receipt.records)
      && receipt.records.every(item => item && typeof item.id === 'string') ? receipt.records : null;
    title.textContent = '回复开始前载入的个人记忆' + (records ? ` · ${records.length} 条` : ' · 未记录');
    box.appendChild(title);
    const note = document.createElement('p');
    note.textContent = !records ? '此消息没有保留记忆输入记录，不能从当前记忆反推当时的输入。'
      : receipt.processing === 'local' ? '这条回复在本地生成，初始记忆没有发送给模型。'
      : receipt.mode === 'off' ? '本轮已关闭个人记忆输入。'
      : !records.length ? '本轮没有提供可用的个人记忆。'
      : `${receipt.mode === 'preferences' ? '本轮仅载入交付偏好。' : ''}以下是初始回复上下文中的记忆，范围不含后续工具查询或对话历史。`;
    box.appendChild(note);
    (records || []).forEach((item, index) => box.appendChild(memoryItem(item, index, box)));
    root.appendChild(box);
  }
  window.ClownfishChatMemoryEvidence = Object.freeze({ append });
})();
