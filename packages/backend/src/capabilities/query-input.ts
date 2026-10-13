import type { CatalogTool } from '@oxy.so/contracts';

type Json = Record<string, unknown>;

function typesOf(property: unknown): readonly string[] {
  if (typeof property !== 'object' || property === null) return [];
  const type = (property as { type?: unknown }).type;
  if (typeof type === 'string') return [type];
  return Array.isArray(type) ? type.filter((t): t is string => typeof t === 'string') : [];
}

/**
 * A GET capability's input, decoded the way its schema declares it.
 *
 * A query string carries only text, so a caller can send `limit=20` or
 * `pinned=true` and nothing else; the schema, parsed strictly, would refuse every
 * one of them as `capability_input_schema_mismatch`. A value is converted only
 * when the property is declared numeric or boolean AND the text is exactly that
 * value — anything else is passed through untouched for the schema to reject.
 */
export function queryInputFor(tool: CatalogTool, query: Json): Json {
  const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties;
  if (!properties) return query;
  const decoded: Json = { ...query };
  for (const [key, value] of Object.entries(query)) {
    if (typeof value !== 'string') continue;
    const types = typesOf(properties[key]);
    if (types.includes('string')) continue;
    if (types.includes('boolean') && (value === 'true' || value === 'false')) {
      decoded[key] = value === 'true';
    } else if (
      (types.includes('integer') || types.includes('number')) &&
      value.trim() !== '' &&
      Number.isFinite(Number(value))
    ) {
      decoded[key] = Number(value);
    }
  }
  return decoded;
}
