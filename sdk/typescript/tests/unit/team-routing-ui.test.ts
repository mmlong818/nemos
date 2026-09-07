import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
function fixture(){
  const events:Record<string,()=>void>={},timers=new Map<number,()=>Promise<void>>();let serial=0;
  const option={disabled:false},plannedOption={disabled:true},mode={value:'auto',querySelector:(selector:string)=>selector.includes('planned')?plannedOption:option,addEventListener:(name:string,fn:()=>void)=>events['mode:'+name]=fn};
  const objective={value:'整理资料',addEventListener:(name:string,fn:()=>void)=>events['goal:'+name]=fn};
  const consent={disabled:true,required:false},budget={disabled:true},panel={hidden:true,querySelectorAll:()=>[consent,budget]};
  const form={elements:{assignmentMode:mode,objective,planningConsent:consent}},note={textContent:''},manual={hidden:true};
  const requests:any[]=[];let resolve:(value:any)=>void=()=>{};
  const window:any={};
  runInNewContext(readFileSync('examples/companion/web/assets/team-routing.js','utf8'),{window,document:{querySelector:(selector:string)=>selector==='#taskForm'?form:selector==='#teamRoutingPreview'?note:selector==='#planningOptions'?panel:manual},
    setTimeout:(fn:()=>Promise<void>)=>{timers.set(++serial,fn);return serial;},clearTimeout:(id:number)=>timers.delete(id),
    fetch:async(path:string,options:any)=>{requests.push({path,body:JSON.parse(options.body)});return new Promise(done=>{resolve=done;});}});
  return {ui:window.ClownfishTeamRouting.bind(),mode,objective,option,plannedOption,panel,consent,budget,note,manual,events,requests,
    tick:()=>{const fn=[...timers.values()].at(-1)!;timers.clear();return fn();},
    reply:()=>resolve({ok:true,json:async()=>({routing:{matches:[{name:'资料整理',role:'worker'}],reason:'本地匹配'},maxModelCalls:2})})};
}
test('预览只发送目标，重复轮询不重复请求，模式切换丢弃旧响应',async()=>{
  const f=fixture();f.ui.update({routingVersion:1,bots:[]});const pending=f.tick();
  assert.deepEqual(f.requests,[{path:'/api/assistant-team/plan-preview',body:{objective:'整理资料'}}]);
  f.ui.update({routingVersion:1,bots:[]});assert.equal(f.requests.length,1);
  f.mode.value='solo';f.events['mode:change']();f.reply();await pending;
  assert.match(f.note.textContent,/独立完成/);assert.doesNotMatch(f.note.textContent,/预计分工/);
});

test('自主协作需服务支持和显式确认，切换时不触发预览调用',()=>{
  const f=fixture();f.ui.update({routingVersion:1,bots:[]});
  assert.equal(f.plannedOption.disabled,true);
  f.mode.value='planned';f.events['mode:change']();assert.equal(f.ui.canSubmit(),false);
  f.ui.update({routingVersion:1,planningVersion:1,bots:[]});
  assert.equal(f.plannedOption.disabled,false);assert.equal(f.panel.hidden,false);
  assert.equal(f.consent.required,true);assert.equal(f.budget.disabled,false);
  assert.equal(f.ui.canSubmit(),true);assert.equal(f.requests.length,0);
  f.mode.value='solo';f.events['mode:change']();
  assert.equal(f.panel.hidden,true);assert.equal(f.consent.required,false);assert.equal(f.budget.disabled,true);
});
test('旧服务显式退回独立模式，不阻断原有提交，升级后恢复自动',()=>{
  const f=fixture();f.ui.update({bots:[]});
  assert.equal(f.mode.value,'solo');assert.equal(f.option.disabled,true);assert.equal(f.ui.canSubmit(),true);
  assert.match(f.note.textContent,/尚未启用/);
  f.ui.update({routingVersion:1,bots:[]});assert.equal(f.mode.value,'auto');assert.equal(f.option.disabled,false);
});
test('手动模式不会被后台更新覆盖，选定的规则区始终可见',()=>{
  const f=fixture();f.ui.update({bots:[]});f.ui.manual();
  f.ui.update({routingVersion:1,bots:[{id:'b',revision:2}]});
  assert.equal(f.mode.value,'manual');assert.equal(f.manual.hidden,false);assert.equal(f.ui.canSubmit(),true);
});
