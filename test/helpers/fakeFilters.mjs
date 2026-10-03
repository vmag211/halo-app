/**
 * Row filtering and ordering for the in-memory Supabase fake.
 *
 * Filters follow SQL three-valued logic, as PostgREST does: a comparison against
 * NULL is neither true nor false, and a WHERE clause keeps a row only when the
 * whole condition is exactly `true`. So `neq('x', 1)` does not match a row whose
 * x is NULL, and `not.eq` does not either. Every filter really filters; nothing
 * here is a no-op.
 *
 * A node is { type: 'cmp', column, op, value } | { type: 'not', node }
 *               | { type: 'and' | 'or', items }.
 */

const isNil = (value) => value === null || value === undefined;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** [row value, filter value] as comparable primitives, typed like the column. */
function comparable(rowValue, filterValue) {
  if (typeof rowValue === 'number') return [rowValue, Number(filterValue)];
  if (typeof rowValue === 'string' && typeof filterValue === 'string'
      && ISO_TIMESTAMP.test(rowValue) && ISO_TIMESTAMP.test(filterValue)) {
    const [a, b] = [Date.parse(rowValue), Date.parse(filterValue)];
    if (!Number.isNaN(a) && !Number.isNaN(b)) return [a, b];
  }
  const text = (value) => (typeof value === 'object' ? JSON.stringify(value) : String(value));
  return [text(rowValue), text(filterValue)];
}

function equal(rowValue, value) {
  const [a, b] = comparable(rowValue, value);
  return a === b;
}

function likeRegExp(pattern, flags) {
  // PostgREST also accepts `*` for `%`.
  const body = String(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/[%*]/g, '.*')
    .replace(/_/g, '.');
  return new RegExp(`^${body}$`, `s${flags}`);
}

/** true | false | null (SQL unknown) for one comparison. */
export function compareValue(op, rowValue, value) {
  if (op === 'is') {
    if (value === null) return isNil(rowValue);
    if (value === true || value === false) return rowValue === value;
    throw new Error(`fakeSupabase: .is() takes null, true or false, got ${String(value)}`);
  }
  if (isNil(rowValue)) return null;
  if (op === 'in') {
    if (!Array.isArray(value)) throw new Error('fakeSupabase: .in() takes an array');
    return value.some((candidate) => !isNil(candidate) && equal(rowValue, candidate));
  }
  if (isNil(value)) return null;
  if (op === 'like' || op === 'ilike') {
    return typeof rowValue === 'string' && likeRegExp(value, op === 'ilike' ? 'i' : '').test(rowValue);
  }
  if (op === 'eq') return equal(rowValue, value);
  if (op === 'neq') return !equal(rowValue, value);
  const [a, b] = comparable(rowValue, value);
  switch (op) {
    case 'gt': return a > b;
    case 'gte': return a >= b;
    case 'lt': return a < b;
    case 'lte': return a <= b;
    default: throw new Error(`fakeSupabase: unsupported filter operator "${op}"`);
  }
}

const negate = (truth) => (truth === null ? null : !truth);

export function evaluate(node, row) {
  switch (node.type) {
    case 'cmp': return compareValue(node.op, row[node.column], node.value);
    case 'not': return negate(evaluate(node.node, row));
    case 'and': {
      const truths = node.items.map((item) => evaluate(item, row));
      if (truths.includes(false)) return false;
      return truths.includes(null) ? null : true;
    }
    case 'or': {
      const truths = node.items.map((item) => evaluate(item, row));
      if (truths.includes(true)) return true;
      return truths.includes(null) ? null : false;
    }
    default: throw new Error(`fakeSupabase: unknown filter node "${node.type}"`);
  }
}

export const matches = (nodes, row) => nodes.every((node) => evaluate(node, row) === true);

/** Splits on commas outside parentheses and double quotes. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === '(') depth += 1;
    if (!quoted && char === ')') depth -= 1;
    if (!quoted && depth === 0 && char === ',') {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current !== '') parts.push(current);
  return parts;
}

function parseOperand(op, text) {
  if (op === 'is') {
    if (text === 'null') return null;
    if (text === 'true') return true;
    if (text === 'false') return false;
    throw new Error(`fakeSupabase: bad .or() operand for is: ${text}`);
  }
  if (op === 'in') {
    return splitTopLevel(text.replace(/^\(|\)$/g, '')).map((item) => item.trim().replace(/^"|"$/g, ''));
  }
  return text;
}

/** Parses a PostgREST `or(...)` body: `a.eq.1,b.is.null,and(c.gt.2,d.lt.5)`. */
export function parseLogicTree(text, type = 'or') {
  const items = splitTopLevel(text).map((part) => {
    const group = /^(and|or)\((.*)\)$/s.exec(part.trim());
    if (group) return parseLogicTree(group[2], group[1]);
    const [column, ...rest] = part.trim().split('.');
    const negated = rest[0] === 'not';
    if (negated) rest.shift();
    const op = rest.shift();
    const node = { type: 'cmp', column, op, value: parseOperand(op, rest.join('.')) };
    return negated ? { type: 'not', node } : node;
  });
  return { type, items };
}

function orderValues(a, b) {
  const [x, y] = comparable(a, b);
  if (x < y) return -1;
  return x > y ? 1 : 0;
}

/**
 * Stable sort of `items` by several { column, ascending, nullsFirst } keys.
 * Postgres puts NULLs last for ascending and first for descending unless told
 * otherwise. `rowOf` picks the row out of an item.
 */
export function sortRows(items, orders, rowOf = (item) => item) {
  if (!orders.length) return items;
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      for (const { column, ascending, nullsFirst } of orders) {
        const a = rowOf(left.item)[column];
        const b = rowOf(right.item)[column];
        const aNil = isNil(a);
        const bNil = isNil(b);
        if (aNil || bNil) {
          if (aNil && bNil) continue;
          const nilFirst = nullsFirst ?? !ascending;
          return (aNil ? -1 : 1) * (nilFirst ? 1 : -1);
        }
        const order = orderValues(a, b);
        if (order !== 0) return ascending ? order : -order;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}
