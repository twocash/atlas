/**
 * Atlas Environment Validation — Fail-Fast Guard
 *
 * Validates environment configuration at startup.
 * CRITICAL: Production cannot run with fallbacks enabled.
 * Uses process.exit(1), NOT throw — thrown errors can be caught and swallowed.
 */

export interface EnvironmentConfig {
  mode: 'development' | 'production';
  enableFallbacks: boolean;
  autoLogErrors: boolean;
}

/**
 * Validate environment and return config.
 * Calls process.exit(1) if production has fallbacks enabled.
 */
export function validateEnvironment(): EnvironmentConfig {
  const mode = (process.env.ATLAS_MODE || 'development') as 'development' | 'production';
  const enableFallbacks = process.env.ENABLE_FALLBACKS === 'true';
  const autoLogErrors = process.env.AUTO_LOG_ERRORS !== 'false'; // Default true

  // CRITICAL: Production cannot run with fallbacks — process.exit cannot be caught
  if (mode === 'production' && enableFallbacks) {
    console.error('🚨 FATAL: Production CANNOT run with ENABLE_FALLBACKS=true.');
    console.error('This masks bugs and causes hallucinated outputs.');
    console.error('Set ENABLE_FALLBACKS=false or remove it from .env.');
    process.exit(1);
  }

  console.log(`Atlas starting in ${mode} mode (fallbacks: ${enableFallbacks}, autoLog: ${autoLogErrors})`);

  return { mode, enableFallbacks, autoLogErrors };
}

/**
 * Check if strict mode is active (no fallbacks allowed).
 * Convenience function for runtime checks.
 */
export function isStrictMode(): boolean {
  return process.env.ENABLE_FALLBACKS !== 'true';
}
