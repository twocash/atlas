import type { LeadResult, Segment } from "./leads"

// Background ← Side Panel
export interface StartQueueMessage {
  name: "START_QUEUE"
}

export interface PauseQueueMessage {
  name: "PAUSE_QUEUE"
}

export interface SkipLeadMessage {
  name: "SKIP_LEAD"
}

export interface ResetQueueMessage {
  name: "RESET_QUEUE"
}

// Background → Content Script
export interface ExecuteActionMessage {
  name: "EXECUTE_ACTION"
  body: {
    action: "save_and_follow"
    listName: string
    segment: Segment
  }
}

export interface CheckReadyMessage {
  name: "CHECK_READY"
}

// Content Script → Background
export interface ActionResultMessage {
  success: boolean
  savedToList: boolean
  followed: boolean
  acceptedInvite?: boolean
  error?: string
  errorType?: LeadResult["errorType"]
  logs: string[]
  scrapedText?: string
  salesNavUrl?: string
}

export interface ReadyResponse {
  ready: boolean
}

// LLM Messages
export interface LlmQueryMessage {
  name: "LLM_QUERY"
  body: {
    prompt: string
    systemPrompt?: string
    maxTokens?: number
  }
}

// Socratic Interview Messages
export interface SocraticAssessMessage {
  name: "SOCRATIC_ASSESS"
  body: {
    comment: import("./comments").LinkedInComment
  }
}

export interface SocraticAnswerMessage {
  name: "SOCRATIC_ANSWER"
  body: {
    sessionId: string
    answerValue: string
    questionIndex?: number
  }
}

export interface SocraticCancelMessage {
  name: "SOCRATIC_CANCEL"
  body: {
    sessionId: string
  }
}
