import type { DatasetField } from '../types/datasets';
import type { VisualFilter } from '../types/visualAnalytics';

const formatNumber = (value: number | undefined) =>
  value === undefined ? null : value.toLocaleString(undefined, { maximumFractionDigits: 2 });

const modePrefix = (filter: VisualFilter) => 'mode' in filter && filter.mode === 'exclude' ? 'Exclude ' : '';

export const visualFilterLabel = (filter: VisualFilter) => {
  const prefix = modePrefix(filter);
  if (filter.kind === 'category') {
    const values = filter.values.length ? filter.values.join(', ') : 'null';
    const nullSuffix = filter.includeNull && filter.values.length ? ' or null' : '';
    return `${prefix}${filter.field}: ${values}${nullSuffix}`;
  }
  if (filter.kind === 'temporal') {
    if (filter.start && filter.end) return `${prefix}${filter.field}: ${filter.start} to ${filter.end}`;
    if (filter.start) return `${prefix}${filter.field}: from ${filter.start}`;
    if (filter.end) return `${prefix}${filter.field}: until ${filter.end}`;
    return `${prefix}${filter.field}: null dates`;
  }
  if (filter.kind === 'range') {
    const min = formatNumber(filter.min);
    const max = formatNumber(filter.max);
    if (min && max) return `${prefix}${filter.field}: ${min} to ${max}`;
    if (min) return `${prefix}${filter.field}: >= ${min}`;
    if (max) return `${prefix}${filter.field}: <= ${max}`;
    return `${prefix}${filter.field}: null values`;
  }
  if (filter.kind === 'text') {
    const operator = filter.operator.replaceAll('_', ' ');
    return `${prefix}${filter.field} ${operator}: ${filter.value}`;
  }
  if (filter.kind === 'boolean') {
    return `${prefix}${filter.field}: ${filter.value ? 'true' : 'false'}`;
  }
  return `${filter.field}: ${filter.isNull ? 'is null' : 'is not null'}`;
};

export const visualFilterKey = (filter: VisualFilter) => {
  const mode = 'mode' in filter ? filter.mode || 'include' : 'include';
  if (filter.kind === 'category') return `${filter.field}:category:${filter.values.join('|')}:${filter.includeNull ? 'null' : ''}:${mode}`;
  if (filter.kind === 'temporal') return `${filter.field}:temporal:${filter.start ?? ''}:${filter.end ?? ''}:${filter.includeNull ? 'null' : ''}:${mode}`;
  if (filter.kind === 'range') return `${filter.field}:range:${filter.min ?? ''}:${filter.max ?? ''}:${filter.includeNull ? 'null' : ''}:${mode}`;
  if (filter.kind === 'text') return `${filter.field}:text:${filter.operator}:${filter.value}:${filter.caseSensitive ? 'case' : 'nocase'}:${mode}`;
  if (filter.kind === 'boolean') return `${filter.field}:boolean:${filter.value}:${mode}`;
  return `${filter.field}:null:${filter.isNull}`;
};

export const isVisualFilterValid = (filter: VisualFilter) => {
  if (!filter.field.trim()) return false;
  if (filter.kind === 'category') return filter.values.length > 0 || Boolean(filter.includeNull);
  if (filter.kind === 'range') {
    const validMin = filter.min === undefined || Number.isFinite(filter.min);
    const validMax = filter.max === undefined || Number.isFinite(filter.max);
    return validMin && validMax && (filter.min !== undefined || filter.max !== undefined || Boolean(filter.includeNull));
  }
  if (filter.kind === 'temporal') return Boolean(filter.start || filter.end || filter.includeNull);
  if (filter.kind === 'text') return Boolean(filter.value.trim());
  return true;
};

export const defaultFilterForField = (field: DatasetField): VisualFilter => {
  if (field.semanticType === 'numeric') return { kind: 'range', field: field.name };
  if (field.semanticType === 'temporal') return { kind: 'temporal', field: field.name };
  if (field.semanticType === 'boolean') return { kind: 'boolean', field: field.name, value: true };
  return { kind: 'category', field: field.name, values: [] };
};

