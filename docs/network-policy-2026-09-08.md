# 出站网络策略与沙箱现状（2026-09-08）

## 一、先纠正一个判断

上一轮把「声明式沙箱」整体列为待做，那个判断是错的：查了 `local-http-security.ts` 和插件清单里的粗粒度 `permissions` 数组就下了结论，漏掉了 [`src/agent/extensions.ts`](../sdk/typescript/src/agent/extensions.ts) 里已经存在的 `AgentExtensionSandbox`。

**已经做完并且真正强制执行的部分：**

| 机制 | 实现 |
| --- | --- |
| 声明式沙箱类型 | `AgentExtensionSandbox`：`node-permission` 或 `windows-appcontainer`，带 `network`、`filesystemRead[]`、`filesystemWrite[]` |
| 落到进程上 | [`mcp-client.ts`](../sdk/typescript/src/agent/mcp-client.ts) 拼 `--permission --allow-fs-read=… --allow-fs-write=… --allow-net`；AppContainer 走独立宿主进程 |
| 版本前置条件 | `network: "deny"` 要求 Node ≥ 25，否则直接拒绝启动而不是静默降级 |
| 声明一致性 | 清单校验交叉检查沙箱与 `permissions`：`network: deny` 与 `network` 权限冲突、`filesystemWrite` 必须配 `filesystem-write`、`deny` 不能配 HTTP 凭证代理 |
| 无沙箱可执行扩展 | `requiresUnsandboxedExecutionApproval` 判定后**默认阻止执行**，必须显式 `allowUnsandboxed` |
| 出站地址边界 | `local-http-security.ts`：DNS 钉住后按解析地址拦本机与私网，重定向每一跳都重新校验 |

所以本轮只做真正缺的那一段。

## 二、本轮补的：按主机的允许／拒绝名单

[`network-policy.ts`](../sdk/typescript/examples/companion/network-policy.ts)。

原有两道防护中间空着一块：地址级判断管的是"不许打到内网"，扩展沙箱的 `network` 只有 `deny | unrestricted` 两档，管的是"这个子进程能不能上网"。都没有回答**"允许上网，但只许访问这几个域名"**。

- **优先级明确为 `deny > allow > defaultAction`**。参考实现只列了「default_action + deny[] + allow[]」而没说谁先谁后；这里拒绝优先：允许 `*.example.com` 同时拒绝 `internal.example.com` 时，内网那台必须被挡住。允许优先会让一条宽泛规则盖掉精确的拒绝规则，这是名单类配置最常见的事故。
- **`*.example.com` 匹配子域但不匹配裸域**。想同时覆盖就把两条都写上；通配顺带匹配裸域会让人在只想放开子域时意外放开主站。
- **默认是放行 + 空名单**，即完全保持现状。默认拒绝会让所有网页读取在用户没配名单时立刻失效，而失效对用户表现为"网页读不出来"，排查不到原因。想要白名单的用户显式切到 `deny`。
- **只接受主机模式**，协议、端口、路径一律报错。允许写路径会给出错误的安全感：重定向、查询串和大小写变化都能绕过路径匹配。
- **不合法的模式报错而不是静默丢弃**。一条被悄悄忽略的拒绝规则，会让用户以为某个域名已经被挡住了。
- **判定时对模式也归一化一次**。`normalizeNetworkPolicy` 已经做过，但直接用字面量构造策略对象的调用方绕过了它；少了这一步，一条大小写不一致的拒绝规则会静默失效。这条是测试抓出来的。
- **IPv6 字面量不作为模式支持**，且拒绝时明确说明原因。压缩写法与 `::ffff:` 映射有多种等价形式，做半套匹配比不做更危险；本机与私网地址已由地址级判断覆盖，IPv4 字面量可以正常书写。

**策略在 DNS 解析之前生效**：被拒绝的域名如果仍被解析一次，就等于向那台 DNS 泄露了访问意图。这一点有测试钉住。

接口：`GET /api/network-policy`（返回策略、加载错误和作用范围说明）、`POST /api/network-policy`（先落盘再切换，写失败时仍按旧策略工作）。落盘文件被改坏时退回默认放行而不是默认拒绝——一份坏文件让所有网页读取静默失效，用户只会看到"读不出来"。坏文件的事实记在 `loadError` 里一并返回。

### 它管不到什么

被 spawn 出去的 MCP 子进程**不受这条策略约束**：Node 的 `--allow-net` 是全有全无，AppContainer 也不做按主机过滤。所以一条 `defaultAction: "deny"` 的策略不等于"整个应用只能访问名单内域名"，只等于"应用自己发起的网页读取只能访问名单内域名"。接口的 `scope` 字段把这句话直接返回给调用方，避免它被当成比实际更强的保证。

## 三、剩下的两项，以及为什么不是一行能改完的

### 1. 内置 Playwright MCP 没有声明沙箱 —— 已按「启动时提示一次」处理

**已做**（2026-09-08）：
- 判断"会不会无沙箱启动本机进程"改用 `spawnsUnsandboxedProcess`（`runtime.type === "mcp" && entry && !sandbox`），
  不再用 SDK 的 `requiresUnsandboxedExecutionApproval`——后者带 `source.type !== "builtin"` 总闸，
  对全部内置插件返回 `false`，拿它把门等于门永不关；
- `allowUnsandboxed` 由这次请求的用户确认决定，不再按插件 id 硬编码豁免；
- 安装确认文案改成说清后果："不在扩展沙箱内运行，对文件和网络的访问不受读写路径与网络策略限制"
  （原文案只说"启动隔离的 Chrome 进程"，那是在描述浏览器的隔离，不是扩展的沙箱）；
- **启动时提示一次**：`GET /api/unsandboxed-notice` + `unsandboxed-notice.js` 横幅，
  确认按「扩展 id + 版本」记录，升版重新提示；读不到确认记录时按未确认处理（多提示一次可接受，
  漏提示不可接受）。守卫测试钉住 8 个页面都挂了这个脚本——新增页面会静默漏掉提示。

**仍未做**：给它真正声明一个沙箱。原因不变（下文保留）。

### 1b. 为什么没有直接给它加沙箱

四个内置插件都没有 `runtime.sandbox`，其中只有 `browser.playwright` 会启动本机进程。

不能直接给它加一个 `node-permission` 沙箱：Playwright 要 spawn Chrome，而 Node 权限模型默认封掉
子进程，沙箱类型里也没有对应的放行位。加上放行位等于让权限模型对这个插件形同虚设。真正合适的是
Windows 平台走 `windows-appcontainer`（宿主进程已经实现），其他平台保留"无沙箱 + 明确告知"。

这需要能实际启动 AppContainer 宿主并拉起 Chrome 才能验证，本轮没有做，也不该在无法验证的情况下改。
在那之前，用户至少会在安装时看到真实后果、并在每次启动（每个版本一次）被提示一次。

### 2. 执行前后钩子

参考实现有 `beforeShellExecution` / `afterShellExecution` / `beforeMCPExecution` / `beforeReadFile` / `afterFileEdit` 等一整套钩子。小丑鱼目前没有钩子机制。

判断是价值相对低：那套钩子主要服务于"用户自己写脚本拦截 Agent 动作"，而小丑鱼的"写类工具执行前"这一段已经由持久化审批 + [工作准则](failure-registry-2026-09-08.md)覆盖。真正缺钩子的场景是审计外挂和企业策略注入，与当前的个人应用定位不匹配。建议等到有具体需求再做，而不是先把接口面铺开。

## 四、顺带修掉的一个每天定时失败的测试

`tests/integration/buzz-adoption.test.ts` 断言待处理队列恰好 3 条。但默认每日计划任务（09:10 北京时间）到点后会被调度器入队、执行完成并产生一条待送达记录，队列因此变成 4 条——**这个测试在每天 09:10 之前通过、之后失败**，CI 每天有十几个小时是红的。在改动之前的干净树上同样失败，与本轮无关。

改的是断言而不是产品行为：测试的意图是"我植入的三条出现在队列里，审批被决定后离开队列"，用总数断言等于让它被无关的后台活动挟持。现在按植入的 id 逐条断言，并额外钉住"uncertain 排在最前"和"重启不会让已决定的审批回到队列"。
