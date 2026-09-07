/* Text-only handoff helpers. Model output is never interpreted as HTML or executed. */
(() => {
  const text = (value) => typeof value === 'string' ? value : '';
  function resultText(delivery) {
    return [text(delivery.summary), ...(delivery.fields || []).map((f) =>
      text(f.label)+'\n'+text(f.value)+'\n来源：'+(f.sources || []).map(text).join('；')),
      '内容待人工审阅；字段与来源格式通过不代表事实正确。'].join('\n\n');
  }
  function botDraft(job) {
    if(job?.status!=='succeeded' || !job.payload?.teamPlan?.workers?.some((b)=>b.template?.id==='bot-designer'))
      throw new Error('只有 Bot 设计助理成功交付后才能提取规则草稿');
    const fields=job.result?.data?.delivery?.fields || [];
    function field(label, limit) {
      const matches=fields.filter((f)=>f.label===label), value=text(matches[0]?.value).trim();
      if(matches.length!==1 || !value || value.length>limit)
        throw new Error(label+'缺失、重复或过长，请复制结果并手动编辑（最多 '+limit+' 字）');
      return value;
    }
    return {name:field('Bot 名称',60),instructions:field('工作规则',4000)};
  }
  function materialStarter(current, template, sample) {
    if(text(current).trim()) throw new Error('已保留你填写的材料；如需填入提纲或示例，请先手动清空材料');
    return sample ? '[合成示例验收，不是我的个人事实]\n'+template.example.materials : template.inputTemplate;
  }
  globalThis.ClownfishTeamResults=Object.freeze({resultText,botDraft,materialStarter});
})();
