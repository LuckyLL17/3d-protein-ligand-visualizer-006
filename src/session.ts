/**
 * 分析会话（analysis session）的持久化逻辑。
 *
 * 会话文件是一个带版本号的 JSON 文档，包含：结构数据、显示模式、
 * 选中的残基与原子、配体旋转、相互作用筛选以及测量记录。
 *
 * 恢复链路（parseSessionFile）对以下异常情况全部安全降级，绝不抛异常：
 * 1. 文件损坏（JSON 无法解析）
 * 2. 旧版本会话（字段缺失 -> 迁移 + 默认值补全）
 * 3. 版本不兼容（文件版本高于应用支持的版本）
 * 4. 字段类型/取值非法（逐字段清洗，回退默认值）
 * 5. 引用对象不存在（选中的残基/原子在结构数据中找不到 -> 回退到合法值）
 *
 * 只有解析出完整、合法的 SessionState 后，调用方才会替换当前状态，
 * 因此恢复失败永远不会覆盖当前可用状态。
 */

export const SESSION_VERSION = 1;
export const DRAFT_STORAGE_KEY = 'protein-atlas-session-draft-v1';
const APP_MARKER = 'protein-atlas';

export type DisplayMode = 'cartoon' | 'surface' | 'atoms';
export type ResidueRole = 'active' | 'support' | 'loop';
export type ElementKind = 'C' | 'N' | 'O' | 'S';

export type Residue = {
  id: number;
  code: string;
  name: string;
  x: number;
  y: number;
  z: number;
  color: string;
  role: ResidueRole;
};

export type Atom = {
  id: string;
  element: ElementKind;
  x: number;
  y: number;
  z: number;
  color: string;
  radius: number;
};

export type Measurement = {
  id: string;
  label: string;
  distance: number;
  residueCode: string;
  atomId: string;
  createdAt: number;
};

export type SessionState = {
  structure: {
    residues: Residue[];
    ligandAtoms: Atom[];
    bonds: [string, string][];
  };
  displayMode: DisplayMode;
  selectedResidue: number;
  selectedAtom: string;
  ligandRotation: number;
  showInteractions: boolean;
  measurements: Measurement[];
};

export type SessionFile = {
  app: typeof APP_MARKER;
  version: number;
  savedAt: number;
  state: SessionState;
};

export const defaultResidues: Residue[] = [
  { id: 41, code: 'GLU41', name: '谷氨酸', x: -1.6, y: .4, z: .5, color: '#ef8e77', role: 'active' },
  { id: 78, code: 'TYR78', name: '酪氨酸', x: -.7, y: 1.15, z: -.25, color: '#f0c76e', role: 'support' },
  { id: 102, code: 'HIS102', name: '组氨酸', x: .4, y: .75, z: .2, color: '#71c9e6', role: 'active' },
  { id: 146, code: 'ASP146', name: '天冬氨酸', x: 1.2, y: .15, z: -.45, color: '#e88389', role: 'active' },
  { id: 183, code: 'PHE183', name: '苯丙氨酸', x: 1.8, y: .7, z: .35, color: '#c28ce8', role: 'support' },
  { id: 219, code: 'SER219', name: '丝氨酸', x: .55, y: -.3, z: -.65, color: '#8fd6a2', role: 'loop' },
  { id: 244, code: 'GLY244', name: '甘氨酸', x: -1.05, y: -.55, z: -.3, color: '#9aabb4', role: 'loop' }
];

export const defaultLigandAtoms: Atom[] = [
  { id: 'C1', element: 'C', x: 0, y: 0, z: 0, color: '#d6e1e4', radius: .17 },
  { id: 'C2', element: 'C', x: .55, y: .26, z: .08, color: '#d6e1e4', radius: .17 },
  { id: 'N1', element: 'N', x: .98, y: -.18, z: .18, color: '#54b9e3', radius: .2 },
  { id: 'O1', element: 'O', x: -.48, y: .35, z: .05, color: '#ec7474', radius: .18 },
  { id: 'O2', element: 'O', x: -.15, y: -.5, z: -.1, color: '#ec7474', radius: .18 },
  { id: 'S1', element: 'S', x: .42, y: .05, z: -.62, color: '#e7c35f', radius: .24 }
];

export const defaultBonds: [string, string][] = [['C1', 'C2'], ['C1', 'O1'], ['C1', 'O2'], ['C2', 'N1'], ['C2', 'S1']];

export function createDefaultState(): SessionState {
  return {
    structure: {
      residues: defaultResidues.map(r => ({ ...r })),
      ligandAtoms: defaultLigandAtoms.map(a => ({ ...a })),
      bonds: defaultBonds.map(b => [b[0], b[1]] as [string, string])
    },
    displayMode: 'cartoon',
    selectedResidue: 102,
    selectedAtom: 'N1',
    ligandRotation: 0.2,
    showInteractions: true,
    measurements: []
  };
}

/* ---------- 类型守卫与清洗工具 ---------- */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const finiteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const nonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

const DISPLAY_MODES: readonly DisplayMode[] = ['cartoon', 'surface', 'atoms'];
const ROLES: readonly ResidueRole[] = ['active', 'support', 'loop'];
const ELEMENTS: readonly ElementKind[] = ['C', 'N', 'O', 'S'];

function sanitizeResidues(raw: unknown): Residue[] | null {
  if (!Array.isArray(raw)) return null;
  const items: Residue[] = [];
  for (const r of raw) {
    if (!isRecord(r)) continue;
    if (!finiteNumber(r.id) || !nonEmptyString(r.code) || !nonEmptyString(r.name)) continue;
    if (!finiteNumber(r.x) || !finiteNumber(r.y) || !finiteNumber(r.z)) continue;
    if (typeof r.color !== 'string') continue;
    if (!ROLES.includes(r.role as ResidueRole)) continue;
    items.push({
      id: r.id, code: r.code, name: r.name,
      x: r.x, y: r.y, z: r.z,
      color: r.color, role: r.role as ResidueRole
    });
  }
  return items.length > 0 ? items : null;
}

function sanitizeAtoms(raw: unknown): Atom[] | null {
  if (!Array.isArray(raw)) return null;
  const items: Atom[] = [];
  for (const a of raw) {
    if (!isRecord(a)) continue;
    if (!nonEmptyString(a.id) || !ELEMENTS.includes(a.element as ElementKind)) continue;
    if (!finiteNumber(a.x) || !finiteNumber(a.y) || !finiteNumber(a.z)) continue;
    if (typeof a.color !== 'string' || !finiteNumber(a.radius)) continue;
    items.push({
      id: a.id, element: a.element as ElementKind,
      x: a.x, y: a.y, z: a.z,
      color: a.color, radius: a.radius
    });
  }
  return items.length > 0 ? items : null;
}

function sanitizeMeasurements(raw: unknown): Measurement[] {
  if (!Array.isArray(raw)) return [];
  const out: Measurement[] = [];
  for (const m of raw) {
    if (!isRecord(m)) continue;
    if (!nonEmptyString(m.id) || !nonEmptyString(m.label)) continue;
    if (!finiteNumber(m.distance) || !finiteNumber(m.createdAt)) continue;
    if (typeof m.residueCode !== 'string' || typeof m.atomId !== 'string') continue;
    out.push({
      id: m.id, label: m.label, distance: m.distance,
      residueCode: m.residueCode, atomId: m.atomId, createdAt: m.createdAt
    });
  }
  return out;
}

/**
 * 从原始 state 对象清洗出完整、合法的会话状态。
 * 任何非法/缺失字段都回退到默认值，结构数据整体无效时回退到内置结构。
 */
function sanitizeState(raw: unknown): SessionState {
  const d = createDefaultState();
  if (!isRecord(raw)) return d;

  const rawStructure = isRecord(raw.structure) ? raw.structure : null;
  const residues = (rawStructure && sanitizeResidues(rawStructure.residues)) || d.structure.residues;
  const ligandAtoms = (rawStructure && sanitizeAtoms(rawStructure.ligandAtoms)) || d.structure.ligandAtoms;
  const atomIds = new Set(ligandAtoms.map(a => a.id));

  let bonds = d.structure.bonds;
  if (rawStructure && Array.isArray(rawStructure.bonds)) {
    const parsed: [string, string][] = [];
    for (const b of rawStructure.bonds) {
      if (!Array.isArray(b) || b.length !== 2) continue;
      if (typeof b[0] !== 'string' || typeof b[1] !== 'string') continue;
      if (!atomIds.has(b[0]) || !atomIds.has(b[1])) continue; // 引用的原子不存在则丢弃该键
      parsed.push([b[0], b[1]]);
    }
    if (parsed.length > 0) bonds = parsed;
  }

  const displayMode = DISPLAY_MODES.includes(raw.displayMode as DisplayMode)
    ? (raw.displayMode as DisplayMode)
    : d.displayMode;

  // 引用完整性：选中的残基/原子在恢复后的结构中必须存在，否则回退到合法值。
  // 结构数据整体缺失时使用应用默认选中；结构存在但选择失效时回退到该结构的首个对象。
  const residuePool = rawStructure ? residues : d.structure.residues;
  const selectedResidue = finiteNumber(raw.selectedResidue) && residuePool.some(r => r.id === raw.selectedResidue)
    ? raw.selectedResidue
    : (rawStructure ? residues[0].id : d.selectedResidue);
  const atomPool = rawStructure ? ligandAtoms : d.structure.ligandAtoms;
  const selectedAtom = nonEmptyString(raw.selectedAtom) && atomPool.some(a => a.id === raw.selectedAtom)
    ? raw.selectedAtom
    : (rawStructure ? ligandAtoms[0].id : d.selectedAtom);

  const ligandRotation = finiteNumber(raw.ligandRotation) ? raw.ligandRotation : d.ligandRotation;
  const showInteractions = typeof raw.showInteractions === 'boolean' ? raw.showInteractions : d.showInteractions;
  const measurements = sanitizeMeasurements(raw.measurements);

  return {
    structure: { residues, ligandAtoms, bonds },
    displayMode,
    selectedResidue,
    selectedAtom,
    ligandRotation,
    showInteractions,
    measurements
  };
}

/**
 * 旧版本迁移。当前只有 v1；未来版本的迁移步骤在此追加，
 * 每一步只负责把 state 从 fromVersion 升到 fromVersion + 1。
 */
function migrateSession(raw: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
  let version = fromVersion;
  let state = isRecord(raw.state) ? { ...raw.state } : {};
  // 示例：if (version === 1) { state = migrateV1ToV2(state); version = 2; }
  void version;
  return { ...raw, state };
}

export type ParseResult =
  | { ok: true; state: SessionState; warnings: string[] }
  | { ok: false; error: string };

/**
 * 解析会话文件文本。永不抛异常；失败时返回中文错误信息，且不触碰任何外部状态。
 */
export function parseSessionFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '文件内容已损坏：不是有效的 JSON' };
  }
  if (!isRecord(raw)) {
    return { ok: false, error: '会话文件格式不正确：缺少顶层结构' };
  }
  if (raw.app !== undefined && raw.app !== APP_MARKER) {
    return { ok: false, error: '该文件不是本应用的会话文件' };
  }

  const version = finiteNumber(raw.version) ? raw.version : 1;
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, error: '会话版本不受支持' };
  }
  if (version > SESSION_VERSION) {
    return { ok: false, error: `会话文件版本为 v${version}，高于应用支持的 v${SESSION_VERSION}，请升级应用后再恢复` };
  }

  const warnings: string[] = [];
  let migrated = raw;
  if (version < SESSION_VERSION) {
    migrated = migrateSession(raw, version);
    warnings.push(`已将旧版本会话（v${version}）迁移到 v${SESSION_VERSION}，缺失字段已补全`);
  }

  if (!isRecord(migrated.state)) {
    return { ok: false, error: '会话文件缺少状态数据（state 字段），无法恢复' };
  }

  const state = sanitizeState(migrated.state);
  return { ok: true, state, warnings };
}

/* ---------- 草稿（localStorage） ---------- */

export function saveDraft(state: SessionState): boolean {
  try {
    const file: SessionFile = { app: APP_MARKER, version: SESSION_VERSION, savedAt: Date.now(), state };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(file));
    return true;
  } catch {
    return false; // 隐私模式 / 存储已满 / 不可用
  }
}

export function loadDraft(): { state: SessionState; savedAt: number } | null {
  try {
    const text = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!text) return null;
    const parsed = parseSessionFile(text);
    if (!parsed.ok) return null; // 草稿损坏：静默忽略，绝不影响当前状态
    const raw = JSON.parse(text) as Record<string, unknown>;
    return { state: parsed.state, savedAt: finiteNumber(raw.savedAt) ? raw.savedAt : 0 };
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
}

/* ---------- 导出 ---------- */

export function buildSessionFile(state: SessionState): SessionFile {
  return { app: APP_MARKER, version: SESSION_VERSION, savedAt: Date.now(), state };
}

export function downloadSessionFile(state: SessionState): void {
  const blob = new Blob([JSON.stringify(buildSessionFile(state), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const a = document.createElement('a');
  a.href = url;
  a.download = `protein-atlas-session-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
