# Changelog

## Unreleased — VPS 在线验证

- `coffee-bot-002` 默认连接 `https://coffee-api.woodbridge.top`，心跳周期调整为 10 秒。
- 心跳增加 `messageId/bootId/sequence`，支持云端幂等和乱序识别。
- 增加环境变量/秘密文件配置覆盖和 `start-remote-002.command`，设备 Token 不进入 JSON 或 Git。
- 增加 headless 真实运行时入口，用于在线、离线、重连和故障注入自动验收。
- 使用稳定设备 User-Agent，修复 Cloudflare Error 1010 对 Python 默认客户端签名的拦截。
- pywebview 状态输出会移除设备 Token 和自定义请求头值。
- 增加一次性激活与崩溃安全的凭证轮换脚本；终端生成 Token，pending 文件支持幂等恢复，密钥不输出。
- 增加显式 `--resume-recovered` headless 选项，用于云端对账后恢复测试任务。
- 001 切换到云端 remote 模式并完成实际激活；补充多设备登记、错误激活码、pending 重试、标识不一致 404 和启动验证操作手册。
- 与云端 `0.3.0` 完成真实扫码订单闭环：设备专属动态二维码、实时能力/余量菜单、串行制作任务、手机进度状态和共享物料扣减已通过公网 E2E。

## v1.2.0 — 可靠性优化版

### 新增

- 每实例 `state/runtime.db`（SQLite WAL），持久化命令 Inbox、制作任务、命令游标、命令结果和事件 Outbox。
- 模拟任务重启恢复和 `task.recovered` 诊断事件；remote 模式恢复后暂停等待对账/继续命令。
- 非制作命令统一结果接口：`POST /api/v1/devices/{deviceId}/commands/{messageId}/result`。
- 健康与状态接口增加同步线程、最后成功/错误以及消息积压摘要。
- 网络错误、429/5xx 的带抖动指数退避；永久 4xx 死信隔离；409 幂等确认。

### 修复

- 相同 `taskId` 跨重启或更换 `messageId` 重投时不再重复制作。
- `CANCEL_TASK` 必须携带并匹配目标 `taskId`，避免迟到取消误伤新任务。
- `enabled=false` 配方在任务入口被拒绝。
- 步骤消耗键升级为 `taskId:stepId:attempt`，已耗料失败后的真实重试会再次扣料。
- 库存调整严格限制为 `ADD/SET`，不再把拼写错误当作 ADD。
- 畸形命令响应和单命令异常不再永久杀死云端工作线程。
- ACK、命令结果和事件在进程退出后仍可重试。

### 安全加固

- 本地 API 校验 Host；写接口要求 JSON、限制请求体并拒绝未授权 Origin。
- 支持 `localApi.authToken` / `X-Local-Token`；非回环绑定或 production 环境强制要求 Token。

### 已知边界

- 库存仍在 `inventory.json`，任务和消息在 SQLite，尚未形成跨两种存储的单一事务。
- 重启恢复只对模拟计时流程安全；真实硬件必须增加传感器、动作日志和 `RECOVERING/HOLD` 裁决。
- 一次性激活和 Bearer Token 轮换已实现；mTLS、命令签名、签名配置/OTA、硬件安全互锁尚未实现。
- 已发送消息的长期归档和磁盘水位策略仍待下一阶段实现。

## v1.1

- 饮品 SVG 动画优化，液面按进度变化。
- 修复动画生命周期和冰块旋转问题。

## v1.0

- 咖啡终端模拟器基线版本。
