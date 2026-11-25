export async function signInAsEmulatedGoogleUser(origin: string) {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
  const allowed = {
    "demo-blind-spot-interval": ["127.0.0.1:9099", "localhost:9099"],
    "demo-blind-spot-benchmark": ["127.0.0.1:9199"],
  };
  const project = process.env.GCLOUD_PROJECT as keyof typeof allowed;
  if (
    !allowed[project]?.includes(authHost) ||
    !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)
  )
    throw new Error(
      "Connect fixtures require the demo emulator project and a loopback origin",
    );
  const sub = crypto.randomUUID(),
    email = sub + "@example.invalid";
  const credential =
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    ) +
    "." +
    Buffer.from(
      JSON.stringify({
        sub,
        email,
        email_verified: true,
        name: "Test Learner",
        iss: "https://accounts.google.com",
        aud: "demo-client",
      }),
    ).toString("base64url") +
    ".";
  const response = await fetch(
    "http://" +
      authHost +
      "/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-api-key",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        postBody: new URLSearchParams({
          id_token: credential,
          providerId: "google.com",
        }).toString(),
        requestUri: origin,
        returnSecureToken: true,
      }),
    },
  );
  if (!response.ok) throw new Error("Demo Google sign-in failed");
  const { localId, idToken, refreshToken } = await response.json();
  return {
    uid: localId as string,
    token: idToken as string,
    refreshToken: refreshToken as string,
    email,
  };
}
