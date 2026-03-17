import { describe, it, expect } from "bun:test"
import { deriveThreadId, parseThreadId, VALID_SURFACES } from "../src/thread"

describe("deriveThreadId", () => {
  it("produces canonical format: surface:nativeId", () => {
    const result = deriveThreadId("telegram", "8207593172")
    expect(result.threadId).toBe("telegram:8207593172")
    expect(result.surface).toBe("telegram")
    expect(result.surfaceNativeId).toBe("8207593172")
  })

  it("coerces numeric nativeId to string", () => {
    const result = deriveThreadId("telegram", 8207593172)
    expect(result.threadId).toBe("telegram:8207593172")
    expect(result.surfaceNativeId).toBe("8207593172")
  })

  it("works for all valid surfaces", () => {
    for (const surface of VALID_SURFACES) {
      const result = deriveThreadId(surface, "test-123")
      expect(result.threadId).toBe(`${surface}:test-123`)
      expect(result.surface).toBe(surface)
    }
  })

  it("is deterministic — same input always produces same output", () => {
    const a = deriveThreadId("bridge", "session-abc")
    const b = deriveThreadId("bridge", "session-abc")
    expect(a.threadId).toBe(b.threadId)
  })

  it("different surfaces with same nativeId produce different threadIds", () => {
    const tg = deriveThreadId("telegram", "123")
    const br = deriveThreadId("bridge", "123")
    expect(tg.threadId).not.toBe(br.threadId)
  })
})

describe("parseThreadId", () => {
  it("round-trips with deriveThreadId", () => {
    const original = deriveThreadId("chrome", "tab-456")
    const parsed = parseThreadId(original.threadId)
    expect(parsed).not.toBeNull()
    expect(parsed!.threadId).toBe(original.threadId)
    expect(parsed!.surface).toBe(original.surface)
    expect(parsed!.surfaceNativeId).toBe(original.surfaceNativeId)
  })

  it("handles nativeId containing colons", () => {
    const parsed = parseThreadId("bridge:session:abc:123")
    expect(parsed).not.toBeNull()
    expect(parsed!.surface).toBe("bridge")
    expect(parsed!.surfaceNativeId).toBe("session:abc:123")
  })

  it("returns null for no colon", () => {
    expect(parseThreadId("invalid")).toBeNull()
  })

  it("returns null for empty nativeId", () => {
    expect(parseThreadId("telegram:")).toBeNull()
  })

  it("returns null for unknown surface", () => {
    expect(parseThreadId("slack:12345")).toBeNull()
  })
})

describe("VALID_SURFACES", () => {
  it("contains exactly the expected surfaces", () => {
    expect(VALID_SURFACES).toContain("telegram")
    expect(VALID_SURFACES).toContain("bridge")
    expect(VALID_SURFACES).toContain("chrome")
    expect(VALID_SURFACES).toContain("api")
    expect(VALID_SURFACES.length).toBe(4)
  })
})
