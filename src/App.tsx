import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Line, OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  DEFAULT_WORKSPACE,
  DRAFT_STORAGE_KEY,
  SESSION_FORMAT_VERSION,
  decodeSession,
  makeSession,
  type Dataset,
  type DisplayMode,
  type InteractionFilters,
  type InteractionKind,
  type LigandAtom,
  type Measurement,
  type MeasurementEndpoint,
  type Residue,
  type SessionView,
  type WorkspaceState,
} from './session';

const helixPoints = Array.from({ length: 46 }, (_, index) => {
  const t = index / 45;
  return new THREE.Vector3(
    -3.2 + t * 6.4,
    Math.sin(t * Math.PI * 4) * 0.72 + Math.cos(t * Math.PI * 2) * 0.18,
    Math.cos(t * Math.PI * 3) * 0.74,
  );
});
const sheetPoints = Array.from(
  { length: 22 },
  (_, index) =>
    new THREE.Vector3(
      -3.5 + index * 0.33,
      1.4 + Math.sin(index * 0.55) * 0.16,
      -0.9 + Math.sin(index * 0.55) * 0.25,
    ),
);

const LIGAND_POSITION = new THREE.Vector3(0.1, 0.45, 0.15);
const interactionMeta: Record<InteractionKind, { name: string; short: string; color: string }> = {
  hbond: { name: '氢键', short: 'H-BOND', color: '#76d8ff' },
  hydrophobic: { name: '疏水接触', short: 'HYDROPHOBIC', color: '#e7c35f' },
  electrostatic: { name: '静电作用', short: 'IONIC', color: '#ff8aa0' },
};

type SessionNotice = { tone: 'success' | 'error'; text: string } | null;
type DraftState = { state: 'available' | 'empty' | 'blocked'; savedAt: string | null; detail: string };

function rotateLigandPoint(atom: LigandAtom, rotation: number) {
  const x = atom.x * Math.cos(rotation) + atom.z * Math.sin(rotation);
  const z = -atom.x * Math.sin(rotation) + atom.z * Math.cos(rotation);
  return new THREE.Vector3(LIGAND_POSITION.x + x, LIGAND_POSITION.y + atom.y, LIGAND_POSITION.z + z);
}

function endpointPoint(endpoint: MeasurementEndpoint, dataset: Dataset, rotation: number) {
  if (endpoint.type === 'residue') {
    const residue = dataset.residues.find(item => item.id === endpoint.id);
    if (!residue) return null;
    return new THREE.Vector3(residue.x, residue.y, residue.z);
  }
  const atom = dataset.atoms.find(item => item.id === endpoint.id);
  return atom ? rotateLigandPoint(atom, rotation) : null;
}

function endpointLabel(endpoint: MeasurementEndpoint, dataset: Dataset) {
  if (endpoint.type === 'residue') {
    return dataset.residues.find(item => item.id === endpoint.id)?.code ?? `残基 ${endpoint.id}`;
  }
  return dataset.atoms.find(item => item.id === endpoint.id)?.id ?? `原子 ${endpoint.id}`;
}

function endpointSignature(endpoint: MeasurementEndpoint) {
  return `${endpoint.type}:${endpoint.id}`;
}

function measurementDistance(measurement: Measurement, dataset: Dataset, rotation: number) {
  const from = endpointPoint(measurement.from, dataset, rotation);
  const to = endpointPoint(measurement.to, dataset, rotation);
  if (!from || !to) return null;
  return from.distanceTo(to);
}

function Ligand({
  atoms,
  bonds,
  rotation,
  selectedAtom,
  onSelect,
}: {
  atoms: LigandAtom[];
  bonds: [string, string][];
  rotation: number;
  selectedAtom: string;
  onSelect: (id: string) => void;
}) {
  const positions = useMemo(
    () => Object.fromEntries(atoms.map(atom => [atom.id, new THREE.Vector3(atom.x, atom.y, atom.z)])),
    [atoms],
  );

  return (
    <group position={LIGAND_POSITION} rotation={[0, rotation, 0]}>
      {bonds.map(([from, to]) => {
        if (!positions[from] || !positions[to]) return null;
        return <Line key={`${from}-${to}`} points={[positions[from], positions[to]]} color="#cbd9dc" lineWidth={3} />;
      })}
      {atoms.map(atom => (
        <mesh
          key={atom.id}
          position={[atom.x, atom.y, atom.z]}
          onClick={event => {
            event.stopPropagation();
            onSelect(atom.id);
          }}
        >
          <sphereGeometry args={[atom.radius * (selectedAtom === atom.id ? 1.35 : 1), 16, 12]} />
          <meshStandardMaterial
            color={atom.color}
            emissive={selectedAtom === atom.id ? atom.color : '#000000'}
            emissiveIntensity={selectedAtom === atom.id ? 0.7 : 0}
          />
        </mesh>
      ))}
    </group>
  );
}

function InteractionLayer({ dataset, filters, rotation }: { dataset: Dataset; filters: InteractionFilters; rotation: number }) {
  const visible = dataset.interactions.filter(item => filters[item.kind]);
  return (
    <group>
      {visible.map(item => {
        const residue = dataset.residues.find(entry => entry.id === item.residueId);
        const atom = dataset.atoms.find(entry => entry.id === item.atomId);
        if (!residue || !atom) return null;
        const from = new THREE.Vector3(residue.x, residue.y, residue.z);
        const to = rotateLigandPoint(atom, rotation);
        const middle = from.clone().lerp(to, 0.52);
        return (
          <group key={item.id}>
            <Line points={[from, to]} color={interactionMeta[item.kind].color} lineWidth={2} transparent opacity={0.82} />
            <Text position={middle} fontSize={0.1} color={interactionMeta[item.kind].color} anchorX="center">
              {interactionMeta[item.kind].short}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

function MeasurementLayer({
  measurements,
  dataset,
  rotation,
}: {
  measurements: Measurement[];
  dataset: Dataset;
  rotation: number;
}) {
  return (
    <group>
      {measurements.map(measurement => {
        const from = endpointPoint(measurement.from, dataset, rotation);
        const to = endpointPoint(measurement.to, dataset, rotation);
        if (!from || !to) return null;
        const middle = from.clone().lerp(to, 0.5);
        const distance = from.distanceTo(to);
        return (
          <group key={measurement.id}>
            <Line points={[from, to]} color="#fff176" lineWidth={2.5} transparent opacity={0.95} />
            <Text position={[middle.x, middle.y + 0.14, middle.z]} fontSize={0.12} color="#fff176" anchorX="center">
              {distance.toFixed(2)} Å
            </Text>
          </group>
        );
      })}
    </group>
  );
}

function ProteinModel({
  state,
  onSelectResidue,
  onSelectAtom,
}: {
  state: WorkspaceState;
  onSelectResidue: (id: number) => void;
  onSelectAtom: (id: string) => void;
}) {
  const { dataset, view } = state;
  const showAtoms = view.mode === 'atoms';
  const surface = view.mode === 'surface';

  return (
    <Canvas shadows camera={{ position: [8, 5.5, 9], fov: 40 }}>
      <color attach="background" args={['#09151d']} />
      <ambientLight intensity={1.2} />
      <directionalLight position={[5, 8, 5]} intensity={2.4} castShadow />
      <pointLight position={[-4, 3, 3]} color="#7fe0ff" intensity={18} distance={11} />
      <group rotation={[0.08, -0.25, 0]}>
        {!showAtoms && (
          <>
            <Line points={helixPoints} color="#6b9fe9" lineWidth={surface ? 12 : 5} />
            <Line points={sheetPoints} color="#d58acb" lineWidth={surface ? 13 : 6} />
          </>
        )}
        {showAtoms &&
          dataset.residues.map(residue => (
            <mesh key={`atom-view-${residue.id}`} position={[residue.x, residue.y, residue.z]}>
              <sphereGeometry args={[0.22, 12, 10]} />
              <meshStandardMaterial color={residue.color} />
            </mesh>
          ))}
        {dataset.residues.map(residue => (
          <group key={`res-${residue.id}`} position={[residue.x, residue.y, residue.z]}>
            <mesh
              onClick={event => {
                event.stopPropagation();
                onSelectResidue(residue.id);
              }}
            >
              <sphereGeometry args={[view.selection.residueId === residue.id ? 0.28 : 0.18, 16, 12]} />
              <meshStandardMaterial
                color={residue.color}
                emissive={view.selection.residueId === residue.id ? residue.color : '#000'}
                emissiveIntensity={view.selection.residueId === residue.id ? 0.8 : 0}
                transparent
                opacity={surface ? 0.9 : 1}
              />
            </mesh>
            <Text
              position={[0, 0.43, 0]}
              fontSize={0.14}
              color={view.selection.residueId === residue.id ? '#ffe9a2' : '#8baeb9'}
              anchorX="center"
            >
              {residue.code}
            </Text>
          </group>
        ))}
        <Ligand
          atoms={dataset.atoms}
          bonds={dataset.bonds}
          rotation={view.ligandRotation}
          selectedAtom={view.selection.atomId}
          onSelect={onSelectAtom}
        />
        <InteractionLayer dataset={dataset} filters={view.interactionFilters} rotation={view.ligandRotation} />
        <MeasurementLayer measurements={state.measurements} dataset={dataset} rotation={view.ligandRotation} />
      </group>
      <ContactShadows position={[0, -1.5, 0]} opacity={0.32} scale={10} blur={2.5} />
      <OrbitControls makeDefault minDistance={5} maxDistance={16} />
    </Canvas>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function inspectDraft(): DraftState {
  try {
    const text = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!text) return { state: 'empty', savedAt: null, detail: '暂无本地草稿' };
    const decoded = decodeSession(text);
    if (!decoded.ok) return { state: 'blocked', savedAt: null, detail: decoded.error };
    return {
      state: 'available',
      savedAt: decoded.value.session.savedAt,
      detail: `上次自动保存：${formatTime(decoded.value.session.savedAt)}`,
    };
  } catch (error) {
    return {
      state: 'blocked',
      savedAt: null,
      detail: error instanceof Error ? error.message : '无法读取浏览器本地草稿',
    };
  }
}

function loadInitialWorkspace(): WorkspaceState {
  try {
    const text = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!text) return DEFAULT_WORKSPACE;
    const decoded = decodeSession(text);
    if (!decoded.ok) return DEFAULT_WORKSPACE;
    const session = decoded.value.session;
    return { dataset: session.dataset, view: session.view, measurements: session.measurements };
  } catch {
    return DEFAULT_WORKSPACE;
  }
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function toWorkspace(session: ReturnType<typeof makeSession>): WorkspaceState {
  return { dataset: session.dataset, view: session.view, measurements: session.measurements };
}

export default function App() {
  const [state, setState] = useState<WorkspaceState>(loadInitialWorkspace);
  const [draft, setDraft] = useState<DraftState>(inspectDraft);
  const [notice, setNotice] = useState<SessionNotice>(() =>
    draft.state === 'blocked'
      ? { tone: 'error', text: '本地草稿无法恢复，已保留当前可用状态。' }
      : draft.state === 'available'
        ? { tone: 'success', text: '已从本地草稿恢复分析会话。' }
        : null,
  );
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const lastWrittenState = useRef<WorkspaceState>(state);
  const draftBlocked = useRef(draft.state === 'blocked');

  const { dataset, view } = state;
  const selectedResidue =
    dataset.residues.find(item => item.id === view.selection.residueId) ?? dataset.residues[0];
  const selectedAtom = dataset.atoms.find(item => item.id === view.selection.atomId) ?? dataset.atoms[0];

  useEffect(() => {
    if (state === lastWrittenState.current || draftBlocked.current) return;
    try {
      const savedAt = new Date().toISOString();
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(makeSession(state, savedAt)));
      lastWrittenState.current = state;
      setDraft({ state: 'available', savedAt, detail: `自动保存于 ${formatTime(savedAt)}` });
    } catch (error) {
      draftBlocked.current = true;
      setDraft({
        state: 'blocked',
        savedAt: draft.savedAt,
        detail: error instanceof Error ? `草稿写入失败：${error.message}` : '草稿写入失败',
      });
    }
  }, [state, draft.savedAt]);

  const updateView = (patch: Partial<SessionView>) => {
    setState(current => ({ ...current, view: { ...current.view, ...patch } }));
  };

  const selectResidue = (residueId: number) => {
    setState(current => ({
      ...current,
      view: { ...current.view, selection: { ...current.view.selection, residueId } },
    }));
  };

  const selectAtom = (atomId: string) => {
    setState(current => ({
      ...current,
      view: { ...current.view, selection: { ...current.view.selection, atomId } },
    }));
  };

  const setMode = (mode: DisplayMode) => updateView({ mode });

  const allInteractionsVisible = (Object.keys(interactionMeta) as InteractionKind[]).every(
    kind => view.interactionFilters[kind],
  );

  const toggleAllInteractions = () => {
    const nextValue = !allInteractionsVisible;
    const interactionFilters: InteractionFilters = {
      hbond: nextValue,
      hydrophobic: nextValue,
      electrostatic: nextValue,
    };
    updateView({ interactionFilters });
  };

  const toggleInteraction = (kind: InteractionKind) => {
    updateView({
      interactionFilters: { ...view.interactionFilters, [kind]: !view.interactionFilters[kind] },
    });
  };

  const saveDraft = () => {
    try {
      const savedAt = new Date().toISOString();
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(makeSession(state, savedAt)));
      lastWrittenState.current = state;
      draftBlocked.current = false;
      setDraft({ state: 'available', savedAt, detail: `草稿已保存：${formatTime(savedAt)}` });
      setNotice({ tone: 'success', text: '分析会话草稿已保存到当前浏览器，刷新后会自动尝试恢复。' });
    } catch (error) {
      draftBlocked.current = true;
      setNotice({
        tone: 'error',
        text: error instanceof Error ? `草稿保存失败：${error.message}` : '草稿保存失败',
      });
    }
  };

  const exportSession = () => {
    try {
      const savedAt = new Date().toISOString();
      const blob = new Blob([JSON.stringify(makeSession(state, savedAt), null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `protein-atlas-session-${savedAt.replace(/[:.]/g, '-')}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice({ tone: 'success', text: '会话文件已导出，包含结构、视图、选择、筛选和测量记录。' });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? `会话导出失败：${error.message}` : '会话导出失败',
      });
    }
  };

  const importSessionFile = async (file: File) => {
    try {
      const text = await file.text();
      const decoded = decodeSession(text);
      if (!decoded.ok) {
        setNotice({ tone: 'error', text: `恢复失败，当前状态未被覆盖：${decoded.error}` });
        return;
      }

      const restored = toWorkspace(decoded.value.session);
      setState(restored);
      lastWrittenState.current = restored;
      let draftWriteFailed = false;
      try {
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(decoded.value.session));
      } catch {
        draftWriteFailed = true;
        draftBlocked.current = true;
      }
      if (!draftWriteFailed) draftBlocked.current = false;
      setDraft(
        draftWriteFailed
          ? {
              state: 'blocked',
              savedAt: decoded.value.session.savedAt,
              detail: '会话已在内存中恢复，但浏览器本地草稿不可写。',
            }
          : {
              state: 'available',
              savedAt: decoded.value.session.savedAt,
              detail: `导入会话：${formatTime(decoded.value.session.savedAt)}`,
            },
      );
      setNotice({
        tone: 'success',
        text:
          decoded.value.sourceVersion === 1
            ? '旧版会话已迁移并恢复；缺失的新字段已使用兼容默认值补齐。'
            : '会话已恢复，控件、3D 场景、筛选和详情均使用同一份会话状态。',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? `读取会话文件失败：${error.message}` : '读取会话文件失败',
      });
    }
  };

  const addSelectedDistance = () => {
    const residueEndpoint: MeasurementEndpoint = { type: 'residue', id: selectedResidue.id };
    const atomEndpoint: MeasurementEndpoint = { type: 'atom', id: selectedAtom.id };
    const pairKey = [endpointSignature(residueEndpoint), endpointSignature(atomEndpoint)].sort().join('|');

    const duplicated = state.measurements.some(measurement => {
      if (measurement.kind !== 'distance') return false;
      const currentKey = [endpointSignature(measurement.from), endpointSignature(measurement.to)].sort().join('|');
      return currentKey === pairKey;
    });

    if (duplicated) {
      setNotice({ tone: 'error', text: `${selectedResidue.code} 与 ${selectedAtom.id} 的距离记录已经存在。` });
      return;
    }

    const measurement: Measurement = {
      id: `M-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      kind: 'distance',
      label: `${selectedResidue.code} ↔ ${selectedAtom.id}`,
      from: residueEndpoint,
      to: atomEndpoint,
    };
    setState(current => ({ ...current, measurements: [...current.measurements, measurement] }));
    setNotice({ tone: 'success', text: `已添加距离测量：${measurement.label}。` });
  };

  const removeMeasurement = (id: string) => {
    setState(current => ({ ...current, measurements: current.measurements.filter(item => item.id !== id) }));
  };

  const activeResidues = dataset.residues.filter(item => item.role === 'active').length;
  const supportResidues = dataset.residues.filter(item => item.role === 'support').length;
  const selectedInteractionKinds = dataset.interactions
    .filter(item => item.residueId === selectedResidue.id && view.interactionFilters[item.kind])
    .map(item => interactionMeta[item.kind].name);
  const selectedInteractionText = selectedInteractionKinds.length
    ? Array.from(new Set(selectedInteractionKinds)).join(' / ')
    : '当前筛选下无显示';
  const enabledInteractionCount = (Object.keys(interactionMeta) as InteractionKind[]).filter(
    kind => view.interactionFilters[kind],
  ).length;
  const selectedDistance = selectedResidue
    ? endpointPoint({ type: 'residue', id: selectedResidue.id }, dataset, view.ligandRotation)?.distanceTo(
        rotateLigandPoint(selectedAtom, view.ligandRotation),
      ) ?? null
    : null;
  const atomFunction =
    selectedAtom.element === 'N' ? '供体' : selectedAtom.element === 'O' ? '受体' : selectedAtom.element === 'S' ? '硫原子' : '骨架';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">P</div>
          <div>
            <span className="eyebrow">STRUCTURAL BIOLOGY / ANALYSIS WORKSPACE</span>
            <h1>
              Protein Atlas <span>·</span> 配体结合可视化
            </h1>
          </div>
        </div>
        <div className="header-meta">
          <span className="dataset">PDB-LITE / SESSION v{SESSION_FORMAT_VERSION}</span>
          <button onClick={toggleAllInteractions}>{allInteractionsVisible ? '隐藏相互作用' : '显示相互作用'}</button>
          <button onClick={() => updateView({ ligandRotation: view.ligandRotation + 0.35 })}>旋转配体 ↻</button>
        </div>
      </header>

      <main className="layout">
        <section className="model-card">
          <div className="model-head">
            <div>
              <span className="eyebrow">MOLECULAR VIEWER</span>
              <h2>蛋白质结合口袋 · Ligand LIG-17</h2>
            </div>
            <div className="mode-switch">
              {(['cartoon', 'surface', 'atoms'] as DisplayMode[]).map(item => (
                <button key={item} className={view.mode === item ? 'active' : ''} onClick={() => setMode(item)}>
                  {item === 'cartoon' ? '卡通带状' : item === 'surface' ? '表面模型' : '原子视图'}
                </button>
              ))}
            </div>
          </div>
          <div className="canvas-wrap">
            <ProteinModel state={state} onSelectResidue={selectResidue} onSelectAtom={selectAtom} />
            <div className="viewer-legend">
              <span>
                <i className="dot protein" />蛋白骨架
              </span>
              <span>
                <i className="dot ligand" />配体原子
              </span>
              <span>
                <i className="dot interaction" />相互作用 / 测量
              </span>
            </div>
            <div className="viewer-hint">
              左键旋转 · 滚轮缩放 · 点击残基或原子 · 配体旋转 {(view.ligandRotation % (Math.PI * 2)).toFixed(2)} rad
            </div>
          </div>
        </section>

        <aside className="sidebar">
          <section className="panel session-panel">
            <div className="panel-title">
              <div>
                <span className="eyebrow">ANALYSIS SESSION</span>
                <h3>分析会话</h3>
              </div>
              <span className="count">v{SESSION_FORMAT_VERSION}</span>
            </div>
            {notice && <div className={`session-notice ${notice.tone}`}>{notice.text}</div>}
            <div className={`draft-state ${draft.state}`}>
              <b>{draft.state === 'available' ? '本地草稿可用' : draft.state === 'blocked' ? '草稿已隔离' : '尚无草稿'}</b>
              <small>{draft.detail}</small>
              {draft.state === 'blocked' && <small>当前工作区保持可用；修复或导入有效会话前不会覆盖它。</small>}
            </div>
            <div className="session-actions">
              <button className="primary" onClick={saveDraft}>保存草稿</button>
              <button onClick={exportSession}>导出会话</button>
              <button onClick={() => importInputRef.current?.click()}>导入恢复</button>
            </div>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) void importSessionFile(file);
                event.target.value = '';
              }}
            />
          </section>

          <section className="panel intro-panel">
            <span className="eyebrow">ACTIVE SITE</span>
            <h3>结合口袋分析</h3>
            <p>会话内包含 {dataset.residues.length} 个关键残基、{dataset.atoms.length} 个配体原子和 {dataset.interactions.length} 条相互作用。</p>
            <div className="metrics">
              <Metric label="结构残基" value={String(dataset.residues.length)} note="来自会话数据" />
              <Metric label="结合残基" value={String(activeResidues)} note={`${activeResidues} active / ${supportResidues} support`} />
              <Metric label="相互作用" value={String(enabledInteractionCount)} note="当前筛选可见" />
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <div>
                <span className="eyebrow">INTERACTION FILTERS</span>
                <h3>相互作用筛选</h3>
              </div>
              <span className="count">{enabledInteractionCount}/3</span>
            </div>
            <div className="filter-list">
              {(Object.keys(interactionMeta) as InteractionKind[]).map(kind => (
                <label key={kind} className="filter-item">
                  <input type="checkbox" checked={view.interactionFilters[kind]} onChange={() => toggleInteraction(kind)} />
                  <i style={{ background: interactionMeta[kind].color }} />
                  <span>{interactionMeta[kind].name}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <div>
                <span className="eyebrow">RESIDUES</span>
                <h3>关键残基</h3>
              </div>
              <span className="count">{dataset.residues.length}</span>
            </div>
            <div className="residue-list">
              {dataset.residues.map(item => (
                <button
                  key={item.id}
                  className={selectedResidue.id === item.id ? 'residue selected' : 'residue'}
                  onClick={() => selectResidue(item.id)}
                >
                  <span className="residue-color" style={{ background: item.color }} />
                  <span>
                    <b>{item.code}</b>
                    <small>{item.name}</small>
                  </span>
                  <em>{item.role === 'active' ? 'ACTIVE' : item.role === 'support' ? 'SUPPORT' : 'LOOP'}</em>
                </button>
              ))}
            </div>
          </section>

          <section className="panel detail-panel">
            <span className="eyebrow">SELECTED RESIDUE</span>
            <div className="detail-title">
              <h3>{selectedResidue.code}</h3>
              <span>{selectedResidue.name}</span>
            </div>
            <div className="detail-grid">
              <div>
                <span>空间坐标</span>
                <b>
                  {selectedResidue.x.toFixed(2)} / {selectedResidue.y.toFixed(2)} / {selectedResidue.z.toFixed(2)} Å
                </b>
              </div>
              <div>
                <span>残基角色</span>
                <b>
                  {selectedResidue.role === 'active'
                    ? '结合活性位点'
                    : selectedResidue.role === 'support'
                      ? '口袋支撑'
                      : '柔性环区'}
                </b>
              </div>
              <div>
                <span>配体距离</span>
                <b>{selectedDistance === null ? '不可用' : `${selectedDistance.toFixed(2)} Å`}</b>
              </div>
              <div>
                <span>相互作用</span>
                <b>{selectedInteractionText}</b>
              </div>
            </div>
          </section>

          <section className="panel atom-panel">
            <span className="eyebrow">LIGAND ATOM</span>
            <div className="atom-row">
              <span className="atom-badge">{selectedAtom.element}</span>
              <div>
                <b>{selectedAtom.id}</b>
                <small>
                  {selectedAtom.x.toFixed(2)} / {selectedAtom.y.toFixed(2)} / {selectedAtom.z.toFixed(2)} Å · 点击模型切换
                </small>
              </div>
              <span className="atom-value">{atomFunction}</span>
            </div>
          </section>

          <section className="panel measurements-panel">
            <div className="panel-title">
              <div>
                <span className="eyebrow">MEASUREMENTS</span>
                <h3>测量记录</h3>
              </div>
              <span className="count">{state.measurements.length}</span>
            </div>
            <button className="measure-button" onClick={addSelectedDistance}>
              测量 {selectedResidue.code} ↔ {selectedAtom.id}
            </button>
            {state.measurements.length === 0 ? (
              <p className="empty-copy">尚无测量记录。选择残基和原子后添加距离。</p>
            ) : (
              <div className="measurement-list">
                {state.measurements.map(measurement => {
                  const distance = measurementDistance(measurement, dataset, view.ligandRotation);
                  return (
                    <div key={measurement.id} className="measurement-item">
                      <div>
                        <b>{measurement.label}</b>
                        <small>
                          {endpointLabel(measurement.from, dataset)} → {endpointLabel(measurement.to, dataset)}
                        </small>
                        <strong>{distance === null ? '对象不存在' : `${distance.toFixed(2)} Å`}</strong>
                      </div>
                      <button onClick={() => removeMeasurement(measurement.id)}>删除</button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </main>
    </div>
  );
}
