/**
 * Goal Extraction Prompts
 *
 * Haiku extracts structured GoalContext from the user's natural language
 * response to "What do you want to accomplish with this?"
 *
 * Sprint: GOAL-FIRST-CAPTURE
 * ADR: ADR-001 (Notion SSOT) — these are fallback prompts.
 * Production prompts should resolve from Notion System Prompts DB.
 */

/**
 * System prompt for Haiku goal extraction.
 * Expects {{contentTitle}}, {{contentSummary}}, {{sourceType}}, {{userMessage}} placeholders.
 */
export const GOAL_EXTRACTION_PROMPT = `You are parsing a user's goal statement after they shared content with Atlas (their AI assistant).

CONTENT CONTEXT:
Title: {{contentTitle}}
Summary: {{contentSummary}}
Source: {{sourceType}}

USER'S GOAL STATEMENT:
{{userMessage}}

Extract the following fields. Return null for anything not clearly stated. Be conservative — only extract what the user explicitly or strongly implied.

1. endState: What ACTION is the user requesting? Focus on the PRIMARY VERB.
   - "bookmark" = save for later, no processing needed
   - "research" = investigate, find sources, go deep, explore a topic
   - "create" = produce content (post, brief, deck, etc.) — ONLY when the user's primary intent is to write/produce, NOT when they say "research this AS a [format]"
   - "analyze" = structured analysis, breakdown
   - "summarize" = condensed version
   - "custom" = something else (capture in endStateRaw)

   CRITICAL DISAMBIGUATION: When the user says "research this as a think piece" or "research this for LinkedIn", the endState is "research" — NOT "create". The format ("think piece") describes the OUTPUT shape, not the action. Only use "create" when the primary verb is about writing/producing (e.g., "write a post about this", "draft a brief").

2. thesisHook: Any angle, theme, or thesis they mentioned?
   Example: "revenge of the B students" is a thesis hook.
   Only extract if the user explicitly names an angle or theme.

3. audience: Who will see the output?
   - "self" = just for them
   - "client" = professional deliverable
   - "linkedin" / "twitter" / "public" = social/public content
   - null if not stated

4. format: What type of output?
   - "thinkpiece", "post", "brief", "deck", "memo", "thread", etc.
   - null if not stated

5. depthSignal: How thorough?
   - "quick" = overview, surface level
   - "standard" = normal depth
   - "deep" = comprehensive, sources required
   - null if not stated (do NOT guess)

6. emotionalTone: Any emotional framing?
   - "playful", "urgent", "serious", "analytical", "provocative"
   - null if not stated

7. personalRelevance: Any connection to their ongoing work/themes?
   - Extract phrases like "theme I've been playing with", "relates to my X project"
   - null if not stated

Return ONLY valid JSON matching this schema:
{
  "endState": string,
  "endStateRaw": string | null,
  "thesisHook": string | null,
  "audience": string | null,
  "format": string | null,
  "depthSignal": "quick" | "standard" | "deep" | null,
  "emotionalTone": string | null,
  "personalRelevance": string | null
}`;

/**
 * Build the extraction prompt with content context filled in.
 */
export function buildExtractionPrompt(params: {
  contentTitle: string;
  contentSummary: string;
  sourceType: string;
  userMessage: string;
}): string {
  return GOAL_EXTRACTION_PROMPT
    .replace('{{contentTitle}}', params.contentTitle || 'Unknown')
    .replace('{{contentSummary}}', params.contentSummary || 'No summary available')
    .replace('{{sourceType}}', params.sourceType || 'unknown')
    .replace('{{userMessage}}', params.userMessage);
}

/**
 * Prompt for extracting a specific field from a clarification response.
 * Used when Jim answers a follow-up question.
 */
export const FIELD_EXTRACTION_PROMPT = `You are extracting a specific piece of information from a user's response to a clarification question.

The question asked was about: {{fieldName}}
The user's response: {{userResponse}}

Extract ONLY the value for {{fieldName}}. Return a JSON object with a single key "value" containing the extracted value as a string. If the response doesn't clearly answer the question, return {"value": null}.

For audience: return one of "self", "client", "linkedin", "twitter", "public", "team"
For depthSignal: return one of "quick", "standard", "deep"
For format: return the format type as a lowercase string (e.g., "thinkpiece", "post", "brief", "deck")
For other fields: return the extracted value as a string.

Return ONLY valid JSON: {"value": string | null}`;

/**
 * Build field extraction prompt.
 */
export function buildFieldExtractionPrompt(fieldName: string, userResponse: string): string {
  return FIELD_EXTRACTION_PROMPT
    .replaceAll('{{fieldName}}', fieldName)
    .replace('{{userResponse}}', userResponse);
}
