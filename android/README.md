# Android app

The app is a Compose client of the REST API.

Development API:
- Android Emulator: `http://10.0.2.2:3000/`
- Physical device: replace the base URL in `Api.kt` with the development machine's reachable LAN address.

The current UI covers login, role-aware home, parent child selection, book/unit/lesson browsing, question answering and progress reports.

HTTP cleartext is enabled only to support the local development API. Use HTTPS for deployment.
