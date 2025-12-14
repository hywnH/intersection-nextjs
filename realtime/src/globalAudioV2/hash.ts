// Deterministic 32-bit hash (FNV-1a) for stable note assignment.
export const hashStringToU32 = (input: string) => {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export const noteIndexFromId = (id: string) => hashStringToU32(id) % 12;
