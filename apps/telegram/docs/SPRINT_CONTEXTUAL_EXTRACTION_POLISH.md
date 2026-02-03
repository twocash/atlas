# Sprint: Contextual Extraction Polish (v1.1)

**Goal:** Harden the contextual extraction feature for production release
**Duration:** 1 sprint
**Priority:** P1

---

## Context

Contextual Extraction v1.0.0 is implemented and passing tests. This sprint focuses on production hardening, user experience polish, and observability improvements.

---

## Tasks

### 1. Error Handling & Resilience

#### 1.1 MCP Connection Recovery
- [ ] Add retry logic for MCP tool failures (3 attempts with exponential backoff)
- [ ] Graceful degradation when chrome-ext is unavailable
- [ ] Health check for MCP connection before skill execution
- [ ] User notification on MCP unavailability

#### 1.2 DOM Selector Hardening
- [ ] Add fallback selectors for threads.net (class-based as backup to role-based)
- [ ] Implement selector health monitoring (track success rate)
- [ ] Alert when selector success rate drops below threshold

#### 1.3 Timeout Handling
- [ ] Per-step timeout configuration in skill YAML
- [ ] Partial result saving on timeout (save what we got)
- [ ] User notification with partial results

### 2. User Experience

#### 2.1 Progress Feedback
- [ ] "Extraction started..." message immediately after confirmation
- [ ] Progress indicator for long extractions (edit message with stages)
- [ ] Estimated time remaining based on depth level

#### 2.2 Results Display
- [ ] Rich extraction summary in Telegram (not just "complete")
- [ ] Key insights preview (first 280 chars of analysis)
- [ ] "View full analysis" link to Feed entry
- [ ] Inline keyboard: "Extract links too?" for discovered URLs

#### 2.3 Failure Communication
- [ ] User-friendly error messages (not technical stack traces)
- [ ] Retry button on failure
- [ ] "Skip extraction" option to proceed without

### 3. Observability

#### 3.1 Metrics
- [ ] Track extraction duration by depth level
- [ ] Track success/failure rate by platform (threads, youtube, etc.)
- [ ] Track MCP tool call latency
- [ ] Token usage per extraction

#### 3.2 Logging
- [ ] Structured logs for each extraction step
- [ ] Correlation ID linking Telegram → Skill → Feed entry
- [ ] Debug mode toggle for verbose skill execution logging

#### 3.3 Health Dashboard
- [ ] `/health extraction` command showing:
  - Last 10 extraction statuses
  - Average duration by depth
  - MCP connection status
  - Failed extractions with reasons

### 4. Performance

#### 4.1 Parallel Execution
- [ ] Queue system for multiple incoming URLs
- [ ] Configurable concurrency limit (default: 2 parallel extractions)
- [ ] Priority queue (The Grove items processed first)

#### 4.2 Caching
- [ ] Cache extracted content for duplicate URLs (24h TTL)
- [ ] Skip re-extraction prompt if recently processed
- [ ] Force re-extract option

### 5. Content Quality

#### 5.1 Analysis Improvements
- [ ] Grove analysis: Extract specific quotes worth saving
- [ ] Consulting analysis: Competitor mention highlighting
- [ ] Validation: Ensure analysis isn't hallucinated (reference check)

#### 5.2 Link Extraction
- [ ] Deduplicate extracted links
- [ ] Categorize links (arxiv, github, youtube, other)
- [ ] Preview metadata for each link (title, domain)

### 6. Testing

#### 6.1 Integration Tests
- [ ] End-to-end test: URL → Classification → Extraction → Feed
- [ ] Mock MCP server for CI pipeline
- [ ] Test each extraction depth level

#### 6.2 Regression Tests
- [ ] Selector tests against saved HTML snapshots
- [ ] Notification format tests
- [ ] Feed property update tests

---

## Acceptance Criteria

1. **Reliability**: 95%+ extraction success rate over 7 days
2. **Performance**: Deep extraction < 30s, Standard < 15s, Shallow < 5s
3. **UX**: User sees progress within 2s of confirmation
4. **Observability**: All failures logged with actionable context
5. **Recovery**: No zombie browser tabs after 24h operation

---

## Dependencies

- chrome-ext running and stable
- claude-in-chrome MCP server operational
- Notion API access for Feed updates

---

## Out of Scope (Future Sprints)

- Additional platform skills (arxiv, youtube)
- Recursive discovery chains
- Knowledge graph construction
- Proactive synthesis suggestions

---

## Definition of Done

- [ ] All tasks completed or explicitly deferred
- [ ] Smoke tests passing (52+ tests)
- [ ] Manual end-to-end test successful
- [ ] Documentation updated
- [ ] No P0 bugs open
- [ ] Deployed to production

---

*Sprint Planning - Contextual Extraction v1.1 Polish*
