import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useStore } from '../../store/useStore';
import type { AnalysisVariant, VariantOperation } from '../../types/visualAnalytics';
import { cn } from '../../utils/cn';

/** Sentinel for the "start a fresh scenario" row, which is not a scenario id. */
const NEW = '__new__';

/**
 * A dataset's name without its file extension.
 *
 * Datasets are named after the file they came from, which is right for a layer
 * list and wrong for a scenario: "need_london.parquet prioritisation" reads as a
 * filename someone forgot to tidy, not as a position an analyst is arguing for.
 */
export const scenarioBaseName = (datasetName: string) =>
  datasetName.replace(/\.(parquet|csv|json|geojson|gpkg|arrow)$/i, '');

export type AddToScenarioProps = {
  /** Nothing to add yet — an empty score model, an unselected cohort. */
  disabled?: boolean;
  /** The dataset a newly created scenario is a scenario *of*. */
  baselineDatasetId: string;
  /** Name for a scenario created from this bench. */
  defaultName: string;
  /** What the analyst is asserting, built fresh on each add. */
  buildOperation: () => VariantOperation;
  /**
   * Put the work on the canvas and return the node that carries it.
   *
   * The bench owns this because only it knows what node shape its output takes —
   * a score model becomes a score node, a cohort becomes a filter. The scenario
   * id is handed in so the node can be scoped to it.
   */
  emitNode: (variantId: string) => string | null;
  /** Overrides the default line under the control. */
  hint?: string;
  className?: string;
};

/**
 * The footer every analysis bench ends with.
 *
 * Before this, each bench fired a node into the workflow and forgot: nothing
 * linked the weights you had just set to anything you could name, branch or
 * compare. The scenario panel worked around that by growing its own, worse copy
 * of the score builder, because a scenario had no other way to acquire content.
 *
 * So the direction is inverted here. A bench composes and previews; a scenario
 * receives. `AlgorithmDialog` has worked this way since it was written — this
 * brings Score and Cohorts onto the same footing.
 */
export const AddToScenario = ({
  disabled = false,
  baselineDatasetId,
  defaultName,
  buildOperation,
  emitNode,
  hint = 'Applies to the scenario, not the project.',
  className,
}: AddToScenarioProps) => {
  const allVariants = useStore((state) => state.visualAnalytics.variants);
  const activeSessionId = useStore((state) => state.visualAnalytics.activeSessionId);
  const activeVariantId = useStore((state) => state.visualAnalytics.activeVariantId);
  const createSession = useStore((state) => state.createSession);
  const addVariant = useStore((state) => state.addVariant);
  const updateVariant = useStore((state) => state.updateVariant);
  const setActiveVariant = useStore((state) => state.setActiveVariant);
  const addToast = useStore((state) => state.addToast);

  const scoped = activeSessionId
    ? allVariants.filter((variant) => variant.sessionId === activeSessionId)
    : allVariants;

  // Follow the scenario bar unless the analyst picks otherwise, so "add" lands
  // where they are already standing rather than somewhere they have to check.
  const [chosen, setChosen] = useState<string>('');
  const target = chosen || activeVariantId || scoped[0]?.id || NEW;

  const add = () => {
    if (disabled) return;
    const now = Date.now();
    const operation = buildOperation();

    // A scenario always belongs to a question. Opening one implicitly beats
    // refusing to work until the analyst has named something.
    if (!activeSessionId) {
      createSession({
        id: `session-${now}`,
        name: defaultName,
        question: '',
        baselineDatasetId,
      });
    }

    let variantId = target;
    let created = false;

    if (target === NEW) {
      variantId = `variant-${now}`;
      created = true;
      const variant: AnalysisVariant = {
        id: variantId,
        name: defaultName,
        baselineDatasetId,
        parameters: {},
        assumptions: operation.assumptions ?? [],
        operations: [operation],
        createdAt: now,
        // No output id yet: the run decides whether the result lands as a layer
        // or a table, and `registerWorkflowNodeOutput` fills it in afterwards.
        provenance: { workflowNodeIds: [] },
      };
      addVariant(variant);
    }

    const nodeId = emitNode(variantId);

    if (!created) {
      const existing = allVariants.find((variant) => variant.id === variantId);
      if (!existing) return;
      updateVariant(variantId, {
        operations: [...existing.operations, operation],
        assumptions: [
          ...existing.assumptions,
          ...(operation.assumptions ?? []).filter((text) => !existing.assumptions.includes(text)),
        ],
      });
    }

    if (nodeId) {
      const current = useStore.getState().visualAnalytics.variants.find((item) => item.id === variantId);
      if (current) {
        updateVariant(variantId, {
          provenance: {
            ...current.provenance,
            workflowNodeIds: [...current.provenance.workflowNodeIds, nodeId],
          },
        });
      }
    }

    setActiveVariant(variantId);
    const name = created ? defaultName : scoped.find((item) => item.id === variantId)?.name || defaultName;
    addToast({
      type: 'success',
      message: created
        ? `Started scenario “${name}”. Run the workflow to produce its result.`
        : `Added to “${name}”. Run the workflow to produce its result.`,
    });
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex gap-1.5">
        <select
          value={target}
          onChange={(event) => setChosen(event.target.value)}
          disabled={disabled}
          aria-label="Scenario to add to"
          className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700 disabled:opacity-50"
        >
          {scoped.map((variant) => (
            <option key={variant.id} value={variant.id}>{variant.name}</option>
          ))}
          <option value={NEW}>New scenario…</option>
        </select>
        <button
          type="button"
          onClick={add}
          disabled={disabled}
          className="pressable flex shrink-0 items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Plus className="h-2.5 w-2.5" /> Add
        </button>
      </div>
      <p className="text-[11px] leading-4 text-slate-500">{hint}</p>
    </div>
  );
};
