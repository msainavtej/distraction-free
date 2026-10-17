/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        nord: {
          ink: "#2E3440",    // text, primary buttons
          mute: "#4C566A",   // secondary text
          line: "#D8DEE9",   // borders
          wash: "#ECEFF4",   // subtle fills
          accent: "#5E81AC", // focus, active item
        },
      },
    },
  },
  plugins: [],
};
