/* Route metadata is rendered by the server from app-navigation.ts, not copied per page. */
(() => {
  const routes=JSON.parse(document.getElementById('app-route-manifest').textContent);
  const canonical=(path)=>{let p=path.split(/[?#]/)[0].replace(/\/$/,'').replace(/\.html$/,'')||'/';return p==='/index'?'/':p==='/work'?'/tasks':p;};
  const route=()=>routes.find((r)=>r.path===canonical(location.pathname));
  function sync(){
    const current=route();
    for(const a of document.querySelectorAll('.app-nav [data-wb-path]')){
      const selected=a.dataset.wbPath===current?.path;
      a.classList.toggle('is-current',selected);
      if(selected)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
    }
    window.dispatchEvent?.(new Event('clownfish:navigation'));
  }
  window.ClownfishNavigation=Object.freeze({sync,workView:()=>route()?.workView || 'tasks'});
  window.addEventListener('popstate',sync);document.addEventListener('DOMContentLoaded',sync);sync();
})();
