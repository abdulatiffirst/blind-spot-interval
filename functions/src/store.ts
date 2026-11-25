import { getApps, initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  type DocumentData,
  type Transaction,
} from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
if (!getApps().length) initializeApp();
export const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
export const auth = getAuth();
export type RecordData = DocumentData;
export const userRef = (uid: string) => db.collection("users").doc(uid);
export const collection = (uid: string, name: string) =>
  userRef(uid).collection(name);
export function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
export async function get(
  uid: string,
  name: string,
  id: string,
): Promise<RecordData | null> {
  const ref = collection(uid, name).doc(id);
  const snap = await ref.get();
  return snap.exists ? { ...snap.data()!, id: snap.id } : null;
}
export async function all(uid: string, name: string): Promise<RecordData[]> {
  const rows = await collection(uid, name).get();
  return rows.docs.map((d) => ({ ...d.data()!, id: d.id }));
}
export type MutationGuard = (
  tx: Transaction,
) => Promise<(result: unknown) => void>;

// Every domain mutation reads and advances the owner document. Conflicting transactions retry,
// including queries that saw no pending sessions, so two concurrent topics cannot double-book.
export async function mutate<T>(
  uid: string,
  fn: (
    tx: Transaction,
    read: (name: string, id: string) => Promise<RecordData | null>,
    rows: (
      name: string,
      query?: (
        ref: FirebaseFirestore.CollectionReference,
      ) => FirebaseFirestore.Query,
    ) => Promise<RecordData[]>,
    root: RecordData,
  ) => Promise<T>,
  guard?: MutationGuard,
) {
  return db.runTransaction(async (tx) => {
    const rootSnap = await tx.get(userRef(uid));
    if (!rootSnap.exists) fail(401, "Account not initialized");
    const read = async (name: string, id: string) => {
      const s = await tx.get(collection(uid, name).doc(id));
      return s.exists ? { ...s.data()!, id: s.id } : null;
    };
    const rows = async (
      name: string,
      query?: (
        ref: FirebaseFirestore.CollectionReference,
      ) => FirebaseFirestore.Query,
    ) => {
      const ref = collection(uid, name);
      const s = await tx.get(query ? query(ref) : ref);
      return s.docs.map((d) => ({ ...d.data()!, id: d.id }));
    };
    const finish = await guard?.(tx);
    const result = await fn(tx, read, rows, rootSnap.data()!);
    finish?.(result);
    tx.update(userRef(uid), { revision: (rootSnap.data()!.revision ?? 0) + 1 });
    return result;
  });
}
