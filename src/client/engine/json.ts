/** JSON is the live wire boundary: structured-clone-only values are not valid state. */
export function isJsonValue(value: unknown, byteLimit = 47 * 1024): boolean {
  let nodes = 0;
  const active = new Set<object>();
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > 24000 || depth > 32) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean')
      return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (typeof item !== 'object' || active.has(item)) return false;
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      return false;
    active.add(item);
    const valid = Array.isArray(item)
      ? item.length <= 24000 &&
        Array.from(
          { length: item.length },
          (_, i) => Object.hasOwn(item, i) && visit(item[i], depth + 1),
        ).every(Boolean)
      : Reflect.ownKeys(item).every(
          (key) =>
            typeof key === 'string' &&
            visit((item as Record<string, unknown>)[key], depth + 1),
        );
    active.delete(item);
    return valid;
  };
  try {
    return (
      visit(value, 0) &&
      new TextEncoder().encode(JSON.stringify(value)).byteLength <= byteLimit
    );
  } catch {
    return false;
  }
}
