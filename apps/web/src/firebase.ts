import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type Auth,
} from "firebase/auth";
export const usesFirebase = import.meta.env.VITE_BACKEND !== "legacy";
export const usesEmulators =
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true" ||
  (import.meta.env.DEV &&
    import.meta.env.VITE_USE_FIREBASE_EMULATORS !== "false");
let client: Auth | undefined;
export function firebaseAuth() {
  if (client) return client;
  const projectId =
      import.meta.env.VITE_FIREBASE_PROJECT_ID ??
      (usesEmulators ? "demo-blind-spot-interval" : undefined),
    apiKey =
      import.meta.env.VITE_FIREBASE_API_KEY ??
      (usesEmulators ? "demo-api-key" : undefined);
  if (!projectId || !apiKey)
    throw new Error(
      "Firebase public configuration is missing. See docs/FIREBASE_SETUP.md.",
    );
  if (usesEmulators && !projectId.startsWith("demo-"))
    throw new Error("Emulator mode requires a demo project ID");
  const app =
    getApps()[0] ??
    initializeApp({
      projectId,
      apiKey,
      authDomain:
        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ??
        `${projectId}.firebaseapp.com`,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    });
  client = getAuth(app);
  if (usesEmulators)
    connectAuthEmulator(client, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
  return client;
}
export function observeAuth(listener: () => void) {
  if (!usesFirebase) {
    listener();
    return () => {};
  }
  try {
    return onAuthStateChanged(firebaseAuth(), listener);
  } catch {
    listener();
    return () => {};
  }
}
export async function authToken() {
  if (!usesFirebase) return null;
  const auth = firebaseAuth();
  await auth.authStateReady();
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}
export async function login() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  await signInWithPopup(firebaseAuth(), provider);
}
export async function logout() {
  await signOut(firebaseAuth());
}
