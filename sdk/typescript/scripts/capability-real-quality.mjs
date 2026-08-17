import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const baseUrl = process.env.CLOWNFISH_URL || "http://127.0.0.1:8787";
const outputDir = join(homedir(), ".clownfish", "quality-reviews");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const allCases = [
  ["image-prompt-reconstruction", "图片提示词反推", "md", "画面观察：横向16:9海报；青绿色低多边形背景，右侧是一位粉色短发的动漫女孩，穿青白色未来感夹克，怀抱一只黄色长耳小动物；左侧大面积留白；柔和正面光；主色青绿、粉色、黄色。请反推可复用提示词，不要猜测角色、品牌或作者。", [/完整|提示词/, /负面|negative/, /构图|composition/, /不确定|可见|未观察|无法.{0,8}(?:观察|推断)/]],
  ["research-brief", "深度研究", "html", "研究 Windows 桌面 AI 应用采用 MSIX 上架 Microsoft Store 的路径。只使用可追溯的一手资料，比较 MSIX 与自托管 EXE，给出2026年8月可执行结论、引用链接、核验时间和仍待确认项。", [/MSIX/i, /来源|引用/, /核验|确认/, /结论|建议/]],
  ["decision-brief", "决策辅助", "md", "一个3人团队未来6个月不能建设云端多租户，但希望公开发布本地AI办公应用。比较：A只做便携版，B优先做MSIX商店版，C先自建下载站。预算10万元，目标是降低新手安装门槛。给出推荐、反对理由、触发条件和90天行动。", [/方案|选项/, /风险/, /建议|推荐/, /触发|条件/]],
  ["html-report", "HTML 报告", "html", "把以下运营数据做成可打印单页报告：7月新增用户1200、激活率42%、7日留存18%、付费转化3.2%；8月新增1650、激活率51%、7日留存24%、付费转化4.1%。指出变化、可能原因必须标为假设，并给下月行动。", [/1,?200/, /1,?650/, /假设/, /行动|建议/]],
  ["document-draft", "文档稿", "doc", "起草《小丑鱼隐私说明》初稿：数据默认本机保存；用户配置外部模型时会发送当前请求和必要上下文；密钥在本机加密保存；用户可导出和删除数据；插件权限安装前展示。要求面向普通用户，先摘要再分条，不虚构法律承诺。", [/本机/, /外部模型|模型服务/, /密钥/, /删除|导出/]],
  ["ocr-extraction", "OCR 文字识别", "md", "OCR识别原始结果如下，请保留行序并标记疑似字符：\n发票号码：A03B8?17\n日期：2026/08/17\n金额：￥1,28O.00（最后一位可能是字母O）\n购买方：海风科枝有限公司（‘枝’可能为‘技’）\n请输出原始识别、结构化字段、疑似项和清洁副本。", [/原始|识别/, /结构化|字段/, /疑似|不确定/, /1280|1,280/]],
  ["document-conversion", "文档转换与整理", "doc", "把下面内容整理成正式项目周报，保留事实与缺失项：已完成：登录页；进行中：支付接口，负责人王涛，预计8月22日；阻塞：商店签名账号未申请，负责人未知；数据：本周缺陷12个，关闭9个。输出标题、摘要、状态表、风险和待确认项。", [/登录页/, /王涛/, /12/, /负责人.*未知|未知.*负责人/]],
  ["meeting-minutes", "会议纪要", "doc", "整理会议纪要：2026年8月17日，参与李明、周岚、王涛。决定9月10日前完成Windows上架准备；李明8月20日前提供隐私文案；王涛8月25日前交安装包；周岚9月2日前交商店素材。代码签名账号未申请，负责人未确定。不得擅自指派。", [/李明/, /王涛/, /周岚/, /未确定/]],
  ["group-progress-tracker", "群聊进展跟踪", "md", "整理群聊进展：李明：隐私文案完成80%，明天下午发；王涛：安装包已能启动，但卸载保留数据策略没定；周岚：截图模板已完成，等安装包；老板：9月10日不变。请区分完成、进行中、阻塞、等待输入、下一步，未给日期不要自行补绝对日期。", [/进行中/, /阻塞|等待/, /卸载/, /9月10日/]],
  ["article-polish", "文章润色", "md", "润色这段发布说明，保留数字和事实，不要营销腔：‘小丑鱼0.2.2现在有23个能力。我们把文件、开发、任务都放一起了。它还有很多不成熟地方，比如在线邮箱还没有。我们希望让不会编程的人也能做复杂工作。’ 给出润色稿和修改说明。", [/0\.2\.2/, /23/, /在线邮箱/, /修改|说明/]],
  ["market-briefing", "市场资料简报", "md", "为港股00700和09988做资料核验简报。只整理本机关注列表、官方公告和带时间戳行情快照；若没有新鲜数据就明确待核验，不给买卖建议。", [/00700/, /09988/, /时间|时点/, /非.*建议|不.*买卖|待核验/]],
  ["travel-source-brief", "动车航班方案", "md", "计划2026年9月5日上午从上海到北京，1人，优先高铁，其次航班，预算1500元。请给核验方案；没有实时余票和价格时不要编造，列官方查询入口和订票前确认项。", [/上海/, /北京/, /2026.*9.*5/, /待核验|无法确认|实时/]],
  ["local-booking-brief", "酒店餐馆方案", "md", "2026年9月5日至7日在北京国贸附近住2晚，预算每晚800元以内，需要安静、步行到地铁。请给筛选和核验方案；没有实时房态时不要写成已订到。", [/国贸/, /800/, /房态|待核验/, /地铁/]],
  ["source-finder", "信息源核验", "md", "我们要核验一款AI应用是否真的支持离线运行。请设计来源优先级、取证步骤、可确认标准和无法确认时的降级结论。", [/来源/, /取证|步骤/, /标准|确认/, /降级|无法确认/]],
  ["operator-workflow", "任务工作台", "md", "为小丑鱼Windows上架建立执行工作台：目标9月10日前完成；已有可运行便携版；缺MSIX、隐私政策、商店素材、签名身份。团队3人。输出阶段、状态、负责人待确认项、证据、下一步和验收标准。", [/MSIX/, /隐私/, /状态/, /验收/]],
  ["presentation-builder", "演示文稿", "pptx", "制作8页《小丑鱼Windows上架计划》演示，听众是3人创始团队，10分钟。必须包含现状、用户价值、上架缺口、MSIX路线、隐私与安全、90天里程碑、风险、下一步。每页一个核心信息并写讲者备注。", [/Windows/, /MSIX|上架/, /风险/, /下一步/]],
  ["thinking-workbench", "思考工作台", "html", "我们应该先补在线连接器，还是先完成Windows上架？团队3人、预算10万元、6个月内不做云端多租户。请拆事实、假设、矛盾、选项、验证方式、决策信号和下一步。", [/事实/, /假设/, /选项|方案/, /决策|信号/]],
  ["product-design", "产品设计", "html", "设计小丑鱼首次启动流程。目标用户是不懂API的新手，但产品需要连接用户自己的模型服务。请给完整路径、页面状态、错误恢复、隐私提示、跳过策略和小屏适配，不要只画设置表单。", [/首次|启动/, /错误|失败/, /隐私/, /跳过/]],
  ["business-deal", "商务推进", "html", "我们要与一家20人设计工作室试点小丑鱼30天。对方关心本地数据、Word交付和响应时间；我方不能承诺零故障，也不能提供云端多租户。请形成试点方案、双方责任、验收、风险、报价变量和下一次沟通问题。", [/30天|30 天/, /责任/, /验收/, /零故障|风险/]],
  ["market-opportunity", "市场机会模拟", "html", "评估‘面向中国小团队的本地优先AI工作应用’机会。只能依据给定假设：团队3人、预算10万元、已有Windows原型、没有云端多租户。输出用户、替代方案、价值主张、商业约束、反证条件和低成本验证，不虚构市场规模。", [/用户/, /替代/, /反证|失效/, /验证/]],
  ["ability-builder", "生成新能力", "html", "设计一个可复用的‘Windows应用上架检查’能力：输入应用目录和目标商店；步骤包括版本、安装包、签名、隐私、商店物料、安全与干净机器验收；输出缺口报告和放行结论；任何发布和删除操作都必须确认。", [/输入/, /步骤/, /输出/, /确认|权限/]],
  ["workflow-builder", "流程搭建", "md", "搭建‘每次发布前质量验收’流程：输入版本和候选安装包；自动执行构建、测试、敏感信息扫描、安装升级卸载检查；人工复核隐私和商店物料；失败不得发布；输出回执、负责人和可恢复点。", [/输入/, /自动|构建|测试/, /人工/, /失败.*发布|不得发布/]],
];
const selectedIds = new Set((process.env.CLOWNFISH_CASES || "").split(",").map((item) => item.trim()).filter(Boolean));
const cases = selectedIds.size ? allCases.filter((item) => selectedIds.has(item[0])) : allCases;

async function api(path, options = {}) {
  const response = await fetch(baseUrl + path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data;
}

function assess(test, notification) {
  const reply = String(notification?.reply || "");
  const artifact = notification?.artifact;
  const inspectableFiles = [artifact?.file, artifact?.previewFile].filter((file) => typeof file === "string" && existsSync(file) && /\.(?:html?|md|txt|json)$/i.test(file));
  const inspectionText = [reply, artifact?.summary || "", ...inspectableFiles.map((file) => readFileSync(file, "utf8"))].join("\n");
  const missing = test[4].filter((pattern) => !pattern.test(inspectionText)).map(String);
  const leaks = [/system prompt/i, /Capability rules:/i, /内部交接合同/, /外部项目源码/].filter((pattern) => pattern.test(inspectionText)).map(String);
  const futurePromise = /(?:我会|我们会).{0,8}(?:稍后|明天|今晚|之后).{0,8}(?:完成|交付|发送)|(?:稍后|明天|今晚).{0,4}(?:为你|给你).{0,6}(?:完成|交付|发送)/.test(inspectionText);
  const sourceLeak = test[0] !== "market-briefing" && artifact?.verification?.cards?.some((card) => card.id === "market-briefing");
  const passed = Boolean(artifact?.file && artifact?.proof?.checks?.some((item) => item.status === "passed"))
    && missing.length === 0 && leaks.length === 0 && !futurePromise && !sourceLeak;
  return { passed, missing, leaks, futurePromise, sourceLeak, artifactId: artifact?.id, file: artifact?.file, proof: artifact?.proof?.level, replyLength: reply.length };
}

const results = [];
for (let index = 0; index < cases.length; index += 1) {
  const test = cases[index];
  const startedAt = Date.now();
  try {
    const data = await api("/api/capabilities/adhoc/run", {
      method: "POST",
      body: JSON.stringify({ title: `能力验收${String(index + 1).padStart(2, "0")}·${test[1]}`, personaId: "clownfish", capabilityId: test[0], instruction: `【能力真实质量验收】${test[3]}`, format: test[2] }),
    });
    const evaluation = assess(test, data.notification);
    results.push({ id: test[0], name: test[1], durationMs: Date.now() - startedAt, evaluation, notification: data.notification });
    console.log(`${evaluation.passed ? "PASS" : "ISSUE"} ${test[0]} ${Date.now() - startedAt}ms`);
  } catch (error) {
    results.push({ id: test[0], name: test[1], durationMs: Date.now() - startedAt, evaluation: { passed: false, error: error.message } });
    console.log(`FAIL ${test[0]} ${error.message}`);
  }
}

mkdirSync(outputDir, { recursive: true });
const jsonFile = join(outputDir, `capability-real-quality-${stamp}.json`);
const mdFile = join(outputDir, `capability-real-quality-${stamp}.md`);
writeFileSync(jsonFile, JSON.stringify({ checkedAt: new Date().toISOString(), baseUrl, results }, null, 2), "utf8");
const summary = results.map((item, index) => `| ${index + 1} | ${item.name} | ${item.evaluation.passed ? "通过" : "有问题"} | ${item.evaluation.error || item.evaluation.missing?.join("、") || (item.evaluation.sourceLeak ? "错误附加市场核验" : "需人工复核")} | ${item.evaluation.file || "-"} |`).join("\n");
writeFileSync(mdFile, `# 小丑鱼能力真实质量验收\n\n- 时间：${new Date().toISOString()}\n- 视角：普通办公用户、专业交付审阅者\n- 范围：${results.length} 项公开内置能力（开发项目另走真实项目语料）\n\n| # | 能力 | 自动门槛 | 问题 | 产物 |\n|---:|---|---|---|---|\n${summary}\n`, "utf8");
console.log(JSON.stringify({ total: results.length, passed: results.filter((item) => item.evaluation.passed).length, issues: results.filter((item) => !item.evaluation.passed).length, jsonFile, mdFile }));
