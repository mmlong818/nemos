# Nemos Memory v0.7 设计

状态：0.7.5-alpha.17 实现设计基线
适用版本：0.7.x
适用范围：Nemos 记忆核心。Companion 仅作为首个真实验收应用。

## 1. 背景

Nemos v0.6 已具备以下基础：

- 原始 `archival` 与派生记忆分离。
- `episodic`、`semantic`、`personal_semantic`、`procedural` 分层。
- SQLite 持久化、全文检索、向量检索和用户 namespace 隔离。
- 来源、置信度、敏感标记、事件时间、失效时间和纠正关系。
- 后台抽取队列、反思、领域演化、前瞻记忆和衰减模块。

v0.7 的主要工作不是增加更多记忆类型，而是把这些能力组成统一、可验证的生命周期。以下问题描述的是本轮实现要解决的基线，不代表当前版本仍全部缺失：

- 同步与异步写入执行不同的后处理。
- 反思进度不持久，无法证明一批事件只处理一次。
- 事实仍以自然语言片段为主，难以稳定判断“同一个属性发生了变化”。
- namespace、发言者、事实主体、所有权和可见范围存在概念混用。
- 检索以相关度为主，缺少查询规划、信任准入、时间解释和拒答门槛。
- 角色回复、工具结果和外部网页可能被错误地当作用户事实。
- 衰减使用统一规则，无法区分姓名、稳定偏好、一次事件和失败经验。

## 2. 设计目标

v0.7 要把 Nemos 从“记忆片段存储与检索库”提升为“有证据、有状态、有边界的长期记忆引擎”。

必须实现：

1. 所有写入模式经过同一生命周期。
2. 每条长期事实可追溯到原始证据。
3. 能区分当前事实、历史事实、争议事实和低置信推测。
4. 重启、失败重试和重复执行不会制造重复记忆。
5. 召回不仅考虑相似度，还考虑可见范围、时间、来源和任务适用性。
6. 多主体、多空间和项目记忆有正式的数据边界。
7. 用户可以纠正、停止召回、删除派生内容或彻底销毁本机数据。
8. 记忆质量可以通过固定评测持续衡量。

## 3. 非目标

v0.7 不做以下事情：

- 不用 Neo4j 等图数据库替换 SQLite。
- 不允许模型不受约束地修改核心人设或用户档案。
- 不把全部聊天、网页和工具输出自动升级为长期事实。
- 不把任务调度、文件产物和 Skills 本体塞进记忆表。
- 不以“看起来像人类记忆”为理由引入无法评测的复杂机制。
- 不承诺一次反思就能发现所有隐含关系。
- 不处理群聊建群、成员加入退出、历史披露和 onboarding；这些属于外部应用适配层，不作为 v0.7 核心验收条件。

## 4. 核心原则

### 4.1 证据与信念分离

原始消息、工具回执和外部资料是证据；关于用户、角色或世界的结论是信念。信念可以变化，证据默认保持原样。

### 4.2 当前事实是视图，不是覆盖

更新事实时追加新版本并失效旧版本。系统通过状态和有效时间计算“当前为真”，不直接覆盖历史。

### 4.3 宁可不召回，也不错误注入

低可信、越权、过期或与当前任务不适用的记忆不得因为向量相似而进入提示词。

### 4.4 热路径有固定上限

聊天请求只承担原始事件落库、必要的核心档案读取和有限召回。抽取、整合、完整实体扩展和领域演化默认在后台执行。

### 4.5 执行幂等与状态收敛

系统提供两层保证：

- 执行级幂等：同一个任务和阶段不会重复提交。
- 状态收敛：即使 LLM 对同一输入产生措辞或切分不同的候选，Reconcile 也必须依靠稳定事实身份、规范化值和来源集合合并等价结果。

`input_event_ids_hash + algorithm_version` 只解决执行去重，不能单独证明结果幂等。结果收敛的真正边界是：

`claim_key + canonical_object_hash + canonical_valid_time_range + canonical_source_set_hash`

其中来源 ID 必须排序去重后再计算 hash；时间边界统一到确定格式，并保留“未知精度”而不是补造时间。无法形成稳定 `claim_key` 的候选不得执行自动 SUPERSEDE，只能作为未结构化记忆保存或进入人工/后续反思队列。

### 4.6 本机优先

SQLite 是默认实现。所有新增能力必须能在单机、单进程和无独立数据库服务的环境运行。

## 5. 概念模型

### 5.1 Event：原始事件

Event 是记忆系统接收到的不可随意改写的证据。

典型来源：

- 用户消息
- 角色回复

- 工具调用与回执
- 用户导入的文档
- 外部网页或第三方数据
- 系统管理事件

Event 至少包含：

| 字段 | 含义 |
| --- | --- |
| `event_id` | 全局唯一标识 |
| `event_seq` | 空间内单调递增序号，作为处理和默认时序锚点 |
| `space_id` | 所属记忆空间 |
| `actor_id` | 谁产生了内容 |
| `actor_type` | user、agent、tool、external、system |
| `content` | 原始内容 |
| `content_type` | message、tool_result、document、image_text 等 |
| `occurred_at` | 事件实际发生时间 |
| `recorded_at` | 系统收到时间 |
| `trust_tier` | 来源信任等级 |
| `sensitive` | 是否敏感 |
| `metadata` | 会话、工具、文件、URL 等来源信息 |

现有 `archival` 继续承载 Event 内容。v0.7 不立即迁移全部旧数据，但新 API 统一使用 Event 语义。

### 5.2 Memory Space：记忆空间

Memory Space 替代仅靠字符串约定的 scope，定义数据归属和访问边界。

首批空间类型：

| 类型 | 用途 |
| --- | --- |
| `user_private` | 用户自己的长期记忆 |
| `agent_private` | 某角色的自我状态和承诺 |

| `project` | 项目或长期事务 |
| `system` | 只读策略、产品说明和全局规则 |

成员关系记录：

- `principal_id`
- `principal_type`
- `role`
- `joined_at`
- `left_at`
- `visible_from_event_seq`
- `can_write`
- `can_manage`

新成员默认不能直接检索加入前的完整历史，只能读取显式生成的 onboarding summary。管理员可以改变这一策略。

Memory Space 只定义存储和协作边界，不代替数据主体权利。任何记录还必须独立保存 `data_subject_ids`。只要内容描述用户本人，即使它位于 `agent_private`，用户仍拥有查看、纠正、forget 和 burn 的权利。

### 5.3 Core Profile：核心档案块

核心档案用于少量、稳定、每次都应可见的信息。

推荐内置块：

- `identity`：姓名、称呼、语言和时区
- `preferences`：稳定偏好
- `relationships`：重要人物与关系
- `constraints`：长期禁忌、边界和明确要求
- `agent_identity`：角色自己的稳定身份

每个块必须有：

- 明确用途描述
- 最大字符预算
- 当前版本
- 只读或可提议修改
- 修改来源
- 修改时间

模型只能提交修改提案。用户明确陈述可以自动确认低风险字段；身份、健康、财务、安全等高影响内容需要更严格规则。

### 5.4 Assertion：事实主张

`personal_semantic` 和部分 `semantic` 在 v0.7 中按 Assertion 管理。

建议增加：

| 字段 | 含义 |
| --- | --- |
| `claim_key` | 同一属性或关系的稳定键 |
| `claim_key_version` | claim key 格式版本 |
| `normalizer_version` | 归一化器版本 |
| `subject_id` | 事实描述的主体 |
| `predicate` | 属性或关系 |
| `object_json` | 结构化值，可保留文本值 |
| `valid_from` | 在现实中开始成立 |
| `valid_to` | 在现实中停止成立 |
| `recorded_at` | 系统何时记录 |
| `status` | active、superseded、invalidated、disputed、hidden |
| `confidence` | 数值置信度 |
| `trust_tier` | 来源信任等级 |
| `specificity` | global、contextual、temporary |
| `source_event_ids` | 直接证据 |

结构化字段允许为空。系统无法可靠提取结构时，仍可保存自然语言 Assertion，但不能执行强自动替换。

#### 5.4.1 claim_key 生成

`claim_key` 是事实槽位标识，值不得进入 key。例如：

- “住在福州”
- “搬到福州了”
- “现居福州”

都应解析为类似：

```text
v1|subject:user:self|predicate:residence.current|context:default
```

“福州”保存在 `object_json`，因此城市变化时仍命中同一事实槽位。上例是便于阅读的展示形式；实际存储使用稳定组件和确定性序列化：

```text
claim_key = ck:<version>:base32(sha256(canonical_json({ subject_id, predicate_id, context_dimensions })))
```

数据库同时保存 `subject_id`、`predicate_id` 和 `context_dimensions`，不能只保存不可解释的哈希。`context_dimensions` 只能来自 predicate registry 明确声明的维度，键排序、Unicode、空值和枚举编码固定；不得包含事实值、原始措辞、模型名称或抽取批次。

生成顺序：

1. 确定稳定 `subject_id`。
2. 使用受控 predicate registry 做规则和别名匹配。
3. 规则未命中时，在现有 predicate 候选中做语义匹配。
4. 仍无法确定时，LLM 只能选择候选 predicate 或提出 provisional predicate，不能直接编写 claim key。
5. 低于置信门槛的 provisional predicate 使用稳定 UUID，但禁止自动 SUPERSEDE。
6. context 仅在事实确实允许并存时进入 key，例如工作地与居住地、日常饮食与医疗饮食。

首批受控 predicate 应覆盖 Companion 高频事实：

- `identity.name`
- `identity.preferred_address`
- `residence.current`
- `employment.organization`
- `employment.role`
- `relationship.family`
- `preference.food`
- `preference.communication_style`
- `constraint.health`
- `constraint.safety`

predicate registry 包含稳定 ID、别名、适用主体、值类型、单值/多值规则和时间规则。抽取措辞变化不能改变 predicate ID。

`claim_key_version` 只在 key 格式发生变化时升级；`normalizer_version` 可以独立升级。归一化器升级不得原地重写旧 key，而是执行可审计 re-key job：

1. 生成旧 key 到新 key 的候选映射。
2. 对碰撞组重新 Reconcile。
3. 迁移期间双读新旧 key；当前事实视图必须先解析到 canonical key 再去重，禁止新旧 key 各自产生一个 active 版本。
4. 验证完成后记录 alias，旧 key 保持可追溯。

#### 5.4.2 最小主体解析

主体身份必须在 Commit 前确定，因此实体处理分成两层：

- Normalize 阶段执行最小身份解析：当前用户、当前角色、已授权主体、已知联系人和同空间别名。
- Commit 后的 Link 只做扩展实体、跨记忆关系和领域归属。

“我妈”“妈妈”“张阿姨”不能仅凭语义相似直接合并。解析结果分为：

- `resolved`：已有稳定主体。
- `provisional`：创建临时主体，禁止跨主体 SUPERSEDE。
- `ambiguous`：保留候选，不生成可自动更新的 claim key。

实体合并采用可撤销的 identity operation，不物理改写所有历史记录。`subject_id` 保持不可变，Reconcile 通过当前 identity cluster 的 canonical representative 判断是否同一主体。发现误合并时，系统可以失效 merge operation、重建 cluster，并对受影响 Assertion 重新 Reconcile；拆分不依赖批量改写历史行。

#### 5.4.3 object_json 规范化

状态收敛还依赖事实值的稳定比较。每个 predicate 在 registry 中定义 `value_schema`、规范化步骤和集合语义：

- 地名、组织名和联系人引用优先保存稳定实体 ID，同时保留展示文本。
- 日期、时区、货币、单位、电话号码和枚举转换为固定格式；不确定精度必须显式保存，不能伪造更精确的值。
- Unicode 采用 NFC，字符串只执行 predicate 允许的大小写、空白和标点规则。
- 数组只有在 schema 声明为集合时才排序去重；有序列表保持原顺序。
- LLM 只提交结构化候选，确定性 normalizer 与 schema validator 生成 `canonical_object` 和 `canonical_object_hash`。
- 原始表述继续保留在 Event 和证据字段中，规范化不得破坏原文。

等价性使用 `predicate_id + canonical_object_hash` 判断，不直接比较模型生成的说明文字。normalizer 变更必须升级 `normalizer_version`，通过重算、碰撞检查和状态收敛测试后才能切换当前视图。

### 5.5 Episode：情景记忆

Episode 保存“发生过什么”，必须保留：

- 参与者
- 发生时间
- 所属会话或任务
- 结果
- 关联事件
- 情绪或重要性信号

Episode 不自动等于长期事实。例如“用户今天不想吃辣”是一次情景；只有多次出现或用户明确表达，才可能升级为稳定偏好。

### 5.6 Procedure：程序性记忆

Procedure 保存“怎样做更有效”，结构至少包括：

- `trigger`：什么情况下使用
- `steps`：执行步骤
- `success_criteria`：怎样算成功
- `constraints`：限制和风险
- `evidence_episode_ids`：经验来源
- `success_count` / `failure_count`
- `status`：candidate、active、deprecated

一次模型回复不能直接成为 active Procedure。至少需要用户明确指定、成功执行证据或多次一致经验。

## 6. 来源与信任

trust tier 是冲突裁决的先验信号，不是真实性的最终判决。默认顺序：

1. 用户当前明确陈述或确认
2. 用户维护的结构化资料
3. 已验证的工具回执
4. 用户历史陈述
5. 角色自身承诺或行为记录
6. 模型推断
7. 外部网页、邮件、聊天转发和第三方内容

Normalize 必须同时判断 `utterance_mode`：

- `literal`：当前现实陈述
- `roleplay`：角色扮演或剧情设定
- `hypothetical`：假设和条件表达
- `quoted`：引用他人或外部内容
- `joke`：明显玩笑或夸张
- `uncertain`：无法可靠判断

只有 `literal` 默认有资格升级为稳定用户事实。角色扮演状态由会话 scenario、用户显式开场和邻近轮次共同限定；“我是吸血鬼公爵”在角色扮演会话中只能进入该情景 Episode，不能进入用户 Core Profile。识别置信不足时使用 `uncertain`，不做破坏性更新。

关键规则：

- 角色回复不得自动改写用户事实。
- 外部内容不得自动进入 Core Profile。
- 网页中的指令不得成为 Procedure。
- 工具回执可以证明“动作发生”，不能自动证明其内容永久正确。
- 模型推断必须标记为 derived，且默认低于用户直接陈述。
- 两条同为用户明确陈述且信任相同的单值事实，按有效时间和 `event_seq` 裁决，不按抽取完成顺序裁决。

## 7. 统一写入生命周期

所有 `ingest()`、后台队列、批量导入和直接结构化写入统一经过以下阶段：

1. **Accept**
   - 校验调用者、空间权限和输入类型。
   - 生成 `event_id` 和 `idempotency_key`。

2. **Append**
   - 原子写入 Event。
   - 在同一 SQLite 事务内通过空间计数器分配 `event_seq`，并以 `(space_id, event_seq)` 唯一约束防止重复和倒退。
   - 返回写入确认，不等待 LLM。

3. **Extract**
   - 根据来源类型选择抽取器。
   - 产生 Assertion、Episode、Procedure Candidate 和实体候选。

4. **Normalize**
   - 在 Commit 前完成最小主体解析，再统一时间、称谓、claim key 和结构化值。
   - 判断 utterance mode 和事实适用范围。
   - 无法确定时保留文本，禁止编造和破坏性更新。

5. **Validate**
   - 应用来源信任、权限、敏感信息和层级约束。
   - 阻止 agent/external 内容升级为用户权威事实。

6. **Reconcile**
   - 精确键匹配优先，语义候选作为补充。
   - 输出 ADD、CONFIRM、SUPERSEDE、DISPUTE、IGNORE。

7. **Commit**
   - 新记忆、来源边和旧事实状态在同一事务提交。

8. **Link**
   - 异步补充非关键实体、领域和关联边。
   - 身份归并发生变化时提交可撤销 identity operation，并安排受影响事实重新 Reconcile；Link 不负责首次确定 Assertion 主体。

9. **Schedule**
   - 根据触发信号安排反思，不在请求路径直接运行大型反思。

10. **Observe**
    - 记录阶段耗时、模型调用、产物数量、失败原因和重试状态。

同步和异步模式只能影响“调用者是否等待完成”，不能改变生命周期步骤。

## 8. 事实更新与冲突

### 8.1 更新操作

系统内部只允许以下操作：

| 操作 | 含义 |
| --- | --- |
| `ADD` | 新事实，没有可合并对象 |
| `CONFIRM` | 新证据支持现有事实 |
| `SUPERSEDE` | 新事实取代旧事实 |
| `INVALIDATE` | 旧事实被证明错误 |
| `DISPUTE` | 多个来源冲突，暂不能判定 |
| `RESOLVE_DISPUTE` | 依据新证据或用户裁决结束争议 |
| `MERGE` | 两条等价事实合并来源 |
| `IGNORE` | 不值得长期保存或重复输入 |

### 8.2 决策顺序

1. 使用相同 `claim_key` 聚合同一事实槽位；无 key 的旧事实进入受限语义候选通道。
2. 检查来源是否有权更新该主体和空间。
3. 确定有效时间：显式 `valid_from/occurred_at` 优先；没有明确现实时间时，同来源按 `event_seq` 排序。
4. 时间范围不重叠时保留为历史版本，不执行互相覆盖。
5. 时间范围重叠时比较规范化值和来源信任。
6. 同为用户明确 literal 陈述、同信任且属于单值 predicate 时，较新的有效时间或 `event_seq` 成为当前事实。
7. 无法安全判定新旧关系时进入 DISPUTE，不猜测赢家。
8. 必要时调用 LLM 判断，但 LLM 只能在确定的主体、predicate 和候选集合内选择。

抽取任务的领取时间、LLM 返回时间和 Commit 到达顺序不得参与事实新旧裁决。较早 Event 即使晚完成，也只能补充历史或证据，不能覆盖有效时间更晚的当前事实。SQLite 提交时对同一 `claim_key` 使用事务内当前版本检查，避免并发任务同时成为 active。

### 8.3 时间语义

必须同时保留：

- 现实时间：事实何时成立。
- 系统时间：系统何时知道。

“我去年住在上海，现在住在福州”应产生两个有时间边界的事实，而不是把上海视为抽取错误。

### 8.4 不确定性

“可能”“考虑”“如果”“听说”等表达不得升级为确定事实。无法判定的冲突进入 `disputed`，默认不注入普通回答，但可在用户询问历史或冲突时返回。

### 8.5 DISPUTE 退出机制

DISPUTE 是一个待裁决集合，不是永久终态。以下事件必须触发重新裁决：

- 新的更高信任证据到达。
- 用户通过 `correct()` 明确选择、补充或否定事实。
- 争议来源被 burn、失效或降低信任。
- 主体归并被撤销或重新解析。
- 用户显式要求重新检查。

裁决结果记录 `RESOLVE_DISPUTE` operation，并保留所有历史候选。时间本身不会让系统自动猜一个赢家；长期无新证据的争议可以降温，但不能静默变成 active。

### 8.6 correct() 与派生传播

`correct()` 先追加一条用户纠正 Event，再产生明确的 memory operation。系统沿 provenance edge 反向查找所有依赖项：

1. 立即把受影响的摘要、Procedure、Profile Patch 和反思产物标记为 `stale` 或 `tainted`，停止普通召回。
2. 对仍有独立有效来源的产物重新计算置信度。
3. 对内容受影响的产物安排重新生成。
4. 无剩余来源或无法安全局部修复的产物删除或失效。
5. 已经导出的文档和历史聊天不被静默改写，但其来源记录标注“依据已被纠正”。

因此 provenance 不只是解释字段，也是纠正和 burn 的依赖图。

## 9. 反思与整合

### 9.1 反思输入

反思只读取尚未处理的 Event/Episode 范围，由持久化 cursor 决定。不得用“取最近 N 条”代替处理进度。

新增 `nemos_reflection_state`：

- `tenant_id`
- `space_id`
- `last_event_seq`
- `last_run_at`
- `algorithm_version`
- `lease_owner`
- `lease_until`
- `last_error`

每个任务记录 `input_event_ids_hash + algorithm_version`，作为执行级幂等键。任务重复运行时，最终仍需通过 claim identity 和规范化值实现状态收敛。

反思递归使用固定代数边界：

- 原始 Event 为 generation 0。
- 直接抽取的 Assertion/Episode 为 generation 1。
- 反思摘要、稳定规律和 Procedure Candidate 为 generation 2。
- 自动反思 cursor 只覆盖 Event 流，并可读取与这些 Event 直接关联的 generation 1 Episode。
- generation 2 不得重新进入常规反思输入；只有来源纠正或 burn 才能触发定向重建。
- Lifecycle Validator 拒绝自动生成 generation > 2 的记忆。

### 9.2 触发信号

反思由多信号触发：

- 未处理 Episode 数量达到阈值
- 未处理文本量达到阈值
- 出现事实冲突
- 会话或任务结束
- 主题显著切换
- 距离上次反思超过时间阈值
- 用户显式要求整理

### 9.3 反思产物

反思可以：

- 生成会话或主题摘要
- 将重复 Episode 提升为稳定 Assertion
- 合并等价事实的来源
- 生成 Procedure Candidate
- 建立领域和实体关系
- 提出 Core Profile 修改建议

反思不能：

- 修改原始 Event
- 绕过来源和权限验证
- 直接把外部资料升级为用户偏好
- 无来源地产生稳定事实
- 反复整合自己的产物造成递归膨胀

上述限制由 generation 和输入 cursor 强制执行，不依赖提示词要求模型自觉遵守。

## 10. 召回管线

### 10.1 Query Plan

召回前先生成轻量查询计划：

- 需要哪些记忆类型
- 涉及哪些主体、时间、项目或记忆空间
- 是询问当前事实、历史事实、经验还是方法
- 是否允许敏感记忆
- 最大上下文预算

查询计划应优先使用规则和结构化解析，只有复杂查询才调用 LLM。

### 10.2 候选生成

并行候选通道：

- FTS/BM25 关键词召回
- embedding 语义召回
- claim key 精确召回
- 实体关联召回
- 时间范围召回
- related/domain 扩散
- 最近会话窗口

### 10.3 准入过滤

候选进入排序前必须检查：

- Memory Space 可见权限
- 调用主体对 Memory Space 和来源 Event 的读取权限
- `status` 是否允许当前查询使用
- 是否已过有效时间
- 来源是否适用于当前任务
- 敏感内容是否获得许可
- 外部内容是否包含持久化指令

#### 10.3.1 派生记忆可见性与 onboarding

每条派生记忆必须保存完整 `source_event_ids` 和 `visibility_policy`。默认策略是来源权限交集：调用者只有在有权读取全部来源 Event 时，才能读取该派生内容。仅依靠派生内容自己的 `created_at` 或 `valid_from` 不足以授予权限。

因此，基于成员加入前群聊生成的 Assertion 或主题摘要，对新成员默认不可见，即使它在成员加入后才完成反思。`visible_from_event_seq` 适用于原始流，派生内容必须回查来源权限。

onboarding summary 是显式披露操作，不是普通反思摘要：

1. 管理员或群策略确定可披露主题和目标成员。
2. 生成器只读取允许披露的群 Event，默认排除敏感、私聊来源和成员明确限制的内容。
3. 每个摘要事实经过权限过滤后再合成，不允许先合成全文再做关键词脱敏。
4. 摘要作为加入后的新 disclosure Event 写入，记录目标 audience、来源 Event、披露策略和操作者。
5. 新成员只能读取这条披露 Event，不能沿 provenance 反向读取无权访问的原文。
6. 后续 burn 或纠正来源时，该 summary 立即 taint 并重新生成或删除。

隔离指标中的“加入前历史越权”指未获显式披露授权的原始或派生内容。经过上述流程授权的 onboarding 不计为越权，但其中任何未授权或敏感信息仍计为泄漏。

### 10.4 融合与排序

默认使用 RRF 融合多个候选列表，再进行二次排序。排序信号包括：

- 语义相关度
- 关键词相关度
- 实体匹配
- 时间匹配
- 当前有效性
- 来源信任
- 置信度
- 重要性
- 重复惩罚
- 结果多样性

不得让“访问次数多”直接等同于“更真实”。

### 10.5 上下文组装

上下文按以下顺序组装：

1. 受限长度的 Core Profile
2. 当前有效的关键事实
3. 与问题相关的 Episode
4. 适用的 Procedure
5. 必要的历史或争议信息

每个注入项保留内部引用：

- memory id
- 来源 event id
- 时间
- 状态
- 召回原因

默认不给模型展示内部编号，但保留 Recall Trace 用于调试和评测。

### 10.6 拒绝错误召回

当最高候选仍低于准入门槛时，返回空记忆包。系统必须能够回答“没有可靠记忆”，而不是用低相关内容填满上下文。

### 10.7 热路径预算

首个发布门槛以 Windows 桌面参考机、单进程 SQLite、10 万条派生记忆为基准：

- Event 本机落库 P95 不高于 50ms。
- 规则式 Query Plan P95 不高于 10ms。
- 各候选通道最多返回 50 条，融合前去重后最多保留 200 条。
- 本地候选生成、准入、融合与组装总 P95 不高于 180ms，300ms 到时返回已有安全结果。
- 最终普通记忆包最多 12 项、1800 tokens，其中 Core Profile 默认不超过 600 tokens。
- 普通聊天的 LLM Query Plan 调用率不高于 5%，每次最多一调用、800ms 超时，失败后退回规则计划。
- 热路径不使用 LLM 做逐条 rerank；需要 LLM 的复杂多跳检索进入显式慢路径。

100 万条规模单独报告延迟和降级结果，不用放宽 10 万条发布门槛。所有预算都要在测试报告中写明硬件、数据量、命中通道和是否发生降级。

## 11. 衰减与遗忘

统一 FSRS 规则不适合所有类型。v0.7 按类别定义策略：

| 类型 | 默认策略 |
| --- | --- |
| Core Profile | 不自动衰减，版本化更新 |
| 当前稳定事实 | 不因未访问而失效，只降低召回优先级 |
| 临时事实 | 到期后退出当前事实视图 |
| Episode | 随时间降低普通查询权重，历史查询仍可找回 |
| Procedure | 根据成功、失败和最近验证调整状态 |
| 外部资料 | 按来源时效和抓取时间降权 |

用户操作语义：

- `hide`：不再自动召回，数据仍保留。
- `invalidate`：标记内容不再为真。
- `cool`：降低普通召回优先级。
- `forget`：删除派生记忆及索引。
- `burn`：销毁原始证据及其派生链。

`archival` 的正常操作仍保持追加不可改，但用户主权下必须提供 `burn`。

### 11.1 burn 的派生传播

burn 一个 Event 时按来源图处理：

1. 删除该 Event 与派生内容之间的 provenance edge。
2. Assertion 仍有独立有效来源时保留，但重新计算置信度和信任；没有来源时删除或失效。
3. 混合多个 Event 的摘要不能假装完成可靠局部删改，应立即标记 `tainted`、停止召回，并从剩余授权来源重新生成；无法重建时删除。
4. Procedure、Core Profile Patch、领域摘要和其他复合产物使用同样规则。
5. 反向依赖遍历和删除操作写入审计日志，但日志不得保留被 burn 的原文或可逆摘要。

用户对自身数据的 burn 权限跨越 Memory Space。位于 `agent_private`、但 `data_subject_ids` 包含该用户的观察和推断同样必须进入传播范围；纯角色身份和与用户无关的自我状态不受影响。

### 11.2 SQLite 物理清理

应用控制范围内的 burn 不能只执行 SQL DELETE。完成条件至少包括：

1. 在事务中删除 Event、无来源派生内容、FTS、embedding、队列载荷、召回 trace 和可恢复缓存。
2. burn 期间启用 `PRAGMA secure_delete=ON`。
3. 提交后执行 `PRAGMA wal_checkpoint(TRUNCATE)`，清理 WAL 中的旧页。
4. 在可获得独占锁时执行 `VACUUM`，或生成清理后的新数据库并原子替换旧文件。
5. 检查应用管理的备份，按用户选择同步销毁或明确列出仍存在的副本。

`BurnResult` 必须报告逻辑删除、SQLite 页清理、WAL 清理、备份处理和失败项。系统不能声称控制 Windows 还原点、第三方备份、SSD 固件磨损均衡或用户自行复制的文件；这些限制必须对用户透明。整库重置优先采用关闭数据库、删除应用控制的 DB/WAL/SHM/备份并创建新库。

## 12. 后台任务可靠性

队列增加：

- `stage`
- `next_attempt_at`
- `idempotency_key`
- `lease_owner`
- `lease_until`
- `algorithm_version`
- `input_cursor`

要求：

- 失败任务在 `next_attempt_at` 前不可被领取。
- 每个阶段可以安全重试。
- 进程崩溃后过期 lease 可以恢复。
- 同一空间同一反思区间只能有一个任务。
- 更换模型配置时，旧 worker 必须先停止领取并完成在途事务。

## 13. 公开 API 与实现约定

现有 API 保留兼容层，新增以下高层接口：

```ts
memory.appendEvent(input): Promise<EventReceipt>
memory.waitForLifecycle(eventId): Promise<LifecycleResult>
memory.recall(query, options): Promise<MemoryPacket>
memory.explainRecall(traceId): Promise<RecallTrace>

memory.getProfile(spaceId): Promise<ProfileBlock[]>
memory.proposeProfilePatch(input): Promise<ProfilePatch>
memory.confirmProfilePatch(patchId): Promise<void>

memory.correct(memoryId, correction): Promise<MemoryOperation>
memory.resolveDispute(disputeId, resolution): Promise<MemoryOperation>
memory.hide(memoryId): Promise<void>
memory.forget(memoryId): Promise<void>
memory.burn(target): Promise<BurnResult>

memory.reflect(spaceId, options): Promise<ReflectionResult>

memory.mergeIdentity(input): Promise<IdentityOperation>
memory.splitIdentity(operationId): Promise<IdentityOperation>
memory.getLifecycleStatus(eventId): Promise<LifecycleStatus>
```

旧接口映射：

- `ingest()` → `appendEvent()`，默认返回兼容的 archival/handle。
- `search()` → 保留底层搜索语义。
- `getRelevantContext()` → 基于 `recall()` 组装文本。
- `runReflect()` → 调用新的持久化反思任务。

## 14. SQLite 演进方案

v0.7 优先增加辅助表，不立即合并现有五张 layer 表：

- `nemos_spaces`
- `nemos_space_members`
- `nemos_profile_blocks`
- `nemos_event_metadata`
- `nemos_predicates`
- `nemos_predicate_aliases`
- `nemos_identities`
- `nemos_identity_operations`
- `nemos_claim_index`
- `nemos_claim_key_aliases`
- `nemos_provenance_edges`

- `nemos_memory_operations`
- `nemos_reflection_state`
- `nemos_recall_traces`

现有 memory 表增加或映射：

- `space_id`
- `data_subject_ids`
- `subject_id`
- `claim_key`
- `claim_key_version`
- `normalizer_version`
- `predicate`
- `object_json`
- `trust_tier`
- `utterance_mode`
- `specificity`
- `generation`
- `visibility_policy`

迁移原则：

1. 旧 `user_id + scope` 确定性映射到 Memory Space。
2. 无法结构化的旧事实保留文本，不强制补造 predicate。
3. 旧 `archival_ref` 转成 provenance edge。
4. 旧失效字段保持原义。
5. 迁移可重复执行，且新版本仍能读取旧数据库。

旧文本事实不能形成永久双轨。处理策略：

- 标记为 `legacy_unstructured`，继续参与普通检索，但在结构化当前事实之后排序。
- 新结构化 Assertion 到达时，Reconcile 除 claim key 精确通道外，还要检索可能冲突的旧文本事实。
- 只有主体、语义和来源证据都达到门槛时，才允许新事实 SUPERSEDE 旧文本事实，并记录 migration operation。
- 无法安全判断时保留旧事实但进入 DISPUTE，不能让两个冲突版本同时作为当前事实注入。
- 后台 lazy backfill 可以依据原始 Event 补结构，但低置信结果不得强行生成 predicate。
- claim key 迁移和 legacy 退场必须进入知识更新与旧数据升级评测。

## 15. 评测体系

### 15.1 正确性

- 原文保存正确率
- 事实抽取精确率和召回率
- 更新后旧事实误用率
- 乱序完成导致的当前事实错误率，必须为 0
- 重复事实率
- 反思执行幂等率与结果收敛率
- correct/burn 后派生内容残留率
- DISPUTE 平均存续时间和无退出原因积压数
- 无答案时错误召回率

### 15.2 召回

- Recall@K
- MRR
- nDCG
- 当前事实命中率
- 时间问题命中率
- 多会话证据覆盖率
- 注入 token 数

### 15.3 隔离

- 跨用户泄漏率必须为 0
- 跨角色私有记忆泄漏率必须为 0
- 派生内容绕过来源权限的泄漏率必须为 0
- 敏感记忆无授权召回率必须为 0
- 用户 burn 后 agent_private 中用户相关数据残留率必须为 0

### 15.4 运行质量

- Event 落库 P95
- 后台生命周期完成 P95
- 每事件平均 LLM 调用和 token
- 队列失败率和恢复率
- 10 万、100 万记忆规模下的召回延迟

### 15.5 测试集

首批测试集：

- LongMemEval：信息提取、跨会话推理、时间推理、知识更新、拒答
- LoCoMo：长期会话、事件总结、多跳和时间关系
- Nemos 中文真实集：
  - 称呼和偏好变化
  - 城市、工作、关系等属性替换
  - 角色一对一隔离
  - 用户、角色和项目空间隔离
  - 工具结果与用户陈述冲突
  - 网页提示注入不得污染长期记忆
  - 重启、重试和重复任务

公开 benchmark 的总分不能单独作为发布依据。必须同时报告检索质量、最终回答质量、token、延迟和错误召回。

### 15.6 风险与回归用例映射

| 风险 | 必须加入的回归用例 | 发布门槛 |
| --- | --- | --- |
| claim key 不稳定 | “住在/搬到/现居”及中英文改写落同一槽位 | 同义改写 key 一致率 100% |
| normalizer 升级 | v1 key 数据升级到 v2，碰撞组重裁决并可回滚 | 无双 active、无丢失来源 |
| 主体别名 | “我妈/妈妈/张阿姨”可确认归并，也可撤销误合并 | 误合并撤销后跨主体覆盖为 0 |
| LLM 非确定性 | 同一 Event 用不同抽取措辞和粒度重复执行 | 最终 active 事实集合一致 |
| 异步乱序 | 新城市 Event 先完成、旧城市 Event 后完成 | 旧事实不得覆盖新事实 |
| 多来源 burn | 一个事实有两条来源，burn 其中一条 | 事实保留且来源/置信正确 |
| 混合摘要 burn | 摘要依赖十条 Event，burn 其中一条 | 旧摘要立即停用并正确重建 |
| SQLite 物理 burn | 主库、FTS、embedding、WAL、应用备份检查 | BurnResult 无未报告残留 |
| DISPUTE 退出 | 新高信任证据、用户裁决、来源 burn 三种解除 | 无不可解释永久 disputed |
| 派生权限继承 | 摘要混合可见与不可见来源 | 不得通过摘要获得受限事实 |
| 角色扮演污染 | 剧情中“我是吸血鬼公爵”与现实身份陈述混合 | Core Profile 污染为 0 |
| 同信任冲突 | 用户先后给出两个现居城市 | 按有效时间/event_seq 取当前值 |
| correct 传播 | 纠正底层事实后检查摘要、Procedure、Profile | 旧派生内容普通召回残留为 0 |
| 热路径预算 | 10 万条数据下普通、时间、实体和空命中查询 | 满足 10.7 全部 P95 门槛 |
| 反思递归 | 多轮反思和进程重启 | generation 不超过 2 |
| legacy 双轨 | 旧文本城市事实遇到新结构化城市事实 | 不同时注入冲突当前值 |
| agent_private 主权 | burn 用户本人后扫描全部角色私有空间 | 用户相关残留为 0 |

风险清单与测试集必须同构。新增高风险设计变更时，同一个提交必须增加对应测试描述或解释为何不适用。

## 16. 实施状态（0.7.5-alpha.17）

本文最初按 0.7.0—0.7.4 分阶段设计。到 2026-08-06，仓库代码已经实现以下主链路：

- 同步与后台写入共用 `LifecycleOrchestrator`，并持久化 `event_seq`、阶段状态、幂等键、反思游标和 lease。
- 结构化 claim、来源、信任级别、话语模式、时间裁决、冲突状态和纠正传播已接入写入链路。
- 召回已具备 Query Plan、关键词/向量/实体/时间等多路候选、融合排序、可靠性判断和 Recall Trace。
- Memory Space、主体解析、用户命名空间与角色私有空间已进入当前接口和测试。
- reflect、分类衰减、procedural 召回与派生 generation 上限已实现。

这表示“核心链路已经实现”，不表示本设计中的每项完成标准都已满足。尤其不能把文档目标自动解释为已经通过的性能或隐私证明。

## 17. 外部参考及取舍

- Graphiti：采用 episode、来源、时间有效性和增量失效思想；暂不采用独立图数据库。
- Letta：采用小规模常驻 Core Profile；不允许模型无约束自改。
- LangMem：采用 semantic、episodic、procedural 分工，以及 profile/collection 区分。
- Mem0：采用低成本抽取和多信号召回；不采用仅追加且缺少历史更新语义的简化方式。
- LongMemEval、LoCoMo：采用能力分类和公开数据；不盲信单一 LLM judge 总分。

参考：

- https://github.com/getzep/graphiti
- https://docs.letta.com/guides/core-concepts/memory/memory-blocks
- https://langchain-ai.github.io/langmem/concepts/conceptual_guide/
- https://mem0.ai/research
- https://xiaowu0162.github.io/long-mem-eval/
- https://github.com/snap-research/locomo

## 18. 尚未闭环的边界

- `burn` 的物理清理、WAL/VACUUM 处理、应用备份传播和可核验报告尚未形成完整公开接口；当前代码中的 `forget` 不等于物理删除。
- 10 万/100 万条数据的固定硬件基准与正文 P95 目标尚无仓库内报告，不能声称已达到规模指标。
- predicate 的完整 value schema、主体别名治理和可撤销 merge/split 仍需继续收敛。
- Core Profile 的产品级编辑、权限继承可视化和恢复流程主要属于应用层，SDK 只提供底层原语。
- CHANGELOG 记录的完整 LongMemEval 分数缺少仓库内原始产物，不能作为可复现发布门槛。

## 19. 文档使用规则

- 本文是 0.7.x 的设计基线；当前公开接口以 `src/types.ts`、`src/index.ts` 和 SDK README 为准。
- “完成标准”是验证要求，不是完成声明。只有存在代码、测试或结果产物时才标为已实现。
- 论文与 benchmark 使用冻结版本和独立 manifest，不随 SDK 版本自动更新。
- 新的高风险设计变更必须同时补充对应测试或说明为何不适用。
