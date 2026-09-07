import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
function setup() {
  const peers=new Map<string,Set<any>>();
  class Channel {
    name:string; onmessage:any; closed=false;
    constructor(name:string){this.name=name;if(!peers.has(name))peers.set(name,new Set());peers.get(name)!.add(this);}
    postMessage(data:any){for(const other of peers.get(this.name)!)if(other!==this)queueMicrotask(()=>{if(!other.closed)other.onmessage?.({data});});}
    close(){this.closed=true;peers.get(this.name)!.delete(this);}
  }
  let reads=0;
  const window:any={ClownfishTeamMaterials:{
    validate(file:any){if(!file.size)throw Error('empty');},
    async readFile(file:any){reads++;const text=await file.text();if(!text.trim())throw Error('empty text');return {text,notes:[]};}
  }};
  for(const file of ['skill-file-transfer.js','pending-materials.js'])runInNewContext(readFileSync('examples/companion/web/assets/'+file,'utf8'),{window,Blob,BroadcastChannel:Channel,setTimeout,clearTimeout,setInterval,clearInterval});
  return {window,peers,reads:()=>reads};
}
const token='11111111-1111-4111-8111-111111111111';
test('跨窗口传递原件，接收和草稿保存均不读取正文',async()=>{
  const {window,peers,reads}=setup(),f=new File(['synthetic'], 'S1.txt');
  const offered=window.ClownfishSkillFiles.offer(token,[f],500);
  const files=await window.ClownfishSkillFiles.receive(token,1,500);
  assert.equal((await offered.done).ok,true);assert.equal(files[0],f);
  const items=files.map(window.ClownfishPendingMaterials.pending);
  assert.equal(reads(),0);
  const saved=window.ClownfishPendingMaterials.saved(items);
  assert.equal(saved[0].file,undefined);assert.equal(saved[0].pending,true);
  assert.equal((await window.ClownfishPendingMaterials.prepare(items))[0].text,'synthetic');
  await window.ClownfishPendingMaterials.prepare(items);assert.equal(reads(),1);
  assert.equal(items[0].file,f);assert.equal(items[0].pending,true);
  assert.ok([...peers.values()].every(s=>s.size===0));
  await assert.rejects(window.ClownfishPendingMaterials.prepare(saved),/重新选择/);
});
test('附件不完整或取消时不成功，通道会关闭',async()=>{
  const {window,peers}=setup(),f=new File(['x'],'S.txt');
  const offer=window.ClownfishSkillFiles.offer(token,[f],500);
  await assert.rejects(window.ClownfishSkillFiles.receive(token,2,500),/数量/);
  assert.equal((await offer.done).ok,false);
  const cancelled=window.ClownfishSkillFiles.offer(token,[f],500);cancelled.cancel();
  assert.equal((await cancelled.done).ok,false);
  await assert.rejects(window.ClownfishSkillFiles.receive(token,1,10),/未能到达/);
  assert.ok([...peers.values()].every(s=>s.size===0));
  assert.throws(()=>window.ClownfishSkillFiles.validate([{name:'fake',size:1}],1),/无效/);
});
test('解析失败保留全部原件，成功文件重试使用缓存',async()=>{
  const {window,reads}=setup(),p=window.ClownfishPendingMaterials;
  const files=[new File(['good'],'S1.txt'),new File([' '],'S2.txt')],items:any[]=files.map((file)=>p.pending(file));
  await assert.rejects(p.prepare(items),/S2.txt/);
  assert.equal(items[0].file,files[0]);assert.equal(items[1].file,files[1]);
  assert.equal(reads(),2);await assert.rejects(p.prepare(items));assert.equal(reads(),3);
});
