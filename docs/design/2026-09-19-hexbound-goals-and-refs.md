# Hexbound：现状分析、目标与外部参考（拉新后）

> 基准提交：`dfba319`（2026-09-19）  
> 「全焊接连续地形（移除断崖机制）+ 子格预滤波与距离场观感升级 + 地形生成论文」  
> 配套：`docs/paper/procedural-hex-terrain-paper.md`、`docs/design/impl-progress.md`、`docs/design/hexbound-terrain-maturity-spec.md`

---

## 0. 一句话结论

Hexbound 图形验证期的**几何/无缝/连续性硬问题已基本钉死**（门禁全绿 + 剖面连续规格）。  
下一阶段的主目标应从「消灭六边马赛克与裂缝」转为：**在「玩法仍按格」的前提下，把地貌语义与商业 4X 地标观感拉到可交付切片**——子格源数据、真河道/河面、高度真源统一，以及玩法层最小闭环。

---

## 1. 拉新后实现盘点（`dfba319`）

### 1.1 已成立的能力

| 层 | 现状 | 证据 |
|----|------|------|
| 栈 | Vite + TS + Babylon.js；自定义 `hexTerrain` ShaderMaterial；`public/tex` 合成平铺细节 | `package.json`、`src/render/*` |
| 地图生成 | FBM / ridged / 域扭曲 → 大陆·高度·湿度·森林；BFS 缓坡；河谷雕刻；biome 分类 | `mapgen.ts`、`HexMap.ts` |
| 数据表示 | 两张 RGBA8；**4×4 子格** + `(1−d/r)³` 紧支撑预滤波；岸线 **线段 SDF**；河距场 | 论文 §3–4；`HexTerrainMaterial` |
| 几何 | **无条件角点焊接**、**无侧壁**；任意竖直剖面连续（`profile:check` 单步高差实测 max ≈ 0.0086 wu） | `terrainContinuity.ts`、`ChunkMesher.ts` |
| 着色 | 解析 FBM 法线、各向异性山脊位移、林冠 soft-ellipsoid、岸带/三停水色/焦散、坡度岩雪、雾 | `hexTerrain.{vert,frag}.glsl`、`noise.glsl` |
| 门禁 | `glsl` / `tsc` / `crack` / `corner` / `hole` / `disp:weld` / `profile` / `pick`；`npm run verify` | `package.json` scripts |
| 文档 | 网页设计 v0.5、成熟度规格、迭代日志、数据原理论文、VISUAL_TARGETS、ShaderToy 技法表 | `docs/**` |
| 资源策略 | 参考图 / 截图**不入库**；`refs:fetch` / `shots` 再生；运行时只保留合成 tex | `8034db5` |

### 1.2 相对早期版本的关键转向

1. **断崖机制退役**：垂直墙 = 剖面高度突变，与「剖面必须连续平滑」硬规格冲突；陡峭改为连续陡坡 + 坡度驱动岩雪着色。  
2. **离散→连续的主战场前移到烘焙期**：渲染侧混合只能插值已有频率；马赛克要靠子格预滤波与 SDF，而不是片元里「再糊一层」。  
3. **无缝从观感变成不变式**：撕裂/空洞/角点跨度由读真实缓冲的脚本钉死，而不是靠截图主观过关。

### 1.3 已知残留（论文与进度日志已诚实记录）

| 残留 | 机制 | 建议优先级 |
|------|------|------------|
| 森林/部分岸带仍受「每格 1 样本」带宽限制 | `forestCover` 等源场分辨率不够；预滤波不能发明信息 | **P0 下一阶段** |
| 河谷在宽景可读性不足 | `riverDist` 已有，河面几何 / 水面着色未升为真河 | **P0** |
| elev 与 GPU 位移是双场 | 雪线依赖 `calib-y` 探针；玩法/AI 高度语义分裂 | **P1** |
| README 仍写「悬崖保留」 | 文档滞后于 `dfba319` | 文档修补 |
| 玩法层几乎为零 | 拾取/调试面板有，移动·迷雾·战斗无 | 图形验收后另开里程碑 |

---

## 2. 目标（建议锁定为下一份「可验收规格」）

### 目标陈述

> **在保持六边形游玩语义与现有门禁全绿的前提下，把 Hexbound 从「连续无缝的程序化高度场演示」推进到「可读的 4X 地标切片」：山脉走向、海岸分层、河谷水面、林块有机轮廓均可在官方 5 机位一眼读出，并与 `refs/`（Civ6/7 · Humankind · AoW4）同级对标观感（feel，非像素拷贝）。**

### 2.1 验收指标（建议写进下一次 maturity 增量）

| ID | 指标 | 可判定含义 |
|----|------|------------|
| G1 | 门禁不回退 | `npm run verify` 持续绿；`profile:check` 单步高差阈值不放宽 |
| G2 | 子格源对齐 | 林缘 / 关键生物群系边界在上视 `field-view` 中不再呈明显六边等值线（方向直方图无 ±30° 尖峰主导） |
| G3 | 真河道切片 | 至少 1 条贯穿河谷在概览机位可读为「水面带 + 河岸」，复用岸 SDF 水色栈 |
| G4 | 高度真源 | 雪线 / 拾取高度 /（可选）坡度掩模共享同一烘焙后高度场，或文档明确「位移仅微细节、不改语义高」 |
| G5 | 视觉对标 | 官方 `01–05` 相对 `VISUAL_TARGETS.md`：山脊连续、海岸浅→深、林成团、无马赛克/裂缝；对照 `refs/` 做旁注 diff |
| G6（可选） | 玩法最小闭环 | 选格 → 合法邻格高亮 → 移动消耗（设计文档 v0.5 探索层），不阻塞 G1–G5 |

### 2.2 明确非目标（本阶段不做）

- 整仓照片 atlas / 树石 GLB 堆场景  
- 恢复垂直断崖墙（违反连续性规格）  
- 全图 Geometry Clipmap / 行星级流式（地图仍是 40×32 验证规模）  
- WFC 整图贴片拼装替代噪声场（可作为对照实验，不替换主路径）

### 2.3 建议实现顺序

```
A. 文档同步（README / VISUAL_TARGETS 去掉已退役崖墙表述）
B. 子格源数据：elev / forestCover / moisture 分形上采样后再预滤波
C. 河面几何：riverDist 等值线 → 水面条带 + 复用水着色
D. 位移烘焙回高度真源（或收缩位移为纯细节）
E. （可选）探索层最小交互
```

---

## 3. 外部文献与工程参考（检索整理）

按「Hexbound 已用 / 应对齐 / 可借鉴但不照搬」分组。链接均为公开页。

### 3.1 噪声、域扭曲、解析导数（已深度对齐）

| 参考 | 链接 | 与 Hexbound 的关系 |
|------|------|-------------------|
| I. Quilez — Value Noise Derivatives | https://iquilezles.org/articles/morenoise/ | `noised` / `fbmdX`、解析法线；ShaderToy Rainforest / Atmospheric Landscape 同源 |
| I. Quilez — Domain Warping | https://iquilezles.org/articles/warp/ | mapgen / 林冠格点 warp；避免轴对齐伪影 |
| I. Quilez — FBM as SDF detail | https://iquilezles.org/articles/fbmsdf/ | 岸带 / 细节位移与距离场结合时的注意点 |
| I. Quilez — Gradient noise derivatives | https://iquilezles.org/articles/gradientnoise/ | 若从 value noise 换到 gradient noise 的对照 |
| Musgrave 谱系（Ridged Multifractal） | *Texturing & Modeling: A Procedural Approach*；Blender 旧 Musgrave 节点文档 | ridged 山脊；实现上常见 `offset − |n|` 再平方加权 |

### 3.2 六边形坐标、噪声成图、生物群系（数据层圣经）

| 参考 | 链接 | 与 Hexbound 的关系 |
|------|------|-------------------|
| Red Blob — Hexagonal Grids | https://www.redblobgames.com/grids/hexagons/ | axial / cube-round / 距离；`coords.ts` 直接同源 |
| Red Blob — Terrain from Noise | https://www.redblobgames.com/maps/terrain-from-noise/ | FBM 叠加、幂次 redistribution、ridged、岛屿径向衰减 |
| Red Blob — Mapgen1 hexagons | https://www.redblobgames.com/x/2543-mapgen1-hexagons/ | 噪声 elev+moisture → biome 上色；玩法格与连续采样并存 |
| redblobgames/mapgen2 | https://github.com/redblobgames/mapgen2/ | 河流 / 排水 / 噪声边；**真河道**阶段优先对照 |

### 3.3 六边策略地图的「离散玩法 × 连续外观」

| 参考 | 链接 | 可借鉴点 | 不宜照搬 |
|------|------|----------|----------|
| Catlike Coding — Hex Map（解析网格线） | https://catlikecoding.com/unity/hex-map/2-2-0/ | 世界坐标解析 hex 边；坡上网格不拉伸 | Unity 管线；我们默认关线框 |
| Godot — Hex tilemap blending | https://godotshaders.com/shader/hexagonal-tilemap-with-blending/ | 三近邻重心 + 噪声扰动 barycentric | 纹理 atlas 路径与我们禁照片 atlas 冲突 |
| Dashwood — 六边 biome 过渡网格 | https://dashwood.net/blog/2025-06-17-how-we-solved-biome-blending-in-a-hex-based-3d-rts-using-precomputed-transition- | 邻接 mask → 预计算过渡 | 手作过渡 mesh；我们坚持程序化场 |
| Felix Turner — Hex + WFC | https://felixturner.github.io/hex-map-wfc/article/ | 海岸距离梯度驱动浪带；模块化约束 | WFC 贴片主导，与噪声高度场主路径不同 |

### 3.4 连续地形渲染与岸线 SDF（观感升级）

| 参考 | 链接 | 可借鉴点 |
|------|------|----------|
| Scarlet — One Shader One Mesh One Island | https://scarlet.engineering/blog/ground-shader/ | GPU 烘焙岸线 SDF；FBM 扰动岸线；foam/shallow/deep 分层 |
| Cinevva — Island from noise（浏览器开放世界） | https://app.cinevva.com/blog/2026-05-13-open-world-browser-part-27-island-and-terrain | domain-warp FBM + redistribution + 径向岛屿；「地要像地」的工程拆解 |
| Losasso & Hoppe — Geometry Clipmaps (SIGGRAPH 2004) | https://hhoppe.com/proj/geomclipmap/ | 嵌套规则网格 LOD / 实时合成；**仅当地图规模暴涨时**再评估 |
| Shiben Bhattacharjee — Hexagonal Geometry Clipmaps（论文/学位论文相关） | https://cvit.iiit.ac.in/images/Thesis/MS/shibenMS2010/shibenMSthesis.pdf | 六边 clipmap 思路；超出当前 40×32 验证范围 |

### 3.5 项目内已沉淀（视为一级参考，优先于外部博客）

1. `docs/paper/procedural-hex-terrain-paper.md` — 数据原理全文（公式与常数对齐源码）  
2. `docs/design/hexbound-terrain-maturity-spec.md` — 指标 A/B 与根因表  
3. `docs/design/impl-progress.md` — 全部门禁数字与失效模式  
4. `docs/VISUAL_TARGETS.md` + `refs/SOURCES.md` — 观感对标与参考图来源  
5. `docs/shadertoy-refs/TECHNIQUES.md` — 允许移植 / 禁止整段 raymarch 的边界  

---

## 4. 与论文「后续方向」的对齐

论文 §8 已给出的三条，直接映射到 §2 目标：

| 论文方向 | 本文目标 |
|----------|----------|
| 子格源数据（分形上采样后再滤波） | G2 |
| 河面几何（riverDist → 真水面） | G3 |
| 位移与 elev 统一真源 | G4 |

外加：文档滞后修补（G1 旁路）、可选玩法闭环（G6）。

---

## 5. 风险与对策（下一阶段）

| 风险 | 对策 |
|------|------|
| 上采样引入新的轴对齐伪影 | 沿用林冠修复经验：domain warp + 方向直方图门禁（`orient-metric`） |
| 河面破坏焊接/拾取 | 河面作为顶面高度场修改或独立共面 mesh；必须过 `profile` + `pick` |
| 位移烘焙改变轮廓导致雪线崩 | 先冻结 `calib-y` 基线截图，再改真源；雪线改读烘焙高 |
| 过度追求「像参考图」而引入照片 atlas | 硬禁；只允许 `public/tex` 合成平铺 |
| README / 规格过时误导后续 agent | 本轮先做文档同步再动大改 |

---

## 6. 决策摘要

| 项 | 决定 |
|----|------|
| 当前阶段定性 | 图形验证 **几何连续期已完成**；进入 **地标语义与数据分辨率期** |
| 硬规格保留 | 剖面连续平滑；无垂直墙；无照片 atlas；refs 不进 Shader |
| 下一主线 | 子格源 → 真河 → 高度真源；门禁不回退 |
| 主文献锚点 | Quilez（噪声/导数/warp）+ Red Blob（hex/噪声成图/mapgen2 河）+ Scarlet（岸 SDF 分层） |
| 对照但不替换主路径 | WFC hex map、预计算 biome 过渡 mesh、Geometry Clipmaps |

---

*文档生成：2026-09-19。分析对象为 GitHub `unrealflow/Hexbound@dfba319` 拉新后工作区。*
