import colors from "tailwindcss/colors";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: colors.slate[950],
          muted: colors.zinc[900],
          raised: colors.slate[900],
          border: colors.slate[800],
        },
        accent: {
          DEFAULT: colors.emerald[400],
          strong: colors.emerald[300],
          muted: colors.emerald[900],
        },
      },
    },
  },
  plugins: [],
};
