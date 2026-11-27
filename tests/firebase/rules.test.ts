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
const learnerDocs = [
  "topics/topic",
  "topicMaterials/topic",
  "reviewSchedules/review",
  "reviewHistory/review",
  "preferences/default",
  "memoryStates/topic",
  "calendarEvents/review",
];
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
    for (const path of learnerDocs)
      await setDoc(doc(db, `users/${uid}/${path}`), { title: "Private topic" });
    await setDoc(doc(db, "calendarConnections", uid), {
      encrypted_tokens: "synthetic-envelope",
    });
  });
});
afterAll(async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const { deleteDoc } = await import("firebase/firestore");
    for (const path of learnerDocs)
      await deleteDoc(doc(context.firestore(), `users/${uid}/${path}`));
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
  const anonymous = env.unauthenticatedContext().firestore();
  const owner = env.authenticatedContext(uid).firestore();
  const other = env.authenticatedContext("other").firestore();
  for (const path of ["", ...learnerDocs.map((item) => "/" + item)]) {
    const ref = `users/${uid}${path}`;
    await assertSucceeds(getDoc(doc(owner, ref)));
    await assertFails(getDoc(doc(anonymous, ref)));
    await assertFails(getDoc(doc(other, ref)));
    await assertFails(setDoc(doc(other, ref), { title: "Different learner" }));
  }
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

it("keeps Connect grants, tokens, registrations and confirmations server-only", async () => {
  const db = env.authenticatedContext(uid).firestore();
  for (const name of [
    "mcpAccounts",
    "mcpActions",
    "mcpClients",
    "mcpEphemeral",
  ]) {
    const ref = doc(db, name, uid);
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { uid }));
  }
});

it("blocks owner reads after requesting deletion", async () => {
  const member = uid + "-deleting";
  const path = `users/${member}`;
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, path), { deleting: true });
    await setDoc(doc(db, path + "/topics/private"), { title: "Frozen topic" });
  });
  const db = env.authenticatedContext(member).firestore();
  await assertFails(getDoc(doc(db, path)));
  await assertFails(getDoc(doc(db, path + "/topics/private")));
});
