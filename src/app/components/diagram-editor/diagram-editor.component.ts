import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  inject,
  signal,
  computed,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, switchMap, from, tap } from 'rxjs';
import { DiagramStorageService } from '../../services/diagram-storage.service';
import {
  DiagramFile,
  DiagramNode,
  DiagramEdge,
  DiagramSummary,
  DiagramViewport,
  NodeType,
  PortSide,
  EdgeStyle,
} from '../../models/diagram.types';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_NODE_WIDTH = 140;
const DEFAULT_NODE_HEIGHT = 80;
const GRID_SIZE = 20;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const PORT_HIT_RADIUS = 10;
const PORT_SNAP_RADIUS = 24;
const AUTOSAVE_DEBOUNCE_MS = 800;

const NODE_TYPE_LABELS: Record<NodeType, string> = {
  'server': 'Server',
  'database': 'Database',
  'load-balancer': 'Load Balancer',
  'api-gateway': 'API Gateway',
  'microservice': 'Microservice',
  'queue': 'Queue',
  'browser': 'Browser/Client',
  'cloud': 'Cloud',
  'storage-bucket': 'Storage Bucket',
  'lambda': 'Function (λ)',
  'cache': 'Cache',
  'network-boundary': 'Network Boundary',
  'user': 'User/Actor',
  'external-system': 'External System',
  'generic-box': 'Box',
  'text-label': 'Text',
  'std-rect': 'Rectangle',
  'std-circle': 'Circle',
  'std-diamond': 'Diamond',
  'std-triangle': 'Triangle',
};

const PALETTE_GROUPS: { label: string; types: NodeType[] }[] = [
  {
    label: 'Basic Shapes',
    types: ['std-rect', 'std-circle', 'std-diamond', 'std-triangle'],
  },
  {
    label: 'Compute',
    types: ['server', 'microservice', 'lambda', 'cloud'],
  },
  {
    label: 'Data',
    types: ['database', 'queue', 'cache', 'storage-bucket'],
  },
  {
    label: 'Network',
    types: ['load-balancer', 'api-gateway'],
  },
  {
    label: 'Actors',
    types: ['browser', 'user', 'external-system', 'generic-box'],
  },
  {
    label: 'Annotation',
    types: ['text-label', 'network-boundary'],
  },
];

// ─── Undo/Redo ────────────────────────────────────────────────────────────────

interface HistoryState {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

class UndoRedoStack {
  private readonly past: HistoryState[] = [];
  private readonly future: HistoryState[] = [];

  snapshot(state: HistoryState): void {
    this.past.push({ nodes: [...state.nodes], edges: [...state.edges] });
    this.future.length = 0;
  }

  undo(current: HistoryState): HistoryState | null {
    if (this.past.length === 0) return null;
    this.future.push({ nodes: [...current.nodes], edges: [...current.edges] });
    return this.past.pop()!;
  }

  redo(current: HistoryState): HistoryState | null {
    if (this.future.length === 0) return null;
    this.past.push({ nodes: [...current.nodes], edges: [...current.edges] });
    return this.future.pop()!;
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
}

// ─── Port position helper ─────────────────────────────────────────────────────

function portPosition(node: DiagramNode, port: PortSide): { x: number; y: number } {
  switch (port) {
    case 'top':    return { x: node.x + node.width / 2, y: node.y };
    case 'bottom': return { x: node.x + node.width / 2, y: node.y + node.height };
    case 'left':   return { x: node.x,                  y: node.y + node.height / 2 };
    case 'right':  return { x: node.x + node.width,     y: node.y + node.height / 2 };
  }
}

// ─── Edge path helper ─────────────────────────────────────────────────────────

function buildEdgePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const cx = dx / 2;
  const cy = dy / 2;
  // Smooth cubic bezier
  return `M ${from.x} ${from.y} C ${from.x + cx} ${from.y}, ${to.x - cx} ${to.y}, ${to.x} ${to.y}`;
}

// ─── Snap helper ─────────────────────────────────────────────────────────────

function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

// ─── UUID helper ─────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

// ─── Node bounding-box fit ────────────────────────────────────────────────────

function computeBoundingBox(nodes: DiagramNode[]): { x: number; y: number; w: number; h: number } | null {
  if (nodes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ─── Component ───────────────────────────────────────────────────────────────

type DrawingEdgeState = {
  fromNode: string;
  fromPort: PortSide;
  currentX: number;
  currentY: number;
} | null;

type RubberBandState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
} | null;

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const RESIZE_HANDLE_DEFS: { h: ResizeHandle; cursor: string }[] = [
  { h: 'nw', cursor: 'nw-resize' }, { h: 'n', cursor: 'n-resize' }, { h: 'ne', cursor: 'ne-resize' },
  { h: 'e', cursor: 'e-resize' },
  { h: 'se', cursor: 'se-resize' }, { h: 's', cursor: 's-resize' }, { h: 'sw', cursor: 'sw-resize' },
  { h: 'w', cursor: 'w-resize' },
];

@Component({
  selector: 'app-diagram-editor',
  standalone: true,
  imports: [],
  templateUrl: './diagram-editor.component.html',
  styleUrl: './diagram-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiagramEditorComponent implements OnInit, OnDestroy {
  private readonly storage = inject(DiagramStorageService);

  readonly svgRef = viewChild<ElementRef<SVGSVGElement>>('svgCanvas');

  // ── Diagram list ─────────────────────────────────────────────────────────
  readonly diagrams = signal<DiagramSummary[]>([]);
  readonly activeDiagramId = signal<string | null>(null);
  readonly diagramsSidebarWidth = signal(224);
  readonly diagramsSidebarCollapsed = computed(() => this.diagramsSidebarWidth() < 100);

  // ── Canvas state ─────────────────────────────────────────────────────────
  readonly nodes = signal<DiagramNode[]>([]);
  readonly edges = signal<DiagramEdge[]>([]);
  readonly viewport = signal<DiagramViewport>({ x: 0, y: 0, zoom: 1 });
  readonly diagramName = signal<string>('Untitled');
  readonly pendingPlacementType = signal<NodeType | null>(null);

  // ── Selection ─────────────────────────────────────────────────────────────
  readonly selectedNodeIds = signal<Set<string>>(new Set());
  readonly selectedEdgeIds = signal<Set<string>>(new Set());

  readonly selectedNodes = computed(() => {
    const ids = this.selectedNodeIds();
    return this.nodes().filter(n => ids.has(n.id));
  });

  readonly selectedEdges = computed(() => {
    const ids = this.selectedEdgeIds();
    return this.edges().filter(e => ids.has(e.id));
  });

  readonly singleSelectedNode = computed(() => {
    const nodes = this.selectedNodes();
    return nodes.length === 1 ? nodes[0] : null;
  });

  readonly singleSelectedEdge = computed(() => {
    const edges = this.selectedEdges();
    return edges.length === 1 ? edges[0] : null;
  });

  // ── UI state ──────────────────────────────────────────────────────────────
  readonly snapToGridEnabled = signal(true);
  readonly showGrid = signal(true);
  readonly isPaletteCollapsed = signal(false);
  readonly isPropertiesOpen = computed(
    () => this.selectedNodeIds().size > 0 || this.selectedEdgeIds().size > 0,
  );
  readonly zoomPercent = computed(() => Math.round(this.viewport().zoom * 100));
  readonly saveStatus = signal<'idle' | 'saving' | 'saved'>('idle');
  readonly editingLabelNodeId = signal<string | null>(null);
  readonly onlineModeTooltipVisible = signal(false);
  readonly contextMenu = signal<{ x: number; y: number; diagramId: string } | null>(null);
  readonly renamingDiagramId = signal<string | null>(null);
  readonly renamingValue = signal<string>('');

  // ── Draw-edge ghost state ─────────────────────────────────────────────────
  drawingEdge = signal<DrawingEdgeState>(null);
  hoveredPort = signal<{ nodeId: string; port: PortSide } | null>(null);

  // ── Rubber-band selection state ───────────────────────────────────────────
  rubberBand = signal<RubberBandState>(null);

  readonly rubberBandRect = computed(() => {
    const rb = this.rubberBand();
    if (!rb) return null;
    return {
      x: Math.min(rb.startX, rb.currentX),
      y: Math.min(rb.startY, rb.currentY),
      width: Math.abs(rb.currentX - rb.startX),
      height: Math.abs(rb.currentY - rb.startY),
    };
  });

  // ── History ───────────────────────────────────────────────────────────────
  private readonly history = new UndoRedoStack();
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  // ── Autosave ──────────────────────────────────────────────────────────────
  private readonly saveSubject = new Subject<DiagramFile>();

  // ── Drag state (imperative, not reactive) ─────────────────────────────────
  readonly GRID_SIZE = GRID_SIZE;
  readonly mathMin = Math.min.bind(Math);

  readonly effectiveGridStep = computed(() => {
    const pixels = GRID_SIZE * this.viewport().zoom;
    if (pixels < 5) return GRID_SIZE * 8;
    if (pixels < 10) return GRID_SIZE * 4;
    if (pixels < 20) return GRID_SIZE * 2;
    return GRID_SIZE;
  });

  clearSelection(): void {
    this.selectedNodeIds.set(new Set());
    this.selectedEdgeIds.set(new Set());
  }

  dragState: {
    nodeId: string;
    startMouseX: number;
    startMouseY: number;
    startNodeX: number;
    startNodeY: number;
  } | null = null;

  panState: { startMouseX: number; startMouseY: number; startVpX: number; startVpY: number } | null = null;

  resizeState: {
    nodeId: string;
    handle: ResizeHandle;
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null = null;

  // ── Tool mode ─────────────────────────────────────────────────────────────
  readonly activeTool = signal<'select' | 'hand'>('select');
  isSpaceHeld = false;

  // ── Diagrams Sidebar resizing ─────────────────────────────────────────────
  private diagramsSidebarDragStartX = 0;
  private diagramsSidebarDragStartWidth = 0;
  private diagramsPrevWidth = 224;

  // ── Helpers exposed to template ───────────────────────────────────────────
  readonly nodeTypeLabels = NODE_TYPE_LABELS;
  readonly paletteGroups = PALETTE_GROUPS;
  readonly portSides: PortSide[] = ['top', 'right', 'bottom', 'left'];
  readonly resizeHandleDefs = RESIZE_HANDLE_DEFS;

  constructor() {
    this.saveSubject
      .pipe(
        tap(() => this.saveStatus.set('saving')),
        debounceTime(AUTOSAVE_DEBOUNCE_MS),
        switchMap(diagram => from(this.storage.writeDiagram(diagram))),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.saveStatus.set('saved');
        setTimeout(() => this.saveStatus.set('idle'), 1500);
        void this.refreshDiagramList();
      });
  }

  async ngOnInit(): Promise<void> {
    await this.refreshDiagramList();
  }

  ngOnDestroy(): void {}

  // ── Diagram list ─────────────────────────────────────────────────────────

  private async refreshDiagramList(): Promise<void> {
    const list = await this.storage.listDiagrams();
    this.diagrams.set(list);
  }

  async newDiagram(): Promise<void> {
    const id = uuid();
    const now = new Date().toISOString();
    const diagram: DiagramFile = {
      id,
      name: 'New Diagram',
      createdAt: now,
      updatedAt: now,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    try {
      await this.storage.writeDiagram(diagram);
      await this.refreshDiagramList();
      await this.loadDiagram(id);
    } catch (err) {
      console.error('[DiagramEditor] Failed to create diagram:', err);
      alert(`Could not create diagram. Make sure a notes folder is configured in Settings.\n\n${err}`);
    }
  }

  async loadDiagram(id: string): Promise<void> {
    const diagram = await this.storage.readDiagram(id);
    if (!diagram) return;
    this.activeDiagramId.set(id);
    this.diagramName.set(diagram.name);
    this.nodes.set(diagram.nodes);
    this.edges.set(diagram.edges);
    this.viewport.set(diagram.viewport);
    this.selectedNodeIds.set(new Set());
    this.selectedEdgeIds.set(new Set());
    this.history['past'].length = 0;
    this.history['future'].length = 0;
    this.canUndo.set(false);
    this.canRedo.set(false);
    this.editingLabelNodeId.set(null);
    this.contextMenu.set(null);
  }

  async duplicateDiagram(id: string): Promise<void> {
    const diagram = await this.storage.readDiagram(id);
    if (!diagram) return;
    const now = new Date().toISOString();
    const newId = uuid();
    await this.storage.writeDiagram({
      ...diagram,
      id: newId,
      name: `${diagram.name} (copy)`,
      createdAt: now,
      updatedAt: now,
    });
    await this.refreshDiagramList();
    await this.loadDiagram(newId);
  }

  async deleteDiagramItem(id: string): Promise<void> {
    await this.storage.deleteDiagram(id);
    if (this.activeDiagramId() === id) {
      this.activeDiagramId.set(null);
      this.nodes.set([]);
      this.edges.set([]);
      this.diagramName.set('');
    }
    await this.refreshDiagramList();
  }

  showContextMenu(event: MouseEvent, diagramId: string): void {
    event.preventDefault();
    this.contextMenu.set({ x: event.clientX, y: event.clientY, diagramId });
  }

  hideContextMenu(): void {
    this.contextMenu.set(null);
  }

  startRenaming(id: string, currentName: string | undefined): void {
    this.renamingDiagramId.set(id);
    this.renamingValue.set(currentName ?? '');
    this.contextMenu.set(null);
  }

  getDiagramName(id: string): string {
    return this.diagrams().find(d => d.id === id)?.name ?? '';
  }

  async commitRename(): Promise<void> {
    const id = this.renamingDiagramId();
    const name = this.renamingValue().trim();
    if (!id || !name) {
      this.renamingDiagramId.set(null);
      return;
    }
    await this.storage.renameDiagram(id, name);
    if (this.activeDiagramId() === id) {
      this.diagramName.set(name);
    }
    this.renamingDiagramId.set(null);
    await this.refreshDiagramList();
  }

  // ── Undo / Redo ───────────────────────────────────────────────────────────

  private snapshotHistory(): void {
    this.history.snapshot({ nodes: this.nodes(), edges: this.edges() });
    this.canUndo.set(this.history.canUndo);
    this.canRedo.set(this.history.canRedo);
  }

  undo(): void {
    const state = this.history.undo({ nodes: this.nodes(), edges: this.edges() });
    if (!state) return;
    this.nodes.set(state.nodes);
    this.edges.set(state.edges);
    this.canUndo.set(this.history.canUndo);
    this.canRedo.set(this.history.canRedo);
    this.triggerSave();
  }

  redo(): void {
    const state = this.history.redo({ nodes: this.nodes(), edges: this.edges() });
    if (!state) return;
    this.nodes.set(state.nodes);
    this.edges.set(state.edges);
    this.canUndo.set(this.history.canUndo);
    this.canRedo.set(this.history.canRedo);
    this.triggerSave();
  }

  // ── Save trigger ──────────────────────────────────────────────────────────

  private triggerSave(): void {
    const id = this.activeDiagramId();
    if (!id) return;
    const diagram: DiagramFile = {
      id,
      name: this.diagramName(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: this.nodes(),
      edges: this.edges(),
      viewport: this.viewport(),
    };
    this.saveSubject.next(diagram);
  }

  // ── Viewport ──────────────────────────────────────────────────────────────

  fitToView(): void {
    const bb = computeBoundingBox(this.nodes());
    if (!bb) return;
    const svgEl = this.svgRef()?.nativeElement;
    if (!svgEl) return;
    const { width, height } = svgEl.getBoundingClientRect();
    const PADDING = 60;
    const zoom = Math.min(
      (width - PADDING * 2) / bb.w,
      (height - PADDING * 2) / bb.h,
      MAX_ZOOM,
    );
    const clampedZoom = Math.max(MIN_ZOOM, zoom);
    const x = (width - bb.w * clampedZoom) / 2 - bb.x * clampedZoom;
    const y = (height - bb.h * clampedZoom) / 2 - bb.y * clampedZoom;
    this.viewport.set({ x, y, zoom: clampedZoom });
  }

  zoomIn(): void {
    this.viewport.update(vp => ({
      ...vp,
      zoom: Math.min(MAX_ZOOM, parseFloat((vp.zoom * 1.2).toFixed(3))),
    }));
  }

  zoomOut(): void {
    this.viewport.update(vp => ({
      ...vp,
      zoom: Math.max(MIN_ZOOM, parseFloat((vp.zoom / 1.2).toFixed(3))),
    }));
  }

  resetZoom(): void {
    this.viewport.update(vp => ({ ...vp, zoom: 1 }));
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const svgEl = this.svgRef()?.nativeElement;
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const vp = this.viewport();
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor));
    const newX = mouseX - (mouseX - vp.x) * (newZoom / vp.zoom);
    const newY = mouseY - (mouseY - vp.y) * (newZoom / vp.zoom);
    this.viewport.set({ x: newX, y: newY, zoom: newZoom });
  }

  // ── Canvas coordinate conversion ──────────────────────────────────────────

  private clientToCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const svgEl = this.svgRef()?.nativeElement;
    if (!svgEl) return { x: 0, y: 0 };
    const rect = svgEl.getBoundingClientRect();
    const vp = this.viewport();
    return {
      x: (clientX - rect.left - vp.x) / vp.zoom,
      y: (clientY - rect.top - vp.y) / vp.zoom,
    };
  }

  // ── Resize handle helpers ─────────────────────────────────────────────────

  resizeHandlePos(node: DiagramNode, h: ResizeHandle): { x: number; y: number } {
    const w = node.width, ht = node.height;
    switch (h) {
      case 'nw': return { x: 0,     y: 0 };
      case 'n':  return { x: w / 2, y: 0 };
      case 'ne': return { x: w,     y: 0 };
      case 'e':  return { x: w,     y: ht / 2 };
      case 'se': return { x: w,     y: ht };
      case 's':  return { x: w / 2, y: ht };
      case 'sw': return { x: 0,     y: ht };
      case 'w':  return { x: 0,     y: ht / 2 };
    }
  }

  onResizeHandleMouseDown(event: MouseEvent, nodeId: string, handle: ResizeHandle): void {
    event.stopPropagation();
    event.preventDefault();
    const node = this.nodes().find(n => n.id === nodeId);
    if (!node) return;
    this.snapshotHistory();
    this.resizeState = {
      nodeId, handle,
      startMouseX: event.clientX,
      startMouseY: event.clientY,
      startX: node.x, startY: node.y,
      startWidth: node.width, startHeight: node.height,
    };
  }

  // ── Edge connect helpers ──────────────────────────────────────────────────

  private nearestPort(node: DiagramNode, cx: number, cy: number): PortSide {
    let best: PortSide = 'top';
    let bestDist = Infinity;
    for (const p of ['top', 'right', 'bottom', 'left'] as PortSide[]) {
      const pp = portPosition(node, p);
      const d = Math.hypot(pp.x - cx, pp.y - cy);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    return best;
  }

  private completeEdge(toNodeId: string, toPort: PortSide): void {
    const de = this.drawingEdge();
    if (!de) return;
    this.snapshotHistory();
    const edge: DiagramEdge = {
      id: uuid(),
      from: de.fromNode,
      fromPort: de.fromPort,
      to: toNodeId,
      toPort,
      label: '',
      style: 'solid',
    };
    this.edges.update(es => [...es, edge]);
    this.triggerSave();
  }

  // ── Canvas cursor ─────────────────────────────────────────────────────────

  get canvasCursor(): string {
    if (this.panState) return 'grabbing';
    if (this.activeTool() === 'hand' || this.isSpaceHeld) return 'grab';
    if (this.resizeState) return 'default';
    if (this.dragState) return 'grabbing';
    if (this.drawingEdge()) return 'crosshair';
    if (this.pendingPlacementType()) return 'cell';
    return 'default';
  }

  // ── Palette drag-to-canvas ────────────────────────────────────────────────

  selectPlacementType(type: NodeType): void {
    if (this.pendingPlacementType() === type) {
      this.pendingPlacementType.set(null);
    } else {
      this.pendingPlacementType.set(type);
      this.activeTool.set('select');
    }
  }

  // ── Diagrams Sidebar resizing / collapsing ────────────────────────────────

  private readonly onDiagramsSidebarMouseMove = (e: MouseEvent) => {
    const delta = e.clientX - this.diagramsSidebarDragStartX;
    const newWidth = Math.min(400, Math.max(48, this.diagramsSidebarDragStartWidth + delta));
    this.diagramsSidebarWidth.set(newWidth);
  };

  private readonly onDiagramsSidebarMouseUp = () => {
    document.removeEventListener('mousemove', this.onDiagramsSidebarMouseMove);
    document.removeEventListener('mouseup', this.onDiagramsSidebarMouseUp);
    document.documentElement.classList.remove('is-resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  startDiagramsSidebarResize(e: MouseEvent): void {
    e.stopPropagation();
    e.preventDefault();
    this.diagramsSidebarDragStartX = e.clientX;
    this.diagramsSidebarDragStartWidth = this.diagramsSidebarWidth();
    document.documentElement.classList.add('is-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', this.onDiagramsSidebarMouseMove);
    document.addEventListener('mouseup', this.onDiagramsSidebarMouseUp);
  }

  toggleDiagramsSidebar(): void {
    if (this.diagramsSidebarCollapsed()) {
      this.diagramsSidebarWidth.set(Math.max(this.diagramsPrevWidth, 160));
    } else {
      this.diagramsPrevWidth = this.diagramsSidebarWidth();
      this.diagramsSidebarWidth.set(48);
    }
  }

  onCanvasDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  // ── Node operations ───────────────────────────────────────────────────────

  addNode(type: NodeType, x: number, y: number): void {
    if (!this.activeDiagramId()) return;
    this.snapshotHistory();
    const snapped = this.snapToGridEnabled()
      ? { x: snapToGrid(x), y: snapToGrid(y) }
      : { x, y };

    const isSquareShape = type === 'std-circle' || type === 'std-diamond' || type === 'std-triangle';
    const heightOverride = type === 'network-boundary' ? 180 : type === 'text-label' ? 36 : (isSquareShape ? 100 : DEFAULT_NODE_HEIGHT);
    const widthOverride = type === 'network-boundary' ? 240 : type === 'text-label' ? 160 : (isSquareShape ? 100 : DEFAULT_NODE_WIDTH);

    const node: DiagramNode = {
      id: uuid(),
      type,
      label: NODE_TYPE_LABELS[type],
      x: snapped.x,
      y: snapped.y,
      width: widthOverride,
      height: heightOverride,
      color: null,
      note: '',
    };
    this.nodes.update(ns => [...ns, node]);
    this.selectedNodeIds.set(new Set([node.id]));
    this.selectedEdgeIds.set(new Set());
    this.triggerSave();
  }

  deleteSelected(): void {
    const nodeIds = this.selectedNodeIds();
    const edgeIds = this.selectedEdgeIds();
    if (nodeIds.size === 0 && edgeIds.size === 0) return;
    this.snapshotHistory();
    this.nodes.update(ns => ns.filter(n => !nodeIds.has(n.id)));
    // Also remove edges that connect to deleted nodes
    this.edges.update(es =>
      es.filter(e => !edgeIds.has(e.id) && !nodeIds.has(e.from) && !nodeIds.has(e.to)),
    );
    this.selectedNodeIds.set(new Set());
    this.selectedEdgeIds.set(new Set());
    this.triggerSave();
  }

  duplicateSelected(): void {
    const nodeIds = this.selectedNodeIds();
    if (nodeIds.size === 0) return;
    this.snapshotHistory();
    const idMap = new Map<string, string>();
    const newNodes = this.nodes()
      .filter(n => nodeIds.has(n.id))
      .map(n => {
        const newId = uuid();
        idMap.set(n.id, newId);
        return { ...n, id: newId, x: n.x + 24, y: n.y + 24 };
      });
    this.nodes.update(ns => [...ns, ...newNodes]);
    this.selectedNodeIds.set(new Set(newNodes.map(n => n.id)));
    this.triggerSave();
  }

  selectAll(): void {
    this.selectedNodeIds.set(new Set(this.nodes().map(n => n.id)));
    this.selectedEdgeIds.set(new Set(this.edges().map(e => e.id)));
  }

  updateNodeLabel(id: string, label: string): void {
    this.nodes.update(ns => ns.map(n => n.id === id ? { ...n, label } : n));
    this.triggerSave();
  }

  updateNodeColor(id: string, color: string | null): void {
    this.snapshotHistory();
    this.nodes.update(ns => ns.map(n => n.id === id ? { ...n, color } : n));
    this.triggerSave();
  }

  updateNodeNote(id: string, note: string): void {
    this.nodes.update(ns => ns.map(n => n.id === id ? { ...n, note } : n));
    this.triggerSave();
  }

  updateNodeType(id: string, type: NodeType): void {
    this.snapshotHistory();
    this.nodes.update(ns => ns.map(n => n.id === id ? { ...n, type } : n));
    this.triggerSave();
  }

  updateEdgeStyle(id: string, style: EdgeStyle): void {
    this.snapshotHistory();
    this.edges.update(es => es.map(e => e.id === id ? { ...e, style } : e));
    this.triggerSave();
  }

  updateEdgeLabel(id: string, label: string): void {
    this.edges.update(es => es.map(e => e.id === id ? { ...e, label } : e));
    this.triggerSave();
  }

  updateDiagramName(name: string): void {
    if (!name.trim()) return;
    this.diagramName.set(name.trim());
    this.triggerSave();
  }

  // ── Node mouse interactions ───────────────────────────────────────────────

  onNodeMouseDown(event: MouseEvent, nodeId: string): void {
    // Hand tool, space held, right/middle click → let canvas receive event for panning
    if (this.activeTool() === 'hand' || this.isSpaceHeld || event.button === 2 || event.button === 1) return;

    if (event.button !== 0) return;

    // Complete in-progress edge by snapping to nearest port of this node
    const de = this.drawingEdge();
    if (de) {
      event.stopPropagation();
      if (de.fromNode !== nodeId) {
        const node = this.nodes().find(n => n.id === nodeId);
        if (node) {
          const hp = this.hoveredPort();
          const toPort = (hp?.nodeId === nodeId) ? hp.port : this.nearestPort(node, de.currentX, de.currentY);
          this.completeEdge(nodeId, toPort);
        }
      }
      this.drawingEdge.set(null);
      this.hoveredPort.set(null);
      return;
    }

    // Hand tool or space held → let canvas receive event for panning
    if (this.activeTool() === 'hand' || this.isSpaceHeld) return;

    event.stopPropagation();

    const node = this.nodes().find(n => n.id === nodeId);
    if (!node) return;

    if (event.shiftKey) {
      const next = new Set(this.selectedNodeIds());
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      this.selectedNodeIds.set(next);
    } else {
      if (!this.selectedNodeIds().has(nodeId)) {
        this.selectedNodeIds.set(new Set([nodeId]));
        this.selectedEdgeIds.set(new Set());
      }
    }

    this.dragState = {
      nodeId,
      startMouseX: event.clientX,
      startMouseY: event.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
    };
  }

  onNodeDoubleClick(event: MouseEvent, nodeId: string): void {
    if (this.activeTool() === 'hand') return;
    event.stopPropagation();
    this.editingLabelNodeId.set(nodeId);
  }

  // ── Port interactions ─────────────────────────────────────────────────────

  onPortMouseDown(event: MouseEvent, nodeId: string, port: PortSide): void {
    if (event.button === 2 || event.button === 1) return;

    event.stopPropagation();
    event.preventDefault();

    const de = this.drawingEdge();
    if (de) {
      // Already drawing — don't restart, let mouseup complete it
      return;
    }

    const { x, y } = this.clientToCanvas(event.clientX, event.clientY);
    this.drawingEdge.set({ fromNode: nodeId, fromPort: port, currentX: x, currentY: y });
  }

  onPortMouseUp(event: MouseEvent, toNodeId: string, toPort: PortSide): void {
    event.stopPropagation();
    const de = this.drawingEdge();
    if (!de) return;

    if (de.fromNode === toNodeId) {
      // Quick click on same port = start click-to-connect mode; keep drawing alive
      return;
    }

    this.completeEdge(toNodeId, toPort);
    this.drawingEdge.set(null);
    this.hoveredPort.set(null);
  }

  // ── Canvas mouse interactions ─────────────────────────────────────────────

  onCanvasMouseDown(event: MouseEvent): void {
    if (this.editingLabelNodeId()) {
      this.editingLabelNodeId.set(null);
      return;
    }
    this.contextMenu.set(null);

    // Cancel any in-progress edge draw
    if (this.drawingEdge()) {
      this.drawingEdge.set(null);
      this.hoveredPort.set(null);
      return;
    }

    const { x, y } = this.clientToCanvas(event.clientX, event.clientY);
    const isPanning = event.button === 2 || event.button === 1 || event.altKey || this.activeTool() === 'hand' || this.isSpaceHeld;

    if (isPanning) {
      event.preventDefault();
      event.stopPropagation();
      this.panState = {
        startMouseX: event.clientX,
        startMouseY: event.clientY,
        startVpX: this.viewport().x,
        startVpY: this.viewport().y,
      };
      return;
    }

    // Only left click can place/select/rubberband
    if (event.button !== 0) return;

    // Handle placement of node if we have a pending placement type
    const placeType = this.pendingPlacementType();
    if (placeType) {
      const w = placeType === 'network-boundary' ? 240 : placeType === 'text-label' ? 160 : DEFAULT_NODE_WIDTH;
      const h = placeType === 'network-boundary' ? 180 : placeType === 'text-label' ? 36 : DEFAULT_NODE_HEIGHT;
      this.addNode(placeType, x - w / 2, y - h / 2);
      this.pendingPlacementType.set(null);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this.selectedNodeIds.set(new Set());
    this.selectedEdgeIds.set(new Set());
    this.rubberBand.set({ startX: x, startY: y, currentX: x, currentY: y });
  }

  @HostListener('document:mousemove', ['$event'])
  onDocumentMouseMove(event: MouseEvent): void {
    // Resize node
    if (this.resizeState) {
      const rs = this.resizeState;
      const vp = this.viewport();
      const dx = (event.clientX - rs.startMouseX) / vp.zoom;
      const dy = (event.clientY - rs.startMouseY) / vp.zoom;
      const snap = this.snapToGridEnabled();
      const MIN_W = 40, MIN_H = 30;
      const h = rs.handle;

      let x = rs.startX, y = rs.startY, w = rs.startWidth, ht = rs.startHeight;
      if (h.includes('e')) w  = Math.max(MIN_W, rs.startWidth  + dx);
      if (h.includes('s')) ht = Math.max(MIN_H, rs.startHeight + dy);
      if (h.includes('w')) { const nw = Math.max(MIN_W, rs.startWidth  - dx); x = rs.startX + rs.startWidth  - nw; w  = nw; }
      if (h.includes('n')) { const nh = Math.max(MIN_H, rs.startHeight - dy); y = rs.startY + rs.startHeight - nh; ht = nh; }
      if (snap) {
        w = Math.max(MIN_W, snapToGrid(w)); ht = Math.max(MIN_H, snapToGrid(ht));
        if (h.includes('w')) x = snapToGrid(x);
        if (h.includes('n')) y = snapToGrid(y);
      }
      this.nodes.update(ns => ns.map(n => n.id === rs.nodeId ? { ...n, x, y, width: w, height: ht } : n));
      return;
    }

    // Drag node
    if (this.dragState) {
      const ds = this.dragState;
      const vp = this.viewport();
      const dx = (event.clientX - ds.startMouseX) / vp.zoom;
      const dy = (event.clientY - ds.startMouseY) / vp.zoom;
      const snap = this.snapToGridEnabled();
      const selectedIds = this.selectedNodeIds();

      this.nodes.update(ns => ns.map(n => {
        if (!selectedIds.has(n.id)) return n;
        const isMaster = n.id === ds.nodeId;
        const rawX = (isMaster ? ds.startNodeX : n.x) + dx;
        const rawY = (isMaster ? ds.startNodeY : n.y) + dy;
        return {
          ...n,
          x: snap ? snapToGrid(rawX) : rawX,
          y: snap ? snapToGrid(rawY) : rawY,
        };
      }));
      return;
    }

    // Pan
    if (this.panState) {
      const ps = this.panState;
      this.viewport.update(vp => ({
        ...vp,
        x: ps.startVpX + (event.clientX - ps.startMouseX),
        y: ps.startVpY + (event.clientY - ps.startMouseY),
      }));
      return;
    }

    // Drawing edge ghost + port snapping
    if (this.drawingEdge()) {
      const { x, y } = this.clientToCanvas(event.clientX, event.clientY);
      let snapX = x, snapY = y;
      let hovered: { nodeId: string; port: PortSide } | null = null;

      outer: for (const node of this.nodes()) {
        if (node.id === this.drawingEdge()!.fromNode) continue;
        for (const p of ['top', 'right', 'bottom', 'left'] as PortSide[]) {
          const pp = portPosition(node, p);
          if (Math.hypot(pp.x - x, pp.y - y) < PORT_SNAP_RADIUS) {
            snapX = pp.x; snapY = pp.y;
            hovered = { nodeId: node.id, port: p };
            break outer;
          }
        }
      }

      this.hoveredPort.set(hovered);
      this.drawingEdge.update(de => de ? { ...de, currentX: snapX, currentY: snapY } : null);
      return;
    }

    // Rubber-band
    if (this.rubberBand()) {
      const { x, y } = this.clientToCanvas(event.clientX, event.clientY);
      this.rubberBand.update(rb => rb ? { ...rb, currentX: x, currentY: y } : null);
      const rb = this.rubberBand();
      if (rb) {
        const minX = Math.min(rb.startX, rb.currentX);
        const minY = Math.min(rb.startY, rb.currentY);
        const maxX = Math.max(rb.startX, rb.currentX);
        const maxY = Math.max(rb.startY, rb.currentY);
        const selected = new Set<string>();
        for (const n of this.nodes()) {
          if (n.x < maxX && n.x + n.width > minX && n.y < maxY && n.y + n.height > minY) {
            selected.add(n.id);
          }
        }
        this.selectedNodeIds.set(selected);
      }
    }
  }

  @HostListener('document:mouseup', ['$event'])
  onDocumentMouseUp(event: MouseEvent): void {
    if (this.resizeState) {
      this.resizeState = null;
      this.triggerSave();
    }
    if (this.dragState) {
      this.snapshotHistory();
      this.dragState = null;
      this.triggerSave();
    }
    if (this.panState) {
      this.panState = null;
    }
    if (this.rubberBand()) {
      this.rubberBand.set(null);
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    if (event.key === ' ' && !isInput) {
      event.preventDefault();
      if (!this.isSpaceHeld) { this.isSpaceHeld = true; }
      return;
    }

    if (isInput) return;

    const ctrl = event.ctrlKey || event.metaKey;

    if (ctrl && event.key === 'z' && !event.shiftKey) { event.preventDefault(); this.undo(); return; }
    if (ctrl && (event.key === 'Z' || (event.key === 'z' && event.shiftKey))) { event.preventDefault(); this.redo(); return; }
    if (ctrl && event.key === 'a') { event.preventDefault(); this.selectAll(); return; }
    if (ctrl && event.key === 'd') { event.preventDefault(); this.duplicateSelected(); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { this.deleteSelected(); return; }
    if (event.key === 'h' || event.key === 'H') { this.activeTool.set('hand'); return; }
    if (event.key === 'v' || event.key === 'V') { this.activeTool.set('select'); return; }
    if (event.key === 'Escape') {
      if (this.pendingPlacementType()) { this.pendingPlacementType.set(null); return; }
      if (this.drawingEdge()) { this.drawingEdge.set(null); this.hoveredPort.set(null); return; }
      this.activeTool.set('select');
      this.clearSelection();
      this.editingLabelNodeId.set(null);
      return;
    }
  }

  @HostListener('document:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    if (event.key === ' ') {
      this.isSpaceHeld = false;
      if (this.panState) this.panState = null;
    }
  }

  onEdgeClick(event: MouseEvent, edgeId: string): void {
    event.stopPropagation();
    if (event.shiftKey) {
      const next = new Set(this.selectedEdgeIds());
      if (next.has(edgeId)) next.delete(edgeId);
      else next.add(edgeId);
      this.selectedEdgeIds.set(next);
    } else {
      this.selectedEdgeIds.set(new Set([edgeId]));
      this.selectedNodeIds.set(new Set());
    }
  }

  // ── Copy as SVG ───────────────────────────────────────────────────────────

  copyAsSvg(): void {
    const svgEl = this.svgRef()?.nativeElement;
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.removeAttribute('style');
    void navigator.clipboard.writeText(clone.outerHTML);
  }

  // ── Online toggle ─────────────────────────────────────────────────────────

  onOnlineToggleClick(): void {
    this.onlineModeTooltipVisible.set(true);
    setTimeout(() => this.onlineModeTooltipVisible.set(false), 2000);
  }

  // ── SVG helpers exposed to template ──────────────────────────────────────

  portPosition(node: DiagramNode, port: PortSide) {
    return portPosition(node, port);
  }

  edgePath(edge: DiagramEdge): string {
    const fromNode = this.nodes().find(n => n.id === edge.from);
    const toNode = this.nodes().find(n => n.id === edge.to);
    if (!fromNode || !toNode) return '';
    return buildEdgePath(portPosition(fromNode, edge.fromPort), portPosition(toNode, edge.toPort));
  }

  edgeMidpoint(edge: DiagramEdge): { x: number; y: number } {
    const fromNode = this.nodes().find(n => n.id === edge.from);
    const toNode = this.nodes().find(n => n.id === edge.to);
    if (!fromNode || !toNode) return { x: 0, y: 0 };
    const from = portPosition(fromNode, edge.fromPort);
    const to = portPosition(toNode, edge.toPort);
    return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  }

  ghostEdgePath(): string {
    const de = this.drawingEdge();
    if (!de) return '';
    const fromNode = this.nodes().find(n => n.id === de.fromNode);
    if (!fromNode) return '';
    const from = portPosition(fromNode, de.fromPort);
    return buildEdgePath(from, { x: de.currentX, y: de.currentY });
  }

  viewportTransform = computed(
    () => `translate(${this.viewport().x}, ${this.viewport().y}) scale(${this.viewport().zoom})`
  );

  nodeStrokeColor(node: DiagramNode): string {
    return this.selectedNodeIds().has(node.id)
      ? 'rgb(34 197 94)'   // green-500
      : 'rgb(214 211 208)'; // stone-300
  }

  edgeStrokeColor(edge: DiagramEdge): string {
    return this.selectedEdgeIds().has(edge.id)
      ? 'rgb(34 197 94)'
      : 'rgb(168 162 158)'; // stone-400
  }

  trackById(_: number, item: { id: string }): string {
    return item.id;
  }

  readonly allNodeTypes: NodeType[] = Object.keys(NODE_TYPE_LABELS) as NodeType[];
}
