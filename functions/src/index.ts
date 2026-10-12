import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {FieldValue, getFirestore, Timestamp} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {setGlobalOptions} from "firebase-functions/v2";
import {onRequest} from "firebase-functions/v2/https";
import type {Request, Response} from "express";
import * as logger from "firebase-functions/logger";
import {actOnTrigger, vehicleState} from "./actions";
import {AidenNotifications} from "./notifications";
import {
  InputError, launchParameters, matchesSecret, recordId, triggerMessages, verifyLaunch,
} from "./validation";
import type {TriggerMessage} from "./validation";

initializeApp();
setGlobalOptions({region: "us-central1", maxInstances: 10});
const db = getFirestore();
const triggerSecret = defineSecret("TRIGGER_SECRET");
const aidenPassword = defineSecret("AIDEN_PASSWORD");
let notifications: AidenNotifications | undefined;
const isEmulator = () => process.env.FUNCTIONS_EMULATOR === "true";
const activity = (uid: string) => db.collection("users").doc(uid).collection("activity");

function headers(response: Response) {
  response.set("Cache-Control", "no-store");
  response.set("Referrer-Policy", "no-referrer");
}

function fail(response: Response, error: unknown) {
  if (error instanceof InputError) {
    response.status(400).json({error: error.message});
  } else {
    // Do not log incoming vehicle data, credentials, launch URLs, or tokens.
    logger.error("Request failed", {error: error instanceof Error ? error.message : "Unknown error"});
    response.status(500).json({error: "Unable to complete the request."});
  }
}

async function saveTrigger(message: TriggerMessage): Promise<boolean> {
  const ref = activity(message.vin).doc(recordId(message.vin, message.id));
  const vehicle = db.collection("users").doc(message.vin);
  return db.runTransaction(async (transaction) => {
    const [existing, previous] = await Promise.all([transaction.get(ref), transaction.get(vehicle)]);
    if (existing.exists) return false;
    const state = vehicleState(message);
    const shouldNotify = state === "parked" && previous.data()?.vehicleState !== "parked";
    transaction.create(ref, {
      type: "trigger", title: actOnTrigger(message), messageId: message.id,
      vehicleState: state, data: message.data, receivedAt: FieldValue.serverTimestamp(),
      notification: shouldNotify ? "pending" : "not-needed",
    });
    if (state !== "unknown") transaction.set(vehicle, {vehicleState: state}, {merge: true});
    return true;
  });
}

async function deliverNotification(message: TriggerMessage): Promise<boolean> {
  const ref = activity(message.vin).doc(recordId(message.vin, message.id));
  const claim = await db.runTransaction(async (transaction) => {
    const data = (await transaction.get(ref)).data();
    if (!data || !["pending", "failed", "sending"].includes(data.notification)) return "done";
    if (data.leaseUntil?.toMillis() > Date.now()) return "busy";
    transaction.update(ref, {notification: "sending", leaseUntil: Timestamp.fromMillis(Date.now() + 60000)});
    return "claimed";
  });
  if (claim === "done") return true;
  if (claim === "busy") return false;
  try {
    if (!isEmulator()) {
      notifications ??= new AidenNotifications({
        baseUrl: process.env.AIDEN_URL || "", username: process.env.AIDEN_USERNAME || "",
        password: aidenPassword.value(), serviceUrl: process.env.SERVICE_URL || "",
        title: process.env.NOTIFICATION_TITLE || "Your service is ready",
        message: process.env.NOTIFICATION_MESSAGE || "Your vehicle is parked. Open your service to see the latest update.",
      });
      await notifications.send(message.vin, message.id);
    }
    await ref.update({notification: isEmulator() ? "simulated" : "sent", leaseUntil: FieldValue.delete()});
    return true;
  } catch {
    await ref.update({notification: "failed", leaseUntil: FieldValue.delete()});
    logger.warn("Notification delivery failed; the trigger can be retried.");
    return false;
  }
}

// Configure your AiDEN delivery to send Authorization: Bearer <TRIGGER_SECRET>.
// Replace this adapter if your integration uses a different delivery authentication contract.
export const trigger = onRequest({secrets: [triggerSecret, aidenPassword], invoker: "public"}, async (request, response) => {
  headers(response);
  if (request.method !== "POST") {
    response.set("Allow", "POST").status(405).json({error: "Use POST."});
    return;
  }
  const expected = isEmulator() ? (process.env.TRIGGER_SECRET || "local-demo-trigger-secret") : triggerSecret.value();
  if (!matchesSecret(request.get("Authorization") || "", `Bearer ${expected}`) || !expected) {
    response.status(401).json({error: "Unauthorized."});
    return;
  }
  try {
    // Validate the complete batch before writing any records.
    const messages = triggerMessages(request.body);
    const success: string[] = [];
    const failure: string[] = [];
    const duplicates: string[] = [];
    for (const message of messages) {
      try {
        if (!await saveTrigger(message)) duplicates.push(message.id);
        if (await deliverNotification(message)) success.push(message.id);
        else failure.push(message.id);
      } catch {
        failure.push(message.id);
      }
    }
    response.status(failure.length ? 503 : 200).json({status: "Completed", success, failure, duplicates});
  } catch (error) { fail(response, error); }
});

async function userId(request: Request): Promise<string | undefined> {
  const header = request.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return undefined;
  try { return (await getAuth().verifyIdToken(header.slice(7), true)).uid; }
  catch { return undefined; }
}

// The UI's API: identity always comes from a verified ID token, never from the request body.
export const api = onRequest({invoker: "public"}, async (request, response) => {
  headers(response);
  const path = request.path.replace(/^\/api(?=\/)/, "").replace(/\/$/, "");
  if (path === "/demo-session" && request.method === "GET" && isEmulator()) {
    response.json({token: await getAuth().createCustomToken("DEMO_VEHICLE")});
    return;
  }
  const uid = await userId(request);
  if (!uid) { response.status(401).json({error: "Open this service from your vehicle notification."}); return; }
  try {
    if (path === "/activity" && request.method === "GET") {
      const [snapshot, vehicle] = await Promise.all([
        activity(uid).orderBy("receivedAt", "desc").limit(20).get(), db.collection("users").doc(uid).get(),
      ]);
      response.json({vehicleState: vehicle.data()?.vehicleState || "unknown", items: snapshot.docs.map((doc) => {
        const data = doc.data();
        return {id: doc.id, ...data, receivedAt: data.receivedAt?.toDate().toISOString() ?? null};
      })});
    } else {
      response.status(404).json({error: "Endpoint not found."});
    }
  } catch (error) { fail(response, error); }
});

// Preserve AiDEN's RSA-SHA256 signed launch protocol; consume each nonce atomically.
export const authorize = onRequest({invoker: "public"}, async (request, response) => {
  headers(response);
  if (request.method !== "GET") {
    response.set("Allow", "GET").status(405).json({error: "Use GET."});
    return;
  }
  try {
    const launch = launchParameters(request.query, request.get("x-aiden-vin"));
    const key = process.env.AIDEN_PUBLIC_KEY;
    if (!key) { response.status(503).json({error: "Signed launch is not configured."}); return; }
    if (!verifyLaunch(launch, key)) { response.status(401).json({error: "Invalid signature."}); return; }
    const nonce = db.collection("nonces").doc(recordId("launch", launch.nonce));
    const accepted = await db.runTransaction(async (transaction) => {
      if ((await transaction.get(nonce)).exists) return false;
      transaction.create(nonce, {expiresAt: Timestamp.fromMillis(launch.expiry * 1000)});
      return true;
    });
    if (!accepted) { response.status(409).json({error: "Launch has already been used."}); return; }
    const token = await getAuth().createCustomToken(launch.vin);
    // The fragment is stripped by the UI before loading any authenticated content.
    response.redirect(303, `/auth#token=${encodeURIComponent(token)}`);
  } catch (error) { fail(response, error); }
});
