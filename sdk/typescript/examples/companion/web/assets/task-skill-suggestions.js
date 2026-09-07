(() => {
  const form=document.querySelector('#taskForm');if(!form)return;
  const helper=window.ClownfishSkillHandoff,catalog=window.ClownfishWorkflowCatalog;
  const panel=document.createElement('section');panel.className='task-skill-suggestions';panel.hidden=true;panel.setAttribute('aria-label','可选执行技能');
  const title=document.createElement('strong');title.textContent='需要专业成果？可选执行技能';
  const choices=document.createElement('div');choices.className='team-detail-actions';
  const note=document.createElement('details');note.className='hint';
  const summary=document.createElement('summary');summary.textContent='文字与附件一起带入，开始前不读取正文';
  const explanation=document.createElement('p');explanation.textContent='按目标关键词建议，不代表已验证可用。新窗口带入目标、文字说明、交付要求和附件；原任务保留。转交时请保持当前窗口打开，附件仅在窗口内暂存。模型与工具请在准备页确认，偏好记忆默认关闭。下方“开始处理”仍按文字任务执行。';note.append(summary,explanation);
  const status=document.createElement('p');status.className='hint';status.setAttribute('role','status');
  panel.append(title,choices,note,status);document.querySelector('#teamRoutingPreview').after(panel);
  function render(){
    const suggestions=helper.suggest(form.elements.objective.value,catalog);
    panel.hidden=!suggestions.length;choices.replaceChildren();status.textContent='';
    for(const item of suggestions){
      const button=document.createElement('button');button.type='button';button.textContent='准备'+item.name+' ↗';
      button.addEventListener('click',async()=>{
        let key,offer;
        try{
          if(form.querySelector('[type=submit]').disabled&&form.elements.objective.disabled)throw Error('当前任务正在提交，请稍候');
          const values=Object.fromEntries(['objective','materials','requiredFields'].map(name=>[name,form.elements[name].value]));
          const files=window.ClownfishTeamMaterials.snapshotFiles(form);
          const payload=helper.prepare(item.id,values,catalog,Date.now(),files.length),token=crypto.randomUUID();key=helper.prefix+token;
          if(files.length)offer=window.ClownfishSkillFiles.offer(token,files);
          sessionStorage.setItem(key,JSON.stringify(payload));
          // A same-origin new tab copies sessionStorage at creation. Sever opener immediately;
          // the original form and its unextracted File objects stay in this tab.
          const child=window.open(item.href+'&transfer='+encodeURIComponent(token),'_blank');
          if(!child)throw Error('浏览器阻止了新窗口，请允许后重试；当前任务和附件仍保留');
          child.opener=null;button.disabled=true;status.textContent=files.length?'正在转交附件，请保持当前窗口打开…':'已打开技能准备页；请检查设置后再开始。当前任务未提交。';
          sessionStorage.removeItem(key);
          if(offer){const result=await offer.done;if(!result.ok)throw Error(result.error);status.textContent='已转交 '+files.length+' 个附件，尚未读取正文；原任务与附件保留。';}
        }catch(error){offer?.cancel();status.textContent=error.message;}
        finally{button.disabled=false;if(key)try{sessionStorage.removeItem(key);}catch{}}
      });choices.append(button);
    }
  }
  form.elements.objective.addEventListener('input',render);form.addEventListener('reset',()=>setTimeout(render,0));render();
})();
