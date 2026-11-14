import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReactFlow, Background, Controls, Handle, Position, type NodeProps } from '@xyflow/react'
import { api, ApiError } from './api'
import {
  classificationLabel,
  kindLabel,
  type Citation,
  type Comparison,
  type Configuration,
  type Document,
  type Draft,
  type InvestmentResult,
  type MapNode,
  type Workflow,
} from './contracts'
import { layoutGraph } from './graph'

type Section = 'workspace' | 'sources' | 'drafts' | 'comparison'
type SourceView = { document: Document; page: number }

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    map: 'M3 6 9 3l6 3 6-3v15l-6 3-6-3-6 3V6zm6-3v15m6-12v15',
    file: 'M6 3h8l5 5v13H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm8 0v5h5M8 13h8M8 17h8',
    layers: 'M12 2 2 7l10 5 10-5-10-5zm-10 10 10 5 10-5M2 17l10 5 10-5',
    compare: 'M4 4h7v16H4zM13 4h7v16h-7zM7 8h1m9 0h1',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    check: 'M4 12l5 5L20 6',
    upload: 'M12 16V3m-5 5 5-5 5 5M4 17v4h16v-4',
    print: 'M6 9V3h12v6M6 17H4V9h16v8h-2M6 14h12v7H6z',
    refresh: 'M20 11a8 8 0 1 0-2 6m2-6V5m0 6h-6',
    alert: 'M12 3 2 21h20L12 3zm0 6v5m0 3h.01',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 8v5m0-8h.01',
    x: 'M4 4l16 16M20 4 4 20',
    edit: 'M4 20h4l12-12-4-4L4 16v4zm10-14 4 4',
    link: 'M10 13a5 5 0 0 0 7 .3l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7-.3l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.info} />
    </svg>
  )
}

function AtlasNode({ data, selected }: NodeProps) {
  const item = data.item as MapNode
  return (
    <div className={`graph-node graph-${item.kind} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="graph-node-eyebrow">
        <span className="node-kind-dot" />
        {kindLabel[item.kind]}
      </div>
      <strong>{item.label}</strong>
      <p>{item.text || 'No detail supplied.'}</p>
      <div className="graph-node-foot">
        <span>{classificationLabel[item.classification]}</span>
        <span>
          {item.citations.length
            ? `${item.citations.length} source${item.citations.length === 1 ? '' : 's'}`
            : 'No citation'}
        </span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = { atlas: AtlasNode }
const date = (value: string) => {
  const d = new Date(value)
  return Number.isNaN(d.valueOf())
    ? value
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function EvidenceTag({ classification }: { classification: MapNode['classification'] }) {
  return (
    <span className={`evidence-tag evidence-${classification}`}>
      {classificationLabel[classification]}
    </span>
  )
}

function EmptyMap({ hasDraft }: { hasDraft: boolean }) {
  return (
    <div className="map-empty">
      <div className="empty-mark">
        <span />
        <span />
        <span />
      </div>
      <div className="eyebrow">{hasDraft ? 'INCOMPLETE MAP' : 'AWAITING A GROUNDED DRAFT'}</div>
      <h3>
        {hasDraft ? (
          'No map nodes were returned.'
        ) : (
          <>
            Turn an investor question into
            <br />a clear infrastructure story.
          </>
        )}
      </h3>
      <p>
        {hasDraft
          ? 'The explanation and evidence review remain available. No conceptual links can be displayed until there are supported map nodes.'
          : 'Select source PDFs, add the founder’s context, and generate a map. Every claim stays linked to its evidence or uncertainty.'}
      </p>
    </div>
  )
}

export default function App() {
  const [section, setSection] = useState<Section>('workspace')
  const [config, setConfig] = useState<Configuration | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [comparison, setComparison] = useState<Comparison[]>([])
  const [dataLoaded, setDataLoaded] = useState(false)
  const [question, setQuestion] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedDocs, setSelectedDocs] = useState<string[]>([])
  const [workflow, setWorkflow] = useState<Workflow>('single')
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null)
  const [working, setWorking] = useState<InvestmentResult | null>(null)
  const [dirty, setDirty] = useState(false)
  const [editedFields, setEditedFields] = useState<string[]>([])
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [versions, setVersions] = useState<Draft[]>([])
  const [sourceView, setSourceView] = useState<SourceView | null>(null)
  const [sourceLanguage, setSourceLanguage] = useState('')
  const [derivedFrom, setDerivedFrom] = useState('')
  const [pageMapText, setPageMapText] = useState('{}')
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const configured = config?.configured === true
  const storageReady =
    !!config &&
    !config.missing.some((field) => field === 'ATLAS_PROJECT_ID' || field === 'ATLAS_GCS_BUCKET')

  const loadData = useCallback(async () => {
    setBusy('loading')
    setError('')
    setDataLoaded(false)
    try {
      const status = await api.config()
      setConfig(status)
      if (
        !status.missing.some(
          (field) => field === 'ATLAS_PROJECT_ID' || field === 'ATLAS_GCS_BUCKET',
        )
      ) {
        const [docs, saved, results] = await Promise.all([
          api.documents(),
          api.drafts(),
          api.comparisons(),
        ])
        setDocuments(docs)
        setDrafts(saved)
        setComparison(results)
        setDataLoaded(true)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the workspace.')
    } finally {
      setBusy('')
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const graph = useMemo(
    () => (working ? layoutGraph(working) : { nodes: [], edges: [] }),
    [working],
  )
  const node = working?.map.nodes.find((item) => item.id === selectedNode)
  const edge = working?.map.edges.find((item) => item.id === selectedEdge)
  const sourceName = (citation: Citation) =>
    documents.find((doc) => doc.id === citation.document_id)?.filename ||
    `${citation.document_id.slice(0, 12)}…`
  const sourceRef = (citation: Citation) => `${sourceName(citation)}, p. ${citation.page}`

  function setDraft(draft: Draft) {
    setActiveDraft(draft)
    setWorking(structuredClone(draft.result))
    setDirty(false)
    setEditedFields(draft.edited_fields || [])
    setSelectedNode(null)
    setSelectedEdge(null)
    setConflict(false)
    setQuestion(draft.request.question)
    setNotes(draft.request.founder_notes)
    setSelectedDocs(draft.request.document_ids)
    setWorkflow(draft.request.workflow)
    setSection('workspace')
  }

  function editResult(key: string, mutate: (result: InvestmentResult) => void) {
    if (!working) return
    const next = structuredClone(working)
    mutate(next)
    setWorking(next)
    setDirty(true)
    setEditedFields((existing) => (existing.includes(key) ? existing : [...existing, key]))
  }

  async function generate() {
    if (!question.trim()) {
      setError('Enter the investor question before generating a map.')
      return
    }
    setBusy('generating')
    setError('')
    setNotice('')
    try {
      const draft = await api.generate({
        question: question.trim(),
        founder_notes: notes.trim(),
        document_ids: selectedDocs,
        workflow,
      })
      setDraft(draft)
      setDrafts((items) => [draft, ...items.filter((item) => item.id !== draft.id)])
      setNotice(
        'Draft generated. Review every claim, citation, and unresolved item before approval.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed.')
    } finally {
      setBusy('')
    }
  }

  async function upload(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Choose a PDF document.')
      return
    }
    const limit = Number(config?.limits.max_upload_bytes || 20 * 1024 * 1024)
    if (file.size > limit) {
      setError(`PDF exceeds the ${Math.round(limit / 1024 / 1024)} MB upload limit.`)
      return
    }
    let pageMap: Record<string, number[]> = {}
    if (derivedFrom) {
      try {
        pageMap = JSON.parse(pageMapText)
        if (
          !pageMap ||
          Array.isArray(pageMap) ||
          typeof pageMap !== 'object' ||
          !Object.keys(pageMap).length ||
          Object.entries(pageMap).some(
            ([page, originals]) =>
              !/^\d+$/.test(page) ||
              !Array.isArray(originals) ||
              !originals.length ||
              originals.some((p) => !Number.isInteger(p) || p < 1),
          )
        )
          throw new Error()
      } catch {
        setError(
          'Enter a reviewed page map such as {"1":[1]}. Each translation page must map to original page numbers.',
        )
        return
      }
    }
    setBusy('uploading')
    setError('')
    setNotice('')
    try {
      const doc = await api.upload(file, {
        source_language: sourceLanguage.trim() || 'undetermined',
        derived_from: derivedFrom || undefined,
        source_page_map: pageMap,
      })
      setDocuments((items) => [doc, ...items.filter((item) => item.id !== doc.id)])
      if (doc.status === 'ready') {
        setSelectedDocs((ids) => (ids.includes(doc.id) ? ids : [...ids, doc.id]))
        setNotice(
          `${doc.filename} is ready: ${doc.page_count} page${doc.page_count === 1 ? '' : 's'} extracted.`,
        )
      } else setError(`${doc.filename}: ${doc.status.replace('_', ' ')}. ${doc.warnings.join(' ')}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setBusy('')
    }
  }

  async function save() {
    if (!activeDraft || !working) return
    setBusy('saving')
    setError('')
    try {
      const saved = await api.update(activeDraft.id, activeDraft.revision, working)
      setDraft(saved)
      setDrafts((items) => [saved, ...items.filter((item) => item.id !== saved.id)])
      setNotice(
        saved.status === 'draft'
          ? 'Changes saved as a new draft version. Approval requires another explicit review.'
          : 'Changes saved.',
      )
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true)
        setError(
          'This draft changed elsewhere. Your edits are still local. Reload the latest version to review it before editing again.',
        )
      } else setError(e instanceof Error ? e.message : 'Could not save changes.')
    } finally {
      setBusy('')
    }
  }

  async function approve() {
    if (!activeDraft || dirty) return
    setBusy('approving')
    setError('')
    try {
      const approved = await api.approve(activeDraft.id, activeDraft.revision)
      setDraft(approved)
      setDrafts((items) => [approved, ...items.filter((item) => item.id !== approved.id)])
      setNotice('Approved by human review. Further edits require a new approval.')
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true)
        setError('This draft changed elsewhere. Reload the latest version before approving it.')
      } else setError(e instanceof Error ? e.message : 'Approval failed.')
    } finally {
      setBusy('')
    }
  }

  async function showSource(citation: Citation) {
    setBusy('source')
    setError('')
    try {
      setSourceView({ document: await api.document(citation.document_id), page: citation.page })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open source page.')
    } finally {
      setBusy('')
    }
  }

  async function openVersions() {
    if (!activeDraft) return
    setBusy('versions')
    setError('')
    try {
      setVersions(await api.versions(activeDraft.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load versions.')
    } finally {
      setBusy('')
    }
  }

  async function reloadLatest() {
    if (!activeDraft) return
    setBusy('reloading')
    try {
      setDraft(await api.draft(activeDraft.id))
      setError('')
      setNotice('Latest version loaded. Review it before editing or approving.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reload the draft.')
    } finally {
      setBusy('')
    }
  }

  const nav: { id: Section; label: string; icon: string }[] = [
    { id: 'workspace', label: 'Workspace', icon: 'map' },
    { id: 'sources', label: 'Sources', icon: 'file' },
    { id: 'drafts', label: 'Saved drafts', icon: 'layers' },
    { id: 'comparison', label: 'Comparison', icon: 'compare' },
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <span>A</span>
          </div>
          <div>
            <strong>AIN ATLAS</strong>
            <small>INVESTMENT WORKSPACE</small>
          </div>
        </div>
        <div className="sidebar-label">NAVIGATE</div>
        <nav aria-label="Primary navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${section === item.id ? 'active' : ''}`}
              onClick={() => setSection(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.id === 'drafts' && drafts.length > 0 && <em>{drafts.length}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-rule" />
          <div className="sidebar-caption">
            A CLEARER VIEW OF
            <br />
            WHAT CAPITAL COULD ENABLE.
          </div>
          <span className="sidebar-version">Prototype · Founder review</span>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div>
            <div className="breadcrumb">
              AIN-N&N <span>/</span> {nav.find((item) => item.id === section)?.label}
            </div>
            <h1>
              {section === 'workspace'
                ? 'Investment map'
                : nav.find((item) => item.id === section)?.label}
            </h1>
            <div className="top-tagline">Map investment to infrastructure.</div>
          </div>
          <div className="top-actions">
            <span className={`connection ${configured ? 'connected' : 'disconnected'}`}>
              <i />
              {configured
                ? 'Services configured'
                : storageReady
                  ? 'Model setup needed'
                  : config
                    ? 'Setup required'
                    : 'Checking connection'}
            </span>
            <button
              className="icon-button"
              title="Refresh workspace"
              aria-label="Refresh workspace"
              onClick={() => void loadData()}
              disabled={!!busy}
            >
              <Icon name="refresh" />
            </button>
            {activeDraft && section === 'workspace' && (
              <button
                className="icon-button print-action"
                title="Print draft"
                aria-label="Print draft"
                onClick={() => window.print()}
              >
                <Icon name="print" />
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="banner error-banner" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
            {conflict && (
              <button className="conflict-reload" onClick={() => void reloadLatest()}>
                Reload latest
              </button>
            )}
            <button
              onClick={() => {
                setError('')
                setConflict(false)
              }}
              aria-label="Dismiss error"
            >
              <Icon name="x" size={15} />
            </button>
          </div>
        )}
        {notice && (
          <div className="banner notice-banner" role="status">
            <Icon name="check" />
            <span>{notice}</span>
            <button onClick={() => setNotice('')} aria-label="Dismiss notice">
              <Icon name="x" size={15} />
            </button>
          </div>
        )}
        {config && !configured && (
          <div className="setup-banner">
            <div className="setup-symbol">
              <Icon name="info" size={22} />
            </div>
            <div>
              <strong>Cloud configuration needed</strong>
              <p>
                {config.message ||
                  'Configure Google Cloud services before documents and model generation can run.'}
              </p>
              {config.missing.length > 0 && <small>Missing: {config.missing.join(' · ')}</small>}
            </div>
            <button className="subtle-button" onClick={() => void loadData()}>
              Recheck
            </button>
          </div>
        )}

        {section === 'workspace' && (
          <div className="workspace-grid">
            <section className="compose-panel panel">
              <div className="panel-heading">
                <span className="panel-kicker">01 / DEFINE</span>
                <h2>Start with the question</h2>
                <p>
                  Give the investor’s interest and the founder’s own context. Claims in notes remain
                  founder provided until supported.
                </p>
              </div>
              <label className="field-label" htmlFor="question">
                Investor question <span>Required</span>
              </label>
              <textarea
                id="question"
                className="question-input"
                placeholder="What infrastructure are you building, and what would funding support?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={4000}
              />
              <label className="field-label" htmlFor="notes">
                Founder notes <span>Optional</span>
              </label>
              <textarea
                id="notes"
                className="notes-input"
                placeholder="Add the founder’s current plans, priorities, or clarifications…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={12000}
              />
              <div className="field-label source-heading">
                Source documents{' '}
                <button className="text-button" onClick={() => setSection('sources')}>
                  Manage sources <Icon name="arrow" size={14} />
                </button>
              </div>
              <div className="source-choices">
                {documents.filter((d) => d.status === 'ready').length ? (
                  documents
                    .filter((d) => d.status === 'ready')
                    .map((d) => (
                      <label className="source-choice" key={d.id}>
                        <input
                          type="checkbox"
                          checked={selectedDocs.includes(d.id)}
                          onChange={(e) =>
                            setSelectedDocs((ids) =>
                              e.target.checked ? [...ids, d.id] : ids.filter((id) => id !== d.id),
                            )
                          }
                        />
                        <span className="source-choice-icon">
                          <Icon name="file" size={16} />
                        </span>
                        <span className="source-choice-label">
                          {d.filename}
                          <small>
                            {d.page_count} pages · {d.source_language} · v{d.version}
                          </small>
                        </span>
                      </label>
                    ))
                ) : (
                  <div className="source-empty">
                    <Icon name="file" size={17} />
                    {dataLoaded ? 'No ingested PDFs yet.' : 'Connect storage to load sources.'}
                  </div>
                )}
              </div>
              <div className="workflow-field">
                <div className="field-label">Workflow</div>
                <div className="segmented" role="group" aria-label="Workflow">
                  <button
                    className={workflow === 'single' ? 'active' : ''}
                    onClick={() => setWorkflow('single')}
                  >
                    Single agent
                  </button>
                  <button
                    className={workflow === 'multi' ? 'active' : ''}
                    onClick={() => setWorkflow('multi')}
                  >
                    Multi agent
                  </button>
                </div>
              </div>
              <button
                className="primary-button generate-button"
                disabled={!configured || !!busy || !question.trim()}
                onClick={() => void generate()}
              >
                {busy === 'generating' ? 'Generating grounded draft…' : 'Generate investment map'}
                <Icon name="arrow" size={17} />
              </button>
              <p className="under-button">
                Generation uses live Vertex AI and the selected documents.
              </p>
            </section>

            <section className="map-panel panel">
              <div className="map-panel-top">
                <div>
                  <span className="panel-kicker">02 / CONNECT</span>
                  <h2>Investment map</h2>
                  <p>Conceptual funding, capabilities, and dependencies</p>
                </div>
                <div className="map-count">
                  {working
                    ? `${working.map.nodes.length} nodes · ${working.map.edges.length} links`
                    : 'No draft yet'}
                </div>
              </div>
              <div className="map-canvas">
                {working && graph.nodes.length ? (
                  <ReactFlow
                    nodes={graph.nodes}
                    edges={graph.edges}
                    nodeTypes={nodeTypes}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable
                    onNodeClick={(_, flowNode) => {
                      setSelectedNode(flowNode.id)
                      setSelectedEdge(null)
                    }}
                    onEdgeClick={(_, flowEdge) => {
                      setSelectedEdge(flowEdge.id)
                      setSelectedNode(null)
                    }}
                    fitView
                    fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                    minZoom={0.3}
                    maxZoom={1.3}
                  >
                    <Background color="#dce6e4" gap={24} size={1.2} />
                    <Controls showInteractive={false} position="bottom-left" />
                  </ReactFlow>
                ) : (
                  <EmptyMap hasDraft={!!working} />
                )}
              </div>
              <div className="map-footer">
                <div className="legend">
                  <span>
                    <i className="legend-funds" />
                    Funds
                  </span>
                  <span>
                    <i className="legend-enables" />
                    Enables
                  </span>
                  <span>
                    <i className="legend-depends" />
                    Depends on
                  </span>
                </div>
                <span>
                  Dashed links are conceptual; inspect evidence before treating connections as
                  established.
                </span>
              </div>
            </section>

            <section className="review-panel panel">
              <div className="review-head">
                <div>
                  <span className="panel-kicker">03 / REVIEW</span>
                  <h2>Explanation & evidence</h2>
                </div>
                {activeDraft && (
                  <span className={`status-pill ${dirty ? 'dirty' : activeDraft.status}`}>
                    {dirty
                      ? 'Unsaved edits'
                      : activeDraft.status === 'approved'
                        ? 'Approved'
                        : 'Draft'}
                  </span>
                )}
              </div>
              {working ? (
                <div className="review-scroll">
                  <div className="review-section">
                    <div className="review-label">EXPLANATION CARD</div>
                    <input
                      className="title-edit"
                      aria-label="Explanation title"
                      value={working.explanation.title}
                      onChange={(e) =>
                        editResult('explanation.title', (r) => {
                          r.explanation.title = e.target.value
                        })
                      }
                    />
                    {editedFields.includes('explanation.title') && (
                      <span className="human-edit">Human edit</span>
                    )}
                    <div className="statement-list">
                      {working.explanation.statements.map((statement, index) => (
                        <div className="statement" key={index}>
                          <textarea
                            aria-label={`Explanation statement ${index + 1}`}
                            value={statement.text}
                            rows={Math.max(2, Math.ceil(statement.text.length / 56))}
                            onChange={(e) =>
                              editResult(`explanation.statements.${index}.text`, (r) => {
                                r.explanation.statements[index].text = e.target.value
                              })
                            }
                          />
                          <div className="statement-meta">
                            <EvidenceTag classification={statement.classification} />
                            {statement.citations.map((c, i) => (
                              <button
                                key={`${c.document_id}-${c.page}-${i}`}
                                className="citation"
                                onClick={() => void showSource(c)}
                                title={c.quote || 'Open source page'}
                              >
                                p. {c.page} <Icon name="link" size={12} />
                              </button>
                            ))}
                            {editedFields.includes(`explanation.statements.${index}.text`) && (
                              <span className="human-edit">Human edit</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {node && (
                    <div className="review-section selected-detail">
                      <div className="section-header">
                        <div className="review-label">SELECTED MAP NODE</div>
                        <button
                          className="close-small"
                          onClick={() => setSelectedNode(null)}
                          aria-label="Close selected node"
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                      <div className="node-id">{kindLabel[node.kind]}</div>
                      <input
                        className="node-title-edit"
                        aria-label="Map node label"
                        value={node.label}
                        onChange={(e) =>
                          editResult(`map.nodes.${node.id}.label`, (r) => {
                            r.map.nodes.find((n) => n.id === node.id)!.label = e.target.value
                          })
                        }
                      />
                      <textarea
                        aria-label="Map node description"
                        value={node.text}
                        rows={3}
                        onChange={(e) =>
                          editResult(`map.nodes.${node.id}.text`, (r) => {
                            r.map.nodes.find((n) => n.id === node.id)!.text = e.target.value
                          })
                        }
                      />
                      <div className="statement-meta">
                        <EvidenceTag classification={node.classification} />
                        {node.citations.map((c, i) => (
                          <button className="citation" key={i} onClick={() => void showSource(c)}>
                            p. {c.page} <Icon name="link" size={12} />
                          </button>
                        ))}
                        {(editedFields.includes(`map.nodes.${node.id}.label`) ||
                          editedFields.includes(`map.nodes.${node.id}.text`)) && (
                          <span className="human-edit">Human edit</span>
                        )}
                      </div>
                    </div>
                  )}
                  {edge && (
                    <div className="review-section selected-detail">
                      <div className="section-header">
                        <div className="review-label">SELECTED MAP LINK</div>
                        <button
                          className="close-small"
                          onClick={() => setSelectedEdge(null)}
                          aria-label="Close selected link"
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                      <div className="node-id">{edge.relationship.replace('_', ' ')}</div>
                      <p className="link-detail">
                        {working.map.nodes.find((n) => n.id === edge.source)?.label} →{' '}
                        {working.map.nodes.find((n) => n.id === edge.target)?.label}
                      </p>
                      <div className="statement-meta">
                        <EvidenceTag classification={edge.classification || 'assumption'} />
                        {(edge.citations || []).map((c, i) => (
                          <button className="citation" key={i} onClick={() => void showSource(c)}>
                            p. {c.page} <Icon name="link" size={12} />
                          </button>
                        ))}
                      </div>
                      <p className="link-caveat">
                        A conceptual link does not establish an operating route or a confirmed
                        dependency.
                      </p>
                    </div>
                  )}
                  <div className="review-section">
                    <div className="review-label">BUDGET RECONCILIATION</div>
                    {working.budget_checks.length ? (
                      working.budget_checks.map((check, i) => (
                        <div className={`budget-card budget-${check.status}`} key={i}>
                          <div className="budget-top">
                            <strong>{check.currency}</strong>
                            <span>{check.status}</span>
                          </div>
                          <p>{check.description}</p>
                          <dl>
                            <div>
                              <dt>Phase subtotals</dt>
                              <dd>{check.subtotal_sum ?? 'Unknown'}</dd>
                            </div>
                            <div>
                              <dt>Printed total</dt>
                              <dd>{check.printed_total ?? 'Unknown'}</dd>
                            </div>
                            {check.difference && (
                              <div>
                                <dt>Difference</dt>
                                <dd>{check.difference}</dd>
                              </div>
                            )}
                          </dl>
                          {check.fields.map((f, j) => (
                            <button
                              className="budget-source"
                              key={j}
                              onClick={() => void showSource(f.citation)}
                            >
                              {f.label} · {sourceRef(f.citation)}
                            </button>
                          ))}
                        </div>
                      ))
                    ) : (
                      <p className="quiet-state">
                        No documented budget figures were available for reconciliation.
                      </p>
                    )}
                  </div>
                  <div className="review-section">
                    <div className="review-label">GAPS & UNCERTAINTY</div>
                    {working.gaps.length ||
                    working.assumptions.length ||
                    working.contradictions.length ? (
                      <div className="issues">
                        {working.gaps.map((item, i) => (
                          <div className="issue" key={`g${i}`}>
                            <span className="issue-icon">?</span>
                            <p>{item}</p>
                          </div>
                        ))}
                        {working.assumptions.map((item, i) => (
                          <div className="issue" key={`a${i}`}>
                            <span className="issue-icon">~</span>
                            <p>
                              {item.text}
                              <EvidenceTag classification="assumption" />
                              {item.citations.map((c, j) => (
                                <button
                                  className="citation"
                                  key={j}
                                  onClick={() => void showSource(c)}
                                >
                                  {sourceRef(c)}
                                </button>
                              ))}
                            </p>
                          </div>
                        ))}
                        {working.contradictions.map((item, i) => (
                          <div className="issue conflict" key={`c${i}`}>
                            <span className="issue-icon">!</span>
                            <p>
                              {item.text}
                              {item.citations.map((c, j) => (
                                <button
                                  className="citation"
                                  key={j}
                                  onClick={() => void showSource(c)}
                                >
                                  {sourceRef(c)}
                                </button>
                              ))}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="quiet-state">
                        No gaps or assumptions were returned. Review source support before approval.
                      </p>
                    )}
                    {working.warnings.map((w, i) => (
                      <p className="warning-line" key={i}>
                        {w}
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="review-empty">
                  <div className="review-empty-icon">
                    <Icon name="edit" size={26} />
                  </div>
                  <h3>Review starts here</h3>
                  <p>
                    Generated explanations, budget checks, evidence gaps, and citations will appear
                    with the map.
                  </p>
                </div>
              )}
              {activeDraft && (
                <div className="review-actions">
                  <div className="review-version">
                    <span>Version {activeDraft.revision}</span>
                    <button className="text-button" onClick={() => void openVersions()}>
                      View history
                    </button>
                  </div>
                  {dirty && activeDraft.status === 'approved' && (
                    <p className="approval-warning">Saving edits will invalidate this approval.</p>
                  )}
                  <div className="action-row">
                    <button
                      className="secondary-button"
                      disabled={!dirty || !!busy}
                      onClick={() => void save()}
                    >
                      {busy === 'saving' ? 'Saving…' : 'Save edits'}
                    </button>
                    <button
                      className="primary-button"
                      disabled={dirty || !!busy || activeDraft.status === 'approved'}
                      onClick={() => void approve()}
                    >
                      <Icon name="check" size={16} />
                      Approve
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {section === 'sources' && (
          <div className="content-page">
            <div className="page-intro">
              <div>
                <span className="panel-kicker">SOURCE LIBRARY</span>
                <h2>Trace every claim to a page.</h2>
                <p>
                  Original PDFs are stored with a content hash, version, page text, and extraction
                  status. Uploading the same file again is idempotent.
                </p>
              </div>
            </div>
            <div className="upload-panel">
              <div className="upload-fields">
                <label>
                  Document language
                  <input
                    value={sourceLanguage}
                    onChange={(e) => setSourceLanguage(e.target.value)}
                    placeholder="e.g. French"
                  />
                </label>
                <label>
                  Derived from original PDF
                  <select value={derivedFrom} onChange={(e) => setDerivedFrom(e.target.value)}>
                    <option value="">Original document</option>
                    {documents
                      .filter((doc) => doc.status === 'ready' && !doc.derived_from)
                      .map((doc) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.filename}
                        </option>
                      ))}
                  </select>
                </label>
                {derivedFrom && (
                  <label className="page-map-field">
                    Reviewed page map (translation page → original pages)
                    <textarea
                      value={pageMapText}
                      onChange={(e) => setPageMapText(e.target.value)}
                      rows={2}
                      aria-label="Reviewed page map"
                    />
                    <small>
                      JSON format, for example {`{"1":[1],"2":[2,3]}`}. The source page must exist
                      in the selected original.
                    </small>
                  </label>
                )}
              </div>
              <label className={`upload-button ${!storageReady || !!busy ? 'disabled' : ''}`}>
                <Icon name="upload" size={17} />
                {busy === 'uploading' ? 'Extracting…' : 'Upload PDF'}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={!storageReady || !!busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void upload(file)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
            {documents.length ? (
              <div className="documents-grid">
                {documents.map((doc) => (
                  <div className="document-card" key={doc.id}>
                    <div className="document-card-top">
                      <div className="document-icon">
                        <Icon name="file" size={20} />
                      </div>
                      <span className={`document-status ${doc.status}`}>
                        {doc.status.replace('_', ' ')}
                      </span>
                    </div>
                    <h3>{doc.filename}</h3>
                    <p>
                      {doc.page_count} pages · {doc.source_language} · version {doc.version}
                      {doc.derived_from ? ' · derived translation' : ' · original'}
                    </p>
                    <div className="document-meta">
                      <span>SHA-256</span>
                      <code>{doc.content_hash.slice(0, 16)}…</code>
                    </div>
                    {doc.derived_from && (
                      <div className="document-meta">
                        <span>Original</span>
                        <code>{doc.derived_from.slice(0, 16)}…</code>
                      </div>
                    )}
                    {doc.warnings.map((w, i) => (
                      <p className="document-warning" key={i}>
                        {w}
                      </p>
                    ))}
                    <div className="document-card-actions">
                      <button
                        className="text-button"
                        onClick={() => void showSource({ document_id: doc.id, page: 1, quote: '' })}
                        disabled={doc.page_count === 0}
                      >
                        Read pages <Icon name="arrow" size={14} />
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          setSelectedDocs((ids) =>
                            ids.includes(doc.id)
                              ? ids.filter((x) => x !== doc.id)
                              : [...ids, doc.id],
                          )
                        }
                        disabled={doc.status !== 'ready'}
                      >
                        {selectedDocs.includes(doc.id) ? 'Selected ✓' : 'Select for map'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="page-empty">
                <Icon name="file" size={32} />
                <h3>
                  {!storageReady
                    ? 'Connect storage to load sources'
                    : dataLoaded
                      ? 'No source documents yet'
                      : 'Sources could not be loaded'}
                </h3>
                <p>
                  {!storageReady
                    ? 'Set the backend project and storage bucket, then recheck the connection.'
                    : dataLoaded
                      ? 'Upload approved company PDFs to ground claims. No business facts are preloaded.'
                      : 'Check Google access, then recheck the connection.'}
                </p>
              </div>
            )}
          </div>
        )}

        {section === 'drafts' && (
          <div className="content-page">
            <div className="page-intro">
              <div>
                <span className="panel-kicker">REVIEW HISTORY</span>
                <h2>Saved investment drafts.</h2>
                <p>
                  Versions preserve the founder’s edits and approval state. Editing an approved
                  draft returns it to review.
                </p>
              </div>
            </div>
            {drafts.length ? (
              <div className="draft-list">
                {drafts.map((draft) => (
                  <button key={draft.id} className="draft-row" onClick={() => setDraft(draft)}>
                    <div className="draft-row-mark">
                      <Icon name="map" size={19} />
                    </div>
                    <div className="draft-row-main">
                      <strong>{draft.result.explanation.title || draft.request.question}</strong>
                      <span>{draft.request.question}</span>
                    </div>
                    <div className="draft-row-end">
                      <span className={`status-pill ${draft.status}`}>{draft.status}</span>
                      <small>
                        v{draft.revision} · {date(draft.updated_at)}
                      </small>
                    </div>
                    <Icon name="arrow" size={17} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="page-empty">
                <Icon name="layers" size={32} />
                <h3>
                  {!storageReady
                    ? 'Connect storage to load drafts'
                    : dataLoaded
                      ? 'No saved drafts'
                      : 'Drafts could not be loaded'}
                </h3>
                <p>
                  {!storageReady
                    ? 'Set the backend project and storage bucket, then recheck the connection to load saved drafts.'
                    : dataLoaded
                      ? 'Generate and save the first evidence-grounded investment map to begin a review history.'
                      : 'Check Google access, then recheck the connection.'}
                </p>
                <button className="secondary-button" onClick={() => setSection('workspace')}>
                  Open workspace
                </button>
              </div>
            )}
          </div>
        )}

        {section === 'comparison' && (
          <div className="content-page">
            <div className="page-intro">
              <div>
                <span className="panel-kicker">CONTROLLED EVALUATION</span>
                <h2>Single agent vs. multi agent.</h2>
                <p>
                  Both paths share the same model, evidence packet, calculation results, and
                  validation rules. Results appear only after a live paired run.
                </p>
              </div>
            </div>
            {comparison.length ? (
              <div className="comparison-list">
                {comparison.map((entry) => (
                  <div className="comparison-card" key={entry.id}>
                    <div className="comparison-head">
                      <div>
                        <div className="review-label">PAIRED RUN · {entry.dataset_version}</div>
                        <h3>
                          {entry.case_count} case{entry.case_count === 1 ? '' : 's'} · {entry.model}
                        </h3>
                        <p>{entry.conditions}</p>
                      </div>
                      <small>{date(entry.created_at)}</small>
                    </div>
                    <div className="comparison-table-wrap">
                      <table className="comparison-table">
                        <thead>
                          <tr>
                            <th>Workflow</th>
                            <th>Case</th>
                            <th>Result</th>
                            <th>Latency</th>
                            <th>Calls</th>
                            <th>Tokens in / out</th>
                            <th>Validation</th>
                            <th>Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entry.arms.map((arm, i) => (
                            <tr key={`${arm.case_id}-${arm.workflow}-${i}`}>
                              <td>{arm.workflow === 'single' ? 'Single agent' : 'Multi agent'}</td>
                              <td>{arm.case_id}</td>
                              <td className={arm.status === 'failed' ? 'cell-fail' : 'cell-pass'}>
                                {arm.status}
                              </td>
                              <td>{Math.round(arm.latency_ms)} ms</td>
                              <td>
                                {arm.model_calls ?? 'Unknown'}
                                {arm.retries ? ` (includes ${arm.retries} retry)` : ''}
                              </td>
                              <td>
                                {`${arm.input_tokens ?? 'unknown'} / ${arm.output_tokens ?? 'unknown'}`}
                              </td>
                              <td>{arm.validation_passed ? 'Passed' : 'Failed'}</td>
                              <td>
                                {arm.estimated_cost_usd == null
                                  ? 'Unknown'
                                  : `$${arm.estimated_cost_usd.toFixed(4)}`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="comparison-note">
                      Usage and cost marked unknown have no verified provider metadata or dated rate
                      card. Results describe these cases under these conditions only.
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="page-empty">
                <Icon name="compare" size={32} />
                <h3>
                  {!storageReady
                    ? 'Connect storage to load comparisons'
                    : dataLoaded
                      ? 'No comparison results yet'
                      : 'Comparisons could not be loaded'}
                </h3>
                <p>
                  {!storageReady
                    ? 'Set the backend project and storage bucket, then recheck the connection to load saved runs.'
                    : dataLoaded
                      ? 'No live paired run is saved in the connected workspace. This view does not infer quality, cost, or speed from test doubles.'
                      : 'Check Google access, then recheck the connection.'}
                </p>
              </div>
            )}
          </div>
        )}
        {working && activeDraft && (
          <article className="print-report" aria-label="Printable investment review record">
            <header className="print-header">
              <div className="print-mark">AIN ATLAS</div>
              <h1>{working.explanation.title || 'Investment map'}</h1>
              <p>Map investment to infrastructure.</p>
              <div className="print-metadata">
                <span>
                  Draft {activeDraft.id} · Version {activeDraft.revision}
                </span>
                <strong>
                  {dirty
                    ? 'UNSAVED EDITS — NOT APPROVED FOR SHARING'
                    : activeDraft.status === 'approved'
                      ? 'HUMAN APPROVED'
                      : 'DRAFT — REVIEW REQUIRED'}
                </strong>
                <span>
                  {activeDraft.origin === 'human_edited' || editedFields.length
                    ? 'Contains human edits'
                    : 'Generated draft'}
                </span>
              </div>
            </header>
            <section>
              <h2>Investor interest</h2>
              <p>{activeDraft.request.question}</p>
              {activeDraft.request.founder_notes && (
                <>
                  <h3>Founder notes</h3>
                  <p>{activeDraft.request.founder_notes}</p>
                </>
              )}
            </section>
            <section>
              <h2>Explanation</h2>
              {working.explanation.statements.map((statement, index) => (
                <div className="print-item" key={index}>
                  <p>{statement.text}</p>
                  <small>
                    {classificationLabel[statement.classification]}
                    {editedFields.includes(`explanation.statements.${index}.text`)
                      ? ' · Human edited'
                      : ''}
                    {statement.citations.length
                      ? ` · ${statement.citations.map(sourceRef).join('; ')}`
                      : ' · No source citation'}
                  </small>
                </div>
              ))}
            </section>
            <section>
              <h2>Conceptual investment map</h2>
              <p className="print-caveat">
                Relationships are conceptual and do not establish operating routes, ownership, or
                confirmed services.
              </p>
              <div className="print-node-list">
                {working.map.nodes.map((node) => (
                  <div className="print-item" key={node.id}>
                    <h3>
                      {kindLabel[node.kind]} · {node.label}
                    </h3>
                    <p>{node.text}</p>
                    <small>
                      {classificationLabel[node.classification]}
                      {editedFields.some((key) => key.startsWith(`map.nodes.${node.id}.`))
                        ? ' · Human edited'
                        : ''}
                      {node.citations.length
                        ? ` · ${node.citations.map(sourceRef).join('; ')}`
                        : ' · No source citation'}
                    </small>
                  </div>
                ))}
              </div>
              <h3>Relationships</h3>
              {working.map.edges.map((edge) => (
                <div className="print-link" key={edge.id}>
                  {working.map.nodes.find((n) => n.id === edge.source)?.label || edge.source}{' '}
                  <strong>{edge.relationship.replace('_', ' ')}</strong>{' '}
                  {working.map.nodes.find((n) => n.id === edge.target)?.label || edge.target}{' '}
                  <small>
                    · {classificationLabel[edge.classification || 'assumption']}
                    {edge.citations?.length ? ` · ${edge.citations.map(sourceRef).join('; ')}` : ''}
                  </small>
                </div>
              ))}
            </section>
            <section>
              <h2>Budget reconciliation</h2>
              {working.budget_checks.length ? (
                working.budget_checks.map((check, index) => (
                  <div className="print-item" key={index}>
                    <h3>
                      {check.currency} · {check.status}
                    </h3>
                    <p>{check.description}</p>
                    <p>
                      Phase subtotals: {check.subtotal_sum ?? 'Unknown'} · Printed total:{' '}
                      {check.printed_total ?? 'Unknown'}
                      {check.difference ? ` · Difference: ${check.difference}` : ''}
                    </p>
                    {check.fields.map((field, i) => (
                      <small className="print-field" key={i}>
                        {field.label}: {field.amount} {field.currency} · {sourceRef(field.citation)}{' '}
                        · {field.validation_status}
                      </small>
                    ))}
                  </div>
                ))
              ) : (
                <p>No documented budget figures were available for reconciliation.</p>
              )}
            </section>
            <section>
              <h2>Missing information and assumptions</h2>
              {working.gaps.map((gap, i) => (
                <p className="print-item" key={`g${i}`}>
                  Gap: {gap}
                </p>
              ))}
              {working.assumptions.map((statement, i) => (
                <p className="print-item" key={`a${i}`}>
                  Assumption: {statement.text}
                  <small>{statement.citations.map(sourceRef).join('; ')}</small>
                </p>
              ))}
              {working.contradictions.map((statement, i) => (
                <p className="print-item" key={`c${i}`}>
                  Contradiction: {statement.text}
                  <small>{statement.citations.map(sourceRef).join('; ')}</small>
                </p>
              ))}
              {working.warnings.map((warning, i) => (
                <p className="print-item" key={`w${i}`}>
                  Warning: {warning}
                </p>
              ))}
              {!working.gaps.length &&
                !working.assumptions.length &&
                !working.contradictions.length &&
                !working.warnings.length && (
                  <p>
                    No gaps or assumptions were returned; source support still requires human
                    review.
                  </p>
                )}
            </section>
            <footer>
              AIN Atlas · Founder review record · Document statements are not independent real-world
              verification.
            </footer>
          </article>
        )}
      </div>

      {sourceView && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSourceView(null)}>
          <div
            className="source-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Source document page"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="panel-kicker">ORIGINAL SOURCE</span>
                <h2>{sourceView.document.filename}</h2>
                <p>
                  Page {sourceView.page} of {sourceView.document.page_count} · SHA-256{' '}
                  {sourceView.document.content_hash.slice(0, 16)}…
                </p>
              </div>
              <button
                className="icon-button"
                onClick={() => setSourceView(null)}
                aria-label="Close source"
              >
                <Icon name="x" />
              </button>
            </div>
            <div className="page-controls">
              <button
                disabled={sourceView.page <= 1}
                onClick={() => setSourceView({ ...sourceView, page: sourceView.page - 1 })}
              >
                ← Previous
              </button>
              <span>Page {sourceView.page}</span>
              <button
                disabled={sourceView.page >= sourceView.document.page_count}
                onClick={() => setSourceView({ ...sourceView, page: sourceView.page + 1 })}
              >
                Next →
              </button>
            </div>
            <pre className="source-text">
              {sourceView.document.pages.find((p) => p.page === sourceView.page)?.text ||
                'No extractable text on this page.'}
            </pre>
            <p className="source-disclaimer">
              This is extracted document text. A cited page does not independently verify the
              real-world claim.
            </p>
          </div>
        </div>
      )}
      {versions.length > 0 && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setVersions([])}>
          <div
            className="versions-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Draft versions"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="panel-kicker">VERSION HISTORY</span>
                <h2>Founder review timeline</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setVersions([])}
                aria-label="Close versions"
              >
                <Icon name="x" />
              </button>
            </div>
            {versions.map((v) => (
              <div className="version-row" key={`${v.id}-${v.revision}`}>
                <span className="version-dot" />
                <div>
                  <strong>
                    Version {v.revision} ·{' '}
                    {v.origin === 'human_edited' ? 'Human edited' : 'Generated'}
                  </strong>
                  <p>
                    {date(v.updated_at)} · {v.status}
                    {v.approved_at ? ` on ${date(v.approved_at)}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
