import React from "react"

interface AtlasLogoProps {
  className?: string
}

/**
 * Atlas Brand Logo - "North Star A" design
 * Navigation arrow + meridian arc conveys global precision
 */
export function AtlasLogo({ className = "w-6 h-6" }: AtlasLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Navigation Arrow (North) */}
      <path d="M12 2 L12 14 M12 2 L8 6 M12 2 L16 6" />

      {/* Meridian Arc (Global) */}
      <path d="M4 12 A8 8 0 0 1 20 12" />
      <path d="M6 16 A8 8 0 0 0 18 16" />

      {/* Base Line */}
      <line x1="6" y1="22" x2="18" y2="22" strokeWidth="2.5" />
    </svg>
  )
}
