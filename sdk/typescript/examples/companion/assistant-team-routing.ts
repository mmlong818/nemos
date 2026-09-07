import type { AssistantBot } from './assistant-team.js';

export interface TeamRouting {
  method: 'local-name-match-v1'; workerIds: string[]; reviewerId: string;
  reason: string; matches: Array<{ id: string; name: string; role: string; reason: string }>;
}
// Small, explicit vocabulary, not semantic or model-based matching. Instructions and
// attachments are never interpreted as router commands or included in this decision.
const topics = [
  ['会议', '纪要', '议程'], ['翻译', '译文', '中英'], ['写作', '文案', '润色', '改写'],
  ['预算', '费用', '财务', '账目'], ['数据', '表格', '统计'], ['计划', '规划', '待办'],
  ['植物', '养护', '浇水'], ['学习', '辅导', '课程'], ['邮件', 'email'],
  ['简历', '求职', '面试'], ['代码', '编程'], ['整理', '资料', '摘要', '总结', '简报'],
  ['会前', '会议准备', '开会准备'], ['通话', '电话', '回访'], ['项目', '里程碑', '推进'],
  ['方案', '压力测试', '可行性'], ['bot', '机器人', '助理设计'],
];
const review = /核验|核对|校验|审校|复核|审核|审阅|验证|检查|review|verify/i;
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
function score(objective: string, bot: AssistantBot) {
  const name=normalize(bot.name), matches:string[]=[];
  if(/审阅/.test(name)&&!review.test(objective))return {bot,terms:[],score:0};
  for(const group of topics)if(group.some(word=>name.includes(word))&&group.some(word=>objective.includes(word)))matches.push(group[0]);
  const words=[...new Intl.Segmenter('zh',{granularity:'word'}).segment(name)]
    .filter(part=>part.isWordLike&&part.segment.length>=2&&!['助理','助手','专家','专业','独立','bot'].includes(part.segment));
  const exact=words.filter(part=>objective.includes(part.segment)).map(part=>part.segment);
  const terms=[...new Set([...matches,...exact])];
  // Prefer a specialist topic over the broad organizer category. Ties are stable by id.
  return {bot,terms,score:matches.filter(term=>term!=='整理').length*6+exact.length*2+(matches.includes('整理')?1:0)};
}
export function routeAssistantTeam(objective: string, bots: AssistantBot[]): TeamRouting {
  const goal=normalize(objective).replace(/(?:不要|无需|不需要|不必|不用)[^，。；,;]{0,40}/g,'');
  const eligible=bots.filter(bot=>bot.enabled&&bot.placement!=='market');
  const rank=(role:AssistantBot['role'])=>eligible.filter(bot=>bot.role===role).map(bot=>score(goal,bot))
    .filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.bot.id.localeCompare(b.bot.id));
  const worker=rank('worker')[0];
  const reviewer=review.test(goal)?rank('reviewer')[0]?.bot||eligible.find(bot=>bot.role==='reviewer'&&bot.id==='bot-reviewer'):undefined;
  const matches:TeamRouting['matches']=[];
  if(worker)matches.push({id:worker.bot.id,name:worker.bot.name,role:'worker',reason:'名称匹配：'+worker.terms.join('、')});
  if(reviewer)matches.push({id:reviewer.id,name:reviewer.name,role:'reviewer',reason:'任务目标明确要求核验或检查'});
  return {method:'local-name-match-v1',workerIds:worker?[worker.bot.id]:[],reviewerId:reviewer?.id||'',matches,
    reason:matches.length?'根据目标与已启用 Bot 的名称匹配；仅处理本次文字材料。':'没有明确匹配的已启用文字 Bot，由小丑鱼独立完成；不会自动启用工具流程。'};
}
