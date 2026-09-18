# 虚拟设备联调实施计划

目标：规划软件通过命令、查询与事件接口驱动独立虚拟设备；网页关闭不影响执行。沿用现有运动、碰撞、物料内核，保留原离线实验入口。

## 本轮交付

1. 统一设备描述：id、kind、model、capabilities、timing、motion/process、stock；运行状态与配置分离。
2. 支持 left/right、brewer、foamer、hot-water、cup-dispenser、lidder、ice-maker、syrup-pump。落杯器新增供杯库存、出口占用、卡杯与实际杯对象生成；封盖机消耗盖库存。
3. 命令以 sessionId + commandId 去重，参数不同重用 ID 返回冲突。明确 ACCEPTED/RUNNING/SUCCEEDED/FAILED/REJECTED/CANCELLED/EXPIRED；执行前期限与客户端等待超时分开。
4. 独立本机 HTTP + SSE 服务；仿真 Worker 维护唯一时钟与状态。实时、加速、手动单步三种模式。查询支持在状态消息丢失后找回结果。
5. 故障、断连、一次性丢确认/完成事件和延迟传感器。断连不等于设备停机，取消能力显式声明。
6. 设备联调页面：三维状态、设备选择、配置编辑、发命令、查询结果、故障与补料、时钟控制、配置导入导出。
7. 示例外部规划器通过同一 HTTP API 完成落杯和拿铁流程，不直接操纵仿真状态。

## 字段约定

- timing：ackDelayMs、startDelaySeconds、sensorDelaySeconds、warmupSeconds、durationSeconds、cooldownSeconds、cleanSeconds、resetSeconds；机械臂另有 graspSeconds/releaseSeconds。
- motion：六关节 limits（min/max/velocity/acceleration/jerk）。
- process：station、outputKg、inputs；定量命令按基准配方等比例计算原料与时间。
- stock：capacity、initial；用于杯和盖，运行剩余数单独记录。
- sensors：ready、cupPresent、gripperHasObject、headPosition、stockRemaining；含 observedAt、延迟与强制异常值。
- command：commandId、deviceId、action、parameters、startWithinSeconds；状态含开始/结束时间、原因与结果。

## 边界

本轮为单杯工作台、行为/协议仿真，不新增真实机器人驱动、连续液体或封盖力学。通信使用本机 HTTP/SSE；硬件协议以后由适配器接入。命令账本仅在当前服务进程内保存：重启/重置生成新 sessionId，旧 sessionId 被拒绝，避免把重启后的实例误认成原实例。配置可导出为文件后通过启动参数加载。

## 验收

- 正常制饮、卡杯、加工中断连、确认/完成通知丢失后的查询与重试。
- 重复命令不重复落杯/扣料，同 ID 异参冲突，过期未启动不执行，已启动不会因客户端超时重复执行。
- 设备库存、容量、占用、缺料、故障、复位和封盖退让联锁。
- 配置非法时保留旧配置；忙碌时禁止修改；关闭/刷新网页不重置服务状态。
- HTTP 集成测试、外部规划器完整流程、浏览器桌面/移动验证、原实验与现有测试回归。

## 实施记录（2026-09-17）

本轮七项交付已实现。自动测试共 100 项通过，无失败或跳过；其中设备运行时 7 项、HTTP 服务与外部规划器集成 3 项。独立断连场景完成 32 个接口任务；丢确认和丢完成事件场景通过查询原命令恢复。Chromium 桌面与移动页面验证覆盖落杯去重、修改配置、刷新保留状态、断连重连、卡杯复位和完整制饮。详细启动、字段与边界见 [device-lab.md](device-lab.md)。
