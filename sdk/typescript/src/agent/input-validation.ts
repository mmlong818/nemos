type JsonSchema = Record<string, unknown>;

export function validateToolInput(
  schema: JsonSchema,
  input: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  validateValue(schema, input, "$", errors);
  return errors;
}

function validateValue(
  schema: JsonSchema,
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${path} must be one of: ${schema.enum.map(String).join(", ")}`);
    return;
  }

  const type = typeof schema.type === "string" ? schema.type : undefined;
  if (type && !matchesType(type, value)) {
    errors.push(`${path} must be ${type}`);
    return;
  }
  if (type === "object" && isRecord(value)) validateObject(schema, value, path, errors);
  if (type === "array" && Array.isArray(value)) validateArray(schema, value, path, errors);
}

function validateObject(
  schema: JsonSchema,
  value: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : [];
  for (const key of required) {
    if (!(key in value)) errors.push(`${path}.${key} is required`);
  }
  for (const [key, child] of Object.entries(value)) {
    const childSchema = properties[key];
    if (isRecord(childSchema)) validateValue(childSchema, child, `${path}.${key}`, errors);
    else if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
  }
}

function validateArray(
  schema: JsonSchema,
  value: unknown[],
  path: string,
  errors: string[],
): void {
  const itemSchema = isRecord(schema.items) ? schema.items : undefined;
  if (itemSchema) {
    value.forEach((item, index) => validateValue(itemSchema, item, `${path}[${index}]`, errors));
  }
}

function matchesType(type: string, value: unknown): boolean {
  if (type === "object") return isRecord(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
