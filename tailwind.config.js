/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canaletto: {
          bg: '#0b0710',
          panel: '#16101a',
          panel2: '#1d1522',
          border: '#3c2c40',
          bordergold: '#5c4a2a',
          cream: '#f3e9d8',
          gold: '#e9ac3f',
          goldsoft: '#c99a4d',
          magenta: '#ef2f9a',
          lavender: '#a998ad',
        },
      },
      fontFamily: {
        condensed: ['Arial Narrow', 'Oswald', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
