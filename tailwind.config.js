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
        // Đỏ HÀ TIÊN — GIỮ LẠI cho nhận diện thương hiệu (chữ "HÀ TIÊN", biểu trưng).
        // Điểm nhấn giao diện đã chuyển sang `eco` bên dưới; đừng dùng `hatien` cho
        // nút/nhãn/chip mới, nếu không tông đỏ lại lan ra khắp trang.
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
        // Xanh lá an toàn — môi trường: tông điểm nhấn chính của giao diện.
        eco: {
          50: '#eefbf3',
          100: '#d6f5e3',
          200: '#aeebc8',
          300: '#7adda6',
          400: '#45c87f',
          500: '#16A34A',
          600: '#12883e',
          700: '#0f6b32',
          800: '#0b5026',
          900: '#07351a',
        },
      },
      boxShadow: {
        glow: '0 20px 60px -20px rgba(0, 85, 164, 0.45)',
        'glow-red': '0 18px 50px -16px rgba(226, 35, 26, 0.5)',
        'glow-green': '0 18px 50px -16px rgba(22, 163, 74, 0.5)',
      },
      backgroundImage: {
        'grid-white': 'linear-gradient(rgba(255,255,255,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.07) 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
}
