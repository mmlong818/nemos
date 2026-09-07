"use strict";
(() => {
  const MAX_CHARS = 24000;
  const textFile = /\.(txt|md|markdown|json|html?|htm)$/i;
  const snapshots = new WeakMap();
  const officeFile = /\.(doc|docx|docm|odt|rtf|epub|ppt|pps|pot|pptx|pptm|ppsx|ppsm|odp|xls|xlsx|xlsm|xlsb|ods|csv|pdf)$/i;
  function validate(file) {
    if (!textFile.test(file.name) && !officeFile.test(file.name)) throw new Error('不支持此文件类型，请选择文字、文档、表格、演示或 PDF 文件');
    const limit = textFile.test(file.name) ? 1024 * 1024 : 8 * 1024 * 1024;
    if (!file.size) throw new Error('文件为空，请重新选择');
    if (file.size > limit) throw new Error(textFile.test(file.name) ? '文字文件不能超过 1 MB' : '办公文件不能超过 8 MB');
  }
  async function readFile(file, signal, request = fetch) {
    validate(file);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    let text, notes = [];
    if (textFile.test(file.name)) {
      try { text = new TextDecoder('utf-8', { fatal:true }).decode(bytes); }
      catch { throw new Error('文字编码无法读取，请另存为 UTF-8 后重试'); }
    } else {
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      const response = await request('/api/files/extract', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:file.name,dataBase64:btoa(binary)}), signal });
      let data;
      try { data = await response.json(); } catch { throw new Error('文件解析服务未返回有效结果，请稍后重试'); }
      if (!response.ok) throw new Error(data.userMessage || '文件解析失败，请检查格式或是否加密');
      if (data.extraction?.truncated || data.conversion?.truncated) throw new Error('文件内容过长，读取结果不完整，请拆分文件后重试');
      text = data.extraction?.text;
      notes = Array.isArray(data.conversion?.notes) ? data.conversion.notes.filter(note=>typeof note==='string') : [];
    }
    if (typeof text !== 'string' || !text.trim()) throw new Error('未提取到可读文字。扫描 PDF 或图片请先转成文字再上传');
    return { name:file.name, text, notes };
  }
  function appendMaterials(current, files) {
    const blocks = files.map(file => `[文件来源：${String(file.name).replace(/[\r\n\[\]]/g,' ').slice(0,160)}]\n${file.text}${file.notes?.length?'\n[文件解析说明]\n'+file.notes.join('\n'):''}`);
    const result = current + (current && blocks.length ? '\n\n' : '') + blocks.join('\n\n');
    if (result.length > MAX_CHARS) throw new Error(`附件内容与补充说明共 ${result.length} 字符，超过单次任务 ${MAX_CHARS} 字符上限，请减少附件或拆分为多个任务`);
    return result;
  }
  function bind() {
    const input = document.querySelector('#teamMaterialFiles'), button = document.querySelector('#uploadTeamMaterials');
    const field = document.querySelector('#taskForm [name=materials]'), form = field.form;
    const status = document.querySelector('#teamMaterialStatus'), notes = document.querySelector('#teamMaterialNotes');
    const submit = form.querySelector('[type=submit]'), list = document.querySelector('#teamAttachmentList');
    let generation = 0, controller, busy = false, attachments = [], cache = new Map();
    function render() {
      list.replaceChildren(...attachments.map((file,index)=>{
        const row=document.createElement('li'), label=document.createElement('span'), remove=document.createElement('button');
        label.textContent=`${file.name} · ${Math.max(1,Math.ceil(file.size/1024))} KB`;
        remove.type='button';remove.textContent='移除';remove.disabled=busy;remove.setAttribute('aria-label',`移除附件 ${file.name}`);
        remove.onclick=()=>{if(busy)return;attachments.splice(index,1);cache.delete(file);render();status.textContent=attachments.length?`已添加 ${attachments.length} 个附件。`:'';};
        row.append(label,remove);return row;
      }));
      list.hidden=!attachments.length;
    }
    function finish() { busy=false; button.disabled=false; input.disabled=false; render(); }
    function reset() { generation++; controller?.abort(); attachments=[];cache.clear();finish();submit.disabled=false;input.value='';status.textContent='';notes.textContent='';notes.hidden=true; }
    button.onclick = () => input.click();
    input.onchange = () => {
      const files = Array.from(input.files || []); input.value='';
      if (!files.length || busy) return;
      try {
        if(attachments.length+files.length>8)throw new Error('每个任务最多选择 8 个附件');
        files.forEach(validate);
        attachments.push(...files);render();
        status.textContent=`已添加 ${attachments.length} 个附件。`;
      } catch(error) { status.textContent=error.message; }
    };
    async function prepare() {
      if(busy)throw new Error('文件正在准备，请稍候');
      const token = ++generation;
      controller = new AbortController(); busy=true;
      submit.disabled=true;button.disabled=true;input.disabled=true;render();
      try {
        const results = [];
        for (const file of attachments) {
          status.textContent=`开始处理：正在读取 ${file.name}（${results.length + 1}/${attachments.length}）…`;
          try { results.push(cache.get(file)||await readFile(file, controller.signal)); }
          catch (error) { throw new Error(`${file.name}：${error.message}`); }
          if (token !== generation) throw new DOMException('已取消','AbortError');
          cache.set(file,results.at(-1));
        }
        // Text remains separate in the form; only the submitted payload combines attachments.
        const materials=appendMaterials(field.value,results);
        const explanation=results.flatMap(file=>file.notes.map(note=>`${file.name}：${note}`)).join('\n');
        notes.textContent=explanation;
        notes.hidden=!notes.textContent;
        if(results.length)status.textContent=`${results.length} 个附件已准备好。`;
        return {materials,token};
      } catch (error) {
        if (token !== generation) throw new DOMException('已取消','AbortError');
        status.textContent=`${error.message}。本次任务未提交，附件和补充说明保留。`;
        throw error;
      } finally { if (token === generation) finish(); }
    }
    form.addEventListener('submit',event=>{if(busy){event.preventDefault();event.stopImmediatePropagation();status.textContent='文件仍在解析，请完成后再开始任务。';}},true);
    // The inline composer survives tab and task switches; reset only after submission.
    snapshots.set(form,()=>{if(busy)throw new Error('附件正在读取，请稍候再转交');return attachments.slice();});
    return { reset, prepare, version:()=>generation };
  }
  window.ClownfishTeamMaterials = Object.freeze({ readFile, appendMaterials, validate, bind, snapshotFiles(form){return snapshots.get(form)?.()||[];} });
})();
