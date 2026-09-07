import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {AssistantBotStore} from '../../examples/companion/assistant-team.js';

const window:any={};
const read=(file:string)=>readFileSync('examples/companion/web/'+file,'utf8');
runInNewContext(read('assets/skill-contracts.js'),{window});
runInNewContext(read('assets/workflow-catalog.js'),{window});
const skills=window.ClownfishSkills;
const recipe={use:'整理会议文字',input:'本次会议记录及日期',steps:'1. 提取明确结论\n2. 检查责任人与日期',output:'摘要、行动项、未决问题',limits:'缺项标为未知，不编造承诺'};

test('结构化规则可往返解析，包含执行边界且不改写输入',()=>{
  const before=JSON.stringify(recipe),instructions=skills.compile(recipe);
  assert.deepEqual(JSON.parse(JSON.stringify(skills.parse(instructions))),recipe);
  assert.equal(JSON.stringify(recipe),before);
  assert.match(instructions,/不联网、不调用工具、不读取私人对话或长期记忆/);
  assert.ok(instructions.length<=4000);
});
test('缺少定义、超长及嵌套标题在保存前拒绝',()=>{
  for(const [key] of skills.fields)assert.throws(()=>skills.compile({...recipe,[key]:''}),/请填写/);
  assert.throws(()=>skills.compile({...recipe,input:'a'.repeat(1401)}),/1400/);
  assert.throws(()=>skills.compile(Object.fromEntries(skills.fields.map(([key]:string[])=>[key,'a'.repeat(900)]))),/4000/);
  assert.throws(()=>skills.compile({...recipe,steps:'正常\n交付要求：混入另一字段'}),/对应输入框/);
});
test('旧规则只投影、不改名称、身份、版本或正文，不从模板猜测权限',()=>{
  const record={id:'old',name:'我的原有 Bot',revision:9,enabled:true,instructions:'用户改写了规则，不使用原模板',template:{id:'plant-journal'}};
  const before=JSON.stringify(record),contract=skills.rule(record);
  assert.equal(contract.sourceId,'old');assert.equal(contract.revision,9);
  assert.equal(contract.name,record.name);assert.equal(contract.instructions,record.instructions);
  assert.match(contract.steps,/未额外定义/);assert.match(contract.permissions,/无联网/);
  assert.equal(JSON.stringify(record),before);
  assert.equal(skills.rule({...record,placement:'market'}).enabled,false);
  assert.equal(skills.rule({...record,enabled:false}).enabled,false);
});
test('11 项执行技能保留原后端、格式与白名单准备地址，不升级规则权限',()=>{
  const workflows=window.ClownfishWorkflowCatalog.workflows;
  assert.equal(workflows.length,11);
  for(const item of workflows){const skill=skills.workflow(item);
    assert.equal(skill.backendId,item.backendId);assert.equal(skill.href,item.href);
    assert.equal(skill.execution,'capability-workflow');
    for(const key of ['use','input','steps','output','limits','permissions','check'])assert.ok(skill[key],key);
  }
});
test('编译规则通过真实内存存储和冻结计划，保留现有记录及版本机制',()=>{
  const store=new AssistantBotStore(':memory:');
  try{
    store.seed('skills-test');const before=store.list('skills-test');
    const instructions=skills.compile(recipe);
    const saved=store.save('skills-test',{name:'合成会议规则',role:'worker',enabled:true,instructions});
    const plan=store.plan('skills-test',{requestId:'skill-test',objective:'整理合成文字',materials:'[S1] 无真实资料',workerIds:[saved.id],model:'mock'});
    assert.equal(plan.workers[0].instructions,instructions);
    assert.deepEqual(store.list('skills-test').filter(x=>x.id!==saved.id),before);
    const updated=store.save('skills-test',{id:saved.id,revision:saved.revision,instructions:'用户重新编辑的完整规则'});
    assert.equal(updated.id,saved.id);assert.equal(updated.revision,saved.revision+1);
    assert.equal(plan.workers[0].instructions,instructions);
  }finally{store.close();}
});
test('新建编译定义、旧规则原样保存；表单只发送兼容字段，不开始任务',async()=>{
  const source=read('assets/assistant-team.js');
  const handler=source.slice(source.indexOf("$('#botForm').onsubmit="),source.indexOf("$('#newTask').disabled=true;"));
  for(const structured of [true,false]){
    const values:any={id:structured?'':'existing',revision:structured?'':3,name:'合成模板',role:'worker',instructions:'保持用户原规则'};
    for(const [key]of skills.fields)values['recipe'+key[0].toUpperCase()+key.slice(1)]=recipe[key as keyof typeof recipe];
    const requests:any[]=[],button:any={},error:any={textContent:''};let closed=false;
    const form:any={elements:{enabled:{checked:true}},querySelector:(q:string)=>q==='[type=submit]'?button:error};
    const nodes:any={'#botForm':form,'#skillRecipeFields':{hidden:!structured},'#botDialog':{close(){closed=true;}}};
    runInNewContext(handler,{$:(q:string)=>nodes[q],skills,FormData:class{get(key:string){return values[key];}},api:async(path:string,body:any)=>requests.push({path,body}),toast(){},load:async()=>{}});
    await form.onsubmit({preventDefault(){},target:form});
    assert.equal(error.textContent,'');assert.equal(closed,true);assert.equal(button.disabled,false);
    assert.equal(requests.length,1);assert.equal(requests[0].path,'/bot');
    assert.equal(requests[0].body.instructions,structured?skills.compile(recipe):values.instructions);
    assert.deepEqual(Object.keys(requests[0].body).sort(),['enabled','id','instructions','name','revision','role']);
  }
});
test('新界面保留旧选择器和深链接，技能是可选项且不伪装在线市场',()=>{
  const html=read('bots.html'),source=read('assets/assistant-team.js');
  assert.match(html,/使用技能（可选）/);assert.match(html,/官方技能市场尚未开放/);
  assert.match(html,/id="skillRecipeFields"/);assert.match(source,/ruleEditorMode\(!b\)/);
  assert.match(source,/openBot\(\);ruleEditorMode\(false\)/);
  assert.match(source,/skills\.workflow\(b\):skills\.rule\(b\)/);
  assert.match(read('assets/product-structure.js'),/href:'\/skills',label:'技能库'/);
});
