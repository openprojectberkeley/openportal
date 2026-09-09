import { describe, expect, it } from "vitest";
import { IN_CHUNK, chunkIds } from "@/lib/postgrest-chunk";

describe("chunkIds", () => {
  it("returns empty for empty input", () => {
    expect(chunkIds([])).toEqual([]);
  });

  it("keeps a short list as one chunk", () => {
    expect(chunkIds(["a", "b"], 80)).toEqual([["a", "b"]]);
  });

  it("splits at IN_CHUNK by default", () => {
    const ids = Array.from({ length: IN_CHUNK + 3 }, (_, i) => `id-${i}`);
    const chunks = chunkIds(ids);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(IN_CHUNK);
    expect(chunks[1]).toHaveLength(3);
  });
});
