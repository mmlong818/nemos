import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync("examples/companion/web/assets/team-materials.js", "utf8");
test("附件提示简洁，格式限制和隐私说明折叠但保留", () => {
  const html=readFileSync("examples/companion/web/bots.html","utf8");
  assert.match(html,/添加参考文件，点击“开始处理”后读取，无需粘贴正文/);
  assert.match(html,/<details class="hint" id="teamAttachmentHelp"><summary>支持的文件与使用说明/);
  assert.match(html,/关闭窗口后需要重新添加/);
  assert.match(html,/发送给所选模型服务/);
  assert.doesNotMatch(source,/本次未加入任何文件|不展开在输入框中/);
});
function library(extras: Record<string, unknown> = {}) {
  const window: any = {};
  runInNewContext(source, { window, TextDecoder, Uint8Array, DOMException, AbortController, Event, btoa,
    fetch: async () => { throw new Error("unexpected request"); }, ...extras });
  return window.ClownfishTeamMaterials;
}
test("文字文件在浏览器读取，多文件保留原材料和文件来源，拒绝超限", async () => {
  const api = library();
  const a = await api.readFile(new File(["[S1] 预算 100 元"], "说明.txt"));
  const b = await api.readFile(new File(["# 核对清单"], "清单.md"));
  const merged = api.appendMaterials("已有材料", [a,b]);
  assert.match(merged, /^已有材料\n\n\[文件来源：说明.txt\]/);
  assert.match(merged, /清单.md\]\n# 核对清单/);
  assert.throws(() => api.appendMaterials("x".repeat(23999), [a]), /超过/);
  assert.throws(() => api.validate(new File(["image"], "photo.png")), /不支持/);
  assert.throws(() => api.validate(new File([], "empty.txt")), /为空/);
  assert.throws(() => api.validate({ name:"large.pdf",size:8*1024*1024+1 }), /8 MB/);
  assert.throws(() => api.validate({ name:"large.txt",size:1024*1024+1 }), /1 MB/);
  await assert.rejects(api.readFile(new File([new Uint8Array([255,254])], "bad.txt")), /UTF-8/);
});
test("办公文件复用解析接口，保留解析说明并拒绝截断、空文本及服务错误", async () => {
  const api = library(), file = new File(["fixture"], "资料.docx");
  let calls = 0;
  const result = await api.readFile(file, undefined, async (url: string, init: any) => {
    calls++; assert.equal(url,"/api/files/extract"); assert.equal(init.method,"POST");
    assert.equal(JSON.parse(init.body).dataBase64, Buffer.from("fixture").toString("base64"));
    return { ok:true, json:async()=>({ extraction:{text:"正文"}, conversion:{notes:["图片未识别"]} }) };
  });
  assert.equal(result.text,"正文"); assert.equal(result.notes[0],"图片未识别"); assert.equal(calls,1);
  for (const data of [{ extraction:{text:"part",truncated:true} },{ extraction:{text:"part"},conversion:{truncated:true} }])
    await assert.rejects(api.readFile(file,undefined,async()=>({ok:true,json:async()=>data})), /不完整/);
  await assert.rejects(api.readFile(file,undefined,async()=>({ok:true,json:async()=>({extraction:{text:""}})})), /可读文字/);
  await assert.rejects(api.readFile(file,undefined,async()=>({ok:false,json:async()=>({userMessage:"文件已加密"})})), /已加密/);
  await assert.rejects(api.readFile(file,undefined,async()=>({ok:false,json:async()=>{throw new Error();}})), /有效结果/);
});
function formFixture(request?: any) {
  const nodes: Record<string, any> = {};
  for (const id of ["#teamMaterialFiles","#uploadTeamMaterials","#teamMaterialStatus","#teamMaterialNotes","#teamAttachmentList"])
    nodes[id]={value:"",textContent:"",hidden:false,disabled:false,files:[],click(){}};
  nodes['#teamAttachmentList'].replaceChildren=(...children:any[])=>{nodes['#teamAttachmentList'].children=children;};
  const submit={disabled:false};
  const events: Record<string, (event?: any)=>void>={};
  const form={querySelector:()=>submit,addEventListener:(name:string,handler:any)=>{events[name]=handler;}};
  const field={value:"原材料",form,setAttribute(){},removeAttribute(){},dispatchEvent(){}};
  nodes['#taskForm [name=materials]']=field;
  const api=library({document:{querySelector:(selector:string)=>nodes[selector],createElement:()=>({children:[],setAttribute(){},append(...children:any[]){this.children=children as never[];}})},...(request?{fetch:request}:{})});
  const binding=api.bind();
  return {nodes,field,submit,events,binding,input:nodes['#teamMaterialFiles']};
}
test("选择附件不读取正文，准备时才解析，多文件失败不覆盖原材料", async () => {
  const f=formFixture();
  let reads=0;
  const file={name:'<img>.txt',size:6,arrayBuffer:async()=>{reads++;return new TextEncoder().encode('正文').buffer;}};
  f.input.files=[file]; f.input.onchange();
  assert.equal(reads,0); assert.equal(f.field.value,'原材料');
  const ready=await f.binding.prepare();assert.equal(reads,1);assert.match(ready.materials,/<img>.txt/);
  assert.equal(f.field.value,'原材料');
  await f.binding.prepare();assert.equal(reads,1); // retry reuses the same attachment, never duplicates it
  f.nodes['#teamAttachmentList'].children[0].children[1].onclick();
  assert.equal(f.nodes['#teamAttachmentList'].hidden,true);
  f.input.files=[new File(["正常"],"one.txt"),new File([" "],"two.txt")];
  f.input.onchange();await assert.rejects(f.binding.prepare(),/可读文字/);assert.equal(f.field.value,"原材料");
  assert.match(f.nodes['#teamMaterialStatus'].textContent,/未提取/);
  assert.equal(f.input.value,"");
  assert.equal(f.nodes['#teamMaterialStatus'].innerHTML,undefined);
});
test("读取时禁止提交、保留期间编辑，重置草稿丢弃迟到结果", async () => {
  let resolve: (value:any)=>void = ()=>{};
  const f=formFixture(()=>new Promise(r=>{resolve=r;}));
  f.input.files=[new File(["fixture"],"brief.docx")];
  f.input.onchange();const pending=f.binding.prepare(); await new Promise(r=>setTimeout(r,0));
  assert.equal(f.submit.disabled,true);
  let blocked=0; f.events.submit({preventDefault(){blocked++;},stopImmediatePropagation(){blocked++;}}); assert.equal(blocked,2);
  f.field.value="读取期间新增";
  resolve({ok:true,json:async()=>({extraction:{text:"文档正文"}})}); const prepared=await pending;
  assert.equal(f.field.value,"读取期间新增");assert.match(prepared.materials,/文档正文/);
  f.binding.reset();f.input.files=[new File(["new"],"new.docx")];f.input.onchange();
  const cancelled=f.binding.prepare(); await new Promise(r=>setTimeout(r,0));
  f.binding.reset(); f.field.value="另一个任务的材料";
  resolve({ok:true,json:async()=>({extraction:{text:"不应加入"}})}); await assert.rejects(cancelled,{name:'AbortError'});
  assert.equal(f.field.value,"另一个任务的材料"); assert.equal(f.submit.disabled,false);
  assert.equal(f.nodes['#teamMaterialStatus'].textContent,"");
});
