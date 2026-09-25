import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 构件：模型写的、可交互、带状态的单页小工具（勾选清单、计算器、打卡表、小游戏）。
 *
 * 安全边界：构件页面由 ARTIFACT_SANDBOX_HEADERS 关在无来源沙箱里，拿不到接口权限。
 * 它要保存状态，只能通过 postMessage 交给外层的小丑鱼页面，由外层代存；外层只把状态当数据存取，从不执行。
 */

const WIDGET_CUE = /(可勾选|能勾选|打勾|勾选|可交互|交互式|能点的|小工具|计算器|换算器|小游戏|构件|打卡表|打卡器|倒计时|计时器|番茄钟|抽签|转盘|计分板|记分板|widget)/i;
const MAKE_VERB = /(做|生成|制作|创建|来一个|来个|弄个|弄一个|写个|写一个|搭一个|给我一个)/;

/** 聊天里"做一个能勾选的清单""弄个番茄钟"：动词加构件词，不要求出现"网页""HTML"。 */
export function hasWidgetIntent(text: string): boolean {
  if (/(不要|别|无需|不需要).{0,8}(做|生成|制作).{0,8}(构件|小工具|网页|页面)/.test(text)) return false;
  const cue = WIDGET_CUE.exec(text);
  if (!cue) return false;
  const before = text.slice(Math.max(0, cue.index - 16), cue.index);
  return MAKE_VERB.test(before) || MAKE_VERB.test(text.slice(cue.index, cue.index + cue[0].length + 8));
}

/** 写进 HTML 能力提示的构件约定。 */
export const WIDGET_CONTRACT = "如果要的是可交互的小工具（勾选清单、计算器、打卡表、小游戏等）：写成一个单文件页面，CSS 和 JS 全部内联，不联网、不引用任何外部资源；需要记住的状态直接用 localStorage，或用 await window.clownfishState.load() / window.clownfishState.save(对象)，小丑鱼都会替它存在本机；不要用 alert、prompt、confirm，提醒写在页面上；手机宽度下也要能用。页面会直接嵌在这条回复里使用，说明里不要让用户下载、另存或双击打开。";

/**
 * 注入到构件页面最前面的桥接脚本。页面在沙箱里（没有同源身份），浏览器自带的 localStorage 会直接报错，
 * 所以这里换上一个替身：读写落在"信封"里，由外层小丑鱼页面代存到本机。
 *
 * 信封 { __clownfish: 1, state, storage }：state 给 clownfishState 用，storage 给 localStorage 替身用。
 * 服务端返回页面时直接把上次存的信封嵌进来，页面一加载就能同步读到，不必等消息往返。
 * 单独在新标签打开时没有外层：改动只在内存里，页面照常能用，关掉就没了。
 */
export function widgetBridgeScript(artifactId: string, saved: unknown = null): string {
  const json = (value: unknown) => JSON.stringify(value ?? null).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<script>(function(){var id=${json(artifactId)};var saved=${json(saved)};var hosted=window.parent!==window;
var env=saved&&typeof saved==="object"&&saved.__clownfish===1?saved:{__clownfish:1,state:saved,storage:{}};if(!env.storage||typeof env.storage!=="object")env.storage={};
function post(m){if(hosted){m.id=id;window.parent.postMessage(m,"*");}}
function persist(){post({type:"clownfish-widget-save",state:env});}
function makeStorage(backing,save){var api={getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(backing(),k)?String(backing()[k]):null;},setItem:function(k,v){backing()[String(k)]=String(v);save();},removeItem:function(k){delete backing()[String(k)];save();},clear:function(){var b=backing();Object.keys(b).forEach(function(k){delete b[k];});save();},key:function(i){var k=Object.keys(backing());return i<k.length?k[i]:null;}};Object.defineProperty(api,"length",{get:function(){return Object.keys(backing()).length;}});return api;}
var memory={};
try{Object.defineProperty(window,"localStorage",{configurable:true,value:makeStorage(function(){return env.storage;},persist)});}catch(e){}
try{Object.defineProperty(window,"sessionStorage",{configurable:true,value:makeStorage(function(){return memory;},function(){})});}catch(e){}
window.clownfishState={hosted:hosted,load:function(){return Promise.resolve(env.state===undefined?null:env.state);},save:function(state){env.state=state===undefined?null:JSON.parse(JSON.stringify(state));persist();}};
function size(){post({type:"clownfish-widget-size",height:Math.ceil(document.documentElement.scrollHeight)});}
window.addEventListener("load",function(){size();if(window.ResizeObserver)new ResizeObserver(size).observe(document.documentElement);});
})();</script>`;
}

/** 插在 <head> 里最前面；没有 <head> 就放在文档最前。 */
export function injectWidgetBridge(html: string, artifactId: string, saved: unknown = null): string {
  const script = widgetBridgeScript(artifactId, saved);
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + script + html.slice(head.index + head[0].length);
  return script + html;
}

export const WIDGET_STATE_LIMIT_BYTES = 64 * 1024;

interface WidgetStateFile { version: 1; states: Record<string, { state: unknown; updatedAt: string }>; pinned: string[] }

export class WidgetStateError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** 构件状态与"钉到总览"。单文件、写临时文件再改名，崩溃不会留下半个 JSON。 */
export class WidgetStateStore {
  private data: WidgetStateFile;
  constructor(private readonly file: string) {
    this.data = { version: 1, states: {}, pinned: [] };
    try {
      if (existsSync(file)) {
        const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<WidgetStateFile>;
        this.data = { version: 1, states: saved.states && typeof saved.states === "object" ? saved.states : {}, pinned: Array.isArray(saved.pinned) ? saved.pinned.map(String) : [] };
      }
    } catch { /* 读坏了就当没有状态，不影响构件打开 */ }
  }
  private persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data), "utf8");
    renameSync(temp, this.file);
  }
  get(id: string): unknown {
    return this.data.states[id]?.state ?? null;
  }
  set(id: string, state: unknown): void {
    const text = JSON.stringify(state ?? null);
    if (Buffer.byteLength(text, "utf8") > WIDGET_STATE_LIMIT_BYTES) throw new WidgetStateError("构件要保存的内容太大（上限 64 KB）", 413);
    this.data.states[id] = { state: JSON.parse(text), updatedAt: new Date().toISOString() };
    this.persist();
  }
  pinned(): string[] { return [...this.data.pinned]; }
  setPinned(id: string, pinned: boolean): string[] {
    this.data.pinned = this.data.pinned.filter((item) => item !== id);
    if (pinned) this.data.pinned.unshift(id);
    this.data.pinned = this.data.pinned.slice(0, 12);
    this.persist();
    return this.pinned();
  }
}
