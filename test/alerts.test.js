import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAlertMessage,
  createServiceAccountJwt,
  sendFcmAlert,
} from "../scripts/send-alert.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf-8");

test("buildAlertMessage formats topic, target routing, and Android channel metadata", () => {
  const cgpaPayload = buildAlertMessage({
    title: "SGPA Published",
    body: "Odd semester grades are live.",
    target: "cgpa",
    refresh: true,
  });
  assert.deepEqual(cgpaPayload, {
    message: {
      topic: "alerts",
      notification: {
        title: "SGPA Published",
        body: "Odd semester grades are live.",
      },
      data: {
        tab: "marks",
        mode: "cgpa",
        refresh: "1",
      },
      android: {
        priority: "high",
        notification: {
          channel_id: "alerts",
          icon: "ic_notification",
          color: "#1a237e",
        },
      },
    },
  });

  const tokenPayload = buildAlertMessage({
    title: "Test ping",
    body: "Single device check",
    target: "none",
    refresh: true,
    token: "device-fcm-token",
  });
  assert.equal(tokenPayload.message.token, "device-fcm-token");
  assert.equal("topic" in tokenPayload.message, false);
  assert.equal("data" in tokenPayload.message, false);

  assert.throws(() => buildAlertMessage({ title: " ", body: "ok" }), /title is required/);
  assert.throws(() => buildAlertMessage({ title: "ok", body: "" }), /body is required/);
  assert.throws(() => buildAlertMessage({ title: "ok", body: "ok", target: "evil" }), /Invalid target/);
  assert.throws(() => buildAlertMessage({ title: "ok", body: "ok", topic: "bad topic!" }), /Invalid FCM topic/);
});

test("createServiceAccountJwt signs a verifiable RS256 assertion", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  const jwt = createServiceAccountJwt({
    project_id: "lazyportal-test",
    client_email: "fcm@lazyportal-test.iam.gserviceaccount.com",
    private_key: privatePem,
  }, 1_700_000_000);

  const [headerB64, payloadB64, sigB64] = jwt.split(".");
  assert.ok(headerB64 && payloadB64 && sigB64);
  const verified = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${headerB64}.${payloadB64}`),
    publicKey,
    Buffer.from(sigB64, "base64url"),
  );
  assert.equal(verified, true);
  const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  assert.equal(claims.iss, "fcm@lazyportal-test.iam.gserviceaccount.com");
  assert.equal(claims.scope, "https://www.googleapis.com/auth/firebase.messaging");
  assert.equal(claims.exp, 1_700_003_600);
});

test("sendFcmAlert handles dryRun and exchanges token + calls FCM v1 endpoint", async () => {
  const dry = await sendFcmAlert({
    title: "Marks out",
    body: "T2 marks uploaded",
    dryRun: true,
    fetchImpl: () => {
      throw new Error("fetch must not run during dryRun");
    },
  });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.payload.message.topic, "alerts");

  await assert.rejects(
    () => sendFcmAlert({ title: "Marks out", body: "Body", serviceAccountJson: "" }),
    /Missing FIREBASE_SERVICE_ACCOUNT_JSON/,
  );

  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sa = JSON.stringify({
    project_id: "lazyportal-prod",
    client_email: "fcm@lazyportal-prod.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });

  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "ya29.mock-token" }), { status: 200 });
    }
    if (url === "https://fcm.googleapis.com/v1/projects/lazyportal-prod/messages:send") {
      return new Response(JSON.stringify({ name: "projects/lazyportal-prod/messages/123" }), { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const sent = await sendFcmAlert({
    title: "Exam Schedule",
    body: "End-sem datesheet released.",
    target: "exams",
    refresh: true,
    serviceAccountJson: sa,
    fetchImpl: fakeFetch,
  });
  assert.equal(sent.dryRun, false);
  assert.equal(sent.response.name, "projects/lazyportal-prod/messages/123");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers.Authorization, "Bearer ya29.mock-token");
  const sentBody = JSON.parse(calls[1].init.body);
  assert.deepEqual(sentBody.message.data, { tab: "exams", refresh: "1" });
});

test("Android alerts plugin, manifest, CI secret, and send workflow are wired safely", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /<uses-permission\s+android:name="android\.permission\.POST_NOTIFICATIONS"\s*\/>/);
  assert.match(manifest, /android:name="\.AlertsMessagingService"/);
  assert.match(manifest, /com\.google\.firebase\.messaging\.default_notification_icon/);

  const activity = read("android/app/src/main/java/com/lazyportal/juet/MainActivity.java");
  assert.match(activity, /registerPlugin\(AlertsPlugin\.class\)/);

  const androidGitignore = read("android/.gitignore");
  assert.match(androidGitignore, /^google-services\.json$/m);

  const apkWorkflow = read(".github/workflows/build-apk.yml");
  assert.match(apkWorkflow, /GOOGLE_SERVICES_JSON_BASE64/);

  const sendWorkflow = read(".github/workflows/send-alert.yml");
  assert.match(sendWorkflow, /workflow_dispatch:/);
  assert.match(sendWorkflow, /FIREBASE_SERVICE_ACCOUNT_JSON/);
  assert.match(sendWorkflow, /node scripts\/send-alert\.mjs/);
});
