先按行号核验 H1–H4，并查片元/侧壁里是否还有逐格不连续。核验结论：**H1–H3 成立**（陆地马赛克主因是顶点位移用整格标量当噪声域/振幅，CPU 焊接被 GPU 拆掉）。**H4 部分成立**（林缘变陡，不是唯一主因）。片元 7 格混合不是主因。

**H1 成立** `hexTerrain.vert.glsl` **52 / 54–57 / 69–77 / 82–84 / 97–99 / 109–111**  
`fbm2d(pos.xz*1.1 + elev*2.0)`、`ridgeFbmd(pos.xz*0.45 + elev*0.15)` 把 **逐顶点 `elev` 写进噪声相位**；振幅 `landAmp=mix(0.55,1,mountainW)`、`0.55*mountainW`、`cliffBoost*elev`、`forestW*0.09`、`terraceW(elev)`。同一世界 `(x,z)` 若 `elev`/`mountainW` 不同 → 不同 ΔY 与不同 `dHx/dHz`。

**H2 成立** `ChunkMesher.ts` **197–198、224–236、281–305、377、382–383**  
`avgMountainW`/`avgForestW` 按**本格**算一次，格心+6 角+侧壁顶全复制；`elevs.push(cell.elev)` 是**未焊接的本格 elev**。角点 Y 已焊（`cornerTopY` **137**），属性未焊。

**H3 成立**  
共享角两份顶点：`pos.xz` 同、`elev`/`mountainW` 不同 → 位移后 Y/法线跳变；`mix(nrm,relief,0.75)`×`reliefScale=mix(0.72,0.85,mountainW)` 再加硬面。观感=格边折线+色块（法线/AO/坡度着色），不是调色板。

**H4 部分成立** `mapgen.ts` **374–375** `avg<0.25→0`、`avg>0.6→mx` 只吸附两尾，中间带仍连续。会加硬林缘，但关位移后马赛克仍在。

**补遗**  
- `landMask=step(elev,0.04)`（vert **48**）水陆角若 elev 不焊会整段开关位移。  
- 侧壁顶用本格 `mountainW`、底用邻格 `nMw`（**275–304**）→ 墙与顶面位移不一致。  
- 片元 `terrainAlbedo` 已 7 格混合（**189–226**），`vTerrainId` 不再驱动 albedo。  
- 格心 `yCenter += 0.015+forestW*0.025`（**199–202**）只抬中心，可留。

---

**路线：选 (a) 焊接属性 + 噪声域只用世界 xz**  
不选 (b)：GLSL `noised/ridgeFbmd` 与 `mapgen.ts` 的 `fbm/ridge` 不是同一核，烘焙会改山形且工作量大。(a) 对准 H1–H3，保留现有脊线。噪声输入去掉 `+elev*`，振幅只用焊接后的 `mountainW`/`forestW`/`elev`。

角点标量（与 `cornerTopY` 同一组 3 格）：

```
cells = [self, n0=AXIAL_DIRS[(i+5)%6], n1=AXIAL_DIRS[i]]
spanY = max(cellTopY) - min(cellTopY)
s_weld = spanY < CLIFF_DROP ? (s0+s1+s2)/3 : s_self
```

`s ∈ {elev, mountainW, forestW}`。格心：7 格平均（可沿用 `avgMountainW`）。侧壁顶=该边两端焊接角点值；底=邻格对应焊接角点（同一 3 格，结果应相等）。

---

**客观指标**（`scripts/crack-metric.ts`，不读像素、不标定相机）  
在 **CPU 复刻 vert 位移**（公式与 GLSL 同行）后：

| 名 | 定义 | 通过 |
|---|---|---|
| `crackGroups` | 顶面顶点按 `(round(x,4), round(z,4))` 分组；`spanY>0.002` 且该角 `cellTopY` 极差 `< CLIFF_DROP` | **0** |
| `trueWalls` | `drop≥CLIFF_DROP` 的边 | 只记录，不回归到「任意邻格都有墙」 |
| `dY_p50/p95` | 陆地邻格**格心**位移后 \|ΔY\| | 相对 fix2 不恶化；平地 p95≪0.14 |
| `lowDeltaWalls` | `\|Δelev\|<0.07` 的墙 | **0**（守 P0-3） |

像素 seam：仅当上述已绿。`uDebugSeam=1` 时 `gl_FragColor.rg = (hexSDF, luma)`，边界像素=SDF∈[0,0.04]，再算边界/内部 luma 跳变。未标定前 **禁止**用现 `seam-metric.mjs` 判过。

---

**四步（每步可独立验收）**

**S1 焊接属性**  
文件：`ChunkMesher.ts` `pushAttr`  
公式：上节 `s_weld`；角点/侧壁顶底写入焊接 `elev/mountainW/forestW`，禁止 `cell.elev` 整格复制。  
命令：`npx tsc --noEmit`；`npx tsx scripts/crack-metric.ts`（先落地脚本，位移复刻可先恒等）。  
过：属性层 `crackGroups` 在位移前已为 0（同 xz 的 elev/mW/fW 极差 &lt;1e-5）。

**S2 位移域改世界 xz**  
文件：`hexTerrain.vert.glsl`  
公式：`md=fbm2d(pos.xz*1.1)`（去掉 `+elev*2`）；`rd=ridgeFbmd(pos.xz*0.45)`（去掉 `+elev*0.15`）；`nd=fbm2d(pos.xz*0.55)`；振幅仍 `0.55*mountainW*uElevScale` 等。`landMask` 用焊接 `elev`。侧壁同样走该位移。  
命令：`npm run glsl:check`；`npx tsx scripts/crack-metric.ts`（复刻与 GLSL 同行）。  
过：位移后 `crackGroups=0`；`lowDeltaWalls=0`。

**S3 林缘**  
文件：`mapgen.ts` `coalesceForestCover`  
公式：删 **374–375** 吸附；仅当 6 邻 `forestCover>0.2` 的个数 `≤1` 时置 0（去椒盐）。  
命令：`npx tsc --noEmit`。  
过：直方图 `forestCover` 在 (0.05,0.95) 内样本数 &gt;0。

**S4 视觉回归**  
命令：`npm run glsl:check`；`npx tsc --noEmit`；`npm run shots:iter -- r1`。  
过：P0-1/3/6/8/9/10 不回退；`_r1-1` 无整格折线换色（P0-4）；`_r1-2` 无悬挂裙（P0-2）；`_r1-3` 水深/滩/沫不回退。再 `npm run shots` 刷新正式 5 张（现 01–05 已过期）。

禁止回退：P0-1/3/6/8/9/10；海岸连续。不要改 `CHUNK_SIZE`/单材质/拾取射线。