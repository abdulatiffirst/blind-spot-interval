import { FirebaseError, initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type Auth,
  type User,
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
  const auth = getAuth(app);
  if (usesEmulators)
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
  client = auth;
  return auth;
}
export function observeAuth(
  listener: (user: User | null) => void,
  onError: (error: Error) => void,
) {
  return onAuthStateChanged(firebaseAuth(), listener, onError);
}
export async function authToken(user?: User) {
  if (!usesFirebase) return null;
  if (user) return user.getIdToken();
  const auth = firebaseAuth();
  await auth.authStateReady();
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}
export function signInErrorMessage(error: unknown) {
  switch (error instanceof FirebaseError && error.code) {
    case "auth/popup-blocked":
      return "popupBlocked";
    case "auth/popup-closed-by-user":
      return "popupClosed";
    case "auth/timeout":
      return "authTimeout";
    case "auth/network-request-failed":
      return "authNetwork";
    case "auth/web-storage-unsupported":
      return "authStorage";
    case "auth/unauthorized-domain":
      return "authDomain";
    case "auth/account-exists-with-different-credential":
      return "authExists";
    default:
      return "authIncomplete";
  }
}
export async function login() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const popup = signInWithPopup(firebaseAuth(), provider);
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new FirebaseError("auth/timeout", "Google Sign-In timed out."));
      }, 120_000);
    });
    const { user } = await Promise.race([popup, deadline]);
    if (import.meta.env.DEV)
      console.info("Firebase Google Sign-In completed", { signedIn: !!user });
    return user;
  } catch (error) {
    if (import.meta.env.DEV)
      console.error("Firebase Google Sign-In failed", {
        code: error instanceof FirebaseError ? error.code : "unknown",
        message: signInErrorMessage(error),
      });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
export async function logout() {
  await signOut(firebaseAuth());
}
