export interface GroupRouteMember {
  id: string;
  name: string;
}

export interface GroupReplyRoute {
  responderPersonaIds?: string[];
  explicitlyMentionedPersonaIds?: string[];
  coordinatorPersonaId?: string;
}

export interface GroupParticipation {
  directlyMentioned: boolean;
  coordinating: boolean;
}

const CASUAL_SIGNAL = /^(你好|嗨|哈喽|在吗|早上好|上午好|中午好|下午好|晚上好|晚安|谢谢|哈哈|嗯+|哦+|好的|收到)[呀啊吗呢吧～~！!。.？?]*$/i;
const CONTINUATION_SIGNAL = /^(继续|接着|往下|展开|详细说说|具体一点|为什么|怎么做|然后呢|这个呢|上一点|刚才那点|第[一二三四五六七八九十\d]+点)/i;

const EXPERT_TOPIC_RULES: Array<{ ids: string[]; pattern: RegExp }> = [
  { ids: ["teacher_lin", "critical_thinking"], pattern: /学习|辅导|讲解|概念|知识点|解题|作业|练习|复习|考试|课程|错题|举例|小测/i },
  { ids: ["user_experience", "interface_design"], pattern: /界面|页面|视觉|图标|配色|排版|布局|可用性|用户体验|UI|UX/i },
  { ids: ["interaction_design", "product_lead"], pattern: /交互|流程|路径|操作|新手|onboarding|状态设计/i },
  { ids: ["brand_strategy", "product_lead"], pattern: /品牌|定位|命名|文案|内容|传播|营销|写作|意象|叙事|风格/i },
  { ids: ["system_architecture", "lean_engineering"], pattern: /架构|系统|代码|开发|接口|API|数据库|模型|技术|性能|服务/i },
  { ids: ["quality_testing", "lean_engineering"], pattern: /测试|质量|故障|错误|缺陷|验收|稳定|可靠/i },
  { ids: ["industry_analysis", "pricing_finance"], pattern: /市场|行业|产业|竞品|商业|定价|成本|收入|财务/i },
  { ids: ["sales_growth", "brand_strategy"], pattern: /销售|增长|获客|转化|渠道|客户/i },
  { ids: ["long_term_strategy", "decision_analysis"], pattern: /战略|长期|取舍|决策|选择|路线|优先级|风险/i },
  { ids: ["startup_validation", "first_principles"], pattern: /创业|想法|验证|可行性|假设|原理|约束/i },
];

function selectAdvisoryExperts(text: string, memberIds: Set<string>, previousExpertIds: string[]): string[] {
  const selected: string[] = [];
  for (const rule of EXPERT_TOPIC_RULES) {
    if (!rule.pattern.test(text)) continue;
    for (const id of rule.ids) {
      if (memberIds.has(id) && !selected.includes(id)) selected.push(id);
      if (selected.length >= 2) return selected;
    }
  }
  if (selected.length > 0) return selected;
  if (CONTINUATION_SIGNAL.test(text.trim())) {
    const previous = previousExpertIds.filter((id) => memberIds.has(id)).slice(0, 2);
    if (previous.length > 0) return previous;
  }
  // 专家组里的非问候消息都需要真实专家参与；模糊、犹豫和“继续”也属于需要判断的上下文。
  return ["product_lead", "critical_thinking"].filter((id) => memberIds.has(id));
}

export function selectGroupResponderIds(memberIds: string[], route?: GroupReplyRoute): string[] {
  const validIds = new Set(memberIds);
  const explicitlyMentioned = (route?.explicitlyMentionedPersonaIds ?? []).filter((id) => validIds.has(id));
  const routedResponders = (route?.responderPersonaIds ?? []).filter((id) => validIds.has(id));
  if (routedResponders.length > 0) return routedResponders;
  if (explicitlyMentioned.length > 0) return explicitlyMentioned;
  return memberIds;
}

export function groupParticipationFor(personaId: string, route?: GroupReplyRoute): GroupParticipation {
  const directlyMentioned = (route?.explicitlyMentionedPersonaIds ?? []).includes(personaId);
  return {
    directlyMentioned,
    coordinating: route?.coordinatorPersonaId === personaId && !directlyMentioned,
  };
}

export function resolveGroupReplyRoute(
  groupId: string,
  text: string,
  members: GroupRouteMember[],
  advisoryGroupId: string,
  coordinatorPersonaId = "clownfish",
  previousExpertIds: string[] = [],
): GroupReplyRoute {
  const body = text || "";
  const explicitlyMentionedPersonaIds = members
    .filter((member) => {
      const names = [member.name, member.id].filter(Boolean);
      return names.some((name) => body.includes(`@${name}`) || body.includes(`＠${name}`));
    })
    .map((member) => member.id);

  if (explicitlyMentionedPersonaIds.length > 0) {
    return {
      responderPersonaIds: explicitlyMentionedPersonaIds,
      explicitlyMentionedPersonaIds,
    };
  }

  if (groupId === advisoryGroupId && members.some((member) => member.id === coordinatorPersonaId)) {
    const memberIds = new Set(members.map((member) => member.id));
    const trimmed = body.trim();
    const invitedExperts = trimmed && !CASUAL_SIGNAL.test(trimmed)
      ? selectAdvisoryExperts(trimmed, memberIds, previousExpertIds)
      : [];
    return {
      // 专家先给出各自判断，小丑鱼最后读取本轮群记录并负责整合。
      responderPersonaIds: [...invitedExperts, coordinatorPersonaId],
      explicitlyMentionedPersonaIds: [],
      coordinatorPersonaId,
    };
  }

  return { explicitlyMentionedPersonaIds: [] };
}
