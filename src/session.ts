export type DisplayMode = 'cartoon' | 'surface' | 'atoms';
export type ResidueRole = 'active' | 'support' | 'loop';
export type AtomElement = 'C' | 'N' | 'O' | 'S';
export type InteractionKind = 'hbond' | 'hydrophobic' | 'electrostatic';

export interface Residue {
  id: number;
  code: string;
  name: string;
  x: number;
  y: number;
  z: number;
  color: string;
  role: ResidueRole;
}

export interface LigandAtom {
  id: string;
  element: AtomElement;
  x: number;
  y: number;
  z: number;
  color: string;
  radius: number;
}

export interface Interaction {
  id: string;
  kind: InteractionKind;
  residueId: number;
  atomId: string;
  label: string;
}

export interface Dataset {
  residues: Residue[];
  atoms: LigandAtom[];
  bonds: [string, string][];
  interactions: Interaction[];
}

export type InteractionFilters = Record<InteractionKind, boolean>;

export interface SessionView {
  mode: DisplayMode;
  selection: {
    residueId: number;
    atomId: string;
  };
  ligandRotation: number;
  interactionFilters: InteractionFilters;
}

export type MeasurementEndpoint =
  | { type: 'residue'; id: number }
  | { type: 'atom'; id: string };

export interface Measurement {
  id: string;
  kind: 'distance';
  label: string;
  from: MeasurementEndpoint;
  to: MeasurementEndpoint;
}

export interface Session {
  version: 2;
  dataset: Dataset;
  view: SessionView;
  measurements: Measurement[];
  savedAt: string;
}

export interface WorkspaceState {
  dataset: Dataset;
  view: SessionView;
  measurements: Measurement[];
}

export const SESSION_FORMAT_VERSION = 2;
export const DRAFT_STORAGE_KEY = 'protein-atlas.analysis-session';

export const DEFAULT_VIEW: SessionView = {
  mode: 'cartoon',
  selection: { residueId: 102, atomId: 'N1' },
  ligandRotation: 0.2,
  interactionFilters: {
    hbond: true,
    hydrophobic: true,
    electrostatic: true,
  },
};

export const DEFAULT_DATASET: Dataset = {
  residues: [
    { id: 41, code: 'GLU41', name: '谷氨酸', x: -1.6, y: 0.4, z: 0.5, color: '#ef8e77', role: 'active' },
    { id: 78, code: 'TYR78', name: '酪氨酸', x: -0.7, y: 1.15, z: -0.25, color: '#f0c76e', role: 'support' },
    { id: 102, code: 'HIS102', name: '组氨酸', x: 0.4, y: 0.75, z: 0.2, color: '#71c9e6', role: 'active' },
    { id: 146, code: 'ASP146', name: '天冬氨酸', x: 1.2, y: 0.15, z: -0.45, color: '#e88389', role: 'active' },
    { id: 183, code: 'PHE183', name: '苯丙氨酸', x: 1.8, y: 0.7, z: 0.35, color: '#c28ce8', role: 'support' },
    { id: 219, code: 'SER219', name: '丝氨酸', x: 0.55, y: -0.3, z: -0.65, color: '#8fd6a2', role: 'loop' },
    { id: 244, code: 'GLY244', name: '甘氨酸', x: -1.05, y: -0.55, z: -0.3, color: '#9aabb4', role: 'loop' },
  ],
  atoms: [
    { id: 'C1', element: 'C', x: 0, y: 0, z: 0, color: '#d6e1e4', radius: 0.17 },
    { id: 'C2', element: 'C', x: 0.55, y: 0.26, z: 0.08, color: '#d6e1e4', radius: 0.17 },
    { id: 'N1', element: 'N', x: 0.98, y: -0.18, z: 0.18, color: '#54b9e3', radius: 0.2 },
    { id: 'O1', element: 'O', x: -0.48, y: 0.35, z: 0.05, color: '#ec7474', radius: 0.18 },
    { id: 'O2', element: 'O', x: -0.15, y: -0.5, z: -0.1, color: '#ec7474', radius: 0.18 },
    { id: 'S1', element: 'S', x: 0.42, y: 0.05, z: -0.62, color: '#e7c35f', radius: 0.24 },
  ],
  bonds: [['C1', 'C2'], ['C1', 'O1'], ['C1', 'O2'], ['C2', 'N1'], ['C2', 'S1']],
  interactions: [
    { id: 'INT-1', kind: 'hbond', residueId: 41, atomId: 'O1', label: '氢键' },
    { id: 'INT-2', kind: 'hbond', residueId: 102, atomId: 'N1', label: '极性作用' },
    { id: 'INT-3', kind: 'electrostatic', residueId: 146, atomId: 'O2', label: '静电作用' },
    { id: 'INT-4', kind: 'hydrophobic', residueId: 183, atomId: 'C2', label: '疏水接触' },
  ],
};

export const DEFAULT_WORKSPACE: WorkspaceState = {
  dataset: DEFAULT_DATASET,
  view: DEFAULT_VIEW,
  measurements: [],
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
type DecodedSession = { session: Session; sourceVersion: number };

const DISPLAY_MODES = ['cartoon', 'surface', 'atoms'] as const;
const RESIDUE_ROLES = ['active', 'support', 'loop'] as const;
const ATOM_ELEMENTS = ['C', 'N', 'O', 'S'] as const;
const INTERACTION_KINDS = ['hbond', 'hydrophobic', 'electrostatic'] as const;

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const failure = (error: string): Result<never> => ({ ok: false, error });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEnumValue = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === 'string' && values.includes(value as T);

function finiteNumber(value: unknown, field: string): Result<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return failure(`${field} 必须是有限数字`);
  return ok(value);
}

function boundedNumber(value: unknown, field: string, min: number, max: number): Result<number> {
  const number = finiteNumber(value, field);
  if (!number.ok) return number;
  if (number.value < min || number.value > max) return failure(`${field} 必须位于 ${min} 到 ${max} 之间`);
  return number;
}

function coordinates(value: Record<string, unknown>, field: string): Result<{ x: number; y: number; z: number }> {
  const x = boundedNumber(value.x, `${field}.x`, -1000, 1000);
  if (!x.ok) return x;
  const y = boundedNumber(value.y, `${field}.y`, -1000, 1000);
  if (!y.ok) return y;
  const z = boundedNumber(value.z, `${field}.z`, -1000, 1000);
  if (!z.ok) return z;
  return ok({ x: x.value, y: y.value, z: z.value });
}

function safeInteger(value: unknown, field: string): Result<number> {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return failure(`${field} 必须是整数`);
  return ok(value);
}

function requiredString(value: unknown, field: string): Result<string> {
  if (typeof value !== 'string') return failure(`${field} 必须是字符串`);
  const trimmed = value.trim();
  if (!trimmed) return failure(`${field} 不能为空`);
  return ok(trimmed);
}

function colorString(value: unknown, field: string): Result<string> {
  const color = requiredString(value, field);
  if (!color.ok) return color;
  if (!/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(color.value)) {
    return failure(`${field} 必须是 #rgb 或 #rrggbb 颜色值`);
  }
  return color;
}

function savedAtString(value: unknown): Result<string> {
  const savedAt = requiredString(value, 'savedAt');
  if (!savedAt.ok) return savedAt;
  const date = new Date(savedAt.value);
  if (Number.isNaN(date.getTime())) return failure('savedAt 必须是有效的 ISO 日期时间');
  return ok(savedAt.value);
}

function defaultInteractionLabel(kind: InteractionKind): string {
  if (kind === 'hbond') return '氢键';
  if (kind === 'hydrophobic') return '疏水接触';
  return '静电作用';
}

function normalizeResidues(value: unknown): Result<Residue[]> {
  if (!Array.isArray(value)) return failure('dataset.residues 必须是数组');
  if (value.length === 0) return failure('dataset.residues 至少需要包含一个残基');
  const ids = new Set<number>();
  const residues: Residue[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const field = `residues[${index}]`;
    if (!isObject(item)) return failure(`${field} 必须是对象`);

    const id = safeInteger(item.id, `${field}.id`);
    if (!id.ok) return id;
    if (ids.has(id.value)) return failure(`残基 ID ${id.value} 重复`);
    ids.add(id.value);

    const code = requiredString(item.code, `${field}.code`);
    if (!code.ok) return code;
    const name = requiredString(item.name, `${field}.name`);
    if (!name.ok) return name;
    const color = colorString(item.color, `${field}.color`);
    if (!color.ok) return color;
    if (!isEnumValue(item.role, RESIDUE_ROLES)) return failure(`${field}.role 不受支持`);

    const position = coordinates(item, field);
    if (!position.ok) return position;

    residues.push({
      id: id.value,
      code: code.value,
      name: name.value,
      x: position.value.x,
      y: position.value.y,
      z: position.value.z,
      color: color.value,
      role: item.role,
    });
  }

  return ok(residues);
}

function normalizeAtoms(value: unknown): Result<LigandAtom[]> {
  if (!Array.isArray(value)) return failure('dataset.atoms 必须是数组');
  if (value.length === 0) return failure('dataset.atoms 至少需要包含一个原子');
  const ids = new Set<string>();
  const atoms: LigandAtom[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const field = `atoms[${index}]`;
    if (!isObject(item)) return failure(`${field} 必须是对象`);

    const id = requiredString(item.id, `${field}.id`);
    if (!id.ok) return id;
    if (ids.has(id.value)) return failure(`原子 ID ${id.value} 重复`);
    ids.add(id.value);

    if (!isEnumValue(item.element, ATOM_ELEMENTS)) return failure(`${field}.element 不受支持`);
    const color = colorString(item.color, `${field}.color`);
    if (!color.ok) return color;
    const radius = boundedNumber(item.radius, `${field}.radius`, 0.01, 5);
    if (!radius.ok) return radius;

    const position = coordinates(item, field);
    if (!position.ok) return position;

    atoms.push({
      id: id.value,
      element: item.element,
      x: position.value.x,
      y: position.value.y,
      z: position.value.z,
      color: color.value,
      radius: radius.value,
    });
  }

  return ok(atoms);
}

function normalizeBonds(value: unknown, atomIds: Set<string>): Result<[string, string][]> {
  if (!Array.isArray(value)) return failure('dataset.bonds 必须是数组');
  const bonds: [string, string][] = [];

  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const field = `bonds[${index}]`;
    if (!Array.isArray(item) || item.length !== 2) return failure(`${field} 必须包含两个原子 ID`);
    const from = requiredString(item[0], `${field}[0]`);
    if (!from.ok) return from;
    const to = requiredString(item[1], `${field}[1]`);
    if (!to.ok) return to;
    if (!atomIds.has(from.value)) return failure(`${field} 引用了不存在的原子 ${from.value}`);
    if (!atomIds.has(to.value)) return failure(`${field} 引用了不存在的原子 ${to.value}`);
    bonds.push([from.value, to.value]);
  }

  return ok(bonds);
}

function normalizeInteractions(value: unknown, dataset: { residues: Residue[]; atoms: LigandAtom[] }): Result<Interaction[]> {
  if (!Array.isArray(value)) return failure('dataset.interactions 必须是数组');
  const residueIds = new Set(dataset.residues.map(item => item.id));
  const atomIds = new Set(dataset.atoms.map(item => item.id));
  const ids = new Set<string>();
  const interactions: Interaction[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const field = `interactions[${index}]`;
    if (!isObject(item)) return failure(`${field} 必须是对象`);

    const id = requiredString(item.id, `${field}.id`);
    if (!id.ok) return id;
    if (ids.has(id.value)) return failure(`相互作用 ID ${id.value} 重复`);
    ids.add(id.value);

    if (!isEnumValue(item.kind, INTERACTION_KINDS)) return failure(`${field}.kind 不受支持`);
    const residueId = safeInteger(item.residueId, `${field}.residueId`);
    if (!residueId.ok) return residueId;
    if (!residueIds.has(residueId.value)) return failure(`${field} 引用了不存在的残基 ${residueId.value}`);

    const atomId = requiredString(item.atomId, `${field}.atomId`);
    if (!atomId.ok) return atomId;
    if (!atomIds.has(atomId.value)) return failure(`${field} 引用了不存在的原子 ${atomId.value}`);

    let label = defaultInteractionLabel(item.kind);
    if (item.label !== undefined) {
      const normalizedLabel = requiredString(item.label, `${field}.label`);
      if (!normalizedLabel.ok) return normalizedLabel;
      label = normalizedLabel.value;
    }

    interactions.push({ id: id.value, kind: item.kind, residueId: residueId.value, atomId: atomId.value, label });
  }

  return ok(interactions);
}

function normalizeDataset(value: unknown): Result<Dataset> {
  if (!isObject(value)) return failure('dataset 必须是对象');

  const residues = normalizeResidues(value.residues);
  if (!residues.ok) return residues;
  const atoms = normalizeAtoms(value.atoms);
  if (!atoms.ok) return atoms;
  const bonds = normalizeBonds(value.bonds, new Set(atoms.value.map(atom => atom.id)));
  if (!bonds.ok) return bonds;

  const dataset: Dataset = { residues: residues.value, atoms: atoms.value, bonds: bonds.value, interactions: [] };
  const interactions = normalizeInteractions(value.interactions, dataset);
  if (!interactions.ok) return interactions;
  dataset.interactions = interactions.value;

  return ok(dataset);
}

function normalizeFilters(value: unknown): Result<InteractionFilters> {
  if (!isObject(value)) return failure('view.interactionFilters 必须是对象');
  const filters = {} as InteractionFilters;
  for (const kind of INTERACTION_KINDS) {
    if (typeof value[kind] !== 'boolean') return failure(`view.interactionFilters.${kind} 必须是布尔值`);
    filters[kind] = value[kind];
  }
  return ok(filters);
}

function normalizeView(value: unknown): Result<SessionView> {
  if (!isObject(value)) return failure('view 必须是对象');
  if (!isEnumValue(value.mode, DISPLAY_MODES)) return failure('view.mode 不受支持');
  if (!isObject(value.selection)) return failure('view.selection 必须是对象');

  const residueId = safeInteger(value.selection.residueId, 'view.selection.residueId');
  if (!residueId.ok) return residueId;
  const atomId = requiredString(value.selection.atomId, 'view.selection.atomId');
  if (!atomId.ok) return atomId;
  const ligandRotation = boundedNumber(value.ligandRotation, 'view.ligandRotation', -100, 100);
  if (!ligandRotation.ok) return ligandRotation;
  const filters = normalizeFilters(value.interactionFilters);
  if (!filters.ok) return filters;

  return ok({
    mode: value.mode,
    selection: { residueId: residueId.value, atomId: atomId.value },
    ligandRotation: ligandRotation.value,
    interactionFilters: filters.value,
  });
}

function normalizeEndpoint(value: unknown, field: string, dataset: Dataset): Result<MeasurementEndpoint> {
  if (!isObject(value)) return failure(`${field} 必须是对象`);
  if (value.type === 'residue') {
    const id = safeInteger(value.id, `${field}.id`);
    if (!id.ok) return id;
    if (!dataset.residues.some(residue => residue.id === id.value)) {
      return failure(`${field} 引用了不存在的残基 ${id.value}`);
    }
    return ok({ type: 'residue', id: id.value });
  }
  if (value.type === 'atom') {
    const id = requiredString(value.id, `${field}.id`);
    if (!id.ok) return id;
    if (!dataset.atoms.some(atom => atom.id === id.value)) {
      return failure(`${field} 引用了不存在的原子 ${id.value}`);
    }
    return ok({ type: 'atom', id: id.value });
  }
  return failure(`${field}.type 必须是 residue 或 atom`);
}

function normalizeMeasurements(value: unknown, dataset: Dataset): Result<Measurement[]> {
  if (!Array.isArray(value)) return failure('measurements 必须是数组');
  const ids = new Set<string>();
  const measurements: Measurement[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const field = `measurements[${index}]`;
    if (!isObject(item)) return failure(`${field} 必须是对象`);

    const id = requiredString(item.id, `${field}.id`);
    if (!id.ok) return id;
    if (ids.has(id.value)) return failure(`测量记录 ID ${id.value} 重复`);
    ids.add(id.value);

    if (item.kind !== 'distance') return failure(`${field}.kind 仅支持 distance`);
    const from = normalizeEndpoint(item.from, `${field}.from`, dataset);
    if (!from.ok) return from;
    const to = normalizeEndpoint(item.to, `${field}.to`, dataset);
    if (!to.ok) return to;

    let label = '距离测量';
    if (item.label !== undefined) {
      const normalizedLabel = requiredString(item.label, `${field}.label`);
      if (!normalizedLabel.ok) return normalizedLabel;
      label = normalizedLabel.value;
    }

    measurements.push({ id: id.value, kind: 'distance', label, from: from.value, to: to.value });
  }

  return ok(measurements);
}

function validateSelection(session: Session): Result<Session> {
  if (!session.dataset.residues.some(residue => residue.id === session.view.selection.residueId)) {
    return failure('选中的残基在恢复后的结构中不存在');
  }
  if (!session.dataset.atoms.some(atom => atom.id === session.view.selection.atomId)) {
    return failure('选中的原子在恢复后的结构中不存在');
  }
  return ok(session);
}

function normalizeV2(raw: Record<string, unknown>): Result<DecodedSession> {
  const dataset = normalizeDataset(raw.dataset);
  if (!dataset.ok) return dataset;
  const view = normalizeView(raw.view);
  if (!view.ok) return view;
  const measurements = normalizeMeasurements(raw.measurements, dataset.value);
  if (!measurements.ok) return measurements;

  let savedAt = new Date().toISOString();
  if (raw.savedAt !== undefined) {
    const normalizedSavedAt = savedAtString(raw.savedAt);
    if (!normalizedSavedAt.ok) return normalizedSavedAt;
    savedAt = normalizedSavedAt.value;
  }

  const session: Session = {
    version: 2,
    dataset: dataset.value,
    view: view.value,
    measurements: measurements.value,
    savedAt,
  };
  const selected = validateSelection(session);
  if (!selected.ok) return selected;
  return ok({ session, sourceVersion: 2 });
}

function migrateV1(raw: Record<string, unknown>): Result<DecodedSession> {
  const view: SessionView = {
    mode: DEFAULT_VIEW.mode,
    selection: { ...DEFAULT_VIEW.selection },
    ligandRotation: DEFAULT_VIEW.ligandRotation,
    interactionFilters: { ...DEFAULT_VIEW.interactionFilters },
  };

  if (raw.mode !== undefined) {
    if (!isEnumValue(raw.mode, DISPLAY_MODES)) return failure('旧版会话的 mode 不受支持');
    view.mode = raw.mode;
  }
  if (raw.selectedResidue !== undefined) {
    const selectedResidue = safeInteger(raw.selectedResidue, 'selectedResidue');
    if (!selectedResidue.ok) return selectedResidue;
    view.selection.residueId = selectedResidue.value;
  }
  if (raw.selectedAtom !== undefined) {
    const selectedAtom = requiredString(raw.selectedAtom, 'selectedAtom');
    if (!selectedAtom.ok) return selectedAtom;
    view.selection.atomId = selectedAtom.value;
  }
  if (raw.ligandRotation !== undefined) {
    const rotation = boundedNumber(raw.ligandRotation, 'ligandRotation', -100, 100);
    if (!rotation.ok) return rotation;
    view.ligandRotation = rotation.value;
  }
  if (raw.showInteractions !== undefined) {
    if (typeof raw.showInteractions !== 'boolean') return failure('旧版会话的 showInteractions 必须是布尔值');
    view.interactionFilters = {
      hbond: raw.showInteractions,
      hydrophobic: raw.showInteractions,
      electrostatic: raw.showInteractions,
    };
  }

  const session: Session = {
    version: 2,
    dataset: DEFAULT_DATASET,
    view,
    measurements: [],
    savedAt: new Date().toISOString(),
  };
  const selected = validateSelection(session);
  if (!selected.ok) return selected;
  return ok({ session, sourceVersion: 1 });
}

export function decodeSession(text: string): Result<DecodedSession> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failure(`会话文件内容损坏，不是有效 JSON（${detail}）`);
  }

  if (!isObject(raw)) return failure('会话文件内容损坏：根节点必须是对象');
  if (typeof raw.version !== 'number') return failure('会话文件缺少有效的 version 字段');
  if (raw.version === 1) return migrateV1(raw);
  if (raw.version === SESSION_FORMAT_VERSION) return normalizeV2(raw);
  if (raw.version < 1) return failure(`数据版本 ${raw.version} 无效`);
  return failure(`数据版本 ${raw.version} 与当前应用不兼容（支持版本 1、2）`);
}

export function makeSession(state: WorkspaceState, savedAt = new Date().toISOString()): Session {
  return {
    version: SESSION_FORMAT_VERSION,
    dataset: state.dataset,
    view: state.view,
    measurements: state.measurements,
    savedAt,
  };
}
