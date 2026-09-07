import {createInterface} from 'node:readline';
import {startModelHarness} from './companion-model-harness.js';

async function main() {
  const h=await startModelHarness();
  const post=async(path:string,body:unknown)=>{
    const response=await fetch(h.base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json() as any;if(!response.ok)throw Error(JSON.stringify(data));return data;
  };
  let release!:()=>void;
  const hold=new Promise<void>(resolve=>{release=resolve;});
  try {
    await post('/api/llm-config',{provider:'custom',protocol:'openai-compatible',baseUrl:h.modelBase+'/v1',model:'manual',selectionMode:'manual'});
    h.state.beforeReply=()=>hold;
    h.state.replyFor=()=>JSON.stringify({summary:'隔离排队验收完成',fields:[]});
    const ids:string[]=[];
    for(const name of ['A','B','C']) {
      const {record}=await post('/api/assistant-team/start',{requestId:'queue-'+name,objective:'排队验收 '+name,materials:'仅合成数据',workerIds:[],reviewerId:''});
      ids.push(record.id);
    }
    console.log(JSON.stringify({base:h.base,ids}));
    const cli=createInterface({input:process.stdin});
    for await(const command of cli) {
      if(command==='release'){h.state.beforeReply=undefined;release();console.log('released');}
      if(command==='status'){
        const response=await fetch(h.base+'/api/assistant-team');
        console.log(JSON.stringify({jobs:(await response.json() as any).jobs,calls:h.requests.filter(r=>r.body?.messages?.some((m:any)=>String(m.content).includes('排队验收'))).length}));
      }
      if(command==='stop'){cli.close();break;}
    }
  } finally {release?.();await h.stop();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
