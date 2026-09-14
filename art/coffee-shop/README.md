# Blender 门店资源（第一阶段）

`coffee-shop.blend` 是可在 Blender 中打开的静态门店工程；`scripts/build_shop_blender.py` 是可重复生成的源脚本。全部几何与材质由本项目生成，无第三方模型或贴图依赖。

本阶段替换地板、后墙、侧墙、侧边木台、两张高脚凳、两张休闲凳和圆桌。品牌 SVG、格栅、窗框、植物、工作台及机械臂仍由原 Three.js 代码生成。未更改设备位置、运动学、订单协议和业务状态。

## 重建

在 coffee-terminal-simulator 目录执行：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --threads 6 --python scripts/build_shop_blender.py
npm run sync:cloud-scene
npm test
```

已使用 Blender 5.2.1 LTS / Cycles CPU 24 samples 烘焙。脚本会覆盖本目录的工程和贴图；手工修改前另存工程，或将修改写入脚本再重建。运行应用无需安装 Blender。

## 资产约定

- Three.js 坐标以米为单位，Y 向上；脚本映射到 Blender `(x,-z,y)`，GLB 导出恢复 Y 向上。
- 共 13,492 三角形、5 个材质、3 张 1024×1024 图，GLB 2,935,652 字节。
- 基色、环境遮蔽（AO）和间接漫反射共用无重叠 UV 图集，全部嵌入 GLB。
- 间接漫反射以 glTF emissive 通道、0.35 强度近似补光，非完整光照重建。直接光和活动物体阴影由 Three.js 保持实时计算。
- 烘焙只包含本工程的静态物体，不包含机械臂、杯子、原程序化植物和工作台；不能宣称完整门店全局光照或离线 Cycles 画质。场景布局变化后应重烘焙。
- 材质仍使用标准 PBR，未使用高成本实时后处理；实时窄屏视图继续关闭动态阴影，烘焙 AO 仍保留。

终端资源：`coffee-terminal/web/assets/scene/coffee-shop-v1.glb`。
云端副本：`coffee-cloud-mvp/public/robot/assets/scene/coffee-shop-v1.glb`。
加载地址相对于正在执行的 viewer bundle 解析，支持终端与云端不同路径。下一版资产应同时更新文件名和加载引用，避免旧缓存混用。

原程序化替代物在完整 GLB 解码后隐藏；请求失败保留原场景。关闭视图会取消请求，迟到的解码结果直接释放。所有 PBR 贴图和 ImageBitmap 均参与释放。

## 验证

新增测试覆盖加载失败回退、解码完成前保留原场景、关闭期间解码结果释放、GLB 内嵌贴图以及两端资源一致性。浏览器验证使用本机 Edge + Playwright（Browser plugin not available）；真实手机 GPU 和终端 pywebview 尚需现场验收。
