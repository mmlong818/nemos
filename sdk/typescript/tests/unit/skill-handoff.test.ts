import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const window:any={};
for(const file of ['workflow-catalog.js','skill-handoff.js'])runInNewContext(readFileSync('examples/companion/web/assets/'+file,'utf8'),{window});
const h=window.ClownfishSkillHandoff,c=window.ClownfishWorkflowCatalog;
const token='11111111-1111-4111-8111-111111111111';
function storage(value:unknown){const map=new Map([[h.prefix+token,JSON.stringify(value)]]);return {getItem:(key:string)=>map.get(key),removeItem:(key:string)=>map.delete(key),map};}
test('只建议白名单技能，负向要求及单纯审阅不触发制作',()=>{
  assert.equal(h.suggest('帮我制作一份 PPT',c)[0].id,'presentation');
  assert.equal(h.suggest('不要生成PPT，只整理文字',c).length,0);
  assert.equal(h.suggest('审阅我的PPT',c).length,0);
  assert.equal(h.suggest('普通聊天',c).length,0);
  assert.equal(h.suggest('深度研究并生成演示文稿',c).length,2);
  assert.ok(h.suggest('深度研究，比较方案，制作PPT，整理会议纪要',c).length<=3);
});
test('转交不截断文字、不携带权限模型或附件，不更改原始对象',()=>{
  const values={objective:'制作PPT',materials:'[S1] 合成资料',requiredFields:'来源',attachments:['private'],model:'private'};
  const before=JSON.stringify(values),p=h.prepare('presentation',values,c,100);
  assert.match(p.instruction,/制作PPT[\s\S]*合成资料[\s\S]*来源/);
  assert.deepEqual(Object.keys(p).sort(),['createdAt','fileCount','id','instruction','version']);
  assert.equal(JSON.stringify(values),before);
  assert.throws(()=>h.prepare('bad',values,c),/未找到/);
  assert.throws(()=>h.prepare('presentation',{objective:''},c),/目标/);
  assert.throws(()=>h.prepare('presentation',{objective:'a'.repeat(16001)},c),/16000/);
});
test('临时转交限十分钟、单次读取，拒绝错技能、损坏数据与未来时间',()=>{
  const p=h.prepare('presentation',{objective:'制作PPT'},c,100),s=storage(p);
  assert.equal(h.take(s,token,'presentation',c,200).instruction,'制作PPT');
  assert.equal(s.map.size,0);assert.throws(()=>h.take(s,token,'presentation',c,201),/无效/);
  for(const [value,id,now]of [[p,'document',200],[p,'presentation',700001],[p,'presentation',99],[{...p,instruction:7},'presentation',200]] as const)
    assert.throws(()=>h.take(storage(value),token,id,c,now),/无效|过期/);
  assert.throws(()=>h.take(storage(p),'bad','presentation',c,200),/地址/);
});
test('准备页只导入空表单、关闭偏好记忆，没有提交或提取动作',()=>{
  const source=readFileSync('examples/companion/web/assets/capability-center.js','utf8');
  const start=source.indexOf('const token=new URLSearchParams(location.search).get("transfer")');
  const part=source.slice(start,source.indexOf('else showToast("未找到这项执行技能',start));
  assert.match(part,/instructionInput.*value.trim\(\)/);
  assert.match(part,/memoryToggle.*checked=false/);
  assert.doesNotMatch(part,/startTask\(|saveDraft\(|fetch\(|extract/);
  const entry=readFileSync('examples/companion/web/assets/task-skill-suggestions.js','utf8');
  assert.match(entry,/child.opener=null/);assert.match(entry,/finally.*sessionStorage.removeItem/s);
  assert.doesNotMatch(entry,/\.prepare\(\)|fetch\(|\/start|arrayBuffer/);
});
