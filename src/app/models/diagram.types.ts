export type NodeType =
  | 'server'
  | 'database'
  | 'load-balancer'
  | 'api-gateway'
  | 'microservice'
  | 'queue'
  | 'browser'
  | 'cloud'
  | 'storage-bucket'
  | 'lambda'
  | 'cache'
  | 'network-boundary'
  | 'user'
  | 'external-system'
  | 'generic-box'
  | 'text-label'
  | 'std-rect'
  | 'std-circle'
  | 'std-diamond'
  | 'std-triangle';

export type EdgeStyle = 'solid' | 'dashed';
export type PortSide = 'top' | 'right' | 'bottom' | 'left';

export interface DiagramNode {
  id: string;
  type: NodeType;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string | null;
  note: string;
}

export interface DiagramEdge {
  id: string;
  from: string;
  fromPort: PortSide;
  to: string;
  toPort: PortSide;
  label: string;
  style: EdgeStyle;
}

export interface DiagramViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface DiagramFile {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  viewport: DiagramViewport;
}

export interface DiagramSummary {
  id: string;
  name: string;
  updatedAt: string;
}
