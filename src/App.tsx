import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Line, OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  SessionState,
  DisplayMode,
  Residue,
  Atom,
  Measurement,
  createDefaultState,
  parseSessionFile,
  saveDraft,
  loadDraft,
  clearDraft,
  downloadSessionFile
} from './session';

type InteractionLine = { key: number; points: [THREE.Vector3, THREE.Vector3] };

const LIGAND_GROUP_POSITION = new THREE.Vector3(.1, .45, .15);

const helixPoints = Array.from({ length: 46 }, (_, index) => {
  const t = index / 45;
  return new THREE.Vector3(
    -3.2 + t * 6.4,
    Math.sin(t * Math.PI * 4) * .72 + Math.cos(t * Math.PI * 2) * .18,
    Math.cos(t * Math.PI * 3) * .74
  );
});
const sheetPoints = Array.from({ length: 22 }, (_, index) =>
  new THREE.Vector3(-3.5 + index * .33, 1.4 + Math.sin(index * .55) * .16, -.9 + Math.sin(index * .55) * .25)
);

function Ligand({ atoms, bonds, rotation, selectedAtom, onSelect }: {
  atoms: Atom[];
  bonds: [string, string][];
  rotation: number;
  selectedAtom: string;
  onSelect: (id: string) => void;
}) {
  const positions = useMemo(
    () => Object.fromEntries(atoms.map(atom => [atom.id, new THREE.Vector3(atom.x, atom.y, atom.z)])),
    [atoms]
  );
  return (
    <group position={[LIGAND_GROUP_POSITION.x, LIGAND_GROUP_POSITION.y, LIGAND_GROUP_POSITION.z]} rotation={[0, rotation, 0]}>
      {bonds.map(([from, to]) => (
        <Line key={`${from}-${to}`} points={[positions[from], positions[to]]} color="#cbd9dc" lineWidth={3} />
      ))}
      {atoms.map(atom => (
        <mesh
          key={atom.id}
          position={[atom.x, atom.y, atom.z]}
          onClick={(event) => { event.stopPropagation(); onSelect(atom.id); }}
        >
          <sphereGeometry args={[atom.radius * (selectedAtom === atom.id ? 1.35 : 1), 16, 12]} />
          <meshStandardMaterial
            color={atom.color}
            emissive={selectedAtom === atom.id ? atom.color : '#000000'}
            emissiveIntensity={selectedAtom === atom.id ? .7 : 0}
          />
        </mesh>
      ))}
    </group>
  );
}

function ProteinModel({ residues, ligandAtoms, bonds, displayMode, selectedResidue, onSelectResidue, ligandRotation, selectedAtom, onSelectAtom, showInteractions, interactions }: {
  residues: Residue[];
  ligandAtoms: Atom[];
  bonds: [string, string][];
  displayMode: DisplayMode;
  selectedResidue: number;
  onSelectResidue: (id: number) => void;
  ligandRotation: number;
  selectedAtom: string;
  onSelectAtom: (id: string) => void;
  showInteractions: boolean;
  interactions: InteractionLine[];
}) {
  const showAtoms = displayMode === 'atoms';
  const surface = displayMode === 'surface';
  return (
    <Canvas shadows camera={{ position: [8, 5.5, 9], fov: 40 }}>
      <color attach="background" args={['#09151d']} />
      <ambientLight intensity={1.2} />
      <directionalLight position={[5, 8, 5]} intensity={2.4} castShadow />
      <pointLight position={[-4, 3, 3]} color="#7fe0ff" intensity={18} distance={11} />
      <group rotation={[.08, -.25, 0]}>
        {!showAtoms && (
          <>
            <Line points={helixPoints} color="#6b9fe9" lineWidth={surface ? 12 : 5} />
            <Line points={sheetPoints} color="#d58acb" lineWidth={surface ? 13 : 6} />
          </>
        )}
        {showAtoms && residues.map(residue => (
          <mesh key={residue.id} position={[residue.x, residue.y, residue.z]}>
            <sphereGeometry args={[.22, 12, 10]} />
            <meshStandardMaterial color={residue.color} />
          </mesh>
        ))}
        {residues.map(residue => (
          <group key={`res-${residue.id}`} position={[residue.x, residue.y, residue.z]}>
            <mesh
              onClick={(event) => { event.stopPropagation(); onSelectResidue(residue.id); }}
            >
              <sphereGeometry args={[selectedResidue === residue.id ? .28 : .18, 16, 12]} />
              <meshStandardMaterial
                color={residue.color}
                emissive={selectedResidue === residue.id ? residue.color : '#000'}
                emissiveIntensity={selectedResidue === residue.id ? .8 : 0}
                transparent
                opacity={surface ? .9 : 1}
              />
            </mesh>
            <Text position={[0, .43, 0]} fontSize={.14} color={selectedResidue === residue.id ? '#ffe9a2' : '#8baeb9'} anchorX="center">
              {residue.code}
            </Text>
          </group>
        ))}
        {showInteractions && interactions.map(line => (
          <Line key={line.key} points={line.points} color="#eac66c" lineWidth={2.5} transparent opacity={.85} />
        ))}
        <Ligand atoms={ligandAtoms} bonds={bonds} rotation={ligandRotation} selectedAtom={selectedAtom} onSelect={onSelectAtom} />
      </group>
      <ContactShadows position={[0, -1.5, 0]} opacity={.32} scale={10} blur={2.5} />
      <OrbitControls makeDefault minDistance={5} maxDistance={16} />
    </Canvas>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

type ToastKind = 'success' | 'error' | 'info';
type Toast = { kind: ToastKind; text: string };

export default function App() {
  // 所有页面状态（3D 场景、控件、详情面板）都来自这同一份会话状态，
  // 恢复会话时整体替换，因此不存在控件与场景状态不一致的可能。
  const [session, setSession] = useState<SessionState>(() => createDefaultState());
  const [toast, setToast] = useState<Toast | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const firstRun = useRef(true);

  // 启动时检测本地草稿（不自动恢复，由用户确认，避免覆盖当前可用状态）
  useEffect(() => {
    const draft = loadDraft();
    if (draft) setDraftSavedAt(draft.savedAt);
  }, []);

  // 改动后防抖自动保存草稿；首次挂载（初始默认状态）不写草稿
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = window.setTimeout(() => saveDraft(session), 700);
    return () => window.clearTimeout(timer);
  }, [session]);

  const showToast = (kind: ToastKind, text: string) => {
    setToast({ kind, text });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  };

  // 恢复的唯一入口：解析成功后整体替换会话状态，失败则当前状态分毫不动
  const applySession = (next: SessionState, warnings: string[] = []) => {
    setSession(next);
    setDraftSavedAt(null);
    warnings.forEach(w => showToast('info', w));
  };

  const handleExportFile = () => {
    downloadSessionFile(session);
    showToast('success', '会话文件已导出');
  };

  const handleSaveDraft = () => {
    if (saveDraft(session)) {
      setDraftSavedAt(Date.now());
      showToast('success', '草稿已保存到本地，刷新后可恢复');
    } else {
      showToast('error', '草稿保存失败：浏览器本地存储不可用');
    }
  };

  const handleRestoreDraft = () => {
    const draft = loadDraft();
    if (!draft) {
      showToast('error', '没有可用的本地草稿');
      return;
    }
    applySession(draft.state);
    showToast('success', '已从本地草稿恢复会话');
  };

  const handleDiscardDraft = () => {
    clearDraft();
    setDraftSavedAt(null);
    showToast('info', '已放弃本地草稿');
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      showToast('error', '恢复失败：无法读取该文件');
      return;
    }
    const result = parseSessionFile(text);
    if (!result.ok) {
      // 解析失败：不调用 applySession，当前会话状态保持可用
      showToast('error', `恢复失败：${result.error}，当前会话未受影响`);
      return;
    }
    applySession(result.state, result.warnings);
    showToast('success', '会话已从文件恢复');
  };

  const { residues, ligandAtoms, bonds } = session.structure;
  const residue = residues.find(item => item.id === session.selectedResidue) ?? residues[0];
  const selectedAtomData = ligandAtoms.find(item => item.id === session.selectedAtom) ?? ligandAtoms[0];

  // 相互作用线：由会话中的结构数据派生
  const interactionLines = useMemo<InteractionLine[]>(
    () => residues
      .filter(item => item.role === 'active')
      .map(item => ({
        key: item.id,
        points: [
          new THREE.Vector3(item.x, item.y, item.z),
          new THREE.Vector3(item.x * .38, item.y * .34 + .4, item.z * .38)
        ] as [THREE.Vector3, THREE.Vector3]
      })),
    [residues]
  );

  // 选中原子在配体旋转后的世界坐标（与 3D 场景同一套变换）
  const selectedAtomWorld = useMemo(() => {
    const atom = ligandAtoms.find(a => a.id === session.selectedAtom);
    if (!atom) return null;
    return new THREE.Vector3(atom.x, atom.y, atom.z)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), session.ligandRotation)
      .add(LIGAND_GROUP_POSITION);
  }, [ligandAtoms, session.selectedAtom, session.ligandRotation]);

  const residueDistance = selectedAtomWorld
    ? selectedAtomWorld.distanceTo(new THREE.Vector3(residue.x, residue.y, residue.z))
    : null;

  const handleRecordMeasurement = () => {
    if (!selectedAtomData || !residue) {
      showToast('error', '当前选中的残基或原子不存在，无法记录测量');
      return;
    }
    if (!selectedAtomWorld) {
      showToast('error', '测量失败：选中的原子在结构中不存在');
      return;
    }
    const distance = selectedAtomWorld.distanceTo(new THREE.Vector3(residue.x, residue.y, residue.z));
    const record: Measurement = {
      id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      label: `${residue.code} ↔ ${selectedAtomData.id}`,
      distance,
      residueCode: residue.code,
      atomId: selectedAtomData.id,
      createdAt: Date.now()
    };
    setSession(s => ({ ...s, measurements: [...s.measurements, record] }));
    showToast('success', `已记录测量：${record.label} ${distance.toFixed(2)} Å`);
  };

  const handleDeleteMeasurement = (id: string) => {
    setSession(s => ({ ...s, measurements: s.measurements.filter(m => m.id !== id) }));
  };

  const formatSavedAt = (ts: number) => {
    if (!ts) return '刚刚';
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">P</div>
          <div>
            <span className="eyebrow">STRUCTURAL BIOLOGY / ANALYSIS WORKSPACE</span>
            <h1>Protein Atlas <span>·</span> 配体结合可视化</h1>
          </div>
        </div>
        <div className="header-meta">
          <span className="dataset">PDB-LITE / 1MOL</span>
          <button className="btn-export" onClick={handleExportFile}>导出会话</button>
          <button className="btn-draft" onClick={handleSaveDraft}>保存草稿</button>
          <button className="btn-restore" onClick={() => fileInputRef.current?.click()}>从文件恢复</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <button onClick={() => setSession(s => ({ ...s, showInteractions: !s.showInteractions }))}>
            {session.showInteractions ? '隐藏相互作用' : '显示相互作用'}
          </button>
          <button onClick={() => setSession(s => ({ ...s, ligandRotation: s.ligandRotation + .35 }))}>
            旋转配体 ↻
          </button>
        </div>
      </header>

      {draftSavedAt !== null && (
        <div className="draft-banner">
          <span>检测到保存于 <strong>{formatSavedAt(draftSavedAt)}</strong> 的本地草稿（{session.measurements.length} 条测量记录）</span>
          <div className="spacer" />
          <button className="primary" onClick={handleRestoreDraft}>恢复草稿</button>
          <button className="ghost" onClick={handleDiscardDraft}>放弃</button>
        </div>
      )}

      <main className="layout">
        <section className="model-card">
          <div className="model-head">
            <div>
              <span className="eyebrow">MOLECULAR VIEWER</span>
              <h2>蛋白质结合口袋 · Ligand LIG-17</h2>
            </div>
            <div className="mode-switch">
              {(['cartoon', 'surface', 'atoms'] as DisplayMode[]).map(item => (
                <button
                  key={item}
                  className={session.displayMode === item ? 'active' : ''}
                  onClick={() => setSession(s => ({ ...s, displayMode: item }))}
                >
                  {item === 'cartoon' ? '卡通带状' : item === 'surface' ? '表面模型' : '原子视图'}
                </button>
              ))}
            </div>
          </div>
          <div className="canvas-wrap">
            <ProteinModel
              residues={residues}
              ligandAtoms={ligandAtoms}
              bonds={bonds}
              displayMode={session.displayMode}
              selectedResidue={session.selectedResidue}
              onSelectResidue={id => setSession(s => ({ ...s, selectedResidue: id }))}
              ligandRotation={session.ligandRotation}
              selectedAtom={session.selectedAtom}
              onSelectAtom={id => setSession(s => ({ ...s, selectedAtom: id }))}
              showInteractions={session.showInteractions}
              interactions={interactionLines}
            />
            <div className="viewer-legend">
              <span><i className="dot protein" />蛋白骨架</span>
              <span><i className="dot ligand" />配体原子</span>
              <span><i className="dot interaction" />相互作用</span>
            </div>
            <div className="viewer-hint">左键旋转 · 滚轮缩放 · 点击残基或原子</div>
          </div>
        </section>

        <aside className="sidebar">
          <section className="panel intro-panel">
            <span className="eyebrow">ACTIVE SITE</span>
            <h3>结合口袋分析</h3>
            <p>当前模型显示 {residues.length} 个关键残基和 {ligandAtoms.length} 个配体原子。通过选择残基与原子记录空间测量，所有分析状态可随会话文件导出或从草稿恢复。</p>
            <div className="metrics">
              <Metric label="口袋体积" value="486 Å³" note="预测区域" />
              <Metric label="结合残基" value={`${residues.filter(r => r.role === 'active').length + residues.filter(r => r.role === 'support').length}`} note={`${residues.filter(r => r.role === 'active').length} active / ${residues.filter(r => r.role === 'support').length} support`} />
              <Metric label="测量记录" value={`${session.measurements.length}`} note="已保存" />
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <div>
                <span className="eyebrow">RESIDUES</span>
                <h3>关键残基</h3>
              </div>
              <span className="count">{residues.length}</span>
            </div>
            <div className="residue-list">
              {residues.map(item => (
                <button
                  key={item.id}
                  className={session.selectedResidue === item.id ? 'residue selected' : 'residue'}
                  onClick={() => setSession(s => ({ ...s, selectedResidue: item.id }))}
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
              <h3>{residue.code}</h3>
              <span>{residue.name}</span>
            </div>
            <div className="detail-grid">
              <div>
                <span>空间坐标</span>
                <b>{residue.x.toFixed(2)} / {residue.y.toFixed(2)} / {residue.z.toFixed(2)} Å</b>
              </div>
              <div>
                <span>残基角色</span>
                <b>{residue.role === 'active' ? '结合活性位点' : residue.role === 'support' ? '口袋支撑' : '柔性环区'}</b>
              </div>
              <div>
                <span>与{selectedAtomData.id}距离</span>
                <b>{residueDistance ? `${residueDistance.toFixed(2)} Å` : '—'}</b>
              </div>
              <div>
                <span>相互作用</span>
                <b>{residue.role === 'active' ? '氢键 / 极性' : '范德华力'}</b>
              </div>
            </div>
          </section>

          <section className="panel atom-panel">
            <span className="eyebrow">LIGAND ATOM</span>
            <div className="atom-row">
              <span className="atom-badge">{selectedAtomData.id.slice(0, 1)}</span>
              <div>
                <b>{selectedAtomData.id}</b>
                <small>点击模型中的原子切换</small>
              </div>
              <span className="atom-value">
                {selectedAtomData.id === 'N1' ? '供体' : selectedAtomData.id.startsWith('O') ? '受体' : '骨架'}
              </span>
            </div>
          </section>

          <section className="panel measurements-panel">
            <div className="panel-title">
              <div>
                <span className="eyebrow">MEASUREMENTS</span>
                <h3>测量记录</h3>
              </div>
              <span className="count">{session.measurements.length}</span>
            </div>
            <button className="record-btn" onClick={handleRecordMeasurement}>
              记录 {residue.code} ↔ {selectedAtomData.id} 的距离
            </button>
            {session.measurements.length === 0 ? (
              <p className="measure-empty">暂无测量记录。选择残基与配体原子后点击上方按钮，记录的距离会随会话一起保存。</p>
            ) : (
              <div className="measure-list">
                {session.measurements.map(m => (
                  <div key={m.id} className="measure-item">
                    <span>
                      <b>{m.label}</b>
                      <small>{new Date(m.createdAt).toLocaleString('zh-CN', { hour12: false })}</small>
                    </span>
                    <span className="dist">{m.distance.toFixed(2)} Å</span>
                    <button title="删除记录" onClick={() => handleDeleteMeasurement(m.id)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </main>

      {toast && (
        <div className="toast-stack">
          <div className={`toast ${toast.kind}`}>{toast.text}</div>
        </div>
      )}
    </div>
  );
}
