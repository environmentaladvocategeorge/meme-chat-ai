/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        "background-secondary": "var(--color-background-secondary)",
        "background-muted": "var(--color-background-muted)",

        foreground: "var(--color-foreground)",
        "foreground-secondary": "var(--color-foreground-secondary)",
        "foreground-muted": "var(--color-foreground-muted)",

        card: "var(--color-card)",
        "card-foreground": "var(--color-card-foreground)",
        "card-muted": "var(--color-card-muted)",
        "card-pressed": "var(--color-card-pressed)",

        border: "var(--color-border)",
        "border-strong": "var(--color-border-strong)",
        input: "var(--color-input)",
        ring: "var(--color-ring)",

        primary: "var(--color-primary)",
        "primary-foreground": "var(--color-primary-foreground)",
        "primary-muted": "var(--color-primary-muted)",
        "primary-subtle": "var(--color-primary-subtle)",

        secondary: "var(--color-secondary)",
        "secondary-foreground": "var(--color-secondary-foreground)",
        tertiary: "var(--color-tertiary)",
        "tertiary-foreground": "var(--color-tertiary-foreground)",

        success: "var(--color-success)",
        "success-muted": "var(--color-success-muted)",
        warning: "var(--color-warning)",
        "warning-muted": "var(--color-warning-muted)",
        error: "var(--color-error)",
        "error-muted": "var(--color-error-muted)",
        info: "var(--color-info)",
        "info-muted": "var(--color-info-muted)",

        tab: "var(--color-tab)",
        "tab-active": "var(--color-tab-active)",
        "progress-track": "var(--color-progress-track)",
        overlay: "var(--color-overlay)",
      },
      borderRadius: {
        // Playful but never balloon-y. Scales with surface size: small
        // controls stay readable, hero surfaces get more breathing room,
        // chat bubbles get their own token so the chat UI reads as chat.
        xs: "6px",
        sm: "10px",
        md: "14px",
        control: "14px",
        card: "16px",
        "card-lg": "20px",
        hero: "24px",
        bubble: "22px",
        dock: "999px",
        pill: "999px",
      },
      fontFamily: {
        sans: ["Poppins-Regular"],
        display: ["Fredoka"],
      },
      fontSize: {
        display: ["28px", { lineHeight: "34px", fontWeight: "600" }],
        "title-xl": ["23px", { lineHeight: "29px", fontWeight: "600" }],
        "title-lg": ["20px", { lineHeight: "26px", fontWeight: "600" }],
        "title-md": ["17px", { lineHeight: "23px", fontWeight: "600" }],
        "title-sm": ["15px", { lineHeight: "20px", fontWeight: "600" }],
        body: ["13px", { lineHeight: "20px", fontWeight: "400" }],
        "body-lg": ["14px", { lineHeight: "21px", fontWeight: "400" }],
        "body-sm": ["12px", { lineHeight: "17px", fontWeight: "500" }],
        label: ["12px", { lineHeight: "16px", fontWeight: "600" }],
        micro: ["10px", { lineHeight: "13px", fontWeight: "600" }],
      },
    },
  },
  plugins: [],
};
