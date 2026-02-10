/**
 * Intent-First Phase 1 — Unit Tests
 *
 * Tests: derivePillarFromContext(), keyboard builders, parseIntentCallbackData(),
 * detectSourceType(), isIntentCallback(), integration with PendingContent state.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  derivePillarFromContext,
  detectSourceType,
  buildIntentKeyboard,
  buildDepthKeyboard,
  buildAudienceKeyboard,
  buildIntentConfirmKeyboard,
  parseIntentCallbackData,
  parseCallbackData,
  isIntentCallback,
  isContentCallback,
  storePendingContent,
  getPendingContent,
  updatePendingContent,
  removePendingContent,
  clearAllPending,
  getPendingCount,
  type PendingContent,
} from '../src/conversation/content-confirm';
import type { StructuredContext, Pillar } from '../src/conversation/types';

// ==========================================
// derivePillarFromContext()
// ==========================================

describe('derivePillarFromContext', () => {
  function ctx(overrides: Partial<StructuredContext> = {}): StructuredContext {
    return {
      intent: 'capture',
      depth: 'standard',
      audience: 'self',
      source_type: 'text',
      format: null,
      voice_hint: null,
      ...overrides,
    };
  }

  describe('audience-driven primary mapping', () => {
    it('client audience → Consulting', () => {
      expect(derivePillarFromContext(ctx({ audience: 'client' }))).toBe('Consulting');
    });

    it('public audience → The Grove', () => {
      expect(derivePillarFromContext(ctx({ audience: 'public' }))).toBe('The Grove');
    });

    it('client audience overrides github source', () => {
      expect(derivePillarFromContext(ctx({ audience: 'client', source_type: 'github' }))).toBe('Consulting');
    });

    it('public audience overrides linkedin source', () => {
      expect(derivePillarFromContext(ctx({ audience: 'public', source_type: 'linkedin' }))).toBe('The Grove');
    });
  });

  describe('intent-driven secondary mapping', () => {
    it('deep research → The Grove', () => {
      expect(derivePillarFromContext(ctx({ intent: 'research', depth: 'deep' }))).toBe('The Grove');
    });

    it('shallow research → Personal (default)', () => {
      expect(derivePillarFromContext(ctx({ intent: 'research', depth: 'quick' }))).toBe('Personal');
    });

    it('engage → Consulting', () => {
      expect(derivePillarFromContext(ctx({ intent: 'engage' }))).toBe('Consulting');
    });

    it('draft for team → The Grove', () => {
      expect(derivePillarFromContext(ctx({ intent: 'draft', audience: 'team' }))).toBe('The Grove');
    });
  });

  describe('source-type hints', () => {
    it('github → The Grove', () => {
      expect(derivePillarFromContext(ctx({ source_type: 'github' }))).toBe('The Grove');
    });

    it('linkedin → Consulting', () => {
      expect(derivePillarFromContext(ctx({ source_type: 'linkedin' }))).toBe('Consulting');
    });
  });

  describe('defaults', () => {
    it('plain text capture for self → Personal', () => {
      expect(derivePillarFromContext(ctx())).toBe('Personal');
    });

    it('save for self from url → Personal', () => {
      expect(derivePillarFromContext(ctx({ intent: 'save', source_type: 'url' }))).toBe('Personal');
    });
  });

  describe('priority order: audience > intent > source', () => {
    it('client audience wins over deep research', () => {
      expect(derivePillarFromContext(ctx({
        audience: 'client',
        intent: 'research',
        depth: 'deep',
      }))).toBe('Consulting');
    });

    it('engage wins over github source', () => {
      // engage → Consulting, github → The Grove; engage wins because intent check is before source
      expect(derivePillarFromContext(ctx({
        intent: 'engage',
        source_type: 'github',
      }))).toBe('Consulting');
    });
  });
});

// ==========================================
// detectSourceType()
// ==========================================

describe('detectSourceType', () => {
  it('returns image for photo attachment', () => {
    expect(detectSourceType(undefined, 'photo')).toBe('image');
  });

  it('returns image for image attachment', () => {
    expect(detectSourceType(undefined, 'image')).toBe('image');
  });

  it('returns document for document attachment', () => {
    expect(detectSourceType(undefined, 'document')).toBe('document');
  });

  it('returns video for video attachment', () => {
    expect(detectSourceType(undefined, 'video')).toBe('video');
  });

  it('returns video for video_note attachment', () => {
    expect(detectSourceType(undefined, 'video_note')).toBe('video');
  });

  it('returns audio for audio attachment', () => {
    expect(detectSourceType(undefined, 'audio')).toBe('audio');
  });

  it('returns audio for voice attachment', () => {
    expect(detectSourceType(undefined, 'voice')).toBe('audio');
  });

  it('returns text for unknown attachment type', () => {
    expect(detectSourceType(undefined, 'sticker')).toBe('text');
  });

  it('returns github for github.com URL', () => {
    expect(detectSourceType('https://github.com/anthropics/claude-code')).toBe('github');
  });

  it('returns linkedin for linkedin.com URL', () => {
    expect(detectSourceType('https://www.linkedin.com/posts/someone')).toBe('linkedin');
  });

  it('returns url for generic URL', () => {
    expect(detectSourceType('https://example.com/article')).toBe('url');
  });

  it('returns text when no URL and no attachment', () => {
    expect(detectSourceType()).toBe('text');
  });

  it('attachment type takes priority over URL', () => {
    expect(detectSourceType('https://github.com/repo', 'photo')).toBe('image');
  });
});

// ==========================================
// Keyboard Builders
// ==========================================

describe('keyboard builders', () => {
  const requestId = 'test-req-123';

  describe('buildIntentKeyboard', () => {
    it('returns an InlineKeyboard', () => {
      const kb = buildIntentKeyboard(requestId);
      expect(kb).toBeDefined();
      expect(typeof kb.text).toBe('function');
    });

    it('includes all 6 intent buttons + skip', () => {
      const kb = buildIntentKeyboard(requestId);
      const flat = (kb as any).inline_keyboard.flat();
      expect(flat.length).toBe(7); // 6 intents + skip
    });

    it('callback data uses intent: prefix', () => {
      const kb = buildIntentKeyboard(requestId);
      const flat = (kb as any).inline_keyboard.flat();
      const researchBtn = flat.find((b: any) => b.text.includes('Research'));
      expect(researchBtn.callback_data).toBe(`intent:${requestId}:intent:research`);
    });

    it('skip button has correct callback data', () => {
      const kb = buildIntentKeyboard(requestId);
      const flat = (kb as any).inline_keyboard.flat();
      const skipBtn = flat.find((b: any) => b.text.includes('Skip'));
      expect(skipBtn.callback_data).toBe(`intent:${requestId}:skip`);
    });
  });

  describe('buildDepthKeyboard', () => {
    it('has 3 depth buttons + back + skip', () => {
      const kb = buildDepthKeyboard(requestId);
      const flat = (kb as any).inline_keyboard.flat();
      expect(flat.length).toBe(5); // quick, standard, deep, back, skip
    });

    it('quick button callback data is correct', () => {
      const kb = buildDepthKeyboard(requestId);
      const flat = (kb as any).inline_keyboard.flat();
      const quickBtn = flat.find((b: any) => b.text.includes('Quick'));
      expect(quickBtn.callback_data).toBe(`intent:${requestId}:depth:quick`);
    });

    it('back navigates to intent step', () => {
      const kb = buildDepthKeyboard(requestId);
      const flat = (kb as any).inline_keyboard.flat();
      const backBtn = flat.find((b: any) => b.text.includes('Back'));
      expect(backBtn.callback_data).toBe(`intent:${requestId}:back:intent`);
    });
  });

  describe('buildAudienceKeyboard', () => {
    it('has 4 audience buttons + back + skip', () => {
      const kb = buildAudienceKeyboard(requestId);
      const flat = (kb as any).inline_keyboard.flat();
      expect(flat.length).toBe(6); // self, client, public, team, back, skip
    });

    it('client button callback data is correct', () => {
      const kb = buildAudienceKeyboard(requestId);
      const flat = (kb as any).inline_keyboard.flat();
      const clientBtn = flat.find((b: any) => b.text.includes('Client'));
      expect(clientBtn.callback_data).toBe(`intent:${requestId}:audience:client`);
    });

    it('back navigates to depth step', () => {
      const kb = buildAudienceKeyboard(requestId);
      const flat = (kb as any).inline_keyboard.flat();
      const backBtn = flat.find((b: any) => b.text.includes('Back'));
      expect(backBtn.callback_data).toBe(`intent:${requestId}:back:depth`);
    });
  });

  describe('buildIntentConfirmKeyboard', () => {
    it('has confirm + back + skip', () => {
      const kb = buildIntentConfirmKeyboard(requestId);
      const flat = (kb as any).inline_keyboard.flat();
      expect(flat.length).toBe(3);
    });

    it('confirm button callback data is correct', () => {
      const kb = buildIntentConfirmKeyboard(requestId);
      const flat = (kb as any).inline_keyboard.flat();
      const confirmBtn = flat.find((b: any) => b.text.includes('Confirm'));
      expect(confirmBtn.callback_data).toBe(`intent:${requestId}:confirm`);
    });

    it('back navigates to audience step', () => {
      const kb = buildIntentConfirmKeyboard(requestId);
      const flat = (kb as any).inline_keyboard.flat();
      const backBtn = flat.find((b: any) => b.text.includes('Back'));
      expect(backBtn.callback_data).toBe(`intent:${requestId}:back:audience`);
    });
  });
});

// ==========================================
// parseIntentCallbackData()
// ==========================================

describe('parseIntentCallbackData', () => {
  it('parses intent selection', () => {
    const result = parseIntentCallbackData('intent:abc123:intent:research');
    expect(result).toEqual({
      requestId: 'abc123',
      action: 'intent',
      value: 'research',
    });
  });

  it('parses depth selection', () => {
    const result = parseIntentCallbackData('intent:abc123:depth:deep');
    expect(result).toEqual({
      requestId: 'abc123',
      action: 'depth',
      value: 'deep',
    });
  });

  it('parses audience selection', () => {
    const result = parseIntentCallbackData('intent:abc123:audience:client');
    expect(result).toEqual({
      requestId: 'abc123',
      action: 'audience',
      value: 'client',
    });
  });

  it('parses confirm (no value)', () => {
    const result = parseIntentCallbackData('intent:abc123:confirm');
    expect(result).toEqual({
      requestId: 'abc123',
      action: 'confirm',
      value: undefined,
    });
  });

  it('parses skip (no value)', () => {
    const result = parseIntentCallbackData('intent:abc123:skip');
    expect(result).toEqual({
      requestId: 'abc123',
      action: 'skip',
      value: undefined,
    });
  });

  it('parses back with target step', () => {
    const result = parseIntentCallbackData('intent:abc123:back:intent');
    expect(result).toEqual({
      requestId: 'abc123',
      action: 'back',
      value: 'intent',
    });
  });

  it('returns null for content: prefix', () => {
    expect(parseIntentCallbackData('content:abc:pillar:Personal')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseIntentCallbackData('')).toBeNull();
  });

  it('returns null for invalid action', () => {
    expect(parseIntentCallbackData('intent:abc:invalid:val')).toBeNull();
  });

  it('returns null for too few parts', () => {
    expect(parseIntentCallbackData('intent:abc')).toBeNull();
  });
});

// ==========================================
// isIntentCallback() / isContentCallback()
// ==========================================

describe('callback type detection', () => {
  it('isIntentCallback returns true for intent: prefix', () => {
    expect(isIntentCallback('intent:abc:intent:research')).toBe(true);
  });

  it('isIntentCallback returns false for content: prefix', () => {
    expect(isIntentCallback('content:abc:pillar:Personal')).toBe(false);
  });

  it('isIntentCallback returns false for undefined', () => {
    expect(isIntentCallback(undefined)).toBe(false);
  });

  it('isContentCallback returns true for content: prefix', () => {
    expect(isContentCallback('content:abc:pillar:Personal')).toBe(true);
  });

  it('isContentCallback returns false for intent: prefix', () => {
    expect(isContentCallback('intent:abc:intent:research')).toBe(false);
  });
});

// ==========================================
// Legacy parseCallbackData() backward compat
// ==========================================

describe('parseCallbackData (legacy content: prefix)', () => {
  it('parses pillar selection', () => {
    const result = parseCallbackData('content:abc:pillar:Personal');
    expect(result).toEqual({
      requestId: 'abc',
      action: 'pillar',
      value: 'Personal',
    });
  });

  it('parses confirm action', () => {
    const result = parseCallbackData('content:abc:confirm');
    expect(result).toEqual({
      requestId: 'abc',
      action: 'confirm',
      value: undefined,
    });
  });

  it('returns null for intent: prefix', () => {
    expect(parseCallbackData('intent:abc:intent:research')).toBeNull();
  });
});

// ==========================================
// PendingContent state management
// ==========================================

describe('PendingContent state management', () => {
  beforeEach(() => {
    clearAllPending();
  });

  const basePending: PendingContent = {
    requestId: 'test-req',
    chatId: 123,
    userId: 456,
    flowState: 'intent',
    originalText: 'https://example.com/article',
    pillar: 'The Grove',
    requestType: 'Research',
    timestamp: Date.now(),
    url: 'https://example.com/article',
  };

  it('store and retrieve', () => {
    storePendingContent(basePending);
    const result = getPendingContent('test-req');
    expect(result).toBeDefined();
    expect(result!.userId).toBe(456);
  });

  it('update intent and flow state', () => {
    storePendingContent(basePending);
    updatePendingContent('test-req', { intent: 'research', flowState: 'depth' });
    const result = getPendingContent('test-req');
    expect(result!.intent).toBe('research');
    expect(result!.flowState).toBe('depth');
  });

  it('update depth', () => {
    storePendingContent(basePending);
    updatePendingContent('test-req', { depth: 'deep', flowState: 'audience' });
    const result = getPendingContent('test-req');
    expect(result!.depth).toBe('deep');
    expect(result!.flowState).toBe('audience');
  });

  it('update audience and structuredContext', () => {
    storePendingContent(basePending);
    const sc: StructuredContext = {
      intent: 'research',
      depth: 'deep',
      audience: 'self',
      source_type: 'url',
      format: 'analysis',
      voice_hint: null,
    };
    updatePendingContent('test-req', {
      audience: 'self',
      structuredContext: sc,
      flowState: 'confirm',
    });
    const result = getPendingContent('test-req');
    expect(result!.audience).toBe('self');
    expect(result!.structuredContext).toEqual(sc);
    expect(result!.flowState).toBe('confirm');
  });

  it('remove pending content', () => {
    storePendingContent(basePending);
    expect(getPendingCount()).toBe(1);
    removePendingContent('test-req');
    expect(getPendingContent('test-req')).toBeUndefined();
    expect(getPendingCount()).toBe(0);
  });

  it('returns false for update on nonexistent', () => {
    expect(updatePendingContent('no-exist', { intent: 'draft' })).toBe(false);
  });

  it('returns false for remove on nonexistent', () => {
    expect(removePendingContent('no-exist')).toBe(false);
  });
});
