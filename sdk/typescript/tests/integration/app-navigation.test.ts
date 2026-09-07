import assert from "node:assert/strict";
import test from "node:test";
import { APP_ROUTES } from "../../examples/companion/app-navigation.js";
import { WORKBENCH_LINKS } from "../../examples/companion/workbench-shell.js";
import { startModelHarness } from "../fixtures/companion-model-harness.js";

test("所有主页面与旧书签都服务同一套导航，浏览不新增任务或调用模型",{timeout:60000},async()=>{
  const h=await startModelHarness();
  try{
    const before=h.requests.length;
    for(const path of [...APP_ROUTES.map((r)=>r.path),"/index.html","/work.html","/office.html?artifact=test","/bots/","/resources/"]){
      const res=await fetch(h.base+path);assert.equal(res.status,200,path);
      const html=await res.text(),rail=html.match(/<aside class="rail app-nav"[\s\S]*?<\/aside>/)?.[0];
      assert.ok(rail,path);assert.equal((rail.match(/aria-current="page"/g)||[]).length,1,path);
      for(const item of WORKBENCH_LINKS)assert.ok(rail.includes('href="'+item.href+'"'),path+item.label);
      assert.ok(html.includes('data-ui="workbench"'));
      const legacy=await (await fetch(h.base+path+(path.includes('?')?'&':'?')+'ui=legacy')).text();
      assert.ok(legacy.includes('data-ui="workbench"'));
      assert.ok(!legacy.includes('id="wbLegacy"'));
      assert.ok(!legacy.includes('legacy-navigation.js'));
      const oldRail=legacy.match(/<aside class="rail app-nav"[\s\S]*?<\/aside>/)![0];
      for(const item of WORKBENCH_LINKS)assert.ok(oldRail.includes('href="'+item.href+'"'));
    }
    for(const path of ["/assets/app-shell.css","/assets/app-navigation.js","/assets/workbench-ui.css","/assets/workbench-ui.js","/assets/workbench-memory.js","/assets/overview.js"]){assert.equal((await fetch(h.base+path)).status,200);}
    assert.equal((await fetch(h.base+"/assets/legacy-navigation.js")).status,404);
    assert.equal(h.requests.length,before);
    const team=await (await fetch(h.base+"/api/assistant-team")).json() as any;assert.equal(team.jobs.length,0);
  }finally{await h.stop();}
});
