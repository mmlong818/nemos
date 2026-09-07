/* Binary transfer stays in same-origin browser memory; no file read, base64 or server write. */
(() => {
  const name=token=>{
    if(!/^[\da-f-]{36}$/i.test(token||''))throw Error('附件转交标识无效');
    return 'clownfish-skill-files-v1:'+token;
  };
  function validate(files,count){
    if(!Array.isArray(files)||files.length!==count||count<1||count>8)throw Error('附件数量不一致，请回到原任务重新转交');
    for(const file of files){
      if(!(file instanceof Blob)||typeof file.name!=='string')throw Error('附件数据无效');
      window.ClownfishTeamMaterials.validate(file);
    }
    return files.slice();
  }
  function offer(token,files,timeout=30000){
    validate(files,files.length);
    const channel=new BroadcastChannel(name(token));let settled=false,timer,resolveDone;
    const done=new Promise(resolve=>{resolveDone=resolve;});
    const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);channel.close();resolveDone({ok:!error,error});};
    channel.onmessage=({data})=>{
      if(data?.type==='ready')try{channel.postMessage({type:'files',files});}catch{finish('附件无法转交，请回到原任务重新选择');}
      if(data?.type==='received')finish();
      if(data?.type==='rejected')finish('准备页未能接收附件；原文件仍在当前任务中');
    };
    timer=setTimeout(()=>finish('附件转交超时，请保留原任务并重新转交'),timeout);
    return {done,cancel(){finish('附件转交已取消');}};
  }
  function receive(token,count,timeout=30000){
    if(!Number.isInteger(count)||count<1||count>8)return Promise.reject(Error('附件数量无效'));
    return new Promise((resolve,reject)=>{
      const channel=new BroadcastChannel(name(token));let interval,timer,settled=false;
      const finish=(error,files)=>{if(settled)return;settled=true;clearInterval(interval);clearTimeout(timer);channel.close();error?reject(error):resolve(files);};
      channel.onmessage=({data})=>{
        if(data?.type!=='files')return;
        try{const files=validate(data.files,count);channel.postMessage({type:'received'});finish(null,files);}
        catch(error){channel.postMessage({type:'rejected'});finish(error);}
      };
      const ready=()=>channel.postMessage({type:'ready'});
      interval=setInterval(ready,250);timer=setTimeout(()=>finish(Error('附件未能到达；请保持原任务窗口打开并重新转交')),timeout);ready();
    });
  }
  window.ClownfishSkillFiles=Object.freeze({offer,receive,validate});
})();
