/* A read-only preview: goal text only, no attachments, model call or enqueue. */
(() => {
  function bind(){
    const form=document.querySelector('#taskForm'),mode=form.elements.assignmentMode;
    const note=document.querySelector('#teamRoutingPreview'),manual=document.querySelector('#manualBotFields');
    let supported=false,planningSupported=false,signature='',lastGoal='',timer,sequence=0,legacyFallback=false;
    function render(){
      manual.hidden=mode.value!=='manual';
      const planningPanel=document.querySelector('#planningOptions');
      if(planningPanel){
        const chosen=mode.value==='planned';planningPanel.hidden=!chosen;
        for(const control of planningPanel.querySelectorAll('input,select'))control.disabled=!chosen||!planningSupported;
        form.elements.planningConsent.required=chosen&&planningSupported;
      }
      clearTimeout(timer);const ticket=++sequence;
      if(mode.value==='planned'){note.textContent=planningSupported?'确认调用预算后，小丑鱼会在任务内生成执行安排。仅处理文字，不自动启用工具。':'当前服务尚未启用自主协作，请更新服务或改用其他方式。';return;}
      if(mode.value==='solo'){note.textContent=legacyFallback?'当前服务尚未启用自动分派，暂由小丑鱼独立完成；服务更新后恢复自动分派。':'由小丑鱼独立完成，不额外使用文字规则。';return;}
      if(mode.value==='manual'){note.textContent='按你指定的分工执行；不指定规则时由小丑鱼独立完成。';return;}
      if(!supported){note.textContent='当前服务尚未启用自动分派；可先选择手动指定或独立完成。';return;}
      const objective=form.elements.objective.value.trim();lastGoal=objective;
      if(!objective){note.textContent='填写目标后预览分工。自动选择已启用的文字规则；文档、研究等执行技能请从技能库准备。';return;}
      note.textContent='正在匹配文字规则…';
      timer=setTimeout(async()=>{
        try{
          const response=await fetch('/api/assistant-team/plan-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({objective})});
          const result=await response.json();if(!response.ok)throw Error(result.userMessage||'预览暂不可用');
          if(ticket!==sequence)return;
          const names=result.routing.matches.map(item=>item.name+(item.role==='reviewer'?'（核验）':''));
          const reason=String(result.routing.reason||'').replace('已启用 Bot 的名称','已启用规则的名称').replace('已启用文字 Bot','已启用文字规则');
          note.textContent=(names.length?'预计使用：'+names.join(' → ')+' → 小丑鱼汇总。':'由小丑鱼独立完成。')+' '+reason+' 预计 '+result.maxModelCalls+' 次模型调用；开始时按最新规则确认。';
        }catch{if(ticket===sequence)note.textContent='技能预览暂不可用。开始时会重新匹配；也可改为手动指定或独立完成。';}
      },450);
    }
    mode.addEventListener('change',()=>{legacyFallback=false;render();});form.elements.objective.addEventListener('input',render);
    return {update(data){planningSupported=data.planningVersion===1;const plannedOption=mode.querySelector('[value="planned"]');if(plannedOption)plannedOption.disabled=!planningSupported;const next=JSON.stringify([data.planningVersion,data.routingVersion,(data.bots||[]).map(bot=>[bot.id,bot.revision,bot.enabled,bot.placement])]);if(next!==signature||lastGoal!==form.elements.objective.value.trim()){supported=data.routingVersion===1;signature=next;mode.querySelector('[value="auto"]').disabled=!supported;if(!supported&&mode.value==='auto'){mode.value='solo';legacyFallback=true;}else if(supported&&legacyFallback){mode.value='auto';legacyFallback=false;}render();}},canSubmit(){return mode.value==='planned'?planningSupported:mode.value!=='auto'||supported;},manual(){legacyFallback=false;mode.value='manual';render();}};
  }
  window.ClownfishTeamRouting=Object.freeze({bind});
})();
