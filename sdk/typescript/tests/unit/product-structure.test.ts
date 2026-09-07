import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=(name:string)=>readFileSync(`examples/companion/web/assets/${name}.js`,'utf8');
function api(name:string,key:string){const window:any={};runInNewContext(source(name),{window,URLSearchParams});return window[key];}

test('four primary destinations and secondary legacy addresses map consistently',()=>{
  const product=api('product-structure','ClownfishProductStructure');
  assert.equal(product.items.slice(0,4).map((x:any)=>x.key).join(','),'assistant,tasks,files,memory');
  for(const [path,query,key] of [
    ['/','','assistant'],['/overview','','assistant'],['/bots','','tasks'],['/bots','?view=tasks','tasks'],
    ['/bots','?view=bots','bots'],['/bots','?view=market','bots'],['/tasks','','tasks'],['/collaboration','','tasks'],
    ['/spaces','','tasks'],['/matters','','tasks'],['/matters','?view=learning','memory'],
    ['/artifacts','','files'],['/resources','','files'],['/office.html','','files'],['/memory/','','memory'],
    ['/runs','','settings'],['/settings','','settings'],['/capabilities','','tools'],['/automations','','automations']
  ])assert.equal(product.area(path,query),key,`${path}${query}`);
});

test('file index preserves stores, disambiguates ids and excludes archived resources',()=>{
  const files=api('file-library','ClownfishFileLibrary');
  const artifacts=[{id:'same',title:'成果',createdAt:'2026-09-01',format:'pdf',taskId:'flow 1'}];
  const documents=[{id:'same',name:'编辑副本',updatedAt:'2026-09-03',originArtifactId:'same'}];
  const knowledge=[{id:'same',title:'材料',excerpt:'合成测试',createdAt:'2026-09-02'},{id:'archived',archivedAt:'2026-09-01'}];
  const before=JSON.stringify([artifacts,documents,knowledge]);
  const rows=files.entries(artifacts,documents,knowledge);
  assert.equal(rows.map((x:any)=>x.key).join(','),'document:same,resource:same,artifact:same');
  assert.equal(rows[0].label,'编辑副本');
  assert.equal(JSON.stringify([artifacts,documents,knowledge]),before);
  assert.equal(files.filter(rows,{kind:'resource',query:'合成'}).length,1);
  assert.equal(files.filter(rows,{query:' PDF '})[0].kind,'artifact');
  assert.equal(files.filter(rows,{query:'missing'}).length,0);
  assert.match(files.row(rows[0]),/office\?document=same/);
  assert.match(files.row(rows[2]),/bots\?task=flow%201/);
});

test('file rows escape imported metadata and encode identifiers',()=>{
  const files=api('file-library','ClownfishFileLibrary');
  const row=files.entries([{id:'a"&b',title:'<img src=x onerror=alert(1)>',summary:'<script>bad</script>',createdAt:'invalid'}],[],[])[0];
  const html=files.row(row);
  assert.doesNotMatch(html,/<img|<script/);
  assert.match(html,/&lt;img/);
  assert.match(html,/a%22%26b/);
  assert.match(html,/未记录时间/);
});

test('assistant summary uses existing work only, is bounded and excludes finished jobs',()=>{
  const digest=api('assistant-digest','ClownfishAssistantDigest');
  assert.equal(digest.summary().length,0);
  const rows=digest.summary({matters:[{title:'跟进',status:'active'},{title:'已暂停',status:'paused'}]},
    {jobs:[{id:'x y',title:'处理中',status:'running'},{id:'done',status:'succeeded'}]},
    {groups:[{id:1},{id:2}],items:[1,2,3]});
  assert.equal(rows.length,3);
  assert.equal(rows[0].title,'2 项待确认');
  assert.equal(rows[1].href,'/bots?job=x%20y');
  assert.equal(digest.summary({matters:Array(5).fill({status:'active'})},{jobs:Array(5).fill({status:'running'})},{items:[1]}).length,4);
});

test('file deep links select the exact document and keep original artifact imports',()=>{
  const office=source('office-workbench');
  assert.match(office,/get\('document'\)/);
  assert.match(office,/find\(item=>item.id===requestedDocument\)\?\.id\|\|null/);
  assert.match(office,/hydrateWorkbenchState\(\).then\(\(\) => importArtifactFromQuery\(\)\)/);
  assert.match(source('workbench-ui'),/product-file-back/);
});
