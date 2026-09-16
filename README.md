# Hexbound — 六边形地形程序化 Shader 技术验证

本地网页技术验证（Babylon.js + Vite + TypeScript）：Civ / Humankind / AoW4 风格 pointy-top 六边形大地图。地表以 **ShaderToy 风格 FBM / 冠层场 / 大气雾** 为主，辅以 `public/tex/` 下**合成平铺细节贴图**（噪声/草/岩/沙/水面法线/林冠）。**不用**照片地形 atlas，**不种**树/石 GLB 装饰。

设计文档见 `docs/2026-09-16-hexbound-web-hex-shader-tech-validation.md`。  
美术方向参考图见 `refs/`（**仅供艺术参考，不进运行时采样**），映射表见 `docs/VISUAL_TARGETS.md`。  
ShaderToy 技法归因见 `docs/shadertoy-refs/TECHNIQUES.md`。  
截图样例见 `docs/shots/`。

> 仓库：https://github.com/unrealflow/Hexbound

## 快速开始

```bash
cd /workspace/Hexbound
npm install
npm run tex:gen   # 可选：重新生成 public/tex 细节贴图
npm run dev
```

浏览器打开终端提示的本地地址（通常 `http://localhost:5173`）。

```bash
npm run build
npm run preview
```

## 操作

- **左键**：拾取六边形
- **滚轮**：正交相机缩放
- **右键 / 中键拖拽**：平移
- **调试面板**：种子；山体位移 / 雾 / 六边边缘（默认关）/ 细节贴图

## 资源约束

- **允许**：`public/tex/` 合成平铺噪声与细节（`sampler2D`）
- **禁止作为主外观**：照片地表 albedo atlas；树/石 `.glb` 装饰（除非后续明确需要）
- `refs/*.jpg` 只用于美术对照，**不会**被 Shader 采样
- 几何为程序化六边形棱柱 Chunk；邻格高程混合 + 悬崖保留

## 当前视觉切片

| 特性 | 状态 |
|------|------|
| 斜视正交相机 + 程序化天空/太阳盘 | ✅ |
| 邻格高程混合 + FBM 微位移 / 悬崖 boost | ✅ |
| Quintic `noised` / `fbmdX`（Rainforest 风格） | ✅ |
| 林冠 soft-ellipsoid 场 + 近景树干 / 远景密度 LOD | ✅ |
| 山体 ridged 反照率 / 雪线 / 侧壁 strata | ✅ |
| 水面深度色 / 岸沫 / 动画法线贴图 / 太阳高光 | ✅ |
| 彩色消光距离雾 | ✅ |
| 平铺细节贴图（草/岩/沙/水/林冠） | ✅ |
| 六边描边默认关闭（可开，细暗边） | ✅ |
| 大尺度连贯生物群系 / 海岸架 / 山脊 | ✅ |

## 技术栈

- Vite + TypeScript + `@babylonjs/core`
- 自定义属性：`terrainId` / `featureId` / `elev` / `moisture` / `edgeMask` / `hexCorner`

## 目录要点

```
Hexbound/
├── public/tex/           # 合成平铺细节贴图
├── refs/                 # 艺术参考（非运行时）
├── docs/shadertoy-refs/TECHNIQUES.md
├── scripts/gen-detail-tex.mjs
└── src/render/shaders/   # noise + hexTerrain vert/frag
```
