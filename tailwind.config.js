/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      colors: {
        ink: '#05070d',
        night: '#0b0f19',
        panel: '#111724',
        panel2: '#151d2d',
        line: 'rgba(255,255,255,0.11)',
        mint: '#49f2ba',
        coral: '#ff7066',
        amber: '#f5b74c',
        sky: '#58c8ff',
        violet: '#a78bfa'
      },
      boxShadow: {
        halo: '0 0 46px rgba(73, 242, 186, 0.18)',
        panel: '0 22px 70px rgba(0,0,0,0.42)'
      }
    }
  },
  plugins: []
};
