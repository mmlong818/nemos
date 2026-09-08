# 非 Windows 上存不了模型密钥（已知限制，2026-09-08）

## 事实

保存模型连接会落一份 `llm-key.dpapi.json`，密钥用当前用户的 DPAPI 加密。
DPAPI 的调用方式是 `execFileSync("powershell.exe", …)`（`server.ts` 的
`protectSecret` / `unprotectSecret`），因此**只有 Windows 有**。

在 Linux 与 macOS 上：

- `POST /api/llm-config` 返回 400，错误是 `spawnSync powershell.exe ENOENT`；
- 私有源连接器的令牌（`bearerCipher` / `refreshCipher` / `clientSecretCipher`）
  与语音、三维那几处的 `tokenCipher` / `passphraseCipher` 同理；
- 不保存密钥的功能（纯本地能力、已通过环境变量注入密钥的情况）不受影响。

README 写的是"Windows 优先支持…Linux 与 macOS 可运行网页界面"，以及"Windows 下密钥
使用当前用户的 DPAPI 加密"。**界面能开，但在非 Windows 上没有配置模型的路径**——这一句
README 没说，容易让人以为只是渲染和路径处理的差别。

## 为什么不顺手补一套

三个整合测试因此在非 Windows 上失败（CI 的 Linux 任务长期红着，与本轮改动无关：
在 `b133e0b` 上失败的是同样这三个）。现在按平台跳过，并写下这份文档。

**没有给非 Windows 造一套落盘加密**，理由：

1. 能顺手写出来的只有"用固定密钥或机器信息派生密钥加密"，那对拿到磁盘的人等于明文——
   比 DPAPI 弱一个量级，却看起来像"已加密"。给一个更弱的机制起一个同样的名字，
   是这类改动最常见的坑。
2. 真正对等的做法是接系统钥匙串（Linux 用 libsecret / Secret Service，macOS 用
   Keychain），那要引入原生依赖、处理无桌面会话的服务器环境、以及"钥匙串被锁定时怎么办"。
   这是一项功能，不是一个 CI 修复。
3. 是否要支持、以什么形态支持，取决于产品决定要不要把 Linux／macOS 从"能开界面"
   提到"能正常用"。这个决定还没做。

## 要动的话，前置条件

- 明确非 Windows 的落盘保护到底承诺什么（能挡同机其他用户？能挡拿到磁盘的人？），
  并让 `encryption` 字段如实记录用了哪种（现在恒为 `"windows-dpapi"`）；
- 钥匙串不可用时**拒绝保存并说清原因**，而不是退回明文；
- 把这三个测试的平台门去掉，改成按"当前平台有无可用的密钥存储"跳过；
- README 第 28 行那句关于跨平台的描述要一并改准。
