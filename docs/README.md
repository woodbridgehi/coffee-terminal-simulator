# 终端模拟器文档索引

文档基线：2026-09-17本地代码核对。[中文入口](../README.zh-CN.md) · [English](../README.md) · [云端文档](../../coffee-cloud-mvp/docs/README.md)

| 目的 | 当前文档 |
| --- | --- |
| 运行时、状态、SQLite和传输边界 | [DESIGN.md](../coffee-terminal/DESIGN.md) |
| 云端协议、本地接口与联调 | [API.md](../coffee-terminal/API.md) |
| 实例、配方、材料、历史版本 | [配置参考](../config/README.md) |
| 激活、软件配对、凭据轮换 | [ACTIVATION.md](../ACTIVATION.md) |
| 制作中断与现场核验 | [restart-recovery.md](restart-recovery.md) |
| Three.js工作站与构建 | [robot-scene.md](robot-scene.md) |
| UR10e双臂、夹持与拉花边界 | [ur-dual-arm-latte-art.md](ur-dual-arm-latte-art.md) |
| 工序音效 | [sound-effects.md](sound-effects.md) |
| 轮播管理入口 | [showcase.md](showcase.md) |
| 第三方展示包完整合同 | [showcase-partner-interface-v1.md](showcase-partner-interface-v1.md) |
| 城市菜单、版本归档、主动同步、联合交付 | [beijing-city-menu-and-sync.md](beijing-city-menu-and-sync.md) |
| Windows分发 | [打包说明](../packaging/windows/README.md) |
| Blender静态门店资源 | [资源工程说明](../art/coffee-shop/README.md) |
| 文档纠错与跨项目核对结果 | [核对记录](documentation-audit-2026-09-17.md) |

## 示例与历史

- [展示包示例](../examples/showcase/README.md)、[starter](../examples/showcase/starter/README.md)、[验收模板](../examples/showcase/ACCEPTANCE-TEMPLATE.md)
- [默认内容包](../coffee-terminal/web/showcase-packages/default/README.md)、[北京内容包交付记录](../coffee-terminal/web/showcase-packages/default/BEIJING-DELIVERY.md)
- [CHANGELOG](../CHANGELOG.md) 是历史变更，不是完整当前功能目录。

当前终端是计时执行＋运动学展示，没有CoppeliaSim、PyBullet、Gazebo或真实硬件驱动。迁移与硬件分层属于后续设计，不能当现有接口使用。旧专题中的测试计数、临时截图和部署结论只适用于各自日期。

## 2026-09-17 可靠性修复与发布

- [整改与回归证据](business-reliability-2026-09-17.md)
- [云端上线及终端源码同步记录](../../coffee-cloud-mvp/docs/releases/2026-09-17-business-reliability.md)：现场终端安装与重启不包含在 VPS 源码同步中。
