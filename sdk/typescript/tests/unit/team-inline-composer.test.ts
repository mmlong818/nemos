import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const script = readFileSync("examples/companion/web/assets/assistant-team.js", "utf8");

test("任务详情与内联草稿互斥，切换只隐藏而不重建表单", () => {
  const fn = script.slice(script.indexOf("function showTaskContent("), script.indexOf("function tabs("));
  const nodes: Record<string, any> = { "#taskComposer": { hidden:false }, "#jobDetail": { hidden:true } };
  const context = { selected:"", $:(key:string)=>nodes[key] };
  for (const selected of ["", "existing", ""]) {
    context.selected=selected;
    runInNewContext(fn+"\nshowTaskContent();", context);
    assert.equal(nodes["#taskComposer"].hidden, !!selected);
    assert.equal(nodes["#jobDetail"].hidden, !selected);
  }
  const open = script.slice(script.indexOf("function openTask("),script.indexOf("function openBot("));
  assert.doesNotMatch(open, /\.reset\(|showModal\(/);
  assert.match(open, /if\(!f\.elements\.objective\.value\.trim\(\)\)/);
});

function fixture() {
  let generation=0, resets=0, formResets=0, calls=0;
  let resolve:(value:unknown)=>void=()=>{}, reject:(error:Error)=>void=()=>{};
  const submit={disabled:false}, field={disabled:false}, error={textContent:""};
  const form:any={ querySelector:(selector:string)=>selector===".form-error"?error:submit,
    querySelectorAll:()=>[field,submit], reset:()=>{formResets++;} };
  const nodes:Record<string,any>={"#taskForm":form,"#taskGuide":{},"#taskTitle":{},"#taskExtraOptions":{},"#manualBotAssignment":{}};
  const bodies:any[]=[];
  const context:any={
    $:(key:string)=>nodes[key], submitting:false, selected:"", detailKey:"", taskOptionsKey:"loaded",
    requestId:"",requestBody:"", activeTemplate:{}, crypto:{randomUUID:()=>"request-1"},
    materialUploads:{version:()=>generation,prepare:async()=>({materials:"合成附件内容",token:++generation}),reset:()=>{resets++;generation++;}},
    FormData:class { get(key:string){return ({objective:"合成目标",requiredFields:"总额\n来源",model:"test-model",reviewerId:""} as any)[key];} getAll(){return [];} },
    api:async(_path:string,body:any)=>{calls++;bodies.push(body);return new Promise((a,b)=>{resolve=a;reject=b;});},
    tabs:()=>{},toast:()=>{},load:async()=>{},syncTaskOptions:()=>{submit.disabled=false;},
  };
  const handler=script.slice(script.indexOf("$('#taskForm').onsubmit="),script.indexOf("$('#botForm').onsubmit="));
  runInNewContext(handler,context);
  return {context,field,submit,error,bodies,send:()=>form.onsubmit({target:form,preventDefault(){}}),
    complete:()=>resolve({record:{id:"new-job"}}),fail:()=>reject(new Error("网络不可用")),
    counts:()=>({calls,resets,formResets})};
}

test("提交中锁定表单、防止重复派发，成功后清空草稿并选择新任务", async () => {
  const f=fixture();const pending=f.send();await new Promise(r=>setTimeout(r,0));
  assert.equal(f.field.disabled,true);assert.equal(f.submit.disabled,true);
  await f.send();assert.equal(f.counts().calls,1);
  assert.equal(f.bodies[0].materials,"合成附件内容");assert.equal(f.bodies[0].workerIds.length,0);
  f.complete();await pending;
  assert.deepEqual(f.counts(),{calls:1,resets:1,formResets:1});
  assert.equal(f.context.selected,"new-job");assert.equal(f.context.submitting,false);
  assert.equal(f.field.disabled,false);assert.equal(f.submit.disabled,false);
});

test("提交失败保留草稿和附件，重试复用同一请求标识", async () => {
  const f=fixture();let pending=f.send();await new Promise(r=>setTimeout(r,0));f.fail();await pending;
  assert.deepEqual(f.counts(),{calls:1,resets:0,formResets:0});
  assert.equal(f.error.textContent,"网络不可用");assert.equal(f.field.disabled,false);
  pending=f.send();await new Promise(r=>setTimeout(r,0));
  assert.equal(f.bodies[0].requestId,f.bodies[1].requestId);
  f.fail();await pending;assert.equal(f.counts().resets,0);
});
