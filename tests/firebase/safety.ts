// Fail before importing Admin SDK or tests: never infer production destinations.
if (
  process.env.GCLOUD_PROJECT !== "demo-blind-spot-interval" ||
  !["127.0.0.1:8080", "localhost:8080"].includes(
    process.env.FIRESTORE_EMULATOR_HOST ?? "",
  ) ||
  !["127.0.0.1:9099", "localhost:9099"].includes(
    process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "",
  )
)
  throw new Error(
    "Firebase tests require the explicit demo Auth and Firestore emulators",
  );
