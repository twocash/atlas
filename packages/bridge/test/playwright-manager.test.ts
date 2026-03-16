/**
 * Tests for PlaywrightManager — headed browser automation.
 *
 * These tests verify the manager's API without launching a real browser
 * (that requires a display server). Focus on state management, config,
 * and error handling.
 */

import { describe, it, expect } from 'bun:test';
import { PlaywrightManager } from '../src/browser/playwright-manager';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';

const TEST_STATE_DIR = resolve(import.meta.dir, '../data/browser-state-test');

describe('PlaywrightManager', () => {
  describe('construction', () => {
    it('creates with default config', () => {
      const mgr = new PlaywrightManager({ headed: false });
      expect(mgr).toBeDefined();
      expect(mgr.isRunning()).toBe(false);
    });

    it('creates state directory if it does not exist', () => {
      // Clean up first
      if (existsSync(TEST_STATE_DIR)) rmSync(TEST_STATE_DIR, { recursive: true });

      const mgr = new PlaywrightManager({ headed: false, stateDir: TEST_STATE_DIR });
      expect(existsSync(TEST_STATE_DIR)).toBe(true);

      // Clean up
      rmSync(TEST_STATE_DIR, { recursive: true });
    });

    it('accepts custom viewport config', () => {
      const mgr = new PlaywrightManager({
        headed: false,
        viewportWidth: 1920,
        viewportHeight: 1080,
      });
      expect(mgr).toBeDefined();
    });
  });

  describe('page tracking', () => {
    it('getActivePages returns empty when no pages open', () => {
      const mgr = new PlaywrightManager({ headed: false });
      expect(mgr.getActivePages()).toEqual([]);
    });

    it('closePage returns false for unknown page ID', async () => {
      const mgr = new PlaywrightManager({ headed: false });
      const result = await mgr.closePage('nonexistent');
      expect(result).toBe(false);
    });

    it('getPage returns null for unknown page ID', async () => {
      const mgr = new PlaywrightManager({ headed: false });
      const page = await mgr.getPage('nonexistent');
      expect(page).toBeNull();
    });
  });

  describe('login detection', () => {
    it('detects Google login page', () => {
      const mgr = new PlaywrightManager({ headed: false });
      expect(mgr.isLoginPage('https://accounts.google.com/signin/v2/identifier')).toBe(true);
    });

    it('detects LinkedIn login page', () => {
      const mgr = new PlaywrightManager({ headed: false });
      expect(mgr.isLoginPage('https://login.linkedin.com/login')).toBe(true);
    });

    it('detects Microsoft login page', () => {
      const mgr = new PlaywrightManager({ headed: false });
      expect(mgr.isLoginPage('https://login.microsoftonline.com/common/oauth2')).toBe(true);
    });

    it('detects GitHub login page', () => {
      const mgr = new PlaywrightManager({ headed: false });
      expect(mgr.isLoginPage('https://github.com/login')).toBe(true);
    });

    it('does not false-positive on regular pages', () => {
      const mgr = new PlaywrightManager({ headed: false });
      expect(mgr.isLoginPage('https://mail.google.com/mail/u/0/#inbox')).toBe(false);
      expect(mgr.isLoginPage('https://www.linkedin.com/in/jimcalhoun')).toBe(false);
      expect(mgr.isLoginPage('https://github.com/twocash/atlas')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('getContent throws for unknown page ID', async () => {
      const mgr = new PlaywrightManager({ headed: false });
      expect(mgr.getContent('nonexistent')).rejects.toThrow('Page not found');
    });

    it('screenshot throws for unknown page ID', async () => {
      const mgr = new PlaywrightManager({ headed: false });
      expect(mgr.screenshot('nonexistent')).rejects.toThrow('Page not found');
    });

    it('interact throws for unknown page ID', async () => {
      const mgr = new PlaywrightManager({ headed: false });
      expect(mgr.interact('nonexistent', { type: 'click', selector: 'button' }))
        .rejects.toThrow('Page not found');
    });

    it('waitForAuth throws for unknown page ID', async () => {
      const mgr = new PlaywrightManager({ headed: false });
      expect(mgr.waitForAuth('nonexistent')).rejects.toThrow('Page not found');
    });

    it('interact validates action requirements', async () => {
      // Can't test without a real page, but verify the type system works
      const mgr = new PlaywrightManager({ headed: false });
      // These should all throw "Page not found" before hitting validation
      expect(mgr.interact('fake', { type: 'click', selector: 'button' }))
        .rejects.toThrow();
    });
  });

  describe('cleanup', () => {
    it('close is safe when browser not started', async () => {
      const mgr = new PlaywrightManager({ headed: false });
      await mgr.close(); // Should not throw
      expect(mgr.isRunning()).toBe(false);
    });
  });
});
