/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Bộ nhận diện thương hiệu VICEM Hà Tiên
        vicem: {
          50: '#e6eff7',
          100: '#cce0ef',
          200: '#99c1df',
          300: '#66a2cf',
          400: '#3383bf',
          500: '#0055A4', // xanh dương VICEM
          600: '#004a91',
          700: '#003a72',
          800: '#002b55',
          900: '#001c3a',
        },
        hatien: {
          50: '#fdeceb',
          100: '#fbd5d3',
          200: '#f6aba6',
          300: '#f0817a',
          400: '#eb544a',
          500: '#E2231A', // đỏ HÀ TIÊN
          600: '#c41d15',
          700: '#a01812',
        },
      },
      boxShadow: {
        glow: '0 20px 60px -20px rgba(0, 85, 164, 0.45)',
        'glow-red': '0 18px 50px -16px rgba(226, 35, 26, 0.5)',
      },
      backgroundImage: {
        'grid-white': 'linear-gradient(rgba(255,255,255,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.07) 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
}
