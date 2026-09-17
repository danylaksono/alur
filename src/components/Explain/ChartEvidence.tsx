import { BarChart3 } from 'lucide-react';
import type { ExplainCard } from '../../types/visualAnalytics';
import { isChartEvidenceCapture } from '../../services/chartExportService';
import { visualFilterLabel } from '../../utils/visualFilters';
import { ChartMarks } from '../Charts/ChartPanel';

/** A pinned chart, drawn from its captured values in the report and in a shared story alike. */
export const ChartEvidence = ({ card }: { card: ExplainCard }) => {
  const capture = isChartEvidenceCapture(card.frozenValues) ? card.frozenValues : null;
  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
        <BarChart3 className="h-4 w-4 shrink-0 text-blue-600" />
        <span className="truncate">{card.title || capture?.chart.title || 'Chart'}</span>
      </h3>
      {capture ? (
        <>
          {capture.filters.length > 0 && (
            <p className="mt-1 truncate text-[11px] text-slate-500" title={capture.filters.map(visualFilterLabel).join('; ')}>
              Filtered: {capture.filters.map(visualFilterLabel).join('; ')}
            </p>
          )}
          <div className="mt-3">
            <ChartMarks chart={capture.chart} data={capture.data} filters={capture.filters} />
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-slate-500">No plotted values were captured for this chart. Pin it again from the Charts panel.</p>
      )}
    </div>
  );
};
