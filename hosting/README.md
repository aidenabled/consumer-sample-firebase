# Vehicle service page

A read-only React page showing vehicle status and recent updates. No text input, trigger simulation, or notification sending controls are shown. The page refreshes automatically every five seconds while visible and reduces detail while the vehicle is moving.

See the root README for setup. `npm run dev` enables hot reload while the Firebase emulators run. Use `npm run simulate -- parked` or `moving` from a terminal to send development vehicle data.

Edit `src/App.tsx` and `src/styles.css` to create your own vehicle experience. Layout adapts to compact landscape head units and portrait displays.
