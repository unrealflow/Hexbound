先对齐职责与验收基准，再只读采集参考图、现状截图和关键代码，产出可执行规格后再自审。正在拉取宿主快照、记忆与代码定位，同时对照参考图和现状截图。接下来对照 5 张画布截图和 12 张参考图，并抽出关键着色器、网格与地图生成代码。WCI 索引已过期，改为直接读源码，并继续对照参考图。已对照 5 张 `-canvas.png`、12 张 `refs/*.jpg` 和当前着色器/网格/地图生成源码。下面是可直接交给实现的规格，随后是自审。

---

# Hexbound 地形成熟度规格（指标 A 无缝 + 指标 B 地标观感）

> **时效注（2026-09-19）**：本规格写于崖墙机制退役之前。2026-09-19 的「全焊接连续地形」
> 已移除全部垂直崖墙/台地机制（`terrainContinuity.ts` 无条件焊接、无侧壁），本文
> §1.2 的侧壁三态与 `CLIFF_DROP` 分裂分支、§2.2 崖壁与台地、§2.4 瀑布、P1-3、
> P2-1 等条款凡涉及崖墙者，一律以
> `docs/design/2026-09-19-hexbound-goals-and-refs.md` §1.2/§2 为准：**无任何竖直墙，
> 任何剖面连续（profile:check），陡峭由连续陡坡 + 坡度驱动岩雪着色表达**。
> 文中 "walls=38 / CLIFF_DROP=0.50" 等数字均为退役前口径（现值 0.60 且已退役）。

**验收原话：**「远没有达到要求，要求有成熟的游戏场景地标观感，且地形连续无接缝问题……达到一个极高的成熟度。」

**硬指标**

| 指标 | 可判定含义 |
|---|---|
| **A 地形连续无缝** | 不得有逐六边形换色的马赛克/拼块感；不得有格间硬色阶、裂缝、突兀裙边；相邻格外观必须自然过渡。 |
| **B 地标级观感** | 成熟商业 4X/策略场景的地标感：可读的山脉走向与峰岭、连续陡坡的岩雪分层、海岸与浅滩、河谷、森林块。 |

**方向基准：** `refs/` 下 12 张 jpg（Civ6/Civ7/Humankind/AoW4），只作观感，禁止当地表贴图。  
**约束：** 程序化 GLSL + `public/tex` 小幅可平铺细节贴图；棋盘格/六边框只能作极淡可读性提示。  
**本轮视觉证据：** `docs/shots/01..05-*-canvas.png`（`view_image` mode=llm）。未重新跑 `shots`（现有捕获已足够定位缺陷）。

**必须推翻的旧结论：** `docs/VISUAL_TARGETS.md` 第 42 行把「逐格 albedo 台阶」写成「故意保留的玩法偏差」，第 36 行把「Cliffs / hex walls」标成 `met`。这两条与用户本轮原话冲突，实现时以本规格为准，文档由 Primary 改。

---

## 0. 方案选择（推荐一条路）

| 方案 | 做法 | 优点 | 风险 |
|---|---|---|---|
| **A 仅改 mesh 角点属性** | 角点混合 elev/moisture/shoreDist | 改动小 | `terrainId`/`featureId` 仍是分类 ID，色块会留在格心 |
| **B 世界空间地图数据纹理** | 40×32 两张 RGBA，片元按轴向重心混合 | 外观与网格拓扑解耦，无缝最稳 | 要移植轴向公式到 GLSL；ES1 用 `texture2D` |
| **C 每格独立模型/照片 atlas** | 禁 | 违反 VISUAL_TARGETS | — |

**推荐：B + 几何侧 A（混合）**

- **逻辑层不变：** `HexMap` 格仍是离散 `terrainId`/`featureId`/`elev`（拾取、UI、以后玩法）。
- **视觉层：** 世界空间场（数据纹理 + 片元混合）决定颜色；角点焊接 + 条件侧壁决定几何。
- **拾取已与顶点属性无关：** `src/main.ts` 第 95–119 行用 `y=0` 平面射线 + `worldToAxial`，改着色/几何只要 XZ 轴向映射不变即可。可读性靠拾取高亮圆盘 + 可选极淡 `uShowWireHint`，不靠马赛克色块。

---

## 1. 指标 A：无缝化（根因 → 算法）

### 1.1 根因表（本会话读到的行号）

| # | 现象 | 根因 | 位置 |
|---|---|---|---|
| A1 | 逐格换色马赛克 | 每个顶点属性都复制**本格常量**，扇形三角形不共享顶点；`vTerrainId` 在格内恒定，格边界硬切 | `ChunkMesher.ts` `pushAttr` **334–338**；`hexTerrain.frag.glsl` `terrainAlbedo` **201–208** 的 `tid` 阶梯 |
| A2 | 满屏竖向裙边 | 任意邻格高度差都挤出侧壁；`yBot` 还额外沉到 `minNeighborY - 0.02` 以下，裙边挂在邻格顶面之下 | `ChunkMesher.ts` **160–163** `skirt`/`yBot`；**206–273** 侧壁循环；跳过条件 **227–233** 仅 `drop<0.07` 且 `elev` 差 `<0.04` |
| A3 | 角点高度不对称 → 裂缝，用 `HEX_SIZE*1.002` 遮 | `cornerTopY` 以本格 `selfY` 为主（邻格最多 0.28），共享角在两格上 Y 不同 | `ChunkMesher.ts` **61–86**；顶面 **193** `hexCornerOffset(i, HEX_SIZE * 1.002)` |
| A4 | 高度被量化成 5 级台阶，邻格几乎总是「悬崖」 | mapgen 把连续 elev 打成 `floor(elev*5)` 再加噪声；顶点着色器再做一次 5 级 terrace | `mapgen.ts` **125–127**；`hexTerrain.vert.glsl` **75–80** |
| A5 | 水深环状色阶 | `shoreDist` 是 BFS 环数 / 4，只有角点 1/3 混合，格心仍是阶梯 | `HexMap.ts` `recomputeShoreDepth` **162–210**（`MAX_STEPS = 4`）；`ChunkMesher.ts` `cornerShoreDist` **95–109**；frag **181–193** |
| A6 | 林缘硬边 | `featureId` 整格 0 或 1/2，片元 `if (fid > 0.5 && fid < 2.5)` 一刀切 | `mapgen.ts` **189–201**（`hash2` 伯努利）；frag **227–228** |
| A7 | 沿岸整格染色 | `edgeMask` 邻水即 0.85/1.0，整格同一值；frag 即使有 hexSDF 仍有 `shore * 0.18` 的格内底色 | `HexMap.ts` `recomputeEdgeMasks` **131–156**；frag **310–317** |
| A8 | 格边被 AO/线框再描一道 | `contactAO` **默认永远**压暗 hex 边；`uShowWireHint` 默认 0，但 contactAO 不是开关 | frag **424–427**；`HexTerrainMaterial.ts` **93** `uShowWireHint=0` |
| A9 | 顶点位移按分类 ID 开关 → 格边界高度再跳一次 | 山体 ridged FBM 只在 `tid>3.5 && tid<5.5`；林冠抬升只在 `fid` 匹配 | vert **47–73**、**91–99** |

截图对应（本会话 `view_image`）：

- `02-zoomed-cliffs-canvas.png`：约 50–80 条可见竖裙（白/浅蓝色带）；平地换色对齐六边；山体是「一叠灰六边」而非连续岭。
- `03-panned-coast-canvas.png`：浅海环状色带、滩涂整格、林缘刀切。
- `01`/`04`/`05-*-canvas.png`：平原/沙漠/草格马赛克，缺河谷，林块是深绿色块。

---

### 1.2 几何无缝（侧壁 / 裂缝 / 台阶）

**删除双重量化（P0）**

1. 删 `mapgen.ts` **125–127** 的 `tier = floor(elev*5)` 整段。陆地 `elev` 保持连续 `[0.08, 1]`。
2. 删 `hexTerrain.vert.glsl` **75–80** 的全局 terrace。台地只允许在「缓坡丘陵且局部坡度低」处用**很小**的 smoothstep 台地（幅度 ≤ 0.04×`uElevScale`），且权重来自连续 `elev` 而非 `tid`。

**共享角点焊接（P0）——替换 `cornerTopY`**

三个共用一个角的格子：`(q,r)`、`(q,r)+AXIAL_DIRS[(i+5)%6]`、`(q,r)+AXIAL_DIRS[i]`。

```
CLIFF_DROP = 0.50   // 世界 Y，约 elev 差 0.25（ELEV_SCALE=2）
RAMP_DROP  = 0.14

ys = [ySelf, y0, y1]  // cellTopY，水格恒 0.02
span = max(ys) - min(ys)

if 三角都含水或全是水:
    Y = 0.02
elif span < CLIFF_DROP:
    Y = (ySelf + y0 + y1) / 3     // 对称，两格算出同一值
else:
    Y = ySelf                      // 真悬崖，角点分裂
```

禁止当前 `wSelf=1-w0-w1`、邻格最多 0.28 的不对称公式。同一角的世界 XZ 由 `axialToWorld + hexCornerOffset(i, HEX_SIZE)` 决定，**半径改回 `HEX_SIZE`（去掉 1.002）**；裂缝靠焊接，不靠重叠。

**侧壁只在真落差处出现（P0）——重写 `buildChunkMesh` 侧壁循环 206–273**

只让**较高的那一格**出面（避免双边 Z-fight）：

```
nY    = cellTopY(neighbor)
yA,yB = 本格该边两端焊接后的角点 Y
edgeTop = max(yA, yB)
drop    = edgeTop - nY

if 本格是水 and (邻格是水 or 出界): continue          // 保持开阔水面无墙
if drop < RAMP_DROP: continue                         // 顶面已焊接，不要墙
if 本格 Y 中值 < 邻格 Y 中值: continue                 // 低侧不出面

if drop < CLIFF_DROP:
    // 斜坡连接：底边 Y = 邻格顶（不是 yTop-skirt）
    emit quad (c0,yA)-(c1,yB)-(c1,nY)-(c0,nY)，法线按坡面算
else:
    // 真悬崖：垂直墙，底边仍停在邻格顶，禁止再沉 0.3+elev*0.6
    emit vertical quad，底 = nY
```

删掉：

```
skirt = 0.3 + cell.elev * 0.6
yBot  = min(yTopFlat - skirt, minNeighborY - 0.02)
```

**唯一允许的「地基裙」：** 地图外边界、或陆地贴深水且 `elev>0.45` 的海岸崖（底可到水面 `0.02`，不要到 `-0.2` 除非是水格自身水体厚度）。

水格：保持共面 `y=0.02`、水↔水无墙（已有 **216–217**，保留）。

**顶点位移必须用连续权重（P0）**

在 `pushAttr` 增加（或写入数据纹理由顶点读——WebGL1 顶点纹理不可靠，**用顶点属性**）：

- `mountainW`：`smoothstep(0.38, 0.62, elev)` 再与 6 邻平均，0–1
- `forestW`：见 1.4

vert 里用 `mountainW` 替代 `tid > 3.5 && tid < 5.5`，用 `forestW` 替代 `fid` 开关。分类 ID 不再驱动位移。

---

### 1.3 外观无缝：地图数据纹理 + 六边重心混合（P0）

**新增 2 张 `NEAREST` + `CLAMP` 的 40×32 RGBA 纹理**（`HexTerrainMaterial.ts` 增 sampler；`meshMap`/`rebuild` 时上传，reseed 重建）。

| 纹理 | R | G | B | A |
|---|---|---|---|---|
| `uMapTex0` | `terrainId / 8` | `featureId / 8` | `elev` | `moisture` |
| `uMapTex1` | `shoreDist` 连续 0–1 | `forestCover` 0–1 | `landMask`（陆地 0，水 1） | `relief`（6 邻 elev 极差，0–1） |

uniforms：`uMapOrigin`（`originQ, originR`）、`uMapSize`（`width, height`）、`uHexSize`。

片元：把 `coords.ts` 的 `worldToAxialFrac` 移植到 GLSL（pointy-top，`HEX_SIZE=1`）。

**混合（不要笛卡尔双线性，那会在六边对偶上歪）：**

```
axial = worldToAxialFrac(wp.xz)
取最近 3 个六边中心（立方体坐标圆整的 3 候选）
w_i = max(0, 1.0 - 1.35 * axialDistance(p, cell_i))^2
再做高度混合：w_i *= pow(0.22 + 0.78 * hash21(cell_i) * biomeHeight(tid_i, wp), 5.0)
归一化
```

**禁止**对 3 个格子各跑一遍完整 `terrainAlbedo`（FBM 太重）。拆成：

1. `biomePalette(tid, moist, elev)`：只返回基础色（廉价 mix）
2. `albedo = Σ w_i * palette_i`
3. **世界空间细节只做一次**：`rockStrata` / `microDetail` / 林冠 / 水焦散都用混合后的权重与 `wp.xz`

分类 ID 的 `if (tid < 0.5) ... else if` 阶梯废掉，改成 8 个 biome 权重（可由 3 样本累加）。`vTerrainId` 仍可留给拾取调试，但**不再是外观的主输入**。

WebGL1：只用 `texture2D`；UV = `((q-originQ)+0.5)/width`（半纹素）。`glsl:check` 必须 ES1+ES3 双过。不要用保留字 `patch`。

---

### 1.4 连续场：水 / 滩 / 林（P0）

**水深 SDF（替换 BFS 环）**

`HexMap.recomputeShoreDepth`：

- 陆地 `shoreDist=0`。
- 水格：用 hex 步长 BFS，但存的是 `minDist * HEX_SIZE`（世界距离），再 `/ (8 * HEX_SIZE)` 归一化到 0–1。`MAX_STEPS` 从 4 提到 **8**。
- 角点继续 3 格平均（已有 `cornerShoreDist`），数据纹理同样被片元重心混合。
- 片元：`depth = shore + (fbm2(p*0.9)-0.5)*0.08`，**去掉** `if (tid>6.5) depth=max(depth,0.55)` 这种整格抬升（frag **182–184**），深海用距离场自然饱和。

**滩涂条带（替换整格 edgeMask）**

`edgeMask` 改为「到水的世界距离」的倒场：陆地 `exp(-d / 0.28)`，再进纹理。frag 海滩改为：

```
float dWater = /* 从 uMapTex1.b 的距离或 1-land 的 SDF */
float beach = smoothstep(0.22, 0.0, dWater);   // 只在约 0.22 hex 宽
albedo = mix(albedo, vec3(0.88, 0.80, 0.58), beach * 0.55);
```

删掉「`vEdgeMask>0.1` 则整格 18% 沙滩」的底色项（frag **310–317** 的 `shore * 0.18`）。

**林冠覆盖场**

`HexCell` 增 `forestCover: number`（0–1）。mapgen 已有 `forestBelt`（**151、196**）：写入连续值，**不要**用 `hash2 < belt` 把整格打成 0/1。`featureId` 仍可在 `forestCover>0.45` 时标 Forest/Rainforest（玩法/UI），但着色只用 `forestCover`：

```
cover = smoothstep(0.32, 0.68, forestCover + (fbm2(p*1.4)-0.5)*0.22)
```

林缘约 0.5 格的噪声渗透（对标 Civ7 林缘规则：疏密渐变，禁止刀切）。`canopyField` 世界空间已有，保留，但乘上 `cover`。

---

### 1.5 取消「描边强化边界」（P0）

- frag **424–427** `contactAO`：默认 `1.0`。仅当 `uShowWireHint>0.5` 时，`lit *= 1.0 - darkRim * 0.10`（比现在的 0.20 更淡）。
- 悬崖接触暗化改用 `relief` 与 `n.y`，不要用 `hexSDF`。
- `uShowWireHint` 默认关（已是）；打开时只作可读性提示，不能在 `01-overview-default-canvas.png` 上形成拼块网格。

---

### 1.6 不破坏拾取与六边可读性

| 机制 | 处理 |
|---|---|
| 拾取 | 保持 `main.ts` 平面射线 + `worldToAxial`；逻辑 `HexMap` 不改离散格 |
| 高亮圆盘 | 保留；Y 用 `cell.elev * ELEV_SCALE + 0.12`（山体位移后可能略悬空，P2 再贴合） |
| 六边可读 | 点击高亮 + 可选 10% 暗边；**禁止**用整格换色当可读性 |
| `mesh.isPickable` | 可保持 true，但当前指针逻辑没用 mesh pick |
| 调试面板 | 选中格仍显示离散 `terrainId`/`featureId` |

**已知限制（不阻塞 P0）：** 斜相机下山体用 `y=0` 平面拾取会偏一格。P2 可改为与地形高度求交。不要为修这个改视觉主路径。

---

## 2. 指标 B：地标观感

对标本会话看过的 refs（色板为约值，按「感觉」不是贴图像素）。

### 2.1 山脉走向 / 峰岭（P0 几何连续之后的 P1）

**现状：** `mapgen.ts` `ridge()` 脊线（**99–102、173–175**）被 5 级量化打散；vert 位移按格 `tid` 开关，山是「灰六边堆」。

**实现要点**

1. 连续 `elev` 上保留 1–2 条 domain-warp 脊（已有 `spineMix`）。陆地：`elev += max(0, spineMix-0.48)*1.05`，**不要**整格抬到 `max(elev,0.75)`（删 **175** 那种整格抬顶）。
2. 沿脊做各向异性：`ridge(wx*2.8, wy*2.8)` 已偏一个方向；再把次脊 `spine2` 权重降到 0.45，避免满图都是山。
3. vert：`mountainW` 连续；`ridgeFbmd(pos.xz * 0.45)` 幅度加大到约 `0.55 * mountainW * uElevScale`，让峰沿脊走，而不是每格一个鼓包。
4. 雪线（已有 frag **172–178**，跟位移后的 `vWorldPos.y`）：阈值略升到 `smoothstep(2.35, 2.95, alt + snowN)`；乘 `smoothstep(0.55, 0.25, slope)`，雪进凹槽/北坡（对标 Civ6「缝里有雪」）。积雪色 `#F0F8FF` 受光 / `#B0C4DE` 背光（AoW4 arctic）。

**色板：** 岩暗 `(0.15,0.145,0.15)`、岩暖 `(0.40,0.32,0.22)` 已在 `rockStrata`；峰顶灰 `(0.50,0.51,0.53)`。地层序列按 Humankind：底 `(80,70,60)` → 赭 `(150,110,70)` → 顶 `(190,170,130)`，夹一层砖红 `(140,70,50)`（`rockStrata` 的 `bandVar` 已接近，把暖带对比拉到 0.65）。

**技法：** `docs/shadertoy-refs/TECHNIQUES.md` 的 `ridgeFbmd` + 位移梯度法线（vert **101–107**）。山体法线 `reliefScale` 对山改为 0.85（现在 0.5 偏平）。

### 2.2 连续陡坡与岩雪分层（P1；原「崖壁与台地」，2026-09-19 随崖墙退役改写）

- 陡峭一律用连续陡坡表达：坡度（解析法线 `n.y` / relief）驱动岩/雪/草甸掩模，对标 Humankind 的坡面层理与「顶底柔化」，不再有折线崖边。
- 坡面混岩/草（meadow 项看 `n.y` 不是 `tid`）保留并按坡度加宽过渡带。
- `rockStrata` 层理保留，作用对象从侧壁改为陡坡坡面；坡脚接触压暗（relief + `n.y`）保留。
- 台地观感（若有）只允许以连续缓台 + 坡面着色表达，禁止量化台阶与竖直墙。

**色板（干旱崖，Civ7 waterfall / Humankind arid）：** 受光赭 `#D2A564` 附近，阴影灰褐 `#6E4B32`。温带崖保持现有暖棕/灰。

### 2.3 海岸与浅滩（P1，场连续后）

对标 `humankind-coastal-islands.jpg` / `civ7-coastal-plains-forest.jpg`：

| 带 | RGB 约值 | `shoreDist` |
|---|---|---|
| 滩 | `(0.88, 0.80, 0.58)` 现有 | 陆地 SDF &lt; 0.22 hex |
| 浅 | `(0.10, 0.66, 0.64)` 现有偏饱和；改为 `(0.48, 0.74, 0.74)` 更接近 `#7ABDBD` | 0–0.22 |
| 陆架 | `(0.18, 0.55, 0.64)` ≈ `#47A4A4` | 0.22–0.50 |
| 远海 | `(0.04, 0.13, 0.31)` ≈ `#0F3250` | 0.50–1 |

- 泡沫只在 `shoreDist<0.06` 的不规则带（现有 frag **319–327** 可用，把 `smoothstep(0.02,0.09)` 收窄到 `0.015–0.055`）。
- 水表面共面，禁止浅/深水格之间出墙（已有）。
- 删整格 `tid>6.5` 强制加深。

**技法：** 双层水法线（frag **348–356**）保留；焦散只在浅水 `shallowW`。

### 2.4 河谷与瀑布类地标（P1 河谷，P2 瀑布）

**现状：** 陆地 elev 只加不加减，没有谷。

**河谷（P1）** — 在 `generateMap` 第二遍之后：

1. 用低 `elev` + 高 `moisture` 的格子作河谷种子（`elev<0.28 && moist>0.55 && 非水`）。
2. 沿「邻格中 elev 最低」走 8–20 步，降低路径 `elev *= 0.72`，`featureId=Riverbank`，并给路径 1 邻域 `elev` 做 0.85 缓坡（河谷切口）。
3. 着色：`Riverbank` 不要整格换色；用到路径的世界距离 SDF（可塞进 `uMapTex1` 空闲或 `featureId`+距离）。河床沙 `(0.62,0.52,0.32)`，宽约 0.25 hex。

**瀑布（P2；2026-09-19 改写——无侧壁可依附）：** 在河谷的连续陡坡段以**着色/条带场**表达水帘：白沫混入陡坡 albedo + 向下条带 `abs(sin(wp.x*8.0+fbm))` + 坡脚底雾 `smoothstep`，不建新 mesh。对标 `civ7-waterfall-cliffs-arid.jpg` 改述为「连续陡坡 + 水帘」。

### 2.5 林块自然过渡（P1）

- 连续 `forestCover` + 噪声渗透（1.4）。
- 林块要成带：`forestBelt>0.4` 的连通域保留，删掉 `hash2(q,r,seed+99)` 造成的椒盐孤格（mapgen **196**）。可用一次 6 邻 majority（已有地形 majority **250–290**，对 `forestCover` 做类似：邻均 &lt; 0.25 则拉到 0，&gt; 0.6 则拉到 max）。
- 色：林下 `(0.035,0.10,0.03)`，冠受光 `(0.22,0.43,0.10)`，暖梢 `(0.44,0.54,0.14)`（已有）。边缘 30% 混草地，避免深绿色块。
- 远距 `farLod` 已有，保留以免冠格点状摩尔纹。
- **仍禁止树 mesh。**

### 2.6 光照与空气透视（P1）

现状：正交相机让距离雾变弱；`density=0.012`（frag **459**）；无阴影贴图。

| 项 | 规格 |
|---|---|
| 太阳 | 保持左上，`uSunDir ≈ (0.62, 0.72, 0.3)`（已与 `createScene.ts` **92、118** 一致） |
| 对比 | `ndl` 项从 `sunCol * ndl * 1.3` 提到 `1.55`；环境 `hemi*0.45` 降到 `0.32`（对标 AoW4/Civ 金时 60/40） |
| 阴影色 | 草阴偏青绿 `(0.12,0.16,0.10)`，岩阴偏紫灰 `(0.12,0.11,0.14)`，不要死黑 |
| 雾 | `density` 0.012 → **0.018**；`farFade` 起点 48→36（正交下才读得见空气透视） |
| 谷雾 | `heightAtten` 改为 `mix(1.15, 0.40, clamp(vWorldPos.y/3.0,0,1))`，谷更浓、峰更清 |
| 天穹 | zenith `(0.18,0.38,0.72)` / horizon `(0.72,0.78,0.86)` 可保留；地平暖带已有 |

不新增 shadow map 通道（单材质、分块网格约束）。形体靠位移梯度法线 + wrap + 坡度 AO。

**技法：** TECHNIQUES.md 的 `fogExtinct`、filmic tonemap、sky disk。

---

## 3. 性能与平台约束

| 约束 | 规格 |
|---|---|
| 网格 | 继续 `CHUNK_SIZE=8`、每 chunk 一 Mesh、**一个** `HexTerrainMaterial` |
| 地图 | 40×32 不变；数据纹理 2×40×32 RGBA8 ≈ 10 KB |
| 每帧 | 禁止 CPU 回读 GPU、禁止每帧重建 chunk；`uTime`/`uCamPos` 照旧 |
| 着色器 | 3 格 palette + **一次**世界细节；林冠 2×2 环保留；远像素已有 `farLod` |
| 属性槽 | 现 10 个（pos/normal/uv + 7 custom）。WebGL1 上限 16。新增 `mountainW`、`forestW` 共 12。biome 混合走纹理，不加 8 个权重属性 |
| 顶点纹理 | **不用**（ES1 不稳） |
| 编译 | `npm run glsl:check` ES1+ES3；ANGLE 编译 20–30 s，截图脚本继续轮询 `__hexbound.chunks.meshes[*].isReady(true)`，禁止改成短 `sleep` |
| 禁止 | 参考 jpg 进 sampler；每格独立 draw；额外 PBR 多 pass；树/岩 GLB |

`rebuild(seed)` 必须：dispose 旧 mesh+材质+数据纹理 → `generateMap` → 上传纹理 → `meshMap`。

---

## 4. 验收清单（可判定 + 优先级）

### 命令（每次视觉声称之前）

```
npm run glsl:check          # ES1 + ES3 均通过
npx tsc --noEmit
npm run shots:iter -- <tag> # docs/shots/_<tag>-{1,2,3}-canvas.png
npm run shots               # 五张正式图 + -canvas
```

判画面**只看** `*-canvas.png`。`uShowWireHint` 默认关。

### P0 — 无 P0 不算指标 A 过

| ID | 要求 | 判定 |
|---|---|---|
| P0-1 | 无双重 elev 量化 | `mapgen.ts` 无 `floor(elev * 5)`；vert 无全局 `floor(elev*5)` terrace。`tsc` + 读 diff |
| P0-2 | 无悬挂裙边 | `_p0-2-canvas.png`（用 `shots:iter -- p0skirt`，镜头=现 02）。竖向白/浅蓝色条不得从邻格**顶面之下**再垂一截。真悬崖底边必须贴齐下一级顶面 |
| P0-3 | 平地无格间墙 | 同图：相邻 `elev` 差 &lt; 0.07 的草/原/漠之间**零**竖墙。可在 `__hexbound.map` 抽 20 对邻格，对照 mesh 侧壁是否该 skip（开发者用一次性计数日志，不要留 debug 绘制） |
| P0-4 | 无马赛克换色 | `01` 与 `04` 的 `-canvas`：草原/平原/沙漠内部不得出现「整格一块纯色、边界一条折线」。过渡带宽 ≥ 约 0.5 格。对照 `refs/civ7-coastal-plains-forest.jpg` |
| P0-5 | 水无环状色阶 | `03-*-canvas`：浅→深是连续带，不是同心六边环。对照 `refs/humankind-coastal-islands.jpg` |
| P0-6 | 滩不是整格 | `03`：沙滩只沿水线一条，宽度视觉上 &lt; 半格，格心仍是陆地表 |
| P0-7 | 林缘非刀切 | `04`：林/草边界有渗透，不是六边折线切冠 |
| P0-8 | 默认无描边网格 | `01`：关 wire 时看不到完整 hex 网。开「六边边缘暗示」后暗边强度低，不恢复拼块 |
| P0-9 | 拾取仍可用 | 浏览器点 5 格（水/草/山/林/漠），高亮圆盘跟上，面板 `terrainId` 对 |
| P0-10 | 编译 | `glsl:check` 与 `tsc --noEmit` 退出码 0 |

### P1 — 无 P1 不算指标 B 过

| ID | 要求 | 判定 |
|---|---|---|
| P1-1 | 山脉走向可读 | `02`+`04`：能指出 1 条连续岭（不是孤立灰格）。对照 `refs/civ6-mountains-snow-grassland.jpg` |
| P1-2 | 雪在真峰 | 雪在位移后的高点/凹槽，不是整格盖白 |
| P1-3 | 陡坡可读（原「崖/台地」，2026-09-19 改写） | `02`：陡处为连续陡坡 + 岩/雪坡度着色，缓处为草/原；无任何竖直剖面突变（`profile:check` 绿）。对照 `refs/humankind-cliffs-plateaus-rivers.jpg` 的坡面层理 |
| P1-4 | 海岸层次 | `03`：滩→浅青绿→海军蓝，泡沫贴岸。对照 Humankind 岛图 |
| P1-5 | 河谷 | `04` 或 `05`：至少 1 条切入低地的谷/河岸带，不是全平盘 |
| P1-6 | 林块成片 | 林是连通斑块+软边，不是椒盐 |
| P1-7 | 光影/雾 | 山体受光/背光可分；远景比近景对比低。关雾开关对比 `dbg-fog` |
| P1-8 | 种子稳健 | `05-reseed` + 再随机 1 次：A 的无缝不回退，仍有山或岸类地标 |

### P2

| ID | 要求 | 判定 |
|---|---|---|
| P2-1 | 瀑布 | 河谷连续陡坡段见水帘/沫（着色表达，无侧壁；不要求每种子都有） |
| P2-2 | 拾取贴地 | 高山点击不偏格（改非 y=0 平面） |
| P2-3 | 高亮贴位移顶 | 圆盘不埋进/悬空林冠 |
| P2-4 | 干旱/雪地再贴近 refs | `aow4-desert-siege` / `aow4-arctic-snow-mountains` |

### 明确非目标

- 不用 refs jpg 作 albedo。
- 不新增树/岩 GLB。
- 不把六边玩法格改成连续导航网格。
- 不把 `VISUAL_TARGETS` 里「故意马赛克」当护身符。

---

## 5. 实现顺序（给 developer）

1. **P0 数据：** `HexCell.forestCover`；`recomputeShoreDepth` 改世界距离；`edgeMask` 改距离倒场；删 elev 5 级；林带去椒盐。
2. **P0 几何：** 对称角点焊接；侧壁三态（skip/ramp/cliff）；去掉 1.002 与悬挂 `skirt`。
3. **P0 纹理+着色：** 两张 map tex；片元 3 格 palette 混合；`contactAO` 绑 wire；海滩/林/水深走场。
4. **P0 位移：** `mountainW`/`forestW` 顶点属性。
5. 验证 P0-1…P0-10（`glsl:check`、`tsc`、`shots:iter -- p0`）。
6. **P1** 脊线、雪、雾/光、河谷、林 majority、水彩色板。
7. `npm run shots` 覆盖五张正式图。
8. P2 若 P0/P1 已过再做。

---

## 6. 自审（正确性 / 风险 / 测试）

### 正确性

- 根因行号来自本会话完整阅读，不是记忆：`pushAttr` 334–338、skirt 160–163、`cornerTopY` 61–86、mapgen 125–127、vert terrace 75–80、shore BFS 162–210、edgeMask 131–156、林 fid 闸门 227、contactAO 424–427、拾取 95–119。
- 视觉结论来自现有 `*-canvas.png` 的 `view_image`，与用户「远没有达到」一致。`VISUAL_TARGETS` 把悬崖标 `met`、把马赛克当故意偏差，**判为过时，已否决**。
- 拾取与离散逻辑格分离，无缝方案不会迫使玩法改成连续移动。
- 侧壁「只让高侧出面 + 底边贴齐邻顶」能同时消灭悬挂裙和双边 Z-fight。
- 分类 ID 不能 lerp：所以外观走权重/纹理，不走 `vTerrainId` 插值（WebGL1 也没有 `flat`）。

### 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 3 格 `terrainAlbedo` 全量会爆着色器 | 高 | 规格已强制 palette 廉价 + 细节一次 |
| 角点分裂在真悬崖处仍可能裂缝 | 中 | 悬崖边保留 1.001 重叠**仅** `span>=CLIFF_DROP` 的边；平地 1.000 |
| chunk 接缝 | 中 | 角点公式只读 `HexMap`，跨 chunk 决定性一致 |
| 正交雾仍然弱 | 中 | 用 `camDist`+降 farFade 起点；不够再加基于 `orthoSize` 的雾倍率（P1 调参） |
| `y=0` 拾取偏差 | 低（P2） | 不阻塞 A/B |
| ES1 指令数 | 中 | `glsl:check` 双版本；超限就降 FBM 到远距 2 oct |
| 数据纹理 UV 错半格 | 中 | 半纹素 + 用已知格中心 debug 着色 1 帧（不要留到正式图） |
| 本 worker **未**重跑 `shots`/`glsl:check` | 记录 | 实现方必须跑；本规格不声称「当前构建已过编译」 |

### 测试缺口

- 未在本会话执行 `npm run glsl:check` / `tsc` / `shots`（只读职责）。P0-10 由 developer 出日志。
- 未对 `__hexbound.map` 做邻格 elev 差的统计直方图；P0-3 要求实现时打一次计数。
- `05` 的 llm 描述曾说「完全平坦」，与 `02` 的山体矛盾，以 `02`/`01` 为准（不同种子/镜头）。验收以新截图为准，不引用那条「全平」描述。

### 与用户原话对照

| 原话 | 规格覆盖 |
|---|---|
| 成熟游戏场景地标观感 | §2 山/崖/岸/谷/林/光，P1 清单 |
| 地形连续无接缝 | §1 几何焊接+条件侧壁+世界场混合，P0 清单 |
| 继续处理、极高成熟度 | 分 P0/P1/P2，P0+P1 才算 A+B 过 |
| 参考图方向 | §2 色板与规则来自 12 张 refs |
| 程序化 + 小平铺贴图 | §3 禁止 jpg atlas / GLB |

未发现需要停下来换 duty 的缺口。下一职是 **developer 按 §5 实现**（本 worker 禁止写文件）。Primary 落盘本文并改 `VISUAL_TARGETS.md` 状态表。

---

**VERDICT: PASS**（规格可执行；实现未开始，产品验收未过。）

```json
{"verdict":"PASS","duty":"designer+reviewer","p0":10,"p1":8,"p2":4,"write":"forbidden"}
```