import type { CapacitorConfig } from "@capacitor/cli";

// The iOS app loads the production site; server functions and auth stay on Vercel.
// Change PRODUCTION_URL if the app moves to a custom domain, then run `npx cap sync ios`.
const PRODUCTION_URL = "https://word-ace-deck.vercel.app";

const config: CapacitorConfig = {
  // Must match the Bundle ID registered in App Store Connect.
  appId: "com.yelzhastem.memora",
  appName: "Flashlark",
  webDir: "ios-shell",
  server: {
    url: PRODUCTION_URL,
    cleartext: false,
    // Local page shown when the site cannot be reached (no connection).
    errorPath: "offline.html",
  },
  ios: {
    contentInset: "automatic",
    backgroundColor: "#ffffff",
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: "#ffffff",
      showSpinner: false,
    },
    LocalNotifications: {
      iconColor: "#7132f5",
    },
  },
};

export default config;
