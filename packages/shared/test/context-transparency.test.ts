/**
 * Context Transparency Tests
 *
 * Verifies SlotResult wrapping, degraded context note generation,
 * and the contract between slot states and user-facing indicators.
 */
import { describe, it, expect } from 'bun:test'
import {
  wrapSlotResult,
  type SlotResult,
  type SlotName,
  SLOT_DISPLAY_NAMES,
} from '../src/types/slot-result'
import { buildDegradedContextNote } from '../src/context-transparency'

// =============================================================================
// wrapSlotResult()
// =============================================================================

describe('wrapSlotResult', () => {
  it('returns ok for non-empty content', () => {
    const result = wrapSlotResult('intent', 'some triage content')
    expect(result.status).toBe('ok')
    expect(result.content).toBe('some triage content')
    expect(result.slotName).toBe('intent')
    expect(result.reason).toBeUndefined()
  })

  it('returns failed for null content', () => {
    const result = wrapSlotResult('domain_rag', null)
    expect(result.status).toBe('failed')
    expect(result.content).toBeNull()
    expect(result.reason).toBe('Slot returned no content')
  })

  it('returns failed for undefined content', () => {
    const result = wrapSlotResult('voice', undefined)
    expect(result.status).toBe('failed')
    expect(result.content).toBeNull()
    expect(result.reason).toBe('Slot returned no content')
  })

  it('returns degraded for empty string content', () => {
    const result = wrapSlotResult('pov', '')
    expect(result.status).toBe('degraded')
    expect(result.content).toBe('')
    expect(result.reason).toBe('Slot returned empty content')
  })

  it('returns degraded for whitespace-only content', () => {
    const result = wrapSlotResult('pov', '   \n\t  ')
    expect(result.status).toBe('degraded')
    expect(result.reason).toBe('Slot returned empty content')
  })

  it('uses custom reason for failed slot', () => {
    const result = wrapSlotResult('domain_rag', null, 'Notion API timeout')
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('Notion API timeout')
  })

  it('uses custom reason for degraded slot', () => {
    const result = wrapSlotResult('voice', '', 'Voice config not found')
    expect(result.status).toBe('degraded')
    expect(result.reason).toBe('Voice config not found')
  })

  it('ignores reason for ok slot', () => {
    const result = wrapSlotResult('intent', 'content here', 'should be ignored')
    expect(result.status).toBe('ok')
    expect(result.reason).toBeUndefined()
  })
})

// =============================================================================
// SLOT_DISPLAY_NAMES
// =============================================================================

describe('SLOT_DISPLAY_NAMES', () => {
  it('has entries for all 6 slot names', () => {
    const expected: SlotName[] = ['intent', 'domain_rag', 'pov', 'voice', 'browser', 'output']
    for (const name of expected) {
      expect(SLOT_DISPLAY_NAMES[name]).toBeDefined()
      expect(typeof SLOT_DISPLAY_NAMES[name]).toBe('string')
    }
  })

  it('uses human-readable labels', () => {
    expect(SLOT_DISPLAY_NAMES.domain_rag).toBe('Domain RAG')
    expect(SLOT_DISPLAY_NAMES.pov).toBe('POV Library')
    expect(SLOT_DISPLAY_NAMES.voice).toBe('Voice')
    expect(SLOT_DISPLAY_NAMES.intent).toBe('Triage')
  })
})

// =============================================================================
// buildDegradedContextNote()
// =============================================================================

describe('buildDegradedContextNote', () => {
  it('returns null when all slots are ok', () => {
    const slots: SlotResult[] = [
      wrapSlotResult('intent', 'triage data'),
      wrapSlotResult('domain_rag', 'rag data'),
      wrapSlotResult('voice', 'voice data'),
      wrapSlotResult('pov', 'pov data'),
    ]
    expect(buildDegradedContextNote(slots)).toBeNull()
  })

  it('returns null for empty slot array', () => {
    expect(buildDegradedContextNote([])).toBeNull()
  })

  it('generates note for single failed slot', () => {
    const slots: SlotResult[] = [
      wrapSlotResult('intent', 'ok'),
      wrapSlotResult('domain_rag', null, 'Notion API timeout'),
      wrapSlotResult('voice', 'ok'),
    ]
    const note = buildDegradedContextNote(slots)
    expect(note).not.toBeNull()
    expect(note).toContain('Domain RAG unavailable')
    expect(note).toContain('Notion API timeout')
    expect(note).toContain('Responses may lack specificity')
  })

  it('generates note for single degraded slot', () => {
    const slots: SlotResult[] = [
      wrapSlotResult('intent', 'ok'),
      wrapSlotResult('voice', '', 'Voice config not found'),
    ]
    const note = buildDegradedContextNote(slots)
    expect(note).not.toBeNull()
    expect(note).toContain('Voice unavailable')
    expect(note).toContain('Voice config not found')
  })

  it('consolidates multiple degraded/failed slots', () => {
    const slots: SlotResult[] = [
      wrapSlotResult('intent', 'ok'),
      wrapSlotResult('domain_rag', null, 'RAG down'),
      wrapSlotResult('pov', '', 'Empty POV'),
      wrapSlotResult('voice', null, 'Voice fetch error'),
    ]
    const note = buildDegradedContextNote(slots)!
    expect(note).toContain('Domain RAG unavailable')
    expect(note).toContain('POV Library unavailable')
    expect(note).toContain('Voice unavailable')
    // All three reasons present
    expect(note).toContain('RAG down')
    expect(note).toContain('Empty POV')
    expect(note).toContain('Voice fetch error')
  })

  it('starts with warning emoji', () => {
    const slots: SlotResult[] = [wrapSlotResult('domain_rag', null)]
    const note = buildDegradedContextNote(slots)!
    expect(note.startsWith('⚠️')).toBe(true)
  })

  it('omits ok slots from note', () => {
    const slots: SlotResult[] = [
      wrapSlotResult('intent', 'ok data'),
      wrapSlotResult('domain_rag', null),
    ]
    const note = buildDegradedContextNote(slots)!
    expect(note).not.toContain('Triage')
    expect(note).toContain('Domain RAG')
  })

  it('handles slot without explicit reason', () => {
    const slots: SlotResult[] = [wrapSlotResult('domain_rag', null)]
    const note = buildDegradedContextNote(slots)!
    // Default reason from wrapSlotResult
    expect(note).toContain('Domain RAG unavailable')
    expect(note).toContain('Slot returned no content')
  })

  it('all-failed produces comprehensive note', () => {
    const slots: SlotResult[] = [
      wrapSlotResult('intent', null, 'triage err'),
      wrapSlotResult('domain_rag', null, 'rag err'),
      wrapSlotResult('pov', null, 'pov err'),
      wrapSlotResult('voice', null, 'voice err'),
    ]
    const note = buildDegradedContextNote(slots)!
    expect(note).toContain('Triage unavailable')
    expect(note).toContain('Domain RAG unavailable')
    expect(note).toContain('POV Library unavailable')
    expect(note).toContain('Voice unavailable')
  })
})

// =============================================================================
// Integration: SlotResult → degraded note round-trip
// =============================================================================

describe('SlotResult → degraded note integration', () => {
  it('mixed ok/degraded/failed produces correct note', () => {
    const slots: SlotResult[] = [
      wrapSlotResult('intent', 'triage complete'),        // ok
      wrapSlotResult('domain_rag', ''),                    // degraded
      wrapSlotResult('pov', 'pov content'),                // ok
      wrapSlotResult('voice', null, 'API 500'),            // failed
    ]
    const note = buildDegradedContextNote(slots)!
    // Only degraded/failed appear
    expect(note).toContain('Domain RAG unavailable')
    expect(note).toContain('Voice unavailable (API 500)')
    // ok slots absent
    expect(note).not.toContain('Triage')
    expect(note).not.toContain('POV Library')
  })

  it('note can be injected into system prompt', () => {
    const slots: SlotResult[] = [
      wrapSlotResult('domain_rag', null, 'timeout'),
    ]
    const note = buildDegradedContextNote(slots)!
    const systemPrompt = `You are Atlas.\n\n## Cognitive Context\n\nSome enriched content\n\n${note}`
    expect(systemPrompt).toContain('⚠️ Context Note')
    expect(systemPrompt).toContain('Domain RAG unavailable')
  })
})
