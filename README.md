# Running your impulse using WebAssembly in the browser

For more information see the documentation at https://docs.edgeimpulse.com/docs/through-webassembly-browser

This repository runs an Edge Impulse model in-browser (WebAssembly) to detect dog barks using the microphone.

```
Local development

1. Start the static server:

```powershell
python server.py
```

Then open http://localhost:8082 in a browser to see the application.
 
Push notifications (development)

This repo includes a minimal Node push server (`push-server.js`) using `web-push` for development and testing.

1. Install Node dependencies:

```powershell
npm install
```

2. Start the push server (defaults to port 3000):

```powershell
npm start
```

3. For testing from a mobile device, expose the push-server with HTTPS using ngrok (or deploy it on an HTTPS-enabled server):

```powershell
ngrok http 3000
```

4. Open the webapp (served over HTTPS or GitHub Pages). Use the "Push demo" controls to Subscribe / Unsubscribe and to Send a test push via the server.

Notes

- The server generates VAPID keys automatically and stores them in `vapid.json`.
- Subscriptions are saved to `subscriptions.json` (file-based demo). Use a proper DB for production.
- Web Push requires HTTPS. Use ngrok or deploy to a secure host for testing.

If you want, I can add a small serverless example (AWS Lambda/Netlify function) instead of the Node server.
