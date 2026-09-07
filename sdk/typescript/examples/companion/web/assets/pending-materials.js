/* Metadata now; extraction only when the user starts execution. */
(() => {
  const cache=new WeakMap();
  function pending(file){window.ClownfishTeamMaterials.validate(file);return {name:file.name,size:file.size,pending:true,file};}
  function saved(items){return items.map(({file,...rest})=>({...rest,...(file?{pending:true}:{})}));}
  async function prepare(items){
    const result=[];
    for(const item of items){
      if(!item.pending){result.push(item);continue;}
      if(!item.file)throw Error(item.name+'：原文件仅保存在原窗口，请移除此条目并重新选择文件');
      let extracted=cache.get(item.file);
      if(!extracted){
        try{extracted=await window.ClownfishTeamMaterials.readFile(item.file);cache.set(item.file,extracted);}
        catch(error){throw Error(item.name+'：'+error.message);}
      }
      result.push({name:item.name,size:item.size,text:extracted.text+(extracted.notes.length?'\n[文件解析说明]\n'+extracted.notes.join('\n'):''),kind:'attachment'});
    }
    return result;
  }
  window.ClownfishPendingMaterials=Object.freeze({pending,saved,prepare});
})();
