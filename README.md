# AiDEN consumer service starter

A small MIT-licensed Firebase project customers can copy and extend. It serves a React page, receives AiDEN trigger messages, collects vehicle data, and sends a notification when the vehicle parks. No customer-specific service or credentials are required for the local demo.

## Run locally

Requires Node.js 22, npm, and Java 21 for the Firebase emulators.

```sh
npm ci
cp functions/.secret.local.sample functions/.secret.local
npm start
```

Open **http://localhost:5002**. The local page connects automatically as `DEMO_VEHICLE`. Send car data from a second terminal:

```sh
npm run simulate -- parked
npm run simulate -- moving
npm run simulate -- parked
```

The read-only page updates automatically within five seconds. There are no forms or on-screen event buttons. In production, the car/AiDEN data flow sends these trigger messages; the terminal script is only a development tool. Local notifications are marked `simulated` and never contact AiDEN. The emulator UI is at **http://localhost:4000**. Data is ephemeral and is cleared when the emulators stop. No Firebase login or cloud project is needed; local commands use `demo-consumer-sample`.

For frontend hot reload, leave the emulators running and run `npm run dev` in another terminal. Vite proxies API calls to the Hosting emulator. Client authentication connects to the local Auth emulator.

## What is included

| Example | Behavior | Extension point |
| --- | --- | --- |
| Serve a page | Responsive vehicle status and three recent updates; no typing | `hosting/src/App.tsx`, `hosting/src/styles.css` |
| Act on a trigger | Parking transitions send an AiDEN notification | `functions/src/actions.ts` |
| Collect data | Vehicle trigger payloads stored automatically in Firestore | `functions/src/index.ts`, `functions/src/validation.ts` |
| Signed launch | AiDEN RSA-SHA256 signature exchanged for Firebase authentication | `GET /authorize` |

The backend uses Firebase Functions v2 in `us-central1`. Firestore and Authentication are the only backend services; the frontend does not read or write Firestore directly.

## API

### Trigger delivery

`POST /aiden/trigger` accepts a non-empty `messages` array (up to 100 messages and 64 KB per request). Each message needs an `id` and `standard.infoVin`; all other JSON fields are retained as example collected data. VINs must use letters, digits, `_`, or `-`, with a maximum length of 128. Message IDs can be up to 128 characters.

```sh
curl http://localhost:5002/aiden/trigger \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer local-demo-trigger-secret' \
  -d '{"messages":[{"id":"example-1","standard":{"infoVin":"DEMO_VEHICLE","gearSelection":"GEAR_PARK"},"general":{"gps":{"single":{"location":{"lat":59.33,"lon":18.06}}}}}]}'
```

Production requires `Authorization: Bearer <TRIGGER_SECRET>`. Configure this header with your trigger sender, or adapt the authentication check to your AiDEN delivery contract. The local secret is a demo value only and must never be used in production.

Responses include `success`, `failure`, and `duplicates`, all containing message IDs. Retrying the same vehicle/message ID does not create a second activity or repeat the sample action. Invalid batches return 400 before any writes. Storage failures return 503 with per-message results; retries are safe.

### Trigger-based notifications

Vehicle signals drive the entire flow: **incoming trigger → parking transition → AiDEN notification → signed launch → read-only service page**. A parking signal is `GEAR_PARK` or `parkingBrakeOn=true`, provided reported speed is not positive. Drive/reverse gear or a positive speed marks movement. Updates without those signals preserve the last known state.

The first parking event, and each transition from movement back to parking, reserves a notification alongside the activity record in one Firestore transaction. Further parked updates do not notify again. `actOnTrigger` and `vehicleState` in `functions/src/actions.ts` are the customer extension points.

The backend authenticates at `/shared/api/v1/auth/login`, then posts `title`, `message`, `vin_numbers`, `url`, and `url_authentication_enabled=true` to `/consumer/api/v1/send-notification`. These fields follow the original AiDEN integration contract. The URL points to this service's `/authorize` endpoint. Configure AiDEN's URL authentication to attach the signed VIN/expiry/nonce/signature launch parameters expected below; confirm this with your AiDEN integration when connecting a real account.

Credentials stay on the backend. Passwords use Firebase Secret Manager. HTTP calls have a 10-second timeout, token caching, and one token refresh on an explicit 401. A record moves through `pending` → `sending` → `sent` (or `failed`); local emulators use `simulated`. A 60-second lease prevents concurrent trigger retries from sending the same notification simultaneously. Failed delivery returns 503, so the sender must retry the original message. Its stored activity is reused and delivery resumes.

Notification delivery is **at least once**: an upstream timeout or process crash after AiDEN accepted a send can cause another notification on retry. The API contract does not provide a confirmed idempotency mechanism. There is no standalone scheduled retry worker; retries are driven by trigger redelivery.

### Page API

All `/api/*` calls require a Firebase ID token in the Bearer header. The backend derives the owner from that token.

- `GET /api/activity` returns the caller's latest 20 records.
- `GET /api/demo-session` returns a development custom token for `DEMO_VEHICLE` in the Functions emulator only. Production requires a signed launch.

`GET /api/activity` also returns the last known `vehicleState`. The page polls automatically while visible and shows a reduced status view during movement. It displays no notification sending controls or text inputs.

Activity lives at `users/{uid}/activity/{id}`. Records include `type`, `title`, `vehicleState`, `notification`, `receivedAt`, `messageId`, and original trigger `data`. `users/{uid}` stores the last recognized vehicle state. A signed-in VIN sees its own records. Direct Firestore client access is denied. Choose your own signal allowlist, data retention, and deletion behavior before collecting real customer data.

### AiDEN signed launch

Configure your own Base64 DER/SPKI RSA public key as `AIDEN_PUBLIC_KEY` in `functions/.env.<project-id>`. The launch endpoint accepts `vin` (or `x-aiden-vin`), Unix-seconds `expiry`, `nonce`, and Base64 `signature`. It verifies RSA-SHA256 over this exact string:

```text
vin_number=<vin>&expiry=<expiry>&nonce=<nonce>
```

Launch expiry must be in the next five minutes. Each nonce is consumed atomically and cannot be reused. Successful launches redirect to `/auth#token=…`; the frontend immediately removes the fragment and exchanges the custom token for Firebase authentication. There is no unsigned production login. The emulator-only vehicle session is only a development convenience.

Nonce records at `nonces/{hash}` include `expiresAt`; optionally enable Firestore TTL on that field to remove expired records. Coordinate the five-minute expiry window with your sender if your integration needs a different duration.

## Use your own Firebase project

1. Create a Firebase project, enable Authentication, create a Firestore database, and register a web app. Enable billing for deploying Cloud Functions. Production uses custom authentication; anonymous sign-in does not need to be enabled.
2. Copy `hosting/.env.sample` to `hosting/.env.production.local`. Set `VITE_USE_EMULATORS=false` and replace the project ID, API key, auth domain, and app ID with your Firebase web configuration. `VITE_*` values are public browser configuration; never put backend secrets there.
3. Copy `functions/.env.sample` to `functions/.env.<project-id>` and set your AiDEN public key, `AIDEN_URL`, `AIDEN_USERNAME`, and `SERVICE_URL`. Customize `NOTIFICATION_TITLE` and `NOTIFICATION_MESSAGE`. Set your AiDEN password and a strong trigger secret using Firebase Secret Manager:

   ```sh
   npx firebase login
   npx firebase use --add YOUR_PROJECT_ID
   npx firebase functions:secrets:set TRIGGER_SECRET --project YOUR_PROJECT_ID
   npx firebase functions:secrets:set AIDEN_PASSWORD --project YOUR_PROJECT_ID
   ```

4. Run the checks below, then `npm run deploy -- --project YOUR_PROJECT_ID`. Deployment includes Hosting, Functions, Firestore rules and indexes. `npm run deploy` rejects emulator configuration.
5. Register the deployed `/authorize` and `/aiden/trigger` URLs with your AiDEN integration and configure the trigger authentication header.

Project aliases and environment files are ignored by Git. No automatic cloud deployment workflow is included; CI runs validation only. Changing region requires updating both the Functions global options and Hosting rewrites in `firebase.json`.

## Checks

Run `npm run clean` to remove build output, emulator caches/logs, and TypeScript build caches. Dependencies and local configuration are preserved. Stop running emulators before cleaning.

```sh
npm run lint
npm test
npm run test:integration
```

Unit tests cover validation, signatures, and the AiDEN notification adapter using mocked HTTP responses. Live notification delivery requires customer credentials and is not exercised by these tests. Integration tests use local emulators to check page serving, removed UI action endpoints, trigger deduplication, parking-transition notification decisions, user isolation, denied client Firestore access, and signed launch/replay behavior. The integration runner temporarily supplies a generated signing key and test secret, then restores local configuration. Stop any running emulators before this command.

Firebase references: [Functions configuration](https://firebase.google.com/docs/functions/config-env), [emulator connections](https://firebase.google.com/docs/emulator-suite/connect_functions), and [Hosting rewrites](https://firebase.google.com/docs/hosting/functions).

## License

[MIT](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md) for development and contributions.
