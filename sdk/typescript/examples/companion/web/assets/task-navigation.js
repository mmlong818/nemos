(() => {
  function target(path,search=''){
    const params=new URLSearchParams(search);
    if(!['/tasks','/collaboration','/work'].includes(path)||params.get('legacy')==='1')return '';
    const next=new URLSearchParams({view:'tasks'});
    if(params.get('task'))next.set('task',params.get('task'));
    if(params.get('space'))next.set('space',params.get('space'));
    return '/bots?'+next.toString();
  }
  window.ClownfishTaskNavigation=Object.freeze({target});
  const path=location.pathname.replace(/\.html$/,'').replace(/\/$/,'')||'/';
  const destination=target(path,location.search);
  if(destination)location.replace(destination);
})();
