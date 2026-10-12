import {createHash, createPublicKey, timingSafeEqual, verify} from "node:crypto";

export class InputError extends Error {}
export type JsonObject = Record<string, unknown>;

export function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError("Expected a JSON object.");
  }
  return value as JsonObject;
}

export function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new InputError(`${name} must be a non-empty string of at most ${max} characters.`);
  }
  return value.trim();
}

export function identifier(value: unknown, name: string): string {
  const result = text(value, name, 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw new InputError(`${name} contains unsupported characters.`);
  return result;
}

export function boundedBody(value: unknown): JsonObject {
  const body = object(value);
  if (Buffer.byteLength(JSON.stringify(body)) > 65536) throw new InputError("Request exceeds 64 KB.");
  return body;
}

export interface TriggerMessage {
  id: string;
  vin: string;
  data: JsonObject;
}

// Accept the AiDEN messages envelope without coupling the starter to a vehicle signal.
export function triggerMessages(value: unknown): TriggerMessage[] {
  const body = boundedBody(value);
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100) {
    throw new InputError("messages must contain between 1 and 100 entries.");
  }
  return body.messages.map((value) => {
    const data = object(value);
    const standard = object(data.standard);
    return {id: text(data.id, "id", 128), vin: identifier(standard.infoVin, "standard.infoVin"), data};
  });
}

export function recordId(vin: string, messageId: string): string {
  return createHash("sha256").update(JSON.stringify([vin, messageId])).digest("hex");
}

export function matchesSecret(received: string, expected: string): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface Launch {vin: string; expiry: number; nonce: string; signature: string}

export function launchParameters(query: JsonObject, headerVin?: string, now = Date.now()): Launch {
  const vin = identifier(headerVin ?? query.vin, "vin");
  if (headerVin && query.vin && query.vin !== headerVin) throw new InputError("VIN parameters do not match.");
  if (typeof query.expiry !== "string" || !/^\d+$/.test(query.expiry)) throw new InputError("Invalid expiry.");
  const expiry = Number(query.expiry);
  const seconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(expiry) || expiry <= seconds || expiry > seconds + 300) {
    throw new InputError("Launch must expire within the next five minutes.");
  }
  return {vin, expiry, nonce: text(query.nonce, "nonce", 128), signature: text(query.signature, "signature", 1024)};
}

export function verifyLaunch(launch: Launch, base64PublicKey: string): boolean {
  const key = createPublicKey({key: Buffer.from(base64PublicKey, "base64"), format: "der", type: "spki"});
  const payload = `vin_number=${launch.vin}&expiry=${launch.expiry}&nonce=${launch.nonce}`;
  return verify("RSA-SHA256", Buffer.from(payload), key, Buffer.from(launch.signature, "base64"));
}
