if (
  process.env.GCLOUD_PROJECT !== "demo-blind-spot-benchmark" ||
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8180" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9199"
)
  throw new Error("Run the benchmark with the isolated demo emulator runner");
