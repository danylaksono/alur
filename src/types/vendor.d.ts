/**
 * gridmapper ships no typings. Only the surface ALUR uses is declared, so the
 * compiler still checks the call shape rather than waving the module through.
 */
declare module 'gridmapper' {
  export class GLPKSolver {
    constructor(glpk: unknown);
  }

  export type GridAssignment = {
    id: string;
    gridX: number;
    gridY: number;
    gridCols: number;
    gridRows: number;
  };

  export class GridMapper {
    allocate(
      data: unknown[],
      options: {
        xAccessor: (d: any) => number;
        yAccessor: (d: any) => number;
        compactness?: number;
        gridType?: 'rect' | 'hex' | 'ragged';
        rotateByPCA?: boolean;
        mip: () => unknown;
      },
    ): Promise<{ assignments: GridAssignment[]; meta: Record<string, unknown> }>;
  }
}

declare module 'glpk.js';

/**
 * glyphlens ships no typings at v0.1. Only the lens surface ALUR uses is
 * declared, so the call is still checked rather than waved through.
 */
declare module 'glyphlens/maplibre' {
  export type LensOverlay = {
    setCenter: (centre: [number, number]) => void;
    setRadius: (metres: number) => void;
    setMorph: (u: number) => void;
    update: (patch: Record<string, unknown>) => void;
    state: () => {
      center: [number, number];
      radius?: number;
      stats?: unknown;
      bins?: unknown;
    };
    destroy: () => void;
  };
  export function addLens(map: unknown, options: Record<string, unknown>): LensOverlay;
  export function addField(map: unknown, options: Record<string, unknown>): LensOverlay;
}
