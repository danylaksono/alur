import type { VisualFilter } from './visualAnalytics';
import type { ComputedField } from '../utils/fieldCalculator';

export type TableLayout = {
  columnOrder: string[];
  hiddenColumns: string[];
  pinnedColumns: string[];
  columnWidths: Record<string, number>;
  showHistograms: boolean;
};

export type SavedTableView = {
  id: string;
  name: string;
  layout: TableLayout;
  filters: VisualFilter[];
  computedFields: ComputedField[];
  createdAt: number;
};

export type AppliedTableLayout = TableLayout & { revision: number };
