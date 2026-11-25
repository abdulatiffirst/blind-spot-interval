export async function signInAsEmulatedGoogleUser(origin: string) {
  if (
    process.env.GCLOUD_PROJECT !== "demo-blind-spot-interval" ||
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
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-api-key",
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
