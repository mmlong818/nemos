# 模型与思考强度选择器

## 交互与视觉

沿用小丑鱼工作台现有字体、白色面板、青绿色选中态。收起显示型号、思考强度与展开箭头；打开后分为模型、思考强度、管理入口三部分。保留型号用途和真实连接检查状态，不以视觉选中态暗示工具可用。

支持方向键、Home/End、Enter/Space、Escape、Tab、外部点击关闭，使用 menu/group/menuitemradio 语义。弹层根据视口定位，考虑稳定滚动条占位，窄屏不挤压发送按钮。

## 真正生效的参数

- `reasoningEffort` 单独保存在当前会话配置，从下一条消息生效。自动不向模型提交覆盖值。
- 与旧 `reasoning` 字段的任务轮数/预算分离，不改变工具权限、不扩大预算。
- 前端 → 服务端校验 → 引擎上下文 → 对话/流式/能力执行 → 模型适配器；运行元数据及恢复上下文保留强度。
- Astra 的 Responses 请求使用 `reasoning.effort`；Terra/Luna 的现有 Chat Completions 请求使用 `reasoning_effort`。
- 官方文档核对于 2026-09-07：Astra 支持 low/medium/high/xhigh/max；Terra/Luna 还支持 none。未知服务商/型号不猜测支持情况，只提供自动。后端拒绝无效覆盖值，不静默声称已设置。
- 模型仍复用原检查、保存、失败回退流程。检查失败时显示简短详情，不把完整目录 JSON 放进状态栏。

官方参考：

- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://developers.openai.com/api/docs/models/gpt-5.6-terra
- https://developers.openai.com/api/docs/models/gpt-5.6-luna
- https://developers.openai.com/api/docs/guides/reasoning

## 验证与部署

- TypeScript 检查通过，JavaScript 语法检查通过。
- 45 项模型链路、Responses、记忆连续性、工作模式、目录和集成测试通过；后补 1 项前端请求强度与预算分离回归通过（相关用例共 46 项）。
- 真实隔离服务 + 本地合成模型验证普通/流式回复参数、auto 省略覆盖、非法档位在调用前被拒绝。
- 独立浏览器会话验证：强度切换不调用接口、刷新保持会话选择、模拟模型成功/失败与回退、键盘关闭恢复、桌面与 390px 弹层检查。模拟请求未进入正式模型服务。
- 经用户明确同意重启正式 8787 服务，进程从 39972 更新为 9656。使用原 C:\Users\Admin\.clownfish 数据目录，正式接口已返回 reasoningEfforts。
- 未发起真实付费模型调用，未改变模型默认配置；密钥文件 SHA256 与修改前一致。
- 当前三型号已有工具检查失败记录仍然保留；此工作不是工具兼容修复，也不宣称真实模型效果已验收。
