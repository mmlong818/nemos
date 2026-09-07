import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { startModelHarness } from "../fixtures/companion-model-harness.js";

test("共享材料上传通过真实文件接口解析 CSV，仅本机保存且不调用模型", {timeout:60000}, async () => {
  const h=await startModelHarness();
  try {
    const window: any={};
    runInNewContext(readFileSync('examples/companion/web/assets/team-materials.js','utf8'), {
      window, TextDecoder, Uint8Array, DOMException, btoa, fetch:(path:string, init:RequestInit)=>fetch(h.base+path,init),
    });
    const calls=h.requests.length;
    const result=await window.ClownfishTeamMaterials.readFile(new File(['项目,费用\n场地,120\n材料,60\n'],'费用.csv'));
    assert.match(result.text,/场地/); assert.match(result.text,/120/); assert.match(result.text,/材料/);
    const shared=window.ClownfishTeamMaterials.appendMaterials('[S1] 已有说明',[result]);
    assert.match(shared,/^\[S1\] 已有说明/); assert.match(shared,/文件来源：费用.csv/);
    assert.equal(h.requests.length,calls);
    const team=await (await fetch(h.base+'/api/assistant-team')).json() as any;
    assert.equal(team.jobs.length,0);
    const html=await (await fetch(h.base+'/bots')).text();
    assert.match(html,/id="teamMaterialFiles" type="file" multiple/);
    assert.match(html,/src="\/assets\/team-materials.js"/);
  } finally { await h.stop(); }
});
