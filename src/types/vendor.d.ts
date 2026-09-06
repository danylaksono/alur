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
