# Hexbound — 六边形地形纯 Shader 技术验证

本地网页技术验证（Babylon.js + Vite + TypeScript）：Civ / Humankind / AoW4 风格 pointy-top 六边形大地图，**运行时禁止外部模型与贴图**，地表观感全部由程序化 GLSL Shader 完成。

设计文档见 `docs/2026-09-16-hexbound-web-hex-shader-tech-validation.md`。  
美术方向参考图见 `refs/`（**仅供艺术参考，不进运行时采样**），映射表见 `docs/VISUAL_TARGETS.md`。  
截图样例见 `docs/shots/`（人工/自动化抓取，非运行时资源）。

> 仓库：https://github.com/unrealflow/Hexbound

## 快速开始

```bash
cd /workspace/Hexbound
npm install
npm run dev
```

浏览器打开终端提示的本地地址（通常 `http://localhost:5173`）。

生产构建：

```bash
npm run build
npm run preview
```

## 操作

- **左键**：拾取六边形，调试面板显示 `q/r/terrainId/featureId/elev`
- **滚轮**：正交相机缩放
- **右键 / 中键拖拽**：平移
- **调试面板**：改种子并重新生成；开关山体位移 / 雾 / 六边边缘暗示

## 无贴图约束

- Shader **不得** `sampler2D` 采样 jpg/png 等图片资源
- `refs/*.jpg` 只用于美术对照，**不会**被 Vite 打进运行时材质
- 几何为程序化六边形棱柱 Chunk（`VertexData`），无 `.glb`

## 当前视觉切片（Civ / Humankind 可读性）

| 特性 | 状态 |
|------|------|
| 正交斜视相机（悬崖/水面可读） | ✅ |
| 分块多地形 + 海岸架浅水环 | ✅ |
| 六边边界暗/亮描边（领地线暗示） | ✅ |
| 阶地悬崖侧壁 + 岩层 strata | ✅ |
| 水面深度色 / 岸线泡沫 / 动画法线 / 高光 | ✅ |
| 林冠 Worley + 近景树干 SDF + 风摆 | ✅ |
| 山地雪线 / 坡度岩草混合 | ✅ |
| 沙漠沙纹、冰裂、沼泽浑浊 | ✅ |
| 半球光 + 距离雾 | ✅ |
| 地图：山脊 / 林带 / 生物群系聚类 | ✅ |

## 技术栈

- Vite + TypeScript
- `@babylonjs/core`（WebGL2 / GLSL ES，`ShaderMaterial`）
- 自定义属性：`terrainId` / `featureId` / `elev` / `moisture` / `edgeMask` / `hexCorner`

## 目录结构（要点）

```
Hexbound/
├── refs/                 # 12 张参考图 + SOURCES.md（非运行时）
├── docs/                 # 设计方案 + VISUAL_TARGETS.md + shots/
├── scripts/fetch-refs.mjs
├── src/
│   ├── main.ts
│   ├── scene/createScene.ts
│   ├── hex/coords.ts, HexMap.ts, mapgen.ts, ChunkMesher.ts
│   ├── render/HexTerrainMaterial.ts + shaders/
│   └── ui/debugPanel.ts
└── package.json
```

## 参考图

`refs/` 为 Civ6/7、Humankind、AoW4 地表对标图（仅艺术参考，不进 Shader）。若克隆后缺少 jpg：

```bash
npm run refs:fetch
```
