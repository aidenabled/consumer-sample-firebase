# Consumer service starter

A small customer starter built with React, TypeScript, Firebase Hosting, Functions v2, Authentication, and Firestore. Keep the UI simple and business logic generic.

- `functions/src/actions.ts`: vehicle-driven actions and parking-state decisions; deterministic inside transactions.
- `functions/src/index.ts`: signed launch, trigger receiver, authenticated page API.
- `functions/src/validation.ts`: boundary validation and signature helpers.
- `functions/src/notifications.ts`: backend AiDEN authentication and notification delivery.
- `hosting/src/App.tsx`: read-only vehicle status and automatic activity updates.
- Use the demo project for local development; do not deploy during routine changes.
- Never add credentials, customer branding, unsafe authorization shortcuts, or production demo endpoints.
- Checks: `npm run lint`, `npm test`, `npm run test:integration`.

Never add driver text entry or on-screen vehicle-event simulation. Test events enter through the trigger endpoint.
