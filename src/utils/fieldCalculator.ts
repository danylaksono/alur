export type ComputedField = {
  id: string;
  name: string;
  expression: string;
};

type LiteralNode = { type: 'literal'; value: string | number | boolean | null };
type FieldNode = { type: 'field'; path: string[] };
type UnaryNode = { type: 'unary'; op: '-' | 'not'; operand: ExpressionNode };
type BinaryNode = {
  type: 'binary' | 'logical';
  op: string;
  left: ExpressionNode;
  right: ExpressionNode;
};
type CallNode = { type: 'call'; name: CalculatorFunctionName; args: ExpressionNode[] };
export type ExpressionNode = LiteralNode | FieldNode | UnaryNode | BinaryNode | CallNode;

type Token = {
  type: 'number' | 'string' | 'identifier' | 'op' | 'eof';
  value: string | number | null;
  position: number;
};

type CalculatorFunctionName = keyof typeof FUNCTION_SPECS;

const FUNCTION_SPECS = {
  min: { signature: 'min(a, b, ...)', min: 1, max: Infinity },
  max: { signature: 'max(a, b, ...)', min: 1, max: Infinity },
  abs: { signature: 'abs(x)', min: 1, max: 1 },
  round: { signature: 'round(x, digits?)', min: 1, max: 2 },
  floor: { signature: 'floor(x)', min: 1, max: 1 },
  ceil: { signature: 'ceil(x)', min: 1, max: 1 },
  sqrt: { signature: 'sqrt(x)', min: 1, max: 1 },
  pow: { signature: 'pow(x, y)', min: 2, max: 2 },
  coalesce: { signature: 'coalesce(a, b, ...)', min: 1, max: Infinity },
  if: { signature: 'if(condition, then, else)', min: 3, max: 3 },
  concat: { signature: 'concat(a, b, ...)', min: 1, max: Infinity },
  lower: { signature: 'lower(x)', min: 1, max: 1 },
  upper: { signature: 'upper(x)', min: 1, max: 1 },
} as const;

export const FIELD_CALCULATOR_FUNCTIONS = Object.entries(FUNCTION_SPECS).map(([name, spec]) => ({
  name,
  signature: spec.signature,
}));

export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false', 'null']);
const RESERVED_NAMES = new Set([...KEYWORDS, ...Object.keys(FUNCTION_SPECS)]);
const TWO_CHARACTER_OPERATORS = new Set(['==', '!=', '<=', '>=', '&&', '||']);
const ONE_CHARACTER_OPERATORS = new Set(['+', '-', '*', '/', '%', '<', '>', '(', ')', ',', '.', '!']);
const PRECEDENCE: Record<string, number> = {
  or: 1,
  '||': 1,
  and: 2,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

const tokenize = (text: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (/[0-9]/.test(character) || (character === '.' && /[0-9]/.test(text[index + 1] || ''))) {
      const match = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(text.slice(index));
      if (!match) throw new Error(`Invalid number at position ${index}`);
      tokens.push({ type: 'number', value: Number(match[0]), position: index });
      index += match[0].length;
      continue;
    }
    if (character === "'" || character === '"') {
      let value = '';
      let cursor = index + 1;
      let closed = false;
      while (cursor < text.length) {
        if (text[cursor] === '\\' && cursor + 1 < text.length) {
          value += text[cursor + 1];
          cursor += 2;
        } else if (text[cursor] === character) {
          closed = true;
          cursor += 1;
          break;
        } else {
          value += text[cursor];
          cursor += 1;
        }
      }
      if (!closed) throw new Error(`Unterminated string at position ${index}`);
      tokens.push({ type: 'string', value, position: index });
      index = cursor;
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(index));
      if (!match) throw new Error(`Invalid identifier at position ${index}`);
      tokens.push({ type: 'identifier', value: match[0], position: index });
      index += match[0].length;
      continue;
    }
    const pair = text.slice(index, index + 2);
    if (TWO_CHARACTER_OPERATORS.has(pair)) {
      tokens.push({ type: 'op', value: pair, position: index });
      index += 2;
      continue;
    }
    if (ONE_CHARACTER_OPERATORS.has(character)) {
      tokens.push({ type: 'op', value: character, position: index });
      index += 1;
      continue;
    }
    if (character === '=') throw new Error(`Use "==" for comparison at position ${index}`);
    throw new Error(`Unexpected character "${character}" at position ${index}`);
  }
  tokens.push({ type: 'eof', value: null, position: text.length });
  return tokens;
};

const parseTokens = (tokens: Token[]) => {
  let index = 0;
  const referencedFields = new Set<string>();
  const peek = () => tokens[index];
  const consume = () => tokens[index++];
  const expectOperator = (operator: string) => {
    const token = consume();
    if (token.type !== 'op' || token.value !== operator) {
      throw new Error(`Expected "${operator}" at position ${token.position}`);
    }
  };

  const binaryOperator = () => {
    const token = peek();
    if (token.type === 'op' && typeof token.value === 'string' && PRECEDENCE[token.value] !== undefined) return token.value;
    if (token.type === 'identifier' && typeof token.value === 'string') {
      const keyword = token.value.toLowerCase();
      if (keyword === 'and' || keyword === 'or') return keyword;
    }
    return null;
  };

  const parseExpressionAt = (minimumPrecedence: number): ExpressionNode => {
    let left = parseUnary();
    for (;;) {
      const operator = binaryOperator();
      if (!operator || PRECEDENCE[operator] < minimumPrecedence) break;
      consume();
      const normalized = operator === '&&' ? 'and' : operator === '||' ? 'or' : operator;
      const right = parseExpressionAt(PRECEDENCE[operator] + 1);
      left = {
        type: normalized === 'and' || normalized === 'or' ? 'logical' : 'binary',
        op: normalized,
        left,
        right,
      };
    }
    return left;
  };

  const parseUnary = (): ExpressionNode => {
    const token = peek();
    if (token.type === 'op' && (token.value === '-' || token.value === '!')) {
      consume();
      return { type: 'unary', op: token.value === '!' ? 'not' : '-', operand: parseUnary() };
    }
    if (token.type === 'identifier' && String(token.value).toLowerCase() === 'not') {
      consume();
      return { type: 'unary', op: 'not', operand: parseUnary() };
    }
    return parsePrimary();
  };

  const parsePrimary = (): ExpressionNode => {
    const token = consume();
    if (token.type === 'number' || token.type === 'string') return { type: 'literal', value: token.value as string | number };
    if (token.type === 'op' && token.value === '(') {
      const result = parseExpressionAt(0);
      expectOperator(')');
      return result;
    }
    if (token.type === 'identifier') {
      const value = String(token.value);
      const lower = value.toLowerCase();
      if (lower === 'true' || lower === 'false') return { type: 'literal', value: lower === 'true' };
      if (lower === 'null') return { type: 'literal', value: null };
      if (KEYWORDS.has(lower)) throw new Error(`Unexpected keyword "${value}"`);

      if (peek().type === 'op' && peek().value === '(') {
        consume();
        if (!(lower in FUNCTION_SPECS)) throw new Error(`Unknown function "${value}"`);
        const name = lower as CalculatorFunctionName;
        const args: ExpressionNode[] = [];
        if (!(peek().type === 'op' && peek().value === ')')) {
          args.push(parseExpressionAt(0));
          while (peek().type === 'op' && peek().value === ',') {
            consume();
            args.push(parseExpressionAt(0));
          }
        }
        expectOperator(')');
        const spec = FUNCTION_SPECS[name];
        if (args.length < spec.min || args.length > spec.max) throw new Error(`Invalid argument count for "${name}"`);
        return { type: 'call', name, args };
      }

      const path = [value];
      while (peek().type === 'op' && peek().value === '.') {
        consume();
        const part = consume();
        if (part.type !== 'identifier') throw new Error('Expected a field name after "."');
        path.push(String(part.value));
      }
      referencedFields.add(path[0]);
      return { type: 'field', path };
    }
    if (token.type === 'eof') throw new Error('Unexpected end of expression');
    throw new Error(`Unexpected token "${String(token.value)}"`);
  };

  const ast = parseExpressionAt(0);
  if (peek().type !== 'eof') throw new Error(`Unexpected token "${String(peek().value)}"`);
  return { ast, referencedFields: [...referencedFields] };
};

export const parseExpression = (text: string): { ast: ExpressionNode | null; referencedFields: string[]; error: string | null } => {
  try {
    const parsed = parseTokens(tokenize(text));
    return { ...parsed, error: null };
  } catch (error) {
    return { ast: null, referencedFields: [], error: error instanceof Error ? error.message : 'Invalid expression' };
  }
};

const numberOrNull = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && value.trim()) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
};

const truthy = (value: unknown) => ![null, undefined, false, 0, ''].includes(value as never);
const numericResult = (value: number) => Number.isFinite(value) ? value : null;

const callFunction = (name: CalculatorFunctionName, args: unknown[]) => {
  const numbers = () => args.map(numberOrNull).filter((value): value is number => value !== null);
  if (name === 'min') return numbers().length ? Math.min(...numbers()) : null;
  if (name === 'max') return numbers().length ? Math.max(...numbers()) : null;
  if (name === 'coalesce') return args.find((value) => value !== null && value !== undefined) ?? null;
  if (name === 'if') return truthy(args[0]) ? args[1] : args[2];
  if (name === 'concat') return args.filter((value) => value !== null && value !== undefined).map(String).join('');
  if (name === 'lower' || name === 'upper') {
    if (args[0] == null) return null;
    return name === 'lower' ? String(args[0]).toLowerCase() : String(args[0]).toUpperCase();
  }
  const first = numberOrNull(args[0]);
  if (first === null) return null;
  if (name === 'abs') return Math.abs(first);
  if (name === 'floor') return Math.floor(first);
  if (name === 'ceil') return Math.ceil(first);
  if (name === 'sqrt') return numericResult(Math.sqrt(first));
  if (name === 'round') {
    const digits = args[1] === undefined ? 0 : numberOrNull(args[1]);
    if (digits === null) return null;
    const factor = 10 ** Math.trunc(digits);
    return numericResult(Math.round(first * factor) / factor);
  }
  const second = numberOrNull(args[1]);
  return second === null ? null : numericResult(first ** second);
};

export const evaluateExpression = (node: ExpressionNode | null, row: Record<string, unknown>): unknown => {
  if (!node) return null;
  if (node.type === 'literal') return node.value;
  if (node.type === 'field') {
    let value: unknown = row;
    for (const part of node.path) {
      if (!value || typeof value !== 'object') return null;
      value = (value as Record<string, unknown>)[part];
    }
    return value ?? null;
  }
  if (node.type === 'unary') {
    const value = evaluateExpression(node.operand, row);
    if (node.op === 'not') return !truthy(value);
    const number = numberOrNull(value);
    return number === null ? null : -number;
  }
  if (node.type === 'logical') {
    const left = truthy(evaluateExpression(node.left, row));
    return node.op === 'and'
      ? left && truthy(evaluateExpression(node.right, row))
      : left || truthy(evaluateExpression(node.right, row));
  }
  if (node.type === 'call') return callFunction(node.name, node.args.map((arg) => evaluateExpression(arg, row)));

  const left = evaluateExpression(node.left, row);
  const right = evaluateExpression(node.right, row);
  if (node.op === '==' || node.op === '!=') {
    const leftNumber = numberOrNull(left);
    const rightNumber = numberOrNull(right);
    const equal = left == null || right == null
      ? left == null && right == null
      : leftNumber !== null && rightNumber !== null
        ? leftNumber === rightNumber
        : String(left) === String(right);
    return node.op === '==' ? equal : !equal;
  }
  if (['<', '<=', '>', '>='].includes(node.op)) {
    if (left == null || right == null) return null;
    const pair = typeof left === 'string' && typeof right === 'string'
      ? [left, right]
      : [numberOrNull(left), numberOrNull(right)];
    if (pair[0] === null || pair[1] === null) return null;
    if (node.op === '<') return pair[0] < pair[1];
    if (node.op === '<=') return pair[0] <= pair[1];
    if (node.op === '>') return pair[0] > pair[1];
    return pair[0] >= pair[1];
  }
  if (node.op === '+' && typeof left === 'string' && typeof right === 'string') return left + right;
  const first = numberOrNull(left);
  const second = numberOrNull(right);
  if (first === null || second === null) return null;
  if (node.op === '+') return first + second;
  if (node.op === '-') return first - second;
  if (node.op === '*') return first * second;
  if (node.op === '/') return second === 0 ? null : numericResult(first / second);
  return second === 0 ? null : numericResult(first % second);
};

const materializeValue = (value: unknown) => {
  if (value === true) return 1;
  if (value === false) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value;
  return null;
};

export const applyComputedFields = (rows: Record<string, unknown>[], fields: ComputedField[]) => {
  if (!rows.length || !fields.length) return rows;
  const parsed = fields.map((field) => ({ ...field, ...parseExpression(field.expression) }));
  return rows.map((row) => {
    const next = { ...row };
    parsed.forEach((field) => {
      next[field.name] = field.error ? null : materializeValue(evaluateExpression(field.ast, next));
    });
    return next;
  });
};

export const validateComputedField = (
  field: Pick<ComputedField, 'name' | 'expression'> & { id?: string },
  existingColumns: string[],
  otherFields: ComputedField[],
) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = field.name.trim();
  if (!name) errors.push('Field name is required.');
  else if (!IDENTIFIER_RE.test(name)) errors.push('Use letters, numbers, and underscores; start with a letter or underscore.');
  else if (RESERVED_NAMES.has(name.toLowerCase())) errors.push(`"${name}" is reserved.`);
  else if (existingColumns.some((column) => column.toLowerCase() === name.toLowerCase())) errors.push(`"${name}" already exists.`);
  else if (otherFields.some((item) => item.id !== field.id && item.name.toLowerCase() === name.toLowerCase())) errors.push(`"${name}" already exists.`);

  const parsed = parseExpression(field.expression.trim());
  if (!field.expression.trim()) errors.push('Expression is required.');
  else if (parsed.error) errors.push(parsed.error);
  else {
    const names = new Set([...existingColumns, ...otherFields.map((item) => item.name)]);
    parsed.referencedFields.filter((reference) => !names.has(reference)).forEach((reference) => {
      warnings.push(`Unknown field "${reference}" will evaluate to null.`);
    });
  }
  return { ok: errors.length === 0, errors, warnings };
};

export const profileComputedColumn = (column: string, rows: Record<string, unknown>[]) => {
  const values = rows.map((row) => row[column]).filter((value) => value !== null && value !== undefined);
  const numeric = values.map(numberOrNull).filter((value): value is number => value !== null);
  if (numeric.length && numeric.length >= values.length * 0.8) {
    const min = Math.min(...numeric);
    const max = Math.max(...numeric);
    const count = 10;
    const width = max === min ? 1 : (max - min) / count;
    const bins = Array.from({ length: count }, (_, index) => ({
      label: `${(min + width * index).toPrecision(3)}–${(min + width * (index + 1)).toPrecision(3)}`,
      min: min + width * index,
      max: min + width * (index + 1),
      count: 0,
    }));
    numeric.forEach((value) => {
      const index = max === min ? 0 : Math.min(count - 1, Math.floor((value - min) / width));
      bins[index].count += 1;
    });
    return { column, kind: 'numeric' as const, total: rows.length, nullCount: rows.length - values.length, min, max, bins };
  }
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(String(value), (counts.get(String(value)) || 0) + 1));
  return {
    column,
    kind: 'categorical' as const,
    total: rows.length,
    nullCount: rows.length - values.length,
    bins: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([value, countValue]) => ({ label: value, value, count: countValue })),
  };
};
