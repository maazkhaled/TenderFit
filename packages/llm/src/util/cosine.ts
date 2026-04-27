export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: vector length mismatch (${a.length} vs ${b.length})`,
    );
  }
  if (a.length === 0) {
    throw new Error("cosineSimilarity: empty vectors");
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] as number;
    const bv = b[i] as number;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  if (sim < -1) return -1;
  if (sim > 1) return 1;
  return sim;
}
