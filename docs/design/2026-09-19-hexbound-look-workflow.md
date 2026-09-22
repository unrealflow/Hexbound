# Hexbound 观感对标工作流（2026-09-19）

> **权威顺序：** 用户原话 > 本文 > `docs/design/2026-09-19-hexbound-goals-and-refs.md` > 成熟度规格 > `npm run verify`。  
> **本文管什么：** 「像 Civ / Humankind」怎么度量、怎么排期、每轮怎么跑。  
> **本文不管什么：** 无缝/连续性硬门禁（仍走 `verify`）。门禁全绿 **不是** 观感进步。  
> **配套：** `docs/VISUAL_TARGETS.md`（差距 backlog）· `docs/design/impl-progress.md` · `refs/SOURCES.md`  
> **可达上限：** 能接近「可读的 4X 地标地形」，**不能**接近 Civ6/Humankind 最终观感（手绘 atlas + 3D 树 + 垂直崖）。流程纪律解决不了这条路线盲区。

第二次复核（三条盲区 + 五条修改）已并入。第三次复核（designer+reviewer `w_574b9a61`）**VERDICT:PASS**：五条均已落盘、无过度采纳。顺手收了审查 P2 口径：奶油色 = Hills+雾+`shTint`，不是 Desert；`spineMix` 系数与源码对齐。

---

## 0. 复核摘要

### 0.1 第一次复核（四问）

缺陷工程已经做到「先证后改、门禁钉死」；「像参考图」从未被度量、从未按杠杆排期。官方 `01` 高地是一块奶油 **massif**（约占陆地 65–70%），不是山链。自定义 `ShaderMaterial` 不采样场景灯/影。`tonemapFilmic` 已是 Narkowicz ACES。水文 M1 数据绿、画面无河。Humankind 垂直崖参考降权。奶油色来自 **Hills palette + 雾 + `shTint` 填充光洗白**，不是「大量落在 Desert」：`mapgen.ts` if-else 里 Mountains（`elev>0.58`）/ Hills（`elev>0.38`）优先于 Desert，高 elev 不会进沙漠。

### 0.2 第二次复核（三条盲区）——全部采纳，带一条收紧

| 盲区 | 代码核实 | 处理 |
|---|---|---|
| **最大差距是光照，P2 不应排在 P1 后** | `createScene.ts` 有 DirectionalLight，片元只用 `uSunDir` Lambert/wrap + hemi 0.32 + wrap + `shTint` 地板。lightmap **不读** mapgen 拓扑 | **P2 与 P1 并行，鼓励 P2 先出第一张图。** 收紧：山链在 **高度场 / 剖面** 上仍可验证（`uDbgField` elev、`profile`），不依赖光照；但 **官方 01 彩色验收** 没有明暗面就读不出形体。灰 albedo 不是 P1 的主证据 |
| **P3 缺分级是误诊，缺的是 base albedo** | `hexTerrain.frag.glsl` 604–613：**已经有** 饱和 `mix(luma,lit,1.22)`、对比 `lit*lit*(3-2*lit)` mix 0.58、冷暖 split-tone。`biomePalette` 基色仍偏灰暗（grass `0.14,0.32,0.08`→`0.28,0.52,0.14`，rock `0.26..0.46`） | **P3 拆成 P3a 基色（先）+ P3b 分级微调（后）。** 禁止再加一条 ACES，也禁止把已有 1.22/0.58 再拧猛 |
| **P5 着色器冠面无法收敛到参考林** | `canopyField` 是地形表面上的高度/法线扰动，没有独立剪影 | **P5-A 显式不收敛**（权重量为 5，只做辅助）。**P5-B 合成 cross-quad billboard 升为主路径**（仍禁 GLB / 禁照片 atlas） |

排期权重改锁为：**光影 25 / 构图 20 / 基色 15 / 河 15 / 林-billboard 15 / 水 10**（分级 P3b 并进基色轴的余量，不再单列 15）。百分比仍只用于排期，不进门禁。

---

## 1. 目标 / 非目标

**目标（G5）：** `verify` 持续绿、剖面连续不放宽的前提下，官方 5 机位在锁定裁切对上达到 **可读的 4X 地标切片**（山链可指认、明暗面可读、暖绿/金黄第一眼能读出、有一条真河）。这不是 Civ6/Humankind 最终观感。

**本阶段不做：**

- 运行时采样 `refs/*.jpg`；照片地形 atlas
- 树石 `.glb`（3D 网格仍禁；合成 2D billboard 见 P5-B）
- 恢复垂直断崖墙
- 把门禁全绿当成观感 PASS
- 在 P2+P3a 出第一张可判断的图之前做 P7
- 出图前花数日建工具链（只允许 §7 的两件前置）
- 再用 `hexbound-maturity-polish.rhai` 当观感主循环

**已冻结：** 剖面连续；无垂直墙；`verify` 不回退；hex 玩法语义保留。

---

## 2. 差距 backlog

P4 水文按已开工路线继续。P7 在 P2 与 P3a 都达到 rubric ≥2 之前不做。

| ID | 杠杆 | 权重 | 现状 | 要做成什么样 | 改哪一层 | 证据 |
|---|---|---|---|---|---|---|
| **P2** | 阴影与光照 | 25 | 黏土漫射；无 shadow/lightmap | 受光坡亮、背光坡冷灰、谷底 AO；现有穹顶也要立刻可读 | CPU 高度场光线步进 → lightmap 纹理。采焊接+位移后高度，禁止逐格 `elev`。`ShadowGenerator` 备选 | 关/开 lightmap A/B；官方 `01`/`02` 明暗面。**高度热力不是本项证据** |
| **P1** | 地貌构图 massif→山链 | 20 | `01` 一块奶油穹顶，约占陆地 2/3 | ≥2 条脊、≥1 条脊间谷、山麓绿带 | `mapgen.ts` 脊线分离 + Mountains 分类（脊上强制山/丘，沙只留低干地） | **主：elev 场 / 剖面**（不依赖 P2）。辅：P2 落地后的官方 `01` |
| **P3a** | biome 基色 | 15 | 分级已激进；`biomePalette` 偏灰暗 | 第一眼读出暖绿草地 / 金黄平原；岩保持冷灰，不要把山抬成第二块沙漠 | `biomePalette` + `terrainAlbedo` 基色。扫描色相/饱和，**对着锁定裁切** | `01`/`04` 草地/平原裁切 vs `civ6-mountains-snow-grassland` 低地。`uDbgField=9` albedo 灰度不够，必须看彩色 |
| **P3b** | 分级微调 | 余量 | 604–613 已有 sat 1.22 / 对比 0.58 / split-tone | 只许在 P3a 之后做小幅曝光/冷暖；禁止再加 ACES、禁止再加饱和 | 同一 grade 块，只动常数 | 直方图 mean/sd；luma sd 不得跌回雾面纱量级（~30） |
| **P4** | 真河 | 15 | M1 数据绿；画面无河 | 概览可读水面带+河岸绿 | hydrology S3→S4 | `hydro:check` + `01`/`04` |
| **P5-A** | 着色器 2D 冠面 | 5 | 暗绿柔喷 | **本阶段不收敛到参考林。** 只允许作林下/冠面辅助，不得当 P5 完成定义 | `canopyField` 高度/法线 | 不单列 PASS |
| **P5-B** | 合成 cross-quad billboard | 15 | 无独立树冠剪影 | 簇状冠轮廓 + 高光暗部（仍非 GLB） | 合成冠纹理 + 实例化 cross-quad；不采样 refs | `04` vs `civ7-coastal-plains-forest` 林块 |
| **P6** | 水面陆架 | 10 | 等宽青边 | 陆架宽度随位置变；碎浪只在破波线 | 岸 SDF + 水高光 | `03` + `shore-profile` |
| **P7** | 外缘 / 三平面岩纹 | 余量 | 边界锯齿 | P2+P3a ≥2 之后 | 边界淡出；合成 triplanar | — |

**P1 子诊断（仍有效）：**

1. `spineMix = max(spine*0.95, spine2*0.55)` + continent 团块 → 一座山。要链 = 脊线分离 + 脊间保留低 elev。
2. 近岸 2 格高度压扁会削靠海的脊：压扁只许滩，不许削脊。
3. 中央高地分类是 Hills/Mountains，不是 Desert。奶油感来自 Hills 暖棕 + 雾 + `shTint`。P3a 拉 Grassland/Plains 饱和时 **不要把 Hills/岩一起抬暖**，否则馒头更像沙丘。P1 要把高地从「Hills 奶油丘」推进到可读岩脊（更多 Mountains 权重 / 更冷的 Hills 岩混）。

**P3a 扫描时不要动的：** 雾密度、`tonemapFilmic` 系数、1.22/0.58 grade（那是 P3b，且已够猛）。

---

## 3. 约束显式化

未勾选的项，agent **不得擅自放开**。照片 atlas 与运行时采样参考图 **永不放开**。

| 约束 | 状态 | 含义 |
|---|---|---|
| 剖面连续、无垂直墙 | **锁定禁** | Humankind sheer-cliff 参考降权；允许极陡连续坡 + 台地色带 |
| 不采样 `refs/*.jpg` | **锁定禁** | 只作看图 |
| 照片地形 atlas | **锁定禁** | `public/tex` 合成平铺仍允许 |
| 树石 `.glb` | **本阶段禁** | 3D 网格不做 |
| 2D 林冠着色器 | **允许，但不作为 P5 完成定义** | P5-A，显式天花板 |
| 合成 cross-quad billboard 树冠 | **允许（P5-B 主路径）** | 合成纹理 + 实例化四叉面；不是 GLB，不是照片 |
| CPU 高度场 lightmap | **允许（P2 主路径）** | 40×32，加载时一次；高度源 = 焊接+位移后连续场 |
| Babylon `ShadowGenerator` | **备选** | 必须在自定义片元里采样；与 lightmap 二选一 |
| 后处理 bloom / LUT 链 | **本阶段不做** | 片元内 grade 已够用；整链会打到天空 |
| ShaderToy 无照片地表 | **允许** | 地表（非林）品质锚 |

**崖壁口径：** 对标主锚是 Civ6 式连续圆润地标。Humankind 参考只借层理/台地色带/河，不作为垂直墙打分项。

**森林口径：** 本阶段参考图级森林 = P5-B billboard 的剪影，不是 `canopyField`。没有 billboard 就不得写「林已接近参考」。

---

## 4. 锁定对标机位

所有「差得远 / 进步了」只允许在下表成对裁切上说。裁切用代码拼（左现状、右参考）。禁止图像模型拼宫格。

| 官方机位 | 主参考 | 本对只评 | 不评 |
|---|---|---|---|
| `01` | `civ6-mountains-snow-grassland.jpg`（山链+山麓+雪，去 UI） | P2 明暗、P1 构图、P3a 草地/平原色 | 单位、城市、农场纹理 |
| `02` | 同上近裁；`humankind-cliffs-plateaus-rivers.jpg` 只借层理/明暗 | 脊剖面、岩色、雪一线 | sheer cliff 是否存在 |
| `03` | `humankind-coastal-islands.jpg` 或 `civ7-coastal-plains-forest.jpg` 岸带 | P6 | 船、填海 |
| `04` | `civ6-ocean-forest-desert.jpg` / `humankind-arid-hills-coast.jpg` | P4 河、P5-B 林剪影、P3a | 边境线 |
| `05` | 无像素孪生 | 换种子后 P1/P2/P3a/P4 同一 rubric | 与 01 长得像 |

形状机位（不替换官方 5 图）：elev 热力 / 沿脊剖面。文件名 `_look-<axis>-<tag>.png`。

**强制重读参考：** 每轮必须 `view_image mode=llm` 该轴锁定对。旧「不要重读 refs」作废。

---

## 5. 两套门禁，互不替代

### 5.1 缺陷门禁

`npm run verify`。观感改动后必须仍绿。luma 剖面、`orient-metric`、`lattice-metric`、`field-view` 继续当缺陷警报。全绿 ≠ 更像参考图。

### 5.2 观感 rubric（AI 每轮打分，人拍里程碑）

同一 seed、同一官方机位、并排 A/B（改前 | 改后 | 锁定参考裁切）。

- **每轮：** AI 在锁定对上按轴打 0–3，写入 JSON。这是迭代速度来源，不是「只报警」。
- **回归：** 非本轮目标轴掉 ≥1 = FAIL，先回滚。缺 JSON 字段 = 未过。
- **里程碑（人 accept/reject）：** P2 与 P3a 都 ≥2 才算「地标切片」第一刀可看；P1 ≥2 才算山链成立；P5-B ≥2 才许写森林接近。人可以否决 AI 的 3 分。

| 轴 | 0 | 1 | 2 | 3（本阶段满） |
|---|---|---|---|---|
| 光影 | 黏土漫射 | ndl 在但背光被填平 | 明暗面可读 | 谷 AO + 背光冷 |
| 宏观构图 | 一块穹顶 | 有高低不像链 | ≥2 脊，谷弱 | 山链+谷+山麓，01 一眼 |
| 基色 | 灰绿/奶油山 | 分区对但脏 | 暖绿/金黄第一眼能读 | 接近锁定裁切低地，岩仍冷 |
| 水 | 等宽花边 | 有浅深仍描边 | 陆架宽度有变化 | 破波线 + 太阳高光 |
| 林 | 平涂斑 | 有团无剪影 | billboard 剪影可读 | 簇状高光暗部（仍非 GLB） |
| 河 | 看不见 | 数据有、画面疑似 | 一条连续水带 | 干流+河岸绿 |

```json
{"shot":"01","axis":"lighting","score_before":0,"score_after":2,"regressed":false,"evidence":"docs/shots/_sweep-p2-ao/pick.png"}
```

---

## 6. 每轮怎么跑

```
verify 绿
  → 本轮选 §2 中允许并行的未清空项（P2 优先；P1/P3a 可与 P2 并行）
  → view_image 该轴锁定裁切
  → 复用 uDbgField 出需要的通道（P1=elev 热力；P2=lightmap A/B；P3a=彩色）
  → look-sweep 一次 N 档，选档；禁止只试一个魔法数
  → 只改该层
  → 官方机位（P1 另出 elev/剖面）
  → verify 仍绿
  → AI 打 rubric JSON（0–3 + 回归）
  → impl-progress ≤15 行
```

**并行规则：**

- P2（新纹理+采样）与 P1（`mapgen.ts`）无文件冲突，可并行。
- P3a（`biomePalette`）与 P2 无冲突，可并行。
- P3a 与 P1 **分类** 有耦合：P1 未把脊改成山之前，P3a 不得加饱和中央 Desert。
- P3b 不得与 P3a 同一轮。
- 一层一轮 **之内** 仍禁止顺手改雾/焦散/碎浪。

**参数扫描：**

| 轴 | 扫描什么 | N |
|---|---|---|
| P2 | AO 强度 / 日晒对比 / 阴影色温 | 6 |
| P1 | 脊线分离度 / spine 阈值 / 近岸压扁是否作用于脊 | 6–9 |
| P3a | Grassland/Plains 饱和与色相（岩/沙漠单独档，默认不动） | 9（3×3） |

输出 `docs/shots/_sweep-<axis>-<tag>/` + `manifest.json`。代码拼网格。

**判图：** 同一构建 `01` 与 `04` 冲突记「冲突」≠ PASS。目视无差别必须回退。

---

## 7. 工具（前置砍到 2 件）

**已有，直接用：** `view_image`、`uDbgField` / `field-view.mjs`（P1 的 elev 热力顶替「灰 albedo 金证据」）、`profile:check`、`orient-metric`、`shots` / `shots:iter`、`#dbg-fog`/`#dbg-disp`/`#dbg-tex`、`shore-profile.mjs`、`hydro:check`。

**出图前只补这 2 件：**

1. **`scripts/look-sweep.mjs`**（`npm run look:sweep -- --tag fog --var uEnableFog=0,1`）— 一组 `setFloat` 常数的笛卡尔积 → `docs/shots/_sweep-<tag>/` + `manifest.json`。P2/P3a 调参前用它，不要一轮一改。
2. **复用 `uDbgField` 灰/场通道** — 不要再写 `look-channels.mjs`。P1 用 mode 4/8（elev / mountainW）；albedo luma 是 mode 9。

**随 Sprint 按需再补，禁止前置：**

- contact sheet 裁切（可用现有 `_png-crop` 或一轮内的小脚本）
- `look-rubric.mjs` / `look-scores.md`（先把 JSON 追加在 impl-progress）
- P2 lightmap 实现本身（这是 P2 交付物，不是工具链）
- 独立 Rhai（有空再写；先按 §6 手跑）

**不要当观感主工具：** 整图 SSIM、和参考图像素差、RenderDoc（像素级才上）、`image_edit` 当金标准。

---

## 8. 文献

见 `goals-and-refs.md` §3.7。P3 锚点从「再做 ACES」改为「基色方向；Narkowicz 已在」。P5 锚点从「先 2D 冠面」改为 Humankind GPU 实例化植被的 **2D billboard 子集**（本阶段不搬 GLB）。

---

## 9. 与进行中工作的关系

| 工作 | 关系 |
|---|---|
| G-Hydro M1 已绿 | P4 并行继续。下切改 elev，P1 扫描要以「下切后仍是链」为档 |
| 子格高频带 | 保 G2，不是 P1/P2 |
| 高度真源 D | P2 lightmap 先复刻 `displaceLandY`；与 GPU 噪声族可能有 0.1–0.3 wu 差，写进进度 |
| 旧 Rhai `hexbound-maturity-*` | 只用于无缝回归 |

---

## 10. 排期

不可改的只有：**P2 不得排到「P1 完成之后才开始」；P3a 不得做成再拧 604–613；P5-A 不得当森林完成；出图前不得建 4 件工具。**

1. **前置（数小时，不是数日）：** `look-sweep` 骨架。通道用现有 `uDbgField`。
2. **Sprint P2（先出或与 P1 同时开工）：** height-field lightmap。验收：现有穹顶在 `01` 上出现明暗面。
3. **Sprint P3a（可与 P2 并行）：** `biomePalette` 草地/平原基色扫描。脊上仍是 Desert 时不要加饱和那一块。
4. **Sprint P1：** mapgen 山链 + 分类。验收：elev 场能指出 ≥2 脊 + 1 谷；P2 已亮时 `01` 彩色也能指认。
5. **P3b** 仅当 P3a ≥2 仍偏灰时微调 grade。
6. **P4** M2→S4。
7. **P5-B** billboard。P5-A 只做附属。
8. **P6** 陆架。
9. P7。

---

## 11. 给 agent 的一页纸

```
你在做可读的 4X 地标切片，不是 Civ 最终帧，也不是无缝。
1. P2 lightmap 与 P1 山链可并行；鼓励先出 P2。
2. 色彩先改 biomePalette（P3a），不要再拧 tonemap 后的 1.22/0.58。
3. 森林完成定义是合成 billboard（P5-B）。canopyField 再凹凸也不算接近参考林。
4. 出图前只允许 look-sweep + 现有 uDbgField。不要先做看板/rubric 脚本/Rhai。
5. 每轮 view_image 锁定裁切，AI 打 0–3 分写入 JSON；掉分回滚。里程碑等人 accept。
6. npm run verify 必须仍绿。
7. impl-progress ≤15 行。能指出明暗面/脊/基色，才许写「更像」。
```

---

*文档生成：2026-09-19。第二次复核并入同日。贡献度为排期权重，非消融实验。*
