import {
  FEATURE_NAMES,
  TERRAIN_NAMES,
  type HexCell,
} from '../hex/HexMap';

export interface DebugState {
  seed: number;
  enableDisplace: boolean;
  enableFog: boolean;
  showWireHint: boolean;
  useDetailTex: boolean;
  selected: HexCell | null;
}

export interface DebugPanelHandles {
  root: HTMLElement;
  getState: () => DebugState;
  setSelected: (cell: HexCell | null) => void;
  onReseed: (cb: (seed: number) => void) => void;
  onToggle: (cb: () => void) => void;
}

export function createDebugPanel(initialSeed: number): DebugPanelHandles {
  const state: DebugState = {
    seed: initialSeed,
    enableDisplace: true,
    enableFog: true,
    showWireHint: false,
    useDetailTex: true,
    selected: null,
  };

  const root = document.createElement('div');
  root.id = 'debug-panel';
  root.innerHTML = `
    <h1>Hexbound Debug (Civ-look slice)</h1>
    <label>Seed <input type="number" id="dbg-seed" value="${initialSeed}" /></label>
    <div>
      <button type="button" id="dbg-reseed">重新生成</button>
      <button type="button" id="dbg-rand">随机种子</button>
    </div>
    <label><span>山体位移</span><input type="checkbox" id="dbg-disp" checked /></label>
    <label><span>距离雾</span><input type="checkbox" id="dbg-fog" checked /></label>
    <label><span>六边边缘暗示</span><input type="checkbox" id="dbg-wire" /></label>
    <label><span>细节贴图</span><input type="checkbox" id="dbg-tex" checked /></label>
    <div class="row">
      <div>选中格</div>
      <div class="mono" id="dbg-hex">点击地图拾取 hex</div>
    </div>
    <div class="row" style="font-size:11px;opacity:0.75">
      滚轮缩放 · 右键/中键拖拽 · 程序化 FBM + 平铺细节贴图（无照片地表 atlas）
    </div>
  `;
  document.body.appendChild(root);

  const hint = document.createElement('div');
  hint.id = 'hint';
  hint.textContent = 'Hexbound tech validation — procedural hex terrain';
  document.body.appendChild(hint);

  const seedInput = root.querySelector('#dbg-seed') as HTMLInputElement;
  const hexEl = root.querySelector('#dbg-hex') as HTMLElement;
  let reseedCb: ((seed: number) => void) | null = null;
  let toggleCb: (() => void) | null = null;

  const notifyToggle = () => toggleCb?.();

  root.querySelector('#dbg-reseed')!.addEventListener('click', () => {
    state.seed = Number(seedInput.value) | 0;
    reseedCb?.(state.seed);
  });
  root.querySelector('#dbg-rand')!.addEventListener('click', () => {
    state.seed = (Math.random() * 1e9) | 0;
    seedInput.value = String(state.seed);
    reseedCb?.(state.seed);
  });
  (root.querySelector('#dbg-disp') as HTMLInputElement).addEventListener('change', (e) => {
    state.enableDisplace = (e.target as HTMLInputElement).checked;
    notifyToggle();
  });
  (root.querySelector('#dbg-fog') as HTMLInputElement).addEventListener('change', (e) => {
    state.enableFog = (e.target as HTMLInputElement).checked;
    notifyToggle();
  });
  (root.querySelector('#dbg-wire') as HTMLInputElement).addEventListener('change', (e) => {
    state.showWireHint = (e.target as HTMLInputElement).checked;
    notifyToggle();
  });
  (root.querySelector('#dbg-tex') as HTMLInputElement).addEventListener('change', (e) => {
    state.useDetailTex = (e.target as HTMLInputElement).checked;
    notifyToggle();
  });

  const formatCell = (c: HexCell | null): string => {
    if (!c) return '点击地图拾取 hex';
    return [
      `q=${c.q}  r=${c.r}`,
      `terrainId=${c.terrainId} (${TERRAIN_NAMES[c.terrainId] ?? '?'})`,
      `featureId=${c.featureId} (${FEATURE_NAMES[c.featureId] ?? '?'})`,
      `elev=${c.elev.toFixed(3)}  moist=${c.moisture.toFixed(3)}`,
      `edgeMask=${c.edgeMask.toFixed(2)}`,
    ].join('\n');
  };

  return {
    root,
    getState: () => state,
    setSelected: (cell) => {
      state.selected = cell;
      hexEl.textContent = formatCell(cell);
      hexEl.style.whiteSpace = 'pre-wrap';
    },
    onReseed: (cb) => {
      reseedCb = cb;
    },
    onToggle: (cb) => {
      toggleCb = cb;
    },
  };
}
