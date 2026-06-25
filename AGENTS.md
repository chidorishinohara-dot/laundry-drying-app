# Laundry Drying App Rules

- Keep the app dependency-free unless the task explicitly requires a build system.
- Use plain HTML, CSS, and JavaScript so the app can run from a local static server.
- Keep weather provider code isolated in `app.js`.
- Do not store API keys or private location data in source files.
- Optimize first for iPhone Safari: readable text, large touch targets, and installable PWA metadata.
- After changes, verify by opening the app in a browser and checking both weather loading and fallback error states when possible.
