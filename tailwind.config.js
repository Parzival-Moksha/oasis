// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// UPLOADER - Tailwind Configuration
// Cyberpunk colors for the cybercity
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Lobe colors (from Parzival's connectome)
        prefrontal: '#8B5CF6', // purple
        coder: '#F97316',      // orange
        reviewer: '#3B82F6',   // blue
        tester: '#22C55E',     // green
        hacker: '#EF4444',     // red

        // Maturity levels
        para: '#4B5563',       // dim gray
        pashyanti: '#9CA3AF',  // soft
        madhyama: '#D1D5DB',   // medium
        vaikhari: '#F3F4F6',   // bright

        // UI
        void: '#000000',       // the void of cyberspace
        grid: '#1F2937',       // ground grid
        glow: '#A855F7',       // generic glow
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'spin-slow': 'spin 8s linear infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
