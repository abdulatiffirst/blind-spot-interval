import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
// Official Google SDK distribution fallback when the Firebase storage CDN is unavailable.
// Never replace Firebase's expected checksum: verify the SDK component against Google's manifest.
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const root = join(tmpdir(), "blindspot-firebase");
mkdirSync(root, { recursive: true });
function run(command, args) {
  const r = spawnSync(command, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(command + " failed");
}
run("curl", [
  "--fail",
  "--location",
  "https://dl.google.com/dl/cloudsdk/channels/rapid/components-v580.0.0.json",
  "--output",
  root + "/components.json",
]);
const component = JSON.parse(
  readFileSync(root + "/components.json", "utf8"),
).components.find((c) => c.id === "cloud-firestore-emulator");
if (
  !component ||
  !/^components\/[A-Za-z0-9_.-]+\.tar\.gz$/.test(component.data.source) ||
  !/^[a-f0-9]{64}$/.test(component.data.checksum)
)
  throw new Error("Invalid Google SDK manifest");
const archive = root + "/firestore-sdk.tar.gz";
run("curl", [
  "--fail",
  "--location",
  "https://dl.google.com/dl/cloudsdk/channels/rapid/" + component.data.source,
  "--output",
  archive,
]);
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
if (sha(archive) !== component.data.checksum)
  throw new Error("Google SDK checksum verification failed");
const destination = root + "/google-sdk";
mkdirSync(destination, { recursive: true });
run("tar", [
  "--extract",
  "--gzip",
  "--file",
  archive,
  "--directory",
  destination,
  "--no-same-owner",
]);
const jar =
  destination +
  "/platform/cloud-firestore-emulator/cloud-firestore-emulator.jar";
const launcher = root + "/firestore-launcher.jar";
const lines = [
  "Manifest-Version: 1.0",
  "Main-Class: com.google.cloud.datastore.emulator.firestore.CloudFirestore",
  "Class-Path: " + pathToFileURL(jar).href,
];
let manifest = "";
for (let line of lines) {
  while (line.length > 70) {
    manifest += line.slice(0, 70) + "\r\n";
    line = " " + line.slice(70);
  }
  manifest += line + "\r\n";
}
manifest += "\r\n";
writeFileSync(root + "/launcher.mf", manifest);
run("python3", [
  "-c",
  "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w');z.writestr('META-INF/MANIFEST.MF',open(sys.argv[2]).read());z.close()",
  launcher,
  root + "/launcher.mf",
]);
writeFileSync(
  root + "/verified-emulator.json",
  JSON.stringify({
    jar: launcher,
    sha256: sha(launcher),
    dependencies: [{ jar, sha256: sha(jar) }],
    version: component.version.version_string,
    source: component.data.source,
    archiveSha256: component.data.checksum,
  }),
);
console.log(
  "Verified official Google SDK Firestore emulator " +
    component.version.version_string,
);
