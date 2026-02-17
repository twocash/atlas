/**
 * SocraticInterview — Standalone Socratic context-check UI.
 *
 * Gate 1.7: Extracted from ReplyHelper inline interview panel.
 * Renders an amber prompt with questions and option buttons.
 * Used by ReplyHelper when Socratic assessment returns questions.
 */

import type { SocraticQuestion } from "~src/types/socratic"

export interface SocraticInterviewState {
  sessionId: string
  questions: SocraticQuestion[]
  confidence: number
}

interface SocraticInterviewProps {
  interview: SocraticInterviewState
  onAnswer: (answerValue: string, questionIndex: number) => void
  onSkip: () => void
}

export function SocraticInterview({ interview, onAnswer, onSkip }: SocraticInterviewProps) {
  return (
    <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium text-amber-800">
          Quick context check ({Math.round(interview.confidence * 100)}% confidence)
        </span>
        <button
          onClick={onSkip}
          className="text-[9px] text-amber-600 hover:text-amber-800 underline"
        >
          Skip
        </button>
      </div>
      {interview.questions.map((q, qi) => (
        <div key={qi} className="mb-2 last:mb-0">
          <div className="text-xs text-gray-800 mb-1.5">{q.text}</div>
          <div className="flex flex-wrap gap-1.5">
            {q.options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onAnswer(opt.value, qi)}
                className="text-[10px] px-2.5 py-1.5 bg-white border border-amber-300 text-amber-800 rounded-md hover:bg-amber-100 hover:border-amber-400 transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
