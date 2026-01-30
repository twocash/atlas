/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./sidepanel.tsx", "./sidepanel/**/*.tsx"],
  theme: {
    extend: {
      colors: {
        gray: require('tailwindcss/colors').slate,
        atlas: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#278bd8", // Primary action blue
          600: "#0284c7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      boxShadow: {
        'soft': '0 2px 8px -2px rgba(0, 0, 0, 0.05), 0 1px 4px -1px rgba(0, 0, 0, 0.01)',
      },
    },
  },
  plugins: [],
}
