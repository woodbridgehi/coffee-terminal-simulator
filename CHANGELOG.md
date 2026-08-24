# Changelog

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
- 设备激活、mTLS、命令签名、签名配置/OTA、硬件安全互锁尚未实现。
- 已发送消息的长期归档和磁盘水位策略仍待下一阶段实现。

## v1.1

- 饮品 SVG 动画优化，液面按进度变化。
- 修复动画生命周期和冰块旋转问题。

## v1.0

- 咖啡终端模拟器基线版本。
