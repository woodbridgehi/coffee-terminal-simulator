# 终端文档核对记录（2026-09-17）

本次对照本地运行时、SQLite、HTTP/MQTT、配方、展示包、Three.js及测试整改文档，完整跨项目证据与测试见 [双项目核对记录](../../coffee-cloud-mvp/docs/documentation-audit-2026-09-17.md)。没有修改业务代码或连接实体硬件；保留原有两个实例device.json修改。

## 文档落点

| 内容 | 处理 |
| --- | --- |
| README中英入口 | 精简导航，纠正SQLite、现有实例菜单与测试入口 |
| DESIGN | 重写实际模块、扣料时点、事务、取杯、恢复和投递边界 |
| API | 保留可用协议示例，删除虚构接口建议，更新错误码、状态、取杯、MQTT与联调说明 |
| config/README | 更新库存迁移、reload、配方历史、定制、实例复制与秘密边界 |
| ACTIVATION | 区分预登记激活与软件配对，避免复制示例身份或将错误凭证尝试当日常流程 |
| 三维、声音、展示、恢复、菜单专题 | 修正实际默认行为与已交付范围，旧测试日期保留历史语境 |
| CHANGELOG和专题旧交付记录 | 明确历史属性，不用旧计数代表当前状态 |

重点修正：库存权威为SQLite而非旧JSON；正常步骤完成才扣料；成品等待取杯确认；远程重启进入核验；MQTT内存入队后ACK仍存在落盘窗口；历史配方可用但不能绕过禁用校验；终端声音默认开启偏好不同于顾客页；Three.js是运动学展示，尚无CoppeliaSim/PyBullet/Gazebo或RS-485/IO硬件执行后端。

## 验证与未决项

- Python全套：92通过、8跳过、6个subtest通过。跳过项需要本地MQTT测试broker。
- Node全套：68通过、1失败。`tests/test_i18n.mjs` 检出 `onboarding.status.waitingDesc` 被后续语言注册覆盖为空；本次记录现状，没有修改测试或界面代码。
- `unittest discover`仅覆盖部分用例，README改为pytest入口；运行依赖锁未包含pytest/pytest-subtests，开发环境需单独准备。
- 检查Markdown本地文件链接与diff空白错误；未进行真实浏览器音频和设备现场测试。

从 [文档索引](README.md) 进入当前说明。未来硬件执行接口、物理仿真迁移与REST/事件中间层需要单独设计和验证，不把此前讨论的候选方案写成仓库现有能力。
