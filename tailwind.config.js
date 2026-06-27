/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0e0f13',
        panel: '#16181e',
        panel2: '#1c1f28',
        line: '#262a33',
        txt: '#e7e9f0',
        dim: '#9aa0b0',
        faint: '#6b7180',
        accent: '#5b8def',
      },
      fontFamily: {
        sans: ['Pretendard', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
