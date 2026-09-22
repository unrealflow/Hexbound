# 五方向并行探索汇总（2026-09-19 第三轮）

> 目标文档：`docs/design/2026-09-19-hexbound-goals-and-refs.md`（§2.3 实现顺序 A–E，含 §2.4 G-Hydro 展开）。  
> 方法：5 个只读探索代理并行作业（A 文档同步 / B 子格源数据 / C 水文 G-Hydro / D 高度真源 / E 玩法闭环），主会话汇总并实施改进。  
> 基准：工作树基于 `dcc4a51`，本轮改动未提交（见文末「本轮已实施」）。

---

## 1. 各方向结论

### A. 文档同步（§2.3 步骤 A）

崖墙退役后约 30 处过时表述，按误导性排序：

| 文件 | 最严重问题 | 定性 |
|------|------------|------|
| `docs/VISUAL_TARGETS.md` | 「Cliffs only on steep → met」整行以 walls=38 为达标依据，与「无垂直墙」硬规格直接冲突；CLIFF_DROP 数值也过时（0.50 → 实际 0.60 且已退役） | 冲突 |
| `docs/shadertoy-refs/TECHNIQUES.md` | 「keep=min(1,cliff/0.45) 回插」与代码事实相悖（无条件焊接已删该分支）；两处 metrics 表数字过期且标题重复 | 事实错误 |
| `README.md` | 「悬崖保留」「侧壁 strata」三处 | 冲突 |
| `hexbound-terrain-maturity-spec.md` | §1.2 侧壁三态、§2.2 崖壁与台地、§2.4 瀑布、P1-3 | 冲突（历史规格） |
| `docs/design/hexbound-game-design-web.md` | 「scene.pick / y=0 平面拾取」已过时（现为 heightAt 高度场拾取） | 过时 |
| `docs/design/impl-progress.md` / `seam-fix-plan.md` | 历史日志，保留原貌，加阅读注即可 | 可保留 |

另发现两处**脚本注释滞后**：`crack-metric.ts:129-130`（描述已不存在的墙发射）、`pick-check.mjs:9-12`（遗留 cliff corner 分类）。未改（不在本轮范围，遗留口径仍有回归价值）。

### B. 子格源数据（§2.3 步骤 B，G2）

- 瓶颈：`cellChannels()` 每场每格 1 样本，`bakeRGBA` 的 4×4 子格只是提高**滤波采样密度**，信息分辨率不变——等值线宏观走向必然跟随格心排布。岸线 SDF 是唯一亚格精度通道。
- 推荐方案「两带」：低频带沿用 (1−d/r)³ 核重建；**零均值高频带在核累加之后叠加**（旋转 FBM + 域扭曲，`fbmRotate`/倍频矩阵常数与 `noise.glsl` 同源，排除轴对齐）。不做「原 FBM 直接重采样」——会复刻 elev 双场问题且低倍频重采样等于白算。
- forestCover 用**乘性**细节（自门控，0 处不长幻林）；moisture/elev 用**加性** + terrainId 混合门控（水上归零）。通道布局、MAP_SUB、几何路径全部不动。
- 验证：`field-view` 模式 1 灰度直方图（数据侧）+ `orient-metric`（画面侧）+ verify 全绿硬门。

### C. 水文 G-Hydro（§2.4，M1 = S1+S2）

- 现状「假河」＝湿度种子 + 贪心游走 + `elev×0.72` 雕刻（`mapgen.ts:426-552`）；`riverDist` 是格中心 BFS 跳数场（非线段 SDF），经 BAND 1.8 核滤波进 `uMapTex1.R`；frag:173-174 注释「unfiltered」与实现不符（顺手修注释列入 M3）。
- S1：Priority-Flood（Barnes 2014）海洋种子 + 边界种子，closed-at-push 二叉堆；湖 = `filled − hydroElev > ε` 连通域（ε=0.008、≥3 格），湖面 = 溢流高程直接产物。**hydroElev 必须先做与 cellTopY 同型的 7 点均值平滑**（否则 ±0.0125 逐格抖动制造大量伪洼地）。
- S2：填洼场上 D6 最陡下降 + 低频噪声破对称（白噪声会椒盐抖动）；填洼平台用**多源 BFS**（距离严格递减 ⇒ 无环）；汇流面积按 donor 计数 Kahn 拓扑累加。
- `hydro:check`（新门禁）：H1 覆盖性/链终止于水/面积守恒；H5 湖底真实抬升/湖面=溢流/沿树单调。
- S3/S4 可行：S3 下切量当「场」过 avg7 平滑再扣 + 沿树强制单调重写河床（防下切自造洼地）；S4 影响面仅 `HexMap.ts:262` 打包一行 + frag:401-408 河谷绿带块，**通道预算建议加第三张 tex2**（t/河宽/Strahler/flow），tex1 语义零破坏；`heightAt` 加 `max(地形,河面)` 时必须保留 'none' 模式纯地形恒等式，否则 pick:check 的精确匹配门禁被破坏（M3 最大风险）。

### D. 高度真源统一（§2.3 步骤 D，G4）

- **实际是三个高度场**：CPU 语义 elev（玩法）、CPU 位移复刻场（拾取/profile）、GPU 位移场（画面）——②③公式同构但**噪声实现不同**（JS sin-hash+cubic vs GLSL fract-hash+quintic+域旋转），最坏 |Δy|≈1.2wu、典型 0.1–0.3wu。这是 pick 同格 158/181 的根因。
- **新发现 bug（已验证属实并修复）**：`calib-y.ts` 向 `displaceLandY` 传 `dispW=0`，而所有位移项都乘 `landW/mtnW`（含 dispW），**探针恒测未位移场**。修复后峰顶分布 3.369 → 3.801（位移后）。frag 雪线带 [1.47,1.89] 与修复后探针建议带 [2.66,3.42] 的失配留待 D3 重标定（先冻结基线）。
- 位移总幅度 ±0.6–1.0wu 与语义高同量级（雪线带宽仅 0.42wu），**不满足**「位移仅微细节」豁免（需 ≤0.1wu，会牺牲 G5 山脊观感）。
- 推荐路线一（顶点级烘焙）：mesher 上传 Y 时加 `displaceLandY`（换成 GPU 噪声的精确 TS 移植，Math.fround 模拟 float32），vert 位移归零（保留林冠/风摆 ≤0.09/0.04wu 走豁免条款），`heightAt` 直读烘焙高。约 3–4 个工作段；附带收益：pick 同格率应 87%→~100%、calib-y 退役、G-Hydro S3/S4 的全部验收（下切 elev=可见地形）成立。路线二单独采用会与 G5/G-Hydro 冲突，不推荐。

### E. 玩法最小闭环（§2.3 步骤 E，G6，预研）

- 基建完整：`pickTerrain` 高度场拾取（0.25 步长 + 20 次二分）、调试面板 `selected`、axial 邻接/距离工具齐备；高亮盘雏形已存在（平面盘，斜坡穿模为已知 P2）。
- 设计文档 v0.5 的移动消耗是**离散查表**（terrain/feature base+extra，非高差×坡度）；山脉/水域不可通行；MP 3/回合，回合制。
- 最小范围：单位令牌 + 两态状态机（选中/移动）+ 贴地扇面邻格盘（顶点逐点采 `heightAt`，顺带修高亮穿模）+ cost 查表 + 回合重置。约 2.5–4 天。
- 「同格 158/181」是场拾取 vs mesh 拾取的诊断对比指标（mesh 打在未位移几何上），**不是场拾取错误**，不阻塞玩法；方向 D 落地后自然收敛。
- 解耦：新代码全放 `src/game/`，overlay 独立 mesh + StandardMaterial，不碰 ChunkMesher/材质/纹理通道；门禁零风险。切入时机：G1–G5 验收后，或与 D 并行。

## 2. 方向间依赖与建议排序

```
A（文档，已完成）→ B（子格细节，本轮试点）→ C M2/S3（下切需要 B 的对齐）→ D（烘焙真源，先修 calib-y 基线）→ C M3/S4（渲染层）
                                                        ↘ E（G6，独立，随时可插）
C M1（S1+S2 数据层，本轮已落地）与 B 完全并行（纯新增，零渲染依赖）
```

探索代理修正了 goals 文档预设顺序的两点：① D 应先于 C M3（河面高度/拾取契约依赖单一高度真源）；② C M1 与 B 互不阻塞（与 §2.4 原判断一致）。

## 3. 本轮已实施（主会话汇总后执行）

| 项 | 内容 | 验证 |
|----|------|------|
| A-P0 | VISUAL_TARGETS / README / TECHNIQUES 全部冲突与事实错误修订；maturity-spec 加时效横幅 + §2.2/§2.4/P1-3/P2-1 改写；game-design 拾取表述、shots/README、impl-progress 阅读注 | grep 复查无「walls=38 / 悬崖保留 / keep 回插」残留 |
| B 试点 | 新增 `src/hex/fbm.ts`（旋转 FBM 细节带）；`bakeRGBA` 支持 detail（乘性 forestCover amp 0.15、加性 moisture 0.06 / elev 0.022，land 门控）；细节在核累加之后叠加，通道布局不变 | `verify` 全绿且几何/拾取数字逐位不变（walls=0、profile 0.00858、pick 158/181、fieldAboveMesh 0.924）；field-view 模式 1 horizontal **0.905→0.660**；orient-metric pm30 0.246→0.248（无新伪影）；官方 5 图重出无观感回退 |
| C-M1 | 新增 `src/hex/hydrology.ts`（S1 Priority-Flood 填洼/湖判定 + S2 D6 流向/汇流面积）；`generateMap` 接线 `map.hydrology`；新门禁 `hydro:check`（H1/H5）入 `p0:check` | `hydro:check` 绿（583 陆地格全部汇海成树、maxChain 16、面积守恒）；湖机制在 seed 1/2/42/2024/31415/8888 均可触发且过门禁；门禁种子 20260916 无内陆洼地（0 湖，H5 存在性留给 M2 验收） |
| D-0 | 修复 `calib-y.ts` `dispW=0` 失效 bug（诊断脚本，非门禁） | 修复后输出真实位移分布（峰顶 3.801） |

**遗留（下一轮）**：D1–D4（噪声 TS 移植 + 顶点烘焙 + 雪线重标定）；B 的 shader 侧扰动幅度下调试验（`coverAmt` 的 fbm2 项 1.10→~0.85，数据侧已有细节后可减半路补丁）；C-M2（S3 下切 + H2）；E（G6）。
