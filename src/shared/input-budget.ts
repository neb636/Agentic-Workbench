/** Bound validation work before recursive schemas allocate issue lists. Cyclic IPC input is rejected too. */
export function assertInputBudget(value: unknown): void {
  const pending: { value: unknown; depth: number; leave?: boolean }[] = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0, bytes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (item.leave) { seen.delete(item.value as object); continue; }
    if (++nodes > 200_000 || item.depth > 48) throw new Error("Request is too large or deeply nested.");
    if (typeof item.value === "string") bytes += item.value.length * 2;
    else if (item.value instanceof Uint8Array) bytes += item.value.byteLength;
    else if (item.value && typeof item.value === "object") {
      if (seen.has(item.value)) throw new Error("Cyclic request data is not supported.");
      seen.add(item.value);
      pending.push({ value: item.value, depth: item.depth, leave: true });
      const values = Object.values(item.value);
      if (values.length + pending.length > 200_000) throw new Error("Request contains too many entries.");
      for (const value of values) pending.push({ value, depth: item.depth + 1 });
    }
    if (bytes > 64 * 1024 * 1024) throw new Error("Request exceeds the data limit.");
  }
}
