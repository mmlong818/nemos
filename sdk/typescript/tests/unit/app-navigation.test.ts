import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { APP_ROUTES, appRoute, canonicalAppPath, renderAppPage } from "../../examples/companion/app-navigation.js";
import { WORKBENCH_LINKS } from "../../examples/companion/workbench-shell.js";
import { readAppHtml } from "../fixtures/render-app-page.js";

test("工作台全局入口唯一，旧地址与查询参数不会误落到自动化", () => {
  assert.equal(WORKBENCH_LINKS.length, APP_ROUTES.length);
  assert.equal(new Set(WORKBENCH_LINKS.map((item)=>item.href)).size, APP_ROUTES.length);
  assert.equal(canonicalAppPath("/index.html?x=1"),"/");
  assert.equal(canonicalAppPath("/work.html"),"/tasks");
  for(const name of ["tasks","spaces","automations","collaboration","resources","artifacts","runs","memory"]){
    const route=appRoute("/"+name); assert.ok(route && "workView" in route);assert.equal(route.workView,name);
  }
  assert.equal(appRoute("/capabilities/unknown"),undefined);
  assert.equal(appRoute("/assets/index.html"),undefined);
});
for(const route of APP_ROUTES)test("共用导航与正确归属："+route.path,()=>{
  const html=readAppHtml(route.file,route.path);
  assert.equal((html.match(/aria-label="主导航"/g)||[]).length,1);
  const rail=html.match(/<aside class="rail app-nav"[\s\S]*?<\/aside>/)![0];
  for(const item of WORKBENCH_LINKS)assert.ok(rail.includes('href="'+item.href+'"'),item.label);
  assert.equal((rail.match(/aria-current="page"/g)||[]).length,1);
  const active=rail.match(/<a [^>]*aria-current="page"[^>]*>/)![0];
  assert.ok(active.includes('data-wb-path="'+route.path+'"'));
  assert.ok(html.includes("<title>"+route.title+" · 小丑鱼</title>"));
  assert.equal((html.match(/id="settingsbtn"/g)||[]).length,1);
  assert.ok(!html.includes("<!-- APP_NAVIGATION -->"));
  const manifest=JSON.parse(html.match(/id="app-route-manifest"[^>]*>(.*?)<\/script>/)![1]);
  assert.deepEqual(manifest,APP_ROUTES);
});
test("客户端导航按同一份路由清单同步高亮，未知路径不冒充其他分区",()=>{
  let current="/resources"; const nodes=WORKBENCH_LINKS.map((item)=>({dataset:{wbPath:item.href.split('?')[0]},active:false,attrs:{} as Record<string,string>,
    classList:{toggle(_name:string,_selected:boolean){}},setAttribute(name:string,value:string){this.attrs[name]=value;},removeAttribute(name:string){delete this.attrs[name];}}));
  const ctx:any={location:{get pathname(){return current;}},window:{addEventListener(){}},document:{getElementById(){return {textContent:JSON.stringify(APP_ROUTES)};},querySelectorAll(){return nodes;},addEventListener(){}}};
  runInNewContext(readFileSync("examples/companion/web/assets/app-navigation.js","utf8"),ctx);
  const node=(path:string)=>nodes[WORKBENCH_LINKS.findIndex((item)=>item.href.split('?')[0]===path)];
  assert.equal(ctx.window.ClownfishNavigation.workView(),"resources");assert.equal(node("/resources").attrs["aria-current"],"page");
  current="/memory.html";ctx.window.ClownfishNavigation.sync();assert.equal(node("/memory").attrs["aria-current"],"page");assert.equal(node("/matters").attrs["aria-current"],undefined);
  current="/not-a-page";ctx.window.ClownfishNavigation.sync();assert.ok(nodes.every((node)=>!node.attrs["aria-current"]));
});
test("缺少共用导航占位符拒绝静默交付不完整页面",()=>{assert.throws(()=>renderAppPage("<html></html>","/"),/missing/);});
test("侧栏新建按钮只有一处绑定，并按当前分区打开正确表单",()=>{
  assert.ok(!readAppHtml("work.html").includes("newTaskSideBinder"));
  const script=readFileSync("examples/companion/web/assets/work-center.js","utf8");
  const handler=script.slice(script.indexOf('$("#newTaskSide").onclick ='),script.indexOf('\nhydrateIcons();',script.indexOf('$("#newTaskSide").onclick =')));
  for(const view of ["tasks","automations","spaces","resources"]){
    const button:any={},schedule={value:"manual"};const calls:string[]=[];
    runInNewContext(handler,{view,state:{snapshot:{}},$:(selector:string)=>selector==="#newTaskSide"?button:schedule,
      openTaskDialog:()=>calls.push("task"),openSpaceDialog:()=>calls.push("space"),openKnowledgeDialog:()=>calls.push("resource"),updateScheduleField:()=>calls.push("schedule"),toast:()=>{throw new Error("Unexpected loading state");}});
    button.onclick();
    assert.deepEqual(calls,view==="spaces"?["space"]:view==="resources"?["resource"]:["task"]);
    assert.equal(schedule.value,"manual", "按钮不应在打开表单后重置用户正在编辑的时间");
  }
});
