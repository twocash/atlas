import React from "react"

interface SegmentIconProps {
  segment: string
  className?: string
}

/**
 * Segment Icon System - Lucide-style 2px stroke SVGs
 * Replaces emojis with consistent, professional icons
 */
export function SegmentIcon({ segment, className = "w-5 h-5" }: SegmentIconProps) {
  const iconProps = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  }

  switch (segment.toLowerCase()) {
    case "academic":
      // Graduation cap
      return (
        <svg {...iconProps}>
          <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
          <path d="M6 12v5c3 3 9 3 12 0v-5" />
        </svg>
      )

    case "technical":
      // CPU/Chip
      return (
        <svg {...iconProps}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <path d="M9 2v2M15 2v2M9 20v2M15 20v2" />
          <path d="M2 9h2M2 15h2M20 9h2M20 15h2" />
        </svg>
      )

    case "enterprise":
      // Skyscraper/Building
      return (
        <svg {...iconProps}>
          <rect x="4" y="2" width="16" height="20" rx="2" />
          <path d="M9 22V18h6v4" />
          <path d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01M12 6h.01M12 10h.01M12 14h.01" />
        </svg>
      )

    case "influencer":
      // Broadcast/Lightning bolt (creative energy)
      return (
        <svg {...iconProps}>
          <path d="M13 2 L3 14 h8 l-1 8 L20 10 h-8 l1-8z" />
        </svg>
      )

    default:
      // Fallback: generic circle
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="10" />
        </svg>
      )
  }
}
