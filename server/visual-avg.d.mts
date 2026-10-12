export interface AvgGraphic {
  type: 'AVG';
  version: '1.2';
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  description: string;
  parameters: Record<string, unknown>[];
  items: Record<string, unknown>[];
}
export interface AplDocument {
  type: 'APL';
  version: '2024.3';
  theme: 'dark';
  graphics: {answer: AvgGraphic};
  mainTemplate: {items: Record<string, unknown>[]};
}
export interface AplVisual {
  avg: AvgGraphic;
  commands: Record<string, unknown>[];
  document: AplDocument;
}
export function visualToApl(input: unknown, options?: {reducedMotion?: boolean}): AplVisual;
