#!/usr/bin/env node
/**
 * Send a campus broadcast via Firebase Cloud Messaging HTTP v1 API.
 * Uses Node's built-in crypto + fetch (zero external dependencies).
 */
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

export const DEFAULT_TOPIC = "alerts";
export const VALID_TARGETS = new Set(["marks", "cgpa", "exams", "attendance", "calendar", "more", "none"]);
const TOPIC_PATTERN = /^[A-Za-z0-9-_.~%]{1,128}$/;

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function cleanText(value, label, maxLen) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maxLen) throw new Error(`${label} must be at most ${maxLen} characters.`);
  return text;
}

export function buildAlertMessage({
  title,
  body,
  target = "marks",
  refresh = true,
  topic = DEFAULT_TOPIC,
  token = "",
}) {
  const cleanTitle = cleanText(title, "title", 120);
  const cleanBody = cleanText(body, "body", 500);
  const cleanTarget = typeof target === "string" && target.trim() ? target.trim() : "marks";
  if (!VALID_TARGETS.has(cleanTarget)) {
    throw new Error(`Invalid target "${cleanTarget}". Expected one of: ${[...VALID_TARGETS].join(", ")}`);
  }

  const cleanToken = typeof token === "string" ? token.trim() : "";
  const cleanTopic = typeof topic === "string" && topic.trim() ? topic.trim() : DEFAULT_TOPIC;
  if (!cleanToken && !TOPIC_PATTERN.test(cleanTopic)) {
    throw new Error(`Invalid FCM topic "${cleanTopic}".`);
  }

  const data = {};
  if (cleanTarget === "cgpa") {
    data.tab = "marks";
    data.mode = "cgpa";
  } else if (cleanTarget === "marks") {
    data.tab = "marks";
    data.mode = "marks";
  } else if (cleanTarget !== "none") {
    data.tab = cleanTarget;
  }
  if (refresh && cleanTarget !== "none") {
    data.refresh = "1";
  }

  return {
    message: {
      ...(cleanToken ? { token: cleanToken } : { topic: cleanTopic }),
      notification: {
        title: cleanTitle,
        body: cleanBody,
      },
      ...(Object.keys(data).length > 0 ? { data } : {}),
      android: {
        priority: "high",
        notification: {
          channel_id: "alerts",
          icon: "ic_notification",
          color: "#1a237e",
        },
      },
    },
  };
}

export function parseServiceAccount(rawJson) {
  let parsed;
  try {
    parsed = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
  } catch (err) {
    throw new Error(`Invalid FIREBASE_SERVICE_ACCOUNT_JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must be a JSON object.");
  }
  for (const field of ["project_id", "client_email", "private_key"]) {
    if (typeof parsed[field] !== "string" || !parsed[field].trim()) {
      throw new Error(`Service account JSON is missing "${field}".`);
    }
  }
  return parsed;
}

export function createServiceAccountJwt(serviceAccount, nowSec = Math.floor(Date.now() / 1000)) {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec,
    exp: nowSec + 3600,
  }));
  const unsigned = `${header}.${claimSet}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), serviceAccount.private_key).toString("base64url");
  return `${unsigned}.${signature}`;
}

async function fetchAccessToken(serviceAccount, fetchImpl) {
  const assertion = createServiceAccountJwt(serviceAccount);
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`OAuth token exchange failed (${res.status}): ${json.error_description || json.error || "unknown error"}`);
  }
  return json.access_token;
}

export async function sendFcmAlert({
  title,
  body,
  target = "marks",
  refresh = true,
  topic = DEFAULT_TOPIC,
  token = "",
  dryRun = false,
  serviceAccountJson,
  fetchImpl = fetch,
}) {
  const payload = buildAlertMessage({ title, body, target, refresh, topic, token });
  if (dryRun) {
    return { dryRun: true, payload };
  }
  if (!serviceAccountJson || !String(serviceAccountJson).trim()) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON secret.");
  }
  const serviceAccount = parseServiceAccount(serviceAccountJson);
  const accessToken = await fetchAccessToken(serviceAccount, fetchImpl);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/messages:send`;
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = result?.error?.message || `HTTP ${res.status}`;
    throw new Error(`FCM send failed: ${errMsg}`);
  }
  return { dryRun: false, payload, response: result };
}

async function main() {
  const env = process.env;
  const dryRun = env.ALERT_DRY_RUN === "true" || env.ALERT_DRY_RUN === "1";
  const refresh = env.ALERT_REFRESH !== "false" && env.ALERT_REFRESH !== "0";
  const result = await sendFcmAlert({
    title: env.ALERT_TITLE,
    body: env.ALERT_BODY,
    target: env.ALERT_TARGET || "marks",
    refresh,
    topic: env.ALERT_TOPIC || DEFAULT_TOPIC,
    token: env.ALERT_TOKEN || "",
    dryRun,
    serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON,
  });
  if (result.dryRun) {
    console.log("Dry run — payload validated (nothing sent):");
    console.log(JSON.stringify(result.payload, null, 2));
  } else {
    console.log(`Notification sent: ${result.response?.name || "ok"}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
