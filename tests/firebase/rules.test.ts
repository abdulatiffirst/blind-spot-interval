import { beforeAll, afterAll, it, expect } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, collection, getDocs } from "firebase/firestore";
import { readFile } from "node:fs/promises";
let env: RulesTestEnvironment;
const uid = "rules-" + crypto.randomUUID();
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-blind-spot-interval",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: await readFile("firestore.rules", "utf8"),
    },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", uid), { id: uid });
    await setDoc(doc(db, `users/${uid}/topics/topic`), {
      title: "Private topic",
    });
    await setDoc(doc(db, "calendarConnections", uid), {
      encrypted_tokens: "synthetic-envelope",
    });
  });
});
afterAll(async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const { deleteDoc } = await import("firebase/firestore");
    await deleteDoc(doc(context.firestore(), `users/${uid}/topics/topic`));
    await deleteDoc(doc(context.firestore(), "users", uid));
    await deleteDoc(doc(context.firestore(), "calendarConnections", uid));
  });
  await env.cleanup();
});
it("allows owner reads and queries", async () => {
  const db = env.authenticatedContext(uid).firestore();
  expect(
    (await assertSucceeds(getDoc(doc(db, `users/${uid}/topics/topic`)))).data()!
      .title,
  ).toBe("Private topic");
  await assertSucceeds(getDocs(collection(db, `users/${uid}/topics`)));
});
it("rejects anonymous and cross-user reads", async () => {
  await assertFails(
    getDoc(
      doc(
        env.unauthenticatedContext().firestore(),
        `users/${uid}/topics/topic`,
      ),
    ),
  );
  await assertFails(
    getDoc(
      doc(
        env.authenticatedContext("other").firestore(),
        `users/${uid}/topics/topic`,
      ),
    ),
  );
});
it("denies all direct client writes, including forged memory and review documents", async () => {
  const db = env.authenticatedContext(uid).firestore();
  for (const name of [
    "topics",
    "memoryStates",
    "reviewHistory",
    "reviewSchedules",
    "preferences",
  ])
    await assertFails(
      setDoc(doc(db, `users/${uid}/${name}/forged`), {
        user_id: uid,
        rating: 5,
      }),
    );
});
it("denies owner access to Calendar secrets, jobs and OAuth state", async () => {
  const db = env.authenticatedContext(uid).firestore();
  for (const path of [
    `calendarConnections/${uid}`,
    "syncJobs/job",
    "oauthStates/state",
    "syncLocks/lock",
  ])
    await assertFails(getDoc(doc(db, path)));
});
