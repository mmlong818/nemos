/* Local suggestions and a one-use, tab-scoped handoff. Never enqueue or extract files. */
(() => {
  const prefix='clownfish-skill-transfer-v1:';
  const patterns=[
    ['presentation',/(?:制作|生成|做|输出).{0,20}(?:ppt|演示文稿|幻灯片|演示稿)/i],
    ['document',/(?:写|起草|生成|制作).{0,20}(?:正式文档|word|文档|方案书)/i],
    ['research',/深度研究|专题调研|联网研究|搜索来源|查找最新资料/],
    ['marketBrief',/港股|港交所公告/],['thinking',/梳理复杂问题|拆解问题/],
    ['product',/设计.{0,10}(?:产品界面|页面|交互)|界面改版/],
    ['meeting',/整理.{0,12}(?:会议|纪要)|生成.{0,12}会议纪要/],
    ['web',/(?:做|生成|制作).{0,15}(?:网页报告|html|独立网页)/i],
    ['decision',/比较方案|方案比较|对比方案/],
    ['business',/推进商务|商务合作|谈判方案/],['market',/市场机会|机会评估/],
    ['topic',/选题|题材判断|内容排期/],['videoScript',/(?:短视频|视频|口播|分镜).{0,6}脚本|口播稿/]
  ];
  function suggest(objective,catalog){
    // Match requested work, not instructions in attachments; negative clauses are excluded.
    const goal=String(objective||'').replace(/(?:不要|不用|无需|不需要|不必)[^，。；,;\n]*/g,'');
    return patterns.filter(([,pattern])=>pattern.test(goal)).map(([id])=>catalog.resolve(id)).filter(Boolean).slice(0,3);
  }
  function prepare(id,values,catalog,now=Date.now(),fileCount=0){
    if(!catalog.resolve(id))throw Error('未找到这项执行技能');
    const objective=String(values.objective||'').trim();
    if(!objective)throw Error('请先填写任务目标');
    const instruction=[objective,values.materials?'补充说明与文字材料：\n'+values.materials:'',values.requiredFields?'交付要求：\n'+values.requiredFields:''].filter(Boolean).join('\n\n');
    if(instruction.length>16000)throw Error('文字超过执行技能的 16000 字上限，请精简后再转交；当前内容未改动');
    if(!Number.isInteger(fileCount)||fileCount<0||fileCount>8)throw Error('附件数量无效');
    return {version:2,id,instruction,createdAt:now,fileCount};
  }
  function take(storage,token,id,catalog,now=Date.now()){
    if(!/^[\da-f-]{36}$/i.test(token||'')||!catalog.resolve(id))throw Error('技能转交地址无效');
    const key=prefix+token,raw=storage.getItem(key);storage.removeItem(key);
    let value;try{value=JSON.parse(raw||'null');}catch{throw Error('转交资料无效，请回到原任务重试');}
    if(!value||![1,2].includes(value.version)||value.id!==id||!Number.isFinite(value.createdAt)||now-value.createdAt>600000||value.createdAt>now||typeof value.instruction!=='string'||!value.instruction.trim()||value.instruction.length>16000||(value.version===2&&(!Number.isInteger(value.fileCount)||value.fileCount<0||value.fileCount>8)))throw Error('转交资料已过期或无效，请回到原任务重试');
    return value;
  }
  window.ClownfishSkillHandoff=Object.freeze({prefix,suggest,prepare,take});
})();
