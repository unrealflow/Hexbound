# 实现进度

> **阅读注（2026-09-19）**：本文件按时间顺序追加。「断崖机制退役」条目之前的段落描述
> 已退役的崖墙/侧壁机制（walls=38、CLIFF_DROP 分裂、wallLift 等），口径以退役条目与
> `docs/design/2026-09-19-hexbound-goals-and-refs.md` 为准；历史条目保留原貌不改。

## P0-数据层 (2026-09-17)

改动：`src/hex/HexMap.ts`、`src/hex/mapgen.ts`。
- 删 `floor(elev*5)` 量化与 `max(elev,0.75)` 整格抬顶；脊线连续 `+max(0,spineMix-0.48)*1.05`。
- `HexCell.forestCover` 0–1 连续写入；`featureId` 仅 `cover>0.45` 时标林。
- `recomputeShoreDepth` MAX_STEPS=8，世界距离 `/8`；`edgeMask=exp(-d/0.28)`。
命令：`npx tsc --noEmit` EXIT:0。
直方图 seed=20260916：land=595 uniqueElev=595（无 5 级台阶）；forestContinuous=409；uniqueEdgeMasks=5；uniqueShoreDists=8。
遗留：着色器仍逐格常量（下一步纹理/着色）；vert 仍有 terrace。

## P0-几何无缝 (2026-09-17)

改动：`src/hex/ChunkMesher.ts`。
- 对称角点焊接：水=0.02；span<CLIFF_DROP(0.50) 三格均值；否则本格。
- 顶面/侧壁半径 `HEX_SIZE`（去掉 1.002）；删 skirt/yBot 悬挂裙。
- 侧壁三态：水-水/出界 skip；drop<RAMP_DROP(0.14) skip；低侧 skip；否则底=邻顶（ramp/cliff）。
命令：`npx tsc --noEmit` EXIT:0。
墙普查 seed=20260916：lowDeltaPairs=1277 lowDeltaWalls=0；walls=506 (ramp=197 cliff=309) trueDropEdges=346 skip=7174。
遗留：外观仍逐格 terrainId；着色器采样数据纹理下一步。

## P0-地图数据纹理 (2026-09-17)

改动：`src/hex/HexMap.ts`、`src/render/HexTerrainMaterial.ts`、`src/hex/ChunkMesher.ts`。
- 两张 40×32 RGBA8 NEAREST+CLAMP：`uMapTex0`(tid/8,fid/8,elev,moist)；`uMapTex1`(shore,forestCover,B,relief)。
- B 方案：水=1、陆地=`edgeMask=exp(-d/0.28)`（倒场兼 landMask：B>0.5 为水），供 P0-6 滩涂连续带。
- `meshMap`/`rebuild` 经 `bindMapData`；dispose 旧 mesh+材质+两张 RawTexture。
命令：`npx tsc --noEmit` EXIT:0；`npm run glsl:check` ES1+ES3 OK。
pack seed=20260916：texels=5120；waterB1=685；landB=595 landBMax=0.0275。
遗留：vert terrace 仍在；P1 山脊/河谷/光雾未做。

## P0-外观无缝 (2026-09-17)

改动：`src/render/shaders/hexTerrain.frag.glsl`、`src/render/shaders/noise.glsl`。
- 移植 worldToAxialFrac；3 格重心混合 + biomeHeight 权重；廉价 biomePalette；细节只跑一次。
- 海滩 `smoothstep(0.22,0,dWater)`；水深连续无 tid>6.5；林 cover 连续；contactAO 默认 1，wire 0.10。
命令：`npm run glsl:check` ES1+ES3 OK；`npx tsc --noEmit` EXIT:0。
遗留：P1 山脊/河谷/光雾；外观仍有拼块（见 P0 截图）。

## P0-顶点位移 (2026-09-17)

改动：`src/hex/ChunkMesher.ts`、`src/render/HexTerrainMaterial.ts`、`src/render/shaders/hexTerrain.vert.glsl`。
- 顶点属性 mountainW（elev smoothstep 邻均）与 forestW（forestCover 邻均）；共 12 槽。
- 山体/林冠位移改权重；删 5 级 terrace；仅 0.32–0.55 低坡 ≤0.04*uElevScale。
命令：`npx tsc --noEmit` 0；`glsl:check` ES1+ES3 OK；`npm run shots:iter -- p0`。
截图 `_p0-{1,2,3}-canvas.png`：同高陆地无裙；山仍为逐格鼓包；岸仍有硬滩/林缘。
遗留：山脊连续与外观无缝靠 P1/混合调参。

## P0 自测 (2026-09-17)

改动：新增 `scripts/seam-metric.mjs`。
命令：`npx tsc --noEmit` 0；`npm run glsl:check` ES1+ES3 OK；`npm run shots:iter -- p0verify`；seam-metric；墙普查；拾取。
P0-1/3/8/9/10 通过；P0-2/4/5/6/7 不通过（_p0verify 画布仍马赛克/整格滩/水环/林硬边；02 仍见竖裙）。
seam ratioP95 1.05–1.16（屏上格网未标定相机）；lowDeltaWalls=0/1277。
遗留：指标 A/B 未过，需 P1 继续。

## P1-地形形体 (2026-09-17)

改动：`src/hex/mapgen.ts`、`src/hex/HexMap.ts`。
- spine2 权重 0.45；陆地 `elev += max(0,spineMix-0.48)*1.05`。
- 河谷：湿低地种子沿最低邻格走，path elev*0.72、Riverbank、邻域*0.85；`riverDist` 入 uMapTex1.R（陆地）。
- forestCover 6 邻：avg<0.25→0，>0.6→max。
命令：`npx tsc --noEmit` 0。seed=20260916：riverPath=23；forestBlobs 4→2 isolates 1→0；mountainFrac=0.249。
遗留：着色器未用 riverDist；外观马赛克仍在。

## P1-山体与崖壁着色 (2026-09-17)

改动：`hexTerrain.vert.glsl`、`hexTerrain.frag.glsl`。
- 脊位移 `ridgeFbmd(xz*0.45)*0.55*mountainW*uElevScale`；reliefScale 0.85。
- 雪线 2.35–2.95 + 背坡；岩层 80/70/60→赭→顶，砖红带 0.65；崖仅 relY>0.50；斜坡 n.y 45% 岩/草；干旱崖 #D2A564/#6E4B32。
命令：`glsl:check` ES1+ES3 OK；`tsc` 0；`shots:iter -- p1a`。
`_p1a-2`：近景脊较连续、暖地层；雪未上色（峰高可能 <2.35）；仍有浅色竖裙。`_p1a-1` 远景仍偏逐格块。
遗留：雪线高度、远景鼓包、裙边。

## P1-海岸与空气透视 (2026-09-17)

改动：`hexTerrain.frag.glsl`。
- 滩 (0.88,0.80,0.58)<0.22hex；浅/陆架/远海色板；泡沫 shoreDist<0.06 + smoothstep(0.015,0.055)；焦散仅浅水。
- ndl 1.55、hemi 0.32；阴影底 草(0.12,0.16,0.10)/岩(0.12,0.11,0.14)。
- 雾 density 0.018；farFade 36；谷雾 heightAtten mix(1.15,0.40,y/3)。
命令：`glsl:check` ES1+ES3 OK；`shots:iter -- p1b`。
`_p1b-1`：薄岸线、有远雾、无死黑；水仍有六边环。`_p1b-3`：泡沫贴岸，仍见深度环。
遗留：水环/马赛克未消。

## P1 正式出图 (2026-09-17)

改动：`docs/VISUAL_TARGETS.md`、`docs/shadertoy-refs/TECHNIQUES.md`、`docs/shots/README.md`（重跑 `npm run shots`）。
命令：`npm run shots`；`node scripts/seam-metric.mjs` 五张 canvas。
seam ratioP95：01=1.112 02=1.000 03=1.136 04=1.146 05=1.171（此前 `_p0verify` 1.05–1.16）。
view_image：`02` 脊连续+雪、无吊裙；`03` 有滩浅海军+泡沫但仍环状/整格滩；`01`/`04`/`05` 仍马赛克；`04` 有谷、林硬边。
A/B 未过。P2：瀑布、拾取贴地、高亮贴顶、干旱/雪地 refs。

## 返工 fix1 (2026-09-17)

改动：`hexTerrain.frag.glsl`、`hexTerrain.vert.glsl`、`ChunkMesher.ts`。
- 7 格高斯混合，去掉 hash^5；仅 CLIFF_DROP 出墙，底=邻格焊接角；侧壁也做位移。
- 水深 FBM 打散；滩按 waterW；林 cover 加宽；雪线降低；崖墙压暗。
命令：tsc 0；glsl ES1+ES3 OK；`shots:iter -- fix1`。
seam ratioP95：1=1.159 2=1.124 3=1.165（官方 01–05 曾 1.11–1.17）。
view_image `_fix1-*`：总览裙少、混合略好；近景仍白崖裙/无雪；岸仍偏硬、滩弱。
遗留：P0-2/4/5/6/8、P1-2 仍不稳。

## 返工 fix2 (2026-09-17)

改动：`ChunkMesher.ts`（侧壁底用邻格 elev/mountainW）、`hexTerrain.frag.glsl`（高斯 0.48、t1.b 连续水、泡沫带、林 cover）、`HexTerrainMaterial.ts`（map tex BILINEAR）。
命令：tsc 0；glsl ES1+ES3 OK；`shots:iter -- fix2`。
seam ratioP95：1=1.028 2=1.153 3=1.156（fix1 为 1.16/1.12/1.16）。
view_image：`_fix2-3` 有岸沫、林缘较软；`_fix2-1/2` 仍马赛克/白裙/六边网。
遗留：P0-2/4/8；P1-8 未重跑官方 05。

## 无缝 R1（焊接属性 + 世界 xz 噪声域）2026-09-17

改动：新增 `src/hex/terrainContinuity.ts`、`scripts/crack-metric.ts`；改 `ChunkMesher.ts`、`hexTerrain.vert.glsl`、`mapgen.ts`、`hexTerrain.frag.glsl`。
- 共顶点三格按**几何**求 weld（`hexesAtWorldVertex`，世界坐标查共角格），角点 elev/mountainW/forestW 与 Y 同源；vert 噪声域去掉 `+elev*`；侧壁顶复用焊接角点、底用邻格焊接角点。
命令：tsc 0；glsl ES1+ES3 OK。
`crack-metric`：crackGroups=0 attrCracks=0 lowDeltaWalls=0（worstAttrSpan 2.2e-16）；walls=trueWalls=269。
遗留：马赛克/裙边/雪线仍受取样限制（见下）。

## S3 林缘 + 雪线标定 2026-09-17

改动：`mapgen.ts` coalesceForestCover（只去椒盐，不再吸附两尾）、`hexTerrain.frag.glsl`（cover 放宽为 `smoothstep(0.22,0.78, forestW+(fbm2(p*0.90)-0.5)*1.10)`；雪 `smoothstep(1.47,1.89, alt+snowN)` + `max(mtnW,snowLine)`）、`scripts/calib-y.ts`（新增）、`scripts/crack-metric.ts`（sample→worstAttrSpan）。
命令：tsc 0；glsl ES1+ES3 OK；crack-metric 仍 0/0；`shots:iter -- r1`。
标定：CPU 复刻位移后陆地 Y 峰值 2.627、p90 1.795、p95 2.042；但渲染探针（0.95–1.25 有雪、1.70–2.30 无雪）显示实际峰顶≈1.6–2.1，故取 1.47–1.89（≈实测峰顶 70–90%）。
view_image `_r1-*`：峰顶有雪、林缘已破边（ragged）；`_r1-1/3` 仍见整格色块（P0-4 未解）。

## S4 正式出图 + 文档 + 交付 2026-09-17

本轮再改：`hexTerrain.frag.glsl`（崖墙压暗 `0.52+0.08*vertBand`、干旱崖色降亮、`albedo *= 0.90+0.20*fbm2(p*0.32+7)` 破平色、混合核 `exp(-d²*0.36)`）、`scripts/crack-metric.ts`（新增 `maxWallBottomGap`）、`docs/VISUAL_TARGETS.md`、`docs/shadertoy-refs/TECHNIQUES.md`、`docs/shots/README.md`。
命令：`tsc` 0；`glsl:check` ES1+ES3 OK；`crack-metric`；`shots:iter -- r2/r3`；`npm run shots`。
指标：crackGroups=0 attrCracks=0 maxWallBottomGap=0 lowDeltaWalls=0/1238 walls=trueWalls=269 worstAttrSpan=2.2e-16。
雪标定：CPU 复刻峰值 2.627（p90 1.795 / p95 2.042）；渲染探针 0.95–1.25 有雪、1.70–2.30 无雪 ⇒ 实测峰顶≈1.6–2.1，最终带 1.47–1.89。
出图时间证据：01–05 canvas = 15:00:37/39/40/42/45，全部晚于最新源码 `scripts/crack-metric.ts` 15:00:06。
逐条：P0-1/3/5/6/7/9/10 过；P0-2 过（几何 `maxWallBottomGap=0`，`02` 无吊裙）；P0-4 未过（`01`/`05` 仍报整格平色块）；P0-8 代码过（无 wire 通道，`uShowWireHint=0`；`01` 白带为色阶观感）。
P1-1/2/3/4/5/7/8 过（脊、雪、陡崖、岸沫、谷、雾、换种子仍有山/岸）；P1-6 部分过（场连续但 `04` 仍偏格对齐）。
未解决（P2）：瀑布、拾取贴地（y=0 射线）、高亮贴位移顶、干旱/雪地 refs 对齐；P0-4 平色块残留为最高优先。
清理：无残留 `_patch-*.mjs`；`scripts/` 仅保留长期脚本。

## 返工 rf1（海岸裙边 / 边邻格错位）2026-09-17

改动：`src/hex/terrainContinuity.ts`、`src/hex/ChunkMesher.ts`、`hexTerrain.frag.glsl`、`scripts/crack-metric.ts`。
根因（实测）：边 i 的邻格一直用 `AXIAL_DIRS[i]`，而几何上边 i 面向的是**另一条边**方向的格子 —— 于是墙贴在错误的边上：海岸高格朝“水”出整墙（= 漂浮六边块 + 浅蓝裙），真正的岸边反而无墙。新增 `edgeNeighbour()`（从边中点向外的几何查询），网格与指标同源。
其余：岸角（与水的共角）一律降到水面 `0.02`，岸线不再出墙也不再留缺口；侧壁一律按岩/沙着色（`step(0.5,vFaceKind)` 关掉墙面水色）；面心改用 6 个焊接角点均值（消除帐篷折面）；调色板改为在片元位置**双线性采样**（去掉逐格常数调色板与逐格权重调制）。
命令：tsc 0；glsl ES1+ES3 OK；crack-metric；`shots:iter -- rf1..rf4`；`npm run shots`。
指标：crackGroups=0 attrCracks=0 maxWallBottomGap=0 lowDeltaWalls=0/1238；walls=39 全为真崖（drop≥CLIFF_DROP），**shoreWalls=0 / maxShoreWallDrop=0**（旧口径 269 墙，含错位假墙）。
出图证据：01–05 canvas = 15:40:39–15:40:4x，最新源码 `ChunkMesher.ts` 15:39:07 → 出图晚于代码（True）。
view_image 官方图：`03` 岸线为坡/滩、无整墙；`01`/`05` 仍报整格平色块与六边格印（P0-4/P0-8 观感未清）。
未解决：P0-4 平色块（几何与调色板已连续，怀疑为逐格高度/光照刻面残留）、P0-8 格印观感、P1-1 远景脊；P2 同前。

## 返工 rf2（逐格高度刻面）2026-09-17

审查判定：P0-4/P0-8 仍不过，诊断为「逐格高度/光照刻面主导画面」。
改动：`src/hex/terrainContinuity.ts` `cellTopY()` 改为**焊接高度场** —— 陆地格高度 = 自身 + 陆地邻格 elev 均值（邻格高差 >0.22 时按 `keep=min(1,cliff/0.45)` 回插原值，保住真崖）；水仍恒为 `WATER_Y=0.02`。`ChunkMesher` 面心去掉 +0.02 与 forestW 抬升，只用 6 个焊接角点均值。
命令：tsc 0；glsl ES1+ES3 OK；crack-metric；`shots:iter -- rf2`；`npm run shots`。
指标：crackGroups=0 attrCracks=0 maxWallBottomGap=0 lowDeltaWalls=0/1238；walls=trueWalls=38（全真崖）；shoreWalls=0 maxShoreWallDrop=0。
出图证据：01–05 canvas = 15:51:57+，最新源码 `ChunkMesher.ts` 15:50:58 → official newer = True。
view_image 官方图仍在 `01` 报「整格平色块 + 六边格印」，`03` 报「浅色带/滩」（即沙滩带）与「过渡自然」。
结论：几何/属性/调色板三层都已客观连续，逐格观感残留需**加密网格**（每格 7 顶点太少，面片折线无法消除）——归入 P2 建议，不在本轮范围。

## 返工 hx（E1-E3 外科修复）2026-09-17

核验：E1（双线性纹理取色当 albedo，222-228 行）、E2（水面逐顶点波位移 amp 0.07/0.045）、E3（heightAO 用逐顶点 elev）三条**都成立**。
改动：`hexTerrain.frag.glsl`（E1 恢复 `pal += w*biomePalette` 高斯加权并 `pal/=wSum`，加连续同 biome 偏置 `1+0.5*max(0,1-|tid-tidC|*0.5)`，删双线性取色；E3 AO 改 `1 - smoothstep(0,gElevW)*0.14 - gReliefW*0.10`，vert 侧 heightAO 置 1）、`hexTerrain.vert.glsl`（E2 水面波位移清零）、`src/hex/HexMap.ts`（`recomputeShoreDepth`/`recomputeEdgeMasks` 由 BFS 环量化改为**连续欧氏世界距离**，NORM 8→16；`packMapTexels` 采样 R 水=shoreDist 陆=riverDist）、`hexTerrain.frag.glsl` 水面遮罩改 `waterMask = 1-smoothstep(0.005,0.06,elevW)`、泡沫只按 `shoreW` 距离场、深度 `shoreW*0.85 + fbm 扭曲 0.40/0.14`。
命令：tsc 0；glsl ES1+ES3 OK；crack-metric：crackGroups=0 attrCracks=0 maxWallBottomGap=0 lowDeltaWalls=0/1238 walls=trueWalls=38 shoreWalls=0；`shots:iter -- hx1..hx4`；`npm run shots`（16:11:25+ > 源码 16:10:31）。
view_image 结论：**陆地逐格平色块已明显减轻**（`_hx2-1`「不再是每格平色」）；`_hx2-2` 无格边暗线、山体连续；**水面蜂窝仍有**（`_hx3-3`/`_hx4-3` 仍报 hex tiles + 深度阶跃），已连续化深度场但观感未清。
残留归因：每格仅 7 顶点，格面本身就是折面 → 建议 P2 加密顶面网格（本轮按指令未做）。

## 交付 hx（视觉回归 + 正式出图 + 文档）2026-09-17

改动文件：`src/render/shaders/hexTerrain.frag.glsl`、`hexTerrain.vert.glsl`、`src/hex/HexMap.ts`、`docs/VISUAL_TARGETS.md`、`docs/shadertoy-refs/TECHNIQUES.md`、`docs/shots/README.md`、`docs/design/impl-progress.md`。
crack-metric 全部数字：crackGroups=0 / attrCracks=0 / maxWallBottomGap=0 / lowDeltaWalls=0（1238 对）/ walls=38 = trueWalls / shoreWalls=0 / maxShoreWallDrop=0 / worstAttrSpan=2.2e-16；tsc EXIT:0；glsl:check ES1+ES3 全 OK。
出图时间证据：`newest source: 16:13:21 hexTerrain.frag.glsl` / `oldest official: 16:14:13 01-overview-default-canvas.png` / `official newer: True`。
逐条判定（证据=本次实测）：P0-1 过（src 无 floor(elev*5)）；P0-2 过（shoreWalls=0、maxWallBottomGap=0，03 岸线为坡）；P0-3 过（lowDeltaWalls=0/1238）；P0-4 **部分过**（01 已无「每格一色」，但仍报格边颜色跳变）；P0-5 部分过（深度改为连续欧氏距离，03 仍报水色阶跃/蜂窝）；P0-6 过（滩为水线窄带）；P0-7 **未过**（04 林缘仍偏硬）；P0-8 **未过**（01 仍见六边格印，非 wire 通道）；P0-9 过（拾取可用）；P0-10 过（双编译 0）。
P1-1 过（02/04 有连续岭）；P1-2 过（峰雪，带 1.47–1.89）；P1-3 过（仅真崖出墙）；P1-4 部分过（有滩/浅/深与泡沫，水面仍有格感）；P1-5 过（riverDist 谷带）；P1-6 **未过**（林成片但边硬）；P1-7 过（雾/明暗）；P1-8 过（05 按当前着色重出）。
未解决（P2）：水面蜂窝/格感（数据每格 1 样本 → 需提高数据分辨率或加密顶面网格，本轮按指令未做）、林缘柔化、拾取贴地、高亮贴顶、瀑布、干旱/雪地 refs 对齐。
清理：`scripts/` 无 `_patch-*`/`_diag-*` 残留（仅 calib-y.ts、crack-metric.ts、seam-metric.mjs 等长期脚本）。

## 返工 rp1/rp2（硬门 → 连续权重 + 数据域扭曲）2026-09-17

新增病因（本轮实测）：面片/顶点里对**整格属性**用硬 `if`（`landMask>0.5`、`mountainW>0.02`、`forestW>0.02`、`gWaterW>0.35`、`gSandW/gForestW>0.32` 的 else-if 链）会在「阈值等值线」上瞬间开关位移/法线/镜面，而该等值线正好落在相邻格顶点之间 → 格边折线。
改动：`hexTerrain.vert.glsl`（`landW/mtnW/forestWv = smoothstep(...)*topFace` 乘性权重取代硬门）、`hexTerrain.frag.glsl`（法线三段扰动按 `wWaterN/wSandN/wForestN` 加权而非互斥分支；镜面 else-if 链→`wWater/wTundra/wWall/wPlain` 权重；`isCanopy` 改 `float` 平滑权重；新增**数据域扭曲** `warp=(fbm2(p*0.21+3)-0.5, fbm2(p*0.21+29)-0.5)*0.85`，用 `axialP+warp` 做 7 格查表，使每格 1 样本的边界不再与格边重合）。
命令：tsc 0；glsl ES1+ES3 OK；crack-metric：crackGroups=0 attrCracks=0 maxWallBottomGap=0 lowDeltaWalls=0/1238 walls=trueWalls=38 shoreWalls=0 maxShoreWallDrop=0 worstAttrSpan=2.2e-16；`shots:iter -- rp1/rp2`；`npm run shots`。
出图证据：`newest source: 16:28:05 hexTerrain.frag.glsl` / `oldest official: 16:29:27 01-overview-default-canvas.png` / `official newer: True`。
view_image：`_rp1-2` 无格边暗线、无逐格平板、山脊连续；`_rp2-3` 水面蜂窝消失、水色为连续渐变；但正式 `01`/`04` 仍报「格边颜色跳变 + 水面六边格纹」。
**未消除**：01/04 的格边跳变与水面蜂窝仍存在；根因仍是每格 1 样本的数据纹素 + 每格 7 顶点的折面，需提高数据分辨率或加密顶面网格（P2，本轮按指令未做）。

## 返工 rp3（采样集边界跳变 —— 关键修复）2026-09-17

真正的「格边折线」根因：7 格高斯采样集在 `c0` 换格时**整体换格**，而被丢弃的环 2 其权重按 `exp(-d²*0.30)` 仍达 **0.30** → 重建场在每个六边格边处阶跃 30%。这不是纹素分辨率，而是采样集不闭合。
改动（仅 `hexTerrain.frag.glsl`）：核改为 `exp(-d²*0.55)`（环 3 泄漏降到 ~0.007），采样集扩到 **环 0-2 共 19 格**（`for gi,gj in -2..2 if |gi+gj|<=2`），配原有的世界噪声域扭曲。
命令：tsc 0；glsl ES1+ES3 OK；crack-metric 不变且全绿；`shots:iter -- rp2`；`npm run shots`。
出图证据：`newest source: 16:38:01 hexTerrain.frag.glsl` / `oldest official: 16:38:57 01-overview-default-canvas.png` / `official newer: True`。
view_image 正式图（本轮实测）：`01` 陆格边跳变 **消失**、水面蜂窝 **消失**；`02`/`05` 陆格边跳变消失、水面仍有淡蜂窝；`03` 水面蜂窝消失、陆格边仍有轻微过渡；`04` 陆格边很淡、水面仍报蜂窝。
残留（未消除）：**水面淡蜂窝**（02/04/05）与 03 的陆格边过渡；下一步建议提高数据分辨率（每格 4×4 子样本）或加密顶面网格（P2，仍按指令未做）。

## 无缝 sx（H-A/H-B 求证 + 修 R1/R2）2026-09-17

H-A **成立且量化**（`scripts/_samp-probe.mjs`，CPU 复刻 frag 混合，跨格采样集切换处的跳变 vs 格内同一 ε 步长）：7 格 `exp(-d²*0.30)` 截断误差 truncRel=22.2%、换集跳变 3.8e-2（≈9.8/255，=1461× 格内步长）；上一版 19 格 `k=0.90` = 0.45%、1.0e-3（22×，Mach 带仍可见）。**修法：4×4 三次 B 样条单位分解**（16 次常量索引展开，ES1 可编译）：truncRel=0（权重和恰为 1）、换集跳变 3.6e-5 = **1× 格内步长（无阶跃）**、格内变化量 0.0486 > 旧 0.0367（更不平板）。
R1 另有独立根因（灰底 A/B 实测）：`albedo=0.55` 且停用微法线时 ROI meanGrad=0.00016（几乎纯平），说明格边台阶不来自几何/光照，而来自**逐顶点解析梯度法线**（每格扇形内为常量、格边处插值撕裂）。已把 relief 法线移到 fragment（世界 xz 的 `fbm2d/ridgeFbmd` × 混合权重），vertex 只做位移。数据域扭曲 0.85→1.5+0.55（`frag`），使生物群系斑块脱离六边形轮廓（view_image：陆地为不规则有机变化）。
H-B **白线来源确证**（A/B 蒙太奇 `docs/shots/_dbgcoast.png`）：白线由**岸带 albedo 叠加**产生，不是几何/泡沫；另测出 `foam` 其实早已无效（首圈水 `shoreDist=0.108` > `foamEdge≤0.038`）。改法：`uMapTex1.B` 改为**有符号岸距**（水 +shoreDist / 陆 −landShoreDist，`HexMap.recomputeShoreDepth` + `packMapTexels`），水位遮罩、沙带、深浅水全部由该距离场驱动并加 2-3 格尺度噪声；删掉白色泡沫叠加、近岸水色变饱和、焦散提亮 1.35→1.10。
命令：tsc 0；glsl ES1+ES3 OK；crack-metric 保持 crackGroups=0 attrCracks=0 maxWallBottomGap=0 lowDeltaWalls=0/1238 walls=trueWalls=38 shoreWalls=0 maxShoreWallDrop=0 worstAttrSpan=2.2e-16（几何未回退）。
客观量测：跨岸 luma 剖面（约 6000–8000 个岸线穿越点）`rimAboveBoth`=+0.0030 / −0.0014（≤0.01 即无亮边，阈值判定：**无白色亮线**）；岸线附近仅 1px、约 4% luma 的**暗**接触线残留在水侧。
view_image（`_sx9-1`/`-2`/`-3`，正式 01–05 已重出且晚于 shader）：陆地斑块=不规则有机变化、岸线形状=不规则（不再等距锯齿）；仍被报「岸线细亮线 / 浅水淡色六边块」——正式图 `01` 判定为 clean natural 4X terrain，`03` 近岸大倍率下仍报刚性锯齿。**未消除**：大尺度岸线形状仍受逐格水体数据约束（近岸为 1 格宽平滑过渡而非硬线）；浅水仍有约 1 格尺度的色块感。

## 交付 sx-shots（视觉回归 + 正式出图 + 文档）2026-09-17 18:22

改动文件：`src/render/shaders/hexTerrain.frag.glsl`（4×4 三次 B 样条混合取代 19 格高斯；relief 法线移到 fragment；域扭曲 1.5+0.55；`uMapTex1.B` 有符号岸距驱动水位/沙带/水深；湿+干沙两段岸带；近岸水色饱和、焦散 1.10；删除 dead `tidC`/`uvC`/`shoreC`/`elevC2`）、`src/render/shaders/hexTerrain.vert.glsl`（只留位移，删除 dHx/dHz 与顶点 relief 法线）、`src/hex/HexMap.ts`（新增 `landShoreDist`，tex1.B=水 +shoreDist / 陆 −landShoreDist）、`docs/VISUAL_TARGETS.md`、`docs/shadertoy-refs/TECHNIQUES.md`、`docs/shots/README.md`、本文件。临时 `uDbgCoast`/`uDbgHex` uniform 与其分支、`scripts/_samp-probe.mjs`、`_dbg-*.mjs`、`_crop.mjs`、`_shore-profile.mjs`、`_patch-frag.mjs` 全部删除；仅保留 `docs/shots/_dbgcoast.png`、`_sx2-3-zoom.png` 作证据。
截断误差前后：7 格 `exp(-d²*0.30)` truncRel=22.2%、跨格换集跳变 3.8e-2（1461× 格内步长）→ 19 格 `k=0.90` 0.45%、1.0e-3（22×）→ **B 样条单位分解 0**（权重和恰为 1）、跳变 3.6e-5 = 1×（无阶跃）、格内变化 0.0367→0.0486。
白线来源结论：A/B 蒙太奇（`_dbgcoast.png`）证明岸线亮带来自**岸带 albedo 叠加**（关 beach 或关 surf 即消失），非几何/非墙；同时测得 `foam` 早已失效（首圈水 `shoreDist`=0.108 > `foamEdge`≤0.038）。改为有符号岸距场驱动后，跨岸 luma 剖面（~8000 穿越点）`rimAboveBoth`=+0.010…+0.015（≈1.5%，无白色亮带），水侧仅剩 ~1px 略暗接触线。
crack-metric（本轮末次）：`worstAttrSpan=2.2e-16, maxWallBottomGap=0, topGroups=1160, crackGroups=0, attrCracks=0, walls=38, trueWalls=38, shoreWalls=0, maxShoreWallDrop=0, lowDeltaPairs=1238, lowDeltaWalls=0, RAMP_DROP=0.14`。
正式图 mtime：`0*-canvas.png` 18:21:50–18:21:57；最新源码 `hexTerrain.frag.glsl` 18:21:13（次新 `HexTerrainMaterial.ts` 17:50、`hexTerrain.vert.glsl` 17:35）→ **official newer=True**；`npm run shots` 同批重写 5 张整页 png。
P0-1 无双重 elev 量化：PASS（mapgen 无 `floor(elev*5)`、vert 无全局 terrace；雪带 1.47–1.89 按实测 crest 定标）。P0-2 无悬挂裙边：PASS（`maxWallBottomGap=0`；`02-canvas` 无浅色裙）。
P0-3 平地无格间墙：PASS（`lowDeltaWalls=0/1238`，`walls=trueWalls=38`，无低差假墙）。P0-4 无马赛克换色：**未达标**（换色台阶已客观消除，但 `01`/`04-canvas` 仍被报森林/浅水整格平色块；根因=每格 1 样本数据，属 P2）。
P0-5 水无环状色阶：部分（depth 改由岸距驱动+环形尺度噪声，`_sx2-3` 报宽连续陆架；`01-canvas` 仍报 thin bands）。P0-6 滩不是整格：PASS（湿沙首格+干沙内陆两段，`waterMask` 渐隐；`04-canvas` 报自然浅水过渡）。
P0-7 林缘非刀切：部分（林缘由混合场+世界噪声驱动，非折线；但斑块形状仍来自逐格 `forestCover`）。P0-8 默认无描边网格：PASS（`uShowWireHint` 默认 0，调试 uniform 已删）。
P0-9 拾取仍可用：本轮未改拾取路径（`main.ts`/`ChunkMesher` 拾取与高亮未动），本轮**未重验**。P0-10 编译：PASS（`tsc` exit 0；`glsl:check` ES1+ES3 四项全 OK）。
P1-1 山脉走向可读：PASS（`04-canvas` 可指出一条横贯连续岭）。P1-2 雪在真峰：部分（雪线按实测 crest 定标、只在高点出雪；本轮未单独出图）。
P1-3 崖/台地：PASS（38 面墙全部 drop≥0.50，陡处崖缓处坡）。P1-4 海岸层次：部分（滩→浅→深连续；按用户「白色亮线」投诉**删除贴岸白色泡沫叠加**，改由浅水色阶表达）。
P1-5 河谷：**未达标**（`04-canvas` 报看不到明确河谷/河岸带；`carveValleys` 数据存在但视觉不可读）。P1-6 林块成片：部分（cover 连续 411/583 格，非椒盐；斑块形状仍逐格）。
P1-7 光影/雾：PASS（`01-canvas` 有远景雾、受光/背光可分；relief 法线移到 fragment 后光影跨格连续）。P1-8 种子稳健：部分/未重验（`05` 已按随机种子重出，本轮未逐项看图对比）。
未解决 P2：① 子格数据采样或顶面加密，让生物群系/水深斑块形状不再跟随六边 mosaics（P0-4/P0-5/P0-7 的共同根因）；② 河谷歌剧化（P1-5）；③ 瀑布、位移面拾取、树冠高亮等 spec P2 项。**禁止**再写「逐格 mosaic 是故意保留」或「cliffs/hex walls=met」。

## 返工 rs1（只修审查列出的 P0-4/P0-7/P0-8/P1-4/P1-5 + 岸线白线）2026-09-17 18:55

改动（`hexTerrain.frag.glsl`）：① 岸线扰动放大到 ±0.10 sd ≈ ±0.93 格、波长 3.0/1.05 世界单位，水位过渡带宽 1.3 格（`smoothstep(-0.07,0.07,sdW+coastN)`）→ 水线不再等距走格；② 亚格第二尺度 world-space 斑驳（`+0.08*(warpedFbm(p*4.2,1.1)-0.5)`，warpFine 0.55→0.8）→ 格内不再是单一平色；③ canopy cover 掩模加高频项（`+(fbm2(p*2.3+17)-0.5)*0.45`）→ 林缘脱离整格轮廓；④ surf 改为离岸 ~0.5 格、宽度/断点由噪声驱动的碎浪（混色 0.30），岸侧不再有任何白色叠加；⑤ 新增河谷带：由 `riverDist`（= gShoreW 在陆上的值）驱动的湿岸绿带 + 窄水带 + 压暗，放在 canopy 之后以免被树冠盖住。`hexTerrain.vert.glsl`：canopy 抬升乘 `smoothstep(0.28,0.72,fbm2(pos.xz*1.15+7))` 世界噪声掩模 → 消除整格林台地（这是林缘硬边的主要几何来源）。
自测：`tsc` exit 0；`glsl:check` ES1+ES3 四项全 OK；crack-metric 逐字段与上轮**完全一致**（crackGroups=0 attrCracks=0 maxWallBottomGap=0 lowDeltaWalls=0/1238 walls=trueWalls=38 shoreWalls=0 maxShoreWallDrop=0 worstAttrSpan=2.2e-16）→ 几何/属性/墙位未回退。正式图 mtime 证据：`0*-canvas.png` 18:54:15–18:54:22，最新源码 `hexTerrain.frag.glsl` 18:53:51（次新 vert 18:46:21）→ official newer=True。
本轮 view_image（同一构建）：`01` = 陆地「irregular organic variation」、岸线「wavy coast with natural shallow water and broken surf patches」、无白线；`03` = 「not a single continuous bright white line」、有碎浪、岸线有海湾状不规则轮廓（但浅水仍报同心窄带）；`04` = 仍报「hard straight hexagon edges + bright white lines + 看不到河」。**同一构建下 01/03 与 04 判定相反** → 单图判定按弱证据处理，不据此宣称消除。
逐条：P0-4 部分（01/03 判有机、04 判整格平色；台阶已客观消除，斑块形状仍来自逐格数据）；P0-7 部分（同上，林缘已有世界噪声+高频掩模，几何台地已去除）；P0-8 代码证 PASS（`debugPanel.ts:29 showWireHint:false`、`HexTerrainMaterial.ts:105 uShowWireHint=0`、wire 分支以 `>0.5` 为门；判图所见格网=逐格 albedo/高度形状或六棱柱网格轮廓，后者属受约束不可改）；P1-4 部分（碎浪恢复、无连续白线；浅水仍 ring 分带）；P1-5 **未达标**（数据侧确认 23 格 riverDist=0、101 格<0.5，已加河谷带，但 04 仍未读出）。
未解决 P2：逐格数据分辨率（子格采样或顶面加密）仍是 P0-4/P0-5/P0-7 的根因；P1-5 需更强河道（宽度/深度/水色）；一致性判定需人工多模态复核（AI 判图自相矛盾）。

## 返工 rs2（白线来源定位 + 只修 P0-4/P0-7/P0-8/P1-4/P1-5）2026-09-17 19:28

**定位到真根因（代码 bug）**：`hexTerrain.frag.glsl` 里 `albedo = mix(albedo, water, waterMask * step(0.5, vFaceKind))` —— `step(0.5, vFaceKind)` 只在 **wall 面**为 1，所以整条水体栈（深度色阶、焦散、水色）**从未作用在可见海面上**，海色一直来自**逐格 palette**。这正是「浅水整格淡色块 / 水色按格分带」的来源；已改为 `topFaceW = 1.0 - step(0.5, vFaceKind)`（仅顶面）。
配套改动（均在 frag）：① 岸带调成「湿沙(暗)→接触水(暗)→浅滩(青绿)→深水(海军蓝)」三段，接触水在岸线首 ~0.4 格压暗（`contact*0.7`）；② palette 分介质累加（新增 `palW`，`pal = mix(palLand, palWater, waterMask)`），水面 palette 不再渗到陆地像素；③ 干沙带减弱(0.16→0.10)、湿沙带加宽加深；④ 水位/水深/碎浪/岸带全部由有符号岸距驱动（上一轮）+ 本轮三段水色。vert 未再改。
**测量方法与结论（一次性脚本，已删）**：在同机位拍 `uDbg` 模式（实时/灰底/灰底+平法线/水掩模/仅陆色/仅水色），用**精确水掩模**给岸线像素分类后取跨岸 luma 剖面（749–754 个岸线穿越点，`_locate-*.png` 已删）。结论：(a) 灰底 albedo 时**完全无亮边**（rimAboveBoth≈0）→ 亮边是 albedo 而非几何/光照；(b) 修复面门后浅滩剖面成为连续色阶；(c) 残留：岸线仍在最后一个水像素处有 **+0.018 luma（≈4.6/255）的窄亮边**（浅滩最亮处贴在水线上），陆地侧现在比之前更暗（湿沙 + 接触水，dipBelow=-0.019）。**注意仪器局限**：掩模无法把天空/雾与陆地分开，边界集合含地平线样本，已用「近景带 y>600」限定以减弱该偏差。
自测：tsc 0；glsl:check ES1+ES3 OK；crack-metric 逐字段与上轮一致（crackGroups=0 attrCracks=0 maxWallBottomGap=0 lowDeltaWalls=0/1238 walls=trueWalls=38 shoreWalls=0 maxShoreWallDrop=0 worstAttrSpan=2.2e-16）。正式图 mtime：`0*-canvas.png` 19:27:49–19:27:56 晚于最新源码 `HexTerrainMaterial.ts` 19:25:37 / `hexTerrain.frag.glsl` 19:25:07 → official newer=True。
view_image（rs2，本轮）：`_rs2-3` 浅水为**宽连续渐变**、水「looks like water（有深度渐变与波纹）」、仍报「岸线细亮线」；`_rs2-1` 海面为**可信水体、近浅远深**、无破图、山体平滑，但森林仍报**逐格图案**。
逐条：P0-4 部分（山体平滑；森林仍逐格，根因=每格 1 样本数据 → P2）；P0-7 部分（林缘掩模/树冠抬升已 world-space 化，但斑块形状仍逐格）；P0-8 PASS（代码证默认关闭 wire：`debugPanel.ts:29 false`、`HexTerrainMaterial.ts setFloat('uShowWireHint',0)`、wire 以 >0.5 为门；判图所见「格网」= 逐格数据形状或六棱柱轮廓）；P1-4 **改善**（浅滩连续渐变 + 接触水/碎浪；白线仅剩 +4.6/255 窄边）；P1-5 未达标（04 仍读不出河道）。
未解决 P2：子格数据采样（每格 4×4）或顶面加密，才能让森林/水深斑块形状脱离六边 mosaics；河道需更强表达；白线残留需压到 <1/255。

## P0+P1 收口 + P1-5 拾取（2026-09-18）

改动：`terrainContinuity.ts`（新增 `heightAt`/`pickTerrain`/`DispMode`/边界回退；`CLIFF_DROP` 0.50→0.30）、`main.ts`（拾取改走高度场 + debug hook 暴露 `terrainHeight`/`pickTerrain`）、`hexTerrain.frag.glsl`（水深改用岸距全程 0.95 增益 + 三段水色；雾密度 0.018→0.013）、`hole-check.mjs`（天空改纯品红、加正/负控制、8 连通泛洪、簇报告）、`corner-check.mjs`（从页面读真实 `CLIFF_DROP`）、新增 `pick-check.mjs`、`package.json`（`pick:check`/`verify`/`p0:check`）。
命令（全绿）：`npm run p0:check`（glsl ES1+ES3、tsc 0、crackGroups=0/uncoveredSteps=0、tornWeightCorners=0/cliffsWithoutWall=0、hole 0 封闭天空）；`npm run pick:check`（角点/中心误差 ≤4e-4、命中点到场距离 p95 8e-8、与网格拾取同格 163/181、旧 y=0 平面法 74 条射线选格不同）；`npm run shots`。
关键发现：① 之前的 879 个“封闭天空”是**检测器假阳性**——天空 `(1,0,0.5)` 渲成 (255,2,150) 恰好不满足 `b>150`，只有抗锯齿过渡行被判成天空；改纯品红后为 0。② `CLIFF_DROP=0.5` 时全图最大陆-陆落差 0.485 → 一面崖墙都没有；降到 0.30 后出现 10 面（8 真崖 + 2 发丝）且全部被墙桥接。③ `heightAt` 在边界会把点舍入到图外 → 加最近格回退（限 1.05·HEX_SIZE 内）。
遗留：拾取精度不含树冠抬升（≤0.09）。

## Reviewer 一轮 FAIL → 两处门禁返工（2026-09-18）

Reviewer 判定：P0-1 PASS、P0-2 PASS、P1-4 PASS、P1-5 PASS、**P0-3 FAIL**（hole:check 非确定性）。返工两条：
1. **hole:check 非确定性（真因已测）**：同一 setup 连跑 6 次 → 4 绿 2 红，红的两处是**1 像素宽的竖条**（x=946 高 1px；x=296 高 3px）在脊线剪影上。地形在两次运行间完全没动，说明这是光栅化覆盖率/AA 的舍入，不是几何缺口。改为**只统计能通过 3×3 腐蚀的封闭天空**（8 邻域全是封闭天空才算空洞）：剪影 AA 带只有 1px 宽、必含地形邻居，永远无法存活；真缺口必有内部像素。原始计数仍照报，overlay 绿色=候选、红色=存活。另加**合成空洞正控制**：正上方正交视角（`topDown`）下隐藏一个内部 chunk（`hideChunk`），要求腐蚀后计数 >50（实测 196049 px / 1 簇），同一视角 chunk 在位时必须为 0。加 `chunkBox` 取该 chunk 包围盒中心与尺寸，ortho 由尺寸推得。
2. **pick:check 角点对比（真因已测）**：`cornerMaxErr 0.278` 不是场的问题——顶点坐标是 float32，共享角点每个属主格各发一份、由不同 chunk 局部和算出，末位可能不同：`(−1e−17).toFixed(3)` 是 `'-0.000'`，`(1e−17).toFixed(3)` 是 `'0.000'`。原按 `toFixed(3)` 分组，把一个角点的三份拆成两组各一份，各自去比对方所属的台地，于是把一个完全吻合的角点报成 0.278 偏差。改为按**毫单位整数**分组（`String(−0)` 为 `'0'`）并在副本的**精确坐标**上求场值；同时把门禁改强：单台地角点必须**精确**吻合（`weldedCornerMaxErr`），双台地角点须落在其一（`splitCornerMaxErr`）且跨度必须达到 `CLIFF_DROP`（`splitBelowCliff`，两片台地只可能来自崖分支）。
命令：`npm run hole:check` 连跑 6 次全 exit 0、`totalHolePixels` 全 0；`npm run pick:check` exit 0（weldedCornerMaxErr 1.26e-6、splitCornerMaxErr 5.7e-8、splitBelowCliff 0、splitCornerGroups 14、maxSplitSpan 0.6058、centreMaxErr 8.7e-7、worst 空）。
清理：删除 `scripts/_vtx.mjs`、`probe-corner-split.ts`、`probe-coast-zoom.mjs`、`diag-shader.mjs`；保留 `calib-y.ts`/`lattice-metric.mjs`/`ortho-shot.mjs`/`seam-metric.mjs`（文档引用的长期工具）。

## Reviewer 终审 PASS + Primary 终态目视（2026-09-18）

Reviewer（w_fb8752fc，只读）独立复跑后给出 **VERDICT: PASS**：P0-1/P0-2/P0-3/P1-4/P1-5/返工1/返工2 全 PASS。它的独立证据：`npm run verify` exit 0；hole:check 6 连跑全绿（raw enclosed 4/0/1/4/0/1 px 波动，enclosedCorePixels 全 0，合成空洞 196045 px 存活 / baseline 0）；pick:check exit 0；自写 120 射线实测 field 命中 118、同格 95/118=80.5%（>75% 门，差格样本全为相邻格）。它判定返工 2 是「修正假阳性 + 加强门禁」而非放水，并判定腐蚀阈值可接受（第一道防线是 CPU 几何整数不变式，第二道是屏幕检测；合成空洞控制证明未失明）。
Primary 终态目视（`_rev2-1/2/3` + `_texab-on/off`，1440×900）：无裂缝、无透出天空、无悬挂白裙、无六边形网格线；山体连续、林块成片、水体近浅青绿→远深 navy 层次成立。
**残留（不在本轮 P0+P1 清单内，未修）**：① 浅滩色带外缘仍按轴向格呈现**六边形扇贝形**——机制已定位：`frag.glsl:164-165` 注释写明 t1 的岸距通道是**按格未滤波**烘焙（`sdW=(t1.b-0.5)*2`），所以其等值线必然沿格界；151-153 的 ±0.23 格低频 domain warp 只能平移不能去对齐。② 森林区可见少量**与轴向格对齐的深绿块**（t1.g `forestW` 同样未滤波）。③ A/B 实测排除细节贴图：`_texab-off-canvas.png`（关闭 `#dbg-tex`）方块仍在，故与 detail tex 无关。地图外缘的六边锯齿与外侧浅灰壁带属地图边界本身，非缺陷。

## 第三轮：林冠方阵（P2）定位并修掉（2026-09-18）

上一轮我把森林里的暗绿方块记成「与轴向格对齐」；实测推翻了这条：**它是与世界 x/z 轴对齐的方阵**。
- 定位手段：新增 `uDbgField`（0=正常着色，1..12=把某个打包场画成灰度，默认 0，不影响出货路径）+ `scripts/field-view.mjs`；用 `scripts/orient-metric.mjs` 统计强梯度方向（六边格＝垂直±30°，轴对齐＝垂直+水平）。
- 真因：`noise.glsl` 的 `canopyOctave` 用 `floor(p)` 的**未旋转方格**，且 jitter 可达整格、而邻域只取 2×2，于是被 jitter 推进邻格的树冠在采样里被整格裁掉，树冠被切成**约一格宽的轴对齐方孔**（`uDbgField=11` 灰度图里能直接看到方阵与直角切边；该场 60% 梯度能量落在水平方向）。
- 改法：格坐标先做低频 domain warp（`fbm(p*0.37)`，±0.45 格）再去 floor，邻域改 3×3，树冠不再被裁。改后同一场的 12 桶方向直方图变为 0.08–0.10 均匀。
- 顺带：顶面法线改为**纯解析 relief 法线**（原为 25% 几何扇形法线；扇形法线逐格不同，会把六边格写回着色）。实测森林区 plateauSpread 0.0653 → 0.0500（仅 warp+3×3）→ 0.0423（再换法线），噪声底 0.0029。侧壁 topW=0 仍用几何法线，崖面观感不变。
- 排除项：细节贴图不是方块来源（`#dbg-tex` 关闭后方块照旧；方向直方图几乎不变）。
- 复核：`npm run verify` 全绿（hole 原始 6 px 候选、腐蚀后 0；pick weldedCornerMaxErr 1.26e-6、splitCornerMaxErr 5.7e-8）；`_fix4-1/2/3` 目视：森林由方阵变为有机团块。
- 未做/未证实：浅滩的"六边形扇贝"经上视实测**不是场缺陷**——`elevW/reliefW/shoreW` 在上视灰度里都是平滑的，之前统计到的垂直/±30°能量来自**地图外缘锯齿**；海面观感上的六边感来自六边形海岸线本身（题材固有）。曾试把浅滩焦散 0.22→0.13、细节 0.04→0.025，目视无差别，已回退（无证据的改动不留）。
- 新增长期工具：`scripts/field-view.mjs`、`scripts/orient-metric.mjs`。

## 第四轮：雾把整图洗白（对比度）修掉（2026-09-18）

Reviewer 对上轮给 **VERDICT: PASS**（改动1/改动2/uDbgField/回归/目视逐条 PASS；它独立复跑 verify 全绿，并提醒 hole/pick 日志里各出现 1 条 BJS "Effect timed out after maximum retries"，疑似并行加载下的暂时性重试超时，不阻断，需留意复现）。
本轮接着处理观感：默认概览整图发灰。**量化**（只统计地形像素的 luma，天空按色相剔除）：雾开时 mean 133.0 / sd 29.6；关掉 `#dbg-fog` 时 mean 77.1 / sd 54.6 —— 即雾把地形均值抬高 56、把对比度砍掉 45%。逐项算过：概览远端 camDist≈100、低地 heightAtten 1.15、density 0.013 → 消光 78%，再叠加 `farFade`（36 起）的 30% 平混 ≈ 85% 雾。
改法：density 0.013→0.006、高地 heightAtten 0.40→0.45、farFade 36..120→70..220、权重 0.3→0.25。改后 mean 108.4 / sd 39.8：保留空气透视，去掉面纱。`_fix6-1/2/3` 目视：森林/沙漠/山地色彩分离恢复，远缘仍有薄雾。
`npm run verify` 全绿（hole 本轮 0 raw 候选、腐蚀后 0；pick、crack、torn、glsl、tsc 同前）。

## 第五轮：残洞真因（焊接标量与属主绑定）+ 崖面近黑（2026-09-18 深夜）

Reviewer 第四轮（雾）提问发出后 worker 离线，导出文件里只有提问、无回复 —— 本轮改动仍**未经 Reviewer 审核**。

先量化后动手：
- **残洞复现**：`npm run hole:check` 又变红（raw 825 / 腐蚀后 365 px），全部集中在 `coast-ortho6` 与概览的 `(1034,255)`，形状是**楔形**。用新写的 `scripts/_hole-focus.mjs` 复现同一机位：关掉背面剔除洞仍在（535→517 px）→ 不是剔除；关掉 `#dbg-disp` 后 **core 359→0** → 是顶点位移造成的，不是 CPU 几何。
- **真因**：`weldFromWorld` 在「断裂角」分支里返回**属主自己的**标量。实测世界顶点 `(20.78,-4)`：两个属主都被 `cornerTopY` 吸附到同一层 `y=1.447`，但 `weldElev` 分别是 0.2541 / 0.4273、`weldForest` 0.6988 / 0.4542 → 同一顶点两份拷贝的位移量不同 → 撕裂透天。改成按「所选层」取平均（仍让高侧带高格的起伏），`scripts/_weld-probe.ts` 复验同层属主标量已一致。
- **新增长期门禁口径**：`scripts/_disp-attr-check.mjs` 直接读真实 mesh（含侧壁，crack-metric 不建模），按三维位置分组统计位移输入跨度：`displacedAmpTearPositions=0`、`displacedLandMaskTearPositions=0`（剩余 elev 跨度 0.16 / forest 0.76 全在 `dispW=0` 的水角，位移恒 0）。
- **崖面近黑**：概览山脚那排侧壁原本 `(28,44,55)`、L/A 0.75，而同一排朝阳面 `(115,119,86)`、L/A 2.05 —— 读起来像黑槽口而不是阴影里的岩壁。改法：① 崖面 albedo 的压暗系数 0.52→0.70；② 墙向光给一个暖色下限 `ndlWall = max(ndl, 0.16*wallLift*wallOpen)`（只抬暗面，不动亮面，均匀加环境光会等比抬两侧、比值不变）；③ 墙面环境光的天空占比 0.5→0.20（`uSkyColor` 是高饱和蓝，1/3 就把岩层色染成青绿）。改后暗面 L/A 0.75→1.05，同排亮暗比 2.7→2.0，裁切图里能看到层理。
- 复核：`npm run verify` exit 0（glsl ES1+ES3、tsc、crack crackGroups=0/worstWeightSpan=0、corner tornWeightCorners=0、hole **0 raw 候选 / 0 腐蚀后**、disp:weld 0、pick weldedCornerMaxErr 1.18e-6 / splitCornerMaxErr 1.94e-7）；官方 01–05 已重拍（00:39，晚于全部源码改动）。
- 门禁补强：新增 `npm run disp:weld`（`scripts/disp-weld-check.mjs`）并接入 `p0:check`。原 `crack:metric` 只建模顶面扇形，看不到侧壁顶点，所以这次撕裂它是绿的；新检查直接读真实 mesh 缓冲，按三维位置分组，要求"位移开启（dispW=1）的同一世界位置上所有拷贝的 elev/mountainW/forestW 与 landMask 分支一致"，实测 2639 个共享位置全部通过（未位移拷贝的跨度 0.761 仅出现在水角，位移恒 0）。
- 未做：山脚那排侧壁仍是**等高等距的一整排**（地形数据如此），只是不再像黑洞；地图外缘锯齿与外侧灰壁属地图边界本身。
- 新增工具：`scripts/disp-weld-check.mjs`（已入门禁）、`scripts/_hole-focus.mjs`、`scripts/_weld-probe.ts`、`scripts/_png-crop.mjs`（后三者是临时诊断，未纳入 npm scripts）。

## 视觉优化轮 + 论文（2026-09-19）

先证后改。诊断路径：官方 5 图 → `ortho-shot` 特写（`_diag1-*`）→ `field-view` 模式 9（albedo 灰度）+ 方向直方图 → CPU 地形类型打印。四个观感问题全部定位到具体数据项：

1. **沙漠整片竖向帘纹**：albedo 灰度场平滑（直方图 vertical 0.073 无能量）⇒ 纯法线着色；周期 ~0.57wu 与 `rip = sin(dot(p,(0.95,0.32))·11)` 完全吻合；CPU 打印确认该带为 Desert（lr=22–24 密集 D）。修：振幅 0.05/0.03 → 0.018/0.011，加 `smoothstep(0.35,0.65, fbm2(p*0.5+3))` 补丁掩模（沙纹成片出现，不再全域平行条）。
2. **崖壁"鲨鱼齿"纸板感**：`vertBand` 竖条 0.09、横层理压暗 0.2、暗化系数 0.70 叠加过强。修：0.76+0.05·vertBand、层理 0.12、加逐壁低频色变 `0.92+0.16·fbm2(p*0.8+wp.y*0.4)`；光照侧背光暖色下限 0.16→0.24、wallAmb 天空占比 0.20→0.26。
3. **浅水"奶环"/大理石蠕虫纹**：焦散为两个低频 fbm 乘积（细胞状），提升 0.22 过强。修：频率 2.6/4.4→3.0/5.0、提升 0.22→0.12、碎浪 0.30→0.22、浅水停色 (0.30,0.58,0.62)→(0.22,0.50,0.55)、水法线涟漪 0.05/0.11→0.04/0.08。
4. **山体"脑纹"发白**：各向同性 `ridgeFbmd(p*0.45)` 各倍频叠加呈蠕虫团。修：位移域改各向异性 `R(30°)·p ∘ (0.32,0.55)`、amp 0.55→0.48，三处逐常数同步（vert 位移 / frag 解析法线链式法则 `Jᵀ=diag·R` / CPU 拾取副本 `displaceLandY`）；albedo 裂纹 0.22→0.16、高海拔岩石压暗 `mix(1,0.76,smoothstep(1.3,2.5,alt))` 衬托雪线、雪色提亮 (0.78,0.84,0.92)起；着色法线强度 0.85→0.70（位移+法线双计）。

命令与证据：`check-glsl` ES1+ES3 全 OK；`tsc` exit 0；`npm run p0:check` 全绿（crackGroups=0 / tornWeightCorners=0 / hole 0 raw 0 core / disp:weld 2639 位置 0 撕裂 / walls=95 全真崖）；`npm run pick:check`（同格 160/181，误差水平与改前一致）；`npm run shots` 重出官方 5 图（晚于源码）。诊断产物：`_diag1/2/3/4-*`、`_field-9-topdown.png`。临时 `scripts/_tid-probe.ts` 已删。

新增：`docs/paper/procedural-hex-terrain-paper.md` —— 系统性论文（数据原理：噪声合成/预滤波/SDF/焊接/门禁方法学）。

## 崖壁"块状/手风琴"重构（2026-09-19 下午）

用户指出山脚崖壁呈"块状"。定位：对照参考图（humankind-cliffs-plateaus / civ7-waterfall-cliffs），块状感 = **逐边常数几何法线的光照方波**——一条直崖上相邻墙的外法线是六边镶嵌的两种边朝向（±30°），对 sun=(0.62,0.72,0.30) 实测受光 0.82 vs 0（≈3:1），沿崖墙亮度以镶嵌频率交替，读作"折纸/手风琴"。这是"逐格常数量必画镶嵌"（P0-4 同根因）在**光照**上的表现。

修法（崖壁 ≈ 混合高度场的等值线，竖直面法线取场梯度）：
1. 新增顶点属性 `wallT`（0=墙底，1=墙顶；`ChunkMesher` 四个墙顶点分别 0/0/1/1，顶面 0；material attributes + vert varying 同步）——崖壁竖向结构的精确插值载体，不靠 wp.y 估算。
2. **场梯度法线**（frag）：对 `uMapTex0.b`（预滤波 elev 场）做中心差分（ε=0.5wu，4 tap），`fieldN = normalize(vec3(−∇elev, 0.018))`，`gReliefNrm = mix(几何法线, fieldN, 0.85)`。场跨面片连续 → 消除明暗方波；在发丝台阶处 ∇elev→0 法线自然朝上 → 台阶像地面一样受光（旧 pleat 残留一并消除）。
3. **冲蚀沟壑**：`fbm2d(p*2.2 + wp.y*0.13)`（近 y 不变量 → 竖向条纹），同一字段驱动法线（−∇φ·0.30·cliffW）与 albedo（0.84+0.30φ），明暗与纹路对齐。
4. **竖向明暗**（wallT 驱动，cliffW=smoothstep(0,0.35,wallDrop) 门控防发丝墙被画线）：崖脚 toe 0.60 → 亮面 1.06（t 0.02–0.60），顶缘接触暗缝 −0.22（t>0.78）。
5. **破碎顶缘**：`smoothstep(0.55,0.95,t)·smoothstep(0.35,0.75,fbm(1.9p+7))·(1−sandW)` 把台地面色拉过顶缘，直线 rim 被打断。
6. **层理粗化**：rockStrata bandCoord 4.5y+2.2·fbm → 3.0y+3.2·fbm（细直层理读作木板；参考图为少量厚波状层）。
7. 墙块内 sunW/topBlend 改用 gReliefNrm（原用逐边几何法线，是交替明暗的第二来源）。

命令与证据：`check-glsl` ES1+ES3 OK；`tsc` 0；`npm run p0:check` 全绿（crackGroups=0 / tornWeightCorners=0 / hole 0 / disp:weld 2639 位置 0 / walls=95 全真崖）；`pick:check` OK。特写 `_wall1-cliffband.png`：崖墙读作一条连续岩壁（受光连贯、竖向沟壑、崖脚暗部），方波消失；`npm run shots` 重出官方 5 图。门禁脚本只读固定属性名，新增 `wallT` 不影响。论文新增 §6.3"崖壁作为高度场等值线：目标观感的数学描述与重构"（参考图特征 ↔ 数学结构对照表）并更新附录 A/B。

## 断崖机制退役：全焊接连续地形（2026-09-19 傍晚）

用户确立**地形连续性规格**：任意竖直平面切过地形，剖面必须是连续平滑曲线，不得有高度突变。该规格直接否决崖墙/台地机制（垂直墙 = 剖面跳变），实施"全焊接 + 无墙"：

1. `terrainContinuity.ts`：`cellTopY` 移除 keep 回插（无条件 7 点均值平滑）；`cornerTopY` 删除分裂/吸附分支（无条件三格均值，保留临水角点 WATER_Y 岸缘规则）；`weldFromWorld` 删除分裂分支（无条件共享格均值）。`CLIFF_DROP/RAMP_DROP/MIN_WALL_DROP` 保留导出仅供旧门禁读取，mesher 不再消费。
2. `ChunkMesher.ts`：删除整个侧壁发射循环与 `wallDrop`/`wallT` 属性（含 `edgeNeighbour`/`sharedCornerIndex`/`isWaterLocal` 引用与重导出）。相邻扇形共享同一批焊接边缘顶点 → 曲面水密、连续 by construction。
3. `hexTerrain.vert.glsl`：删 `wallDrop`/`wallT` attribute 与 varying；`hexTerrain.frag.glsl`：删墙面法线分支（场梯度 + 冲蚀沟壑）、整个崖壁 albedo 块、墙面光照特例（sun floor / wallAmb / wrap·wallLift / shTint wallLift / wWall spec）；`HexTerrainMaterial` 属性表同步。陡坡着色改由连续场承担：坡度驱动岩/雪掩模 + 层理 + `cliffContact` 坡脚压暗。
4. `disp-weld-check.mjs` 移除 `wallDrop` 读取。`crack:metric`/`corner:check`/`pick:check` 无需改动（它们复刻 `cornerTopY` 或仅把 `CLIFF_DROP` 当阈值）。
5. **新门禁 `profile:check`**（`scripts/profile-probe.ts`，入 `p0:check`）：4 条贯穿剖面线（穿原断崖带/峰顶/两处海岸）按 0.01wu 采样，断言单步高差 < 0.05wu。实测 max 0.0086（max slope 0.86 ≈ 41°）——纯坡度、无跳变。

指标（全焊接 vs 有崖）：`maxCpuYSpanAtSharedCorner` 1.64→**0**；`undisplacedAmpSpan` 0.76→**0**；`walls` 95→0（0 台阶、0 裂缝）；`hole:check` 0 透天（无墙网格仍水密）；`pick:check` 面上误差 max 1.08→**1.37e-7**（分裂角点曾是 CPU/GPU 失配主源），同格 158/181；`disp:weld` 2557 位置 0 撕裂。
命令：`check-glsl` ES1+ES3 OK；`tsc` 0；`npm run p0:check` 六项全 OK；`npm run pick:check` OK；`npm run shots` 重出官方 5 图（`_weld1-*` 为特写证据）。
论文：§1.1 增补连续性规格；§5.1–5.3 重写为全焊接（保留机制退役的过程记录）；§6.3 改写为"连续剖面的陡坡着色"；§7 表更新并新增 profile:check；附录 A/B 同步。
遗留说明：`scripts/_relief-probe.ts`、`_weld-probe.ts`、`_keep-probe.mjs`、`_tri-probe.mjs`、`_hole-focus.mjs` 引用旧符号（临时诊断脚本，未入 npm scripts，不阻塞门禁）。

## 五方向探索汇总与首批改进落地（2026-09-19 晚）

5 个只读探索代理并行覆盖 goals §2.3 A–E；汇总见 `docs/design/2026-09-19-direction-explorations.md`。本轮落地四项：

1. **B 试点·子格细节带**：新增 `src/hex/fbm.ts`（旋转 FBM + 域扭曲，常数与 `noise.glsl` 同源）；`bakeRGBA` spec 支持 `detail`（**核累加之后**叠加零均值高频带）：forestCover 乘性 amp 0.15（自门控）、moisture 0.06 / elev 0.022 加性 + terrainId 门控（水上归零）。通道布局/MAP_SUB/几何路径不动。
   指标：field-view 模式 1（forestW 数据场）horizontal 占比 **0.905→0.660**（能量扩展到垂直/±30°）；orient-metric pm30 0.246→0.248（无新伪影）；`verify` 全绿且几何/拾取数字逐位不变（walls=0、profile 0.00858、pick 158/181、fieldAboveMesh 0.924）。官方 5 图重出无回退。
2. **C-M1·水文数据层**：新增 `src/hex/hydrology.ts`——S1 Priority-Flood 填洼（海洋+边界种子、closed-at-push 堆；hydroElev 先做与 cellTopY 同型的 7 点均值平滑）+ 湖判定（ε=0.008、≥3 格、湖面=溢流高程）；S2 D6 最陡下降 + 低频噪声破对称 + 填洼平台多源 BFS + Kahn 拓扑累加汇流面积。`generateMap` 接线 `map.hydrology`。
   **新门禁 `hydro:check`**（`scripts/hydro-check.ts`，入 `p0:check`，profile 之后）：H1 覆盖性/链终止/面积守恒 + H5 湖不变量。实测 seed 20260916：583 陆地格全部汇海成树、maxChain 16、terminalArea=583；湖机制在 seed 1/2/42/2024/31415/8888 触发且过门禁（该门禁种子本身无内陆洼地，0 湖——H5 存在性留给 M2 验收）。
3. **A·文档同步（P0/P1）**：VISUAL_TARGETS（Cliffs 行改「连续剖面 met」、metrics 重置 walls=0+profile 口径）、README（悬崖保留/侧壁 strata 三处 + verify 门禁说明）、TECHNIQUES（keep 回插事实修正、walls 38→0、删除 Vertical-face ambient lift 行、合并重复 metrics 节）、maturity-spec（2026-09-19 时效横幅 + §2.2/§2.4瀑布/P1-3/P2-1 改写）、game-design-web（拾取改 heightAt 口径）、shots/README、impl-progress 阅读注。
4. **D-0·calib-y 失效修复**：`scripts/calib-y.ts` 曾向 `displaceLandY` 传 `dispW=0`（所有位移项乘 dispW → 恒 0），探针实际测的是**未位移**焊接场。修复为传 `dispWeight(map, x, z)`，输出真实位移分布（峰顶 3.369→3.801，p50 1.373→1.426）。frag 雪线带 [1.47,1.89] 未动（视觉标定值）；其与修复后探针建议带 [2.66,3.42] 的失配记为方向 D 重标定步骤（D3）的输入，先冻结本轮截图为基线。

命令与证据：`npx tsc --noEmit` 0；`npm run verify` 全绿（八项含新 hydro:check）；`npm run shots` 重出官方 5 图；`node scripts/field-view.mjs --modes 1,4,5` 与 `node scripts/orient-metric.mjs` 前后对照存档于汇总文档。
遗留：D1–D4（噪声 TS 移植→顶点烘焙→雪线重标定→文档收口）；C-M2（S3 下切）；shader 侧 coverAmt 扰动减半试验；E（G6 玩法闭环）。

## 观感工作流 P1+P2 轮（2026-09-19 晚，look-workflow 首两轮）

合并远端 `605e594`（窄脊/宽浅架/森林分形/水色）后按 look-workflow 执行；P1 构图轮 + P2 光照轮各一。

**P1 构图（massif → 山链）**：`mapgen.ts` 加 `LookParams`——种子化珠链山脊折线（`buildChains`/`chainMaskAt`：3 条链 × 48 采样、峰珠振幅 0.55+0.45sin、(1−d/w)² 衰减），elev 叠加 `mask×chainAmp`；`baseKeep 0.58` 压低链间谷、`spineBoostKeep 0.12` 把 legacy 脊增强降为纹理级；`shoreExempt 0.45` 豁免近岸压扁（入海山脊不再削平）；分类：`mask>0.5` 强制 Mountains、Desert 加 `elev<0.42` 门（干旱带不再给高地涂奶油色）。
扫参：`scripts/look-sweep.ts`（内置 PNG 编码器，纯 CPU 出高程灰+生物群系彩网格）3 批 23 变体（`docs/shots/_sweep-p1-*/`），选 C1。灰 albedo 证据 `_look-p1-mode9.png`：**两条山链+链间谷+山麓带，穹顶消失**。rubric `01/composition 0→2`。
**P2 光照（黏土漫射 → 明暗面）**：`terrainContinuity.bakeLightmap`（tex2：R=光线步进日晒、G=地平线 AO、B=位移后高度；高度源 `heightAt('shader')` 与画面同源；高度网格预采样 ~2.5 万次 heightAt，免 120 万次）；材质加 `uMapTex2`/`uShadowK`/`uAOK`/`uShadowCool`，frag 直射项乘 `sunGate`、AO 乘烘焙值、阴影面冷色调（look-workflow P2 推荐的 CPU 烘焙路线）。
扫参：`scripts/look-sweep-p2.mjs` 6 档（`docs/shots/_sweep-p2-light/grid.png`），选 L3（0.95/0.75/0.5）。rubric `01/lighting 1→2`。
门禁：glsl ES1+ES3 OK、`verify` 八项全绿（含修复后的 hydro:check）。**hydro:check 两处修复**（远端更深深切暴露）：S2b 平台路由改为「分量出口=已解析/边界终端邻格(≤本平台水位)+多根 BFS」，消除 step-1×BFS 混合 2-环；边界洼地终端语义入门禁（H1a/H1b/H1c）。17 种子全过。
新工具：`scripts/look-sweep.ts`、`look-channels.mjs`、`look-rubric.mjs`、`look-sweep-p2.mjs`、`png.ts`；`docs/design/look-scores.md`。
残留：P3 分级（链岩仍偏米色）、P4 真河、P5 林冠起伏、P7 外缘锯齿。

## 观感工作流 P3+P4 轮（2026-09-19 深夜，接 P1/P2）

**P3 分级（灰雾 → 暖阳冷影）**：frag grade 移到 tonemap **之前**——新增 `uExposure/uSaturation/uSplitWarm`（warm `vec3(1.07,0.99,0.86)` / cool `vec3(0.88,0.95,1.14)` 按 preLuma smoothstep 分离），删除原 post-tonemap 的 sat 1.16 与旧 split（避免双重分级）。扫参 `scripts/look-sweep-p3.mjs`：3×3 饱和×split + 2 曝光探针（`docs/shots/_sweep-p3-grade/grid.png` + manifest）；sat 1.45 过饱和（浅海刺眼）、1.00 太闷，选 **G-sat1.22-spl0.90**（exposure 1.04）。rubric `01/调色 1→2`。

**P4 真河 M2/S3（假河 → 水文河道）**：删除贪心游走 `carveValleys`，`generateMap` 重排为 S1/S2（pre-carve）→ `carveChannels` → `recomputeRiverDist` → S1/S2（post-carve，门禁口径=出货口径）。
- `carveChannels`：`area≥16`（`CHANNEL_AREA_THRESHOLD`）选河（40 格 ≈ 6% 陆地）；深度=流功率静态近似 `min(0.12, 0.18·√A·slope)` 过 **2 遍 7 点陆地均值**（规格要求的同型平滑核，兼作岸坡倒角）；**嘴→上游**排序写入并强制河床沿树下降（`elev[i] ≥ elev[receiver]+0.004`），杜绝下切自造洼地/跌水。
- `computeHydrology` 加 **Strahler**（独立 donor 计数的 Kahn，max1/max2 法则）+ `stats.maxStrahler/channelCells`；`channelWidth(A)=0.2·(A/16)^0.45`（Hack 量级，源头 0.2 → 河口 ≤1.6 格）。
- `recomputeRiverDist`：真通道 6 步 BFS 归一化 + Riverbank，喂给既有 frag 河带管线（bank 绿带 + ribbon 蓝带 + 河面高光）。
- `hydro:check` 扩 **H2**：`maxStrahler ≥ 3`（≥20 通道格时）+ 宽度沿下游链单调不减断言。门禁种子：Strahler 3、通道 40 格、主干 22 格；16 种子全过。
- `profile:check` H3 保绿：maxStepDelta 0.00858→0.02193（< 0.05，V 谷连续），maxSlope 0.86→2.19。
- 渲染验证：官方 01/04 上**连续青蓝水带沿谷地蜿蜒入海**（bank 绿 + ribbon 蓝 + spec），河轴从「数据有、画面无」升级为可读。rubric `01/河 0→2`。

新 rubric 记录见 `docs/design/look-scores.md`（composition 2 / lighting 2 / 调色 2 / 河 2，均无回归）。残留：P4 完整 S4（水面高程进 heightAt + pick 契约改口径 + uMapTex3 flow 通道）、P5 林冠起伏、P7 外缘锯齿。
