// Minimal push server using express and web-push
const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const fs = require('fs');

const SUBSCRIPTIONS_FILE = './subscriptions.json';

const app = express();
app.use(cors());
app.use(express.json());

// Simple request logger for debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  if (req.method !== 'GET') console.log('Body:', JSON.stringify(req.body).slice(0,200));
  next();
});

let vapidKeys;
const VAPID_FILE = './vapid.json';
if (fs.existsSync(VAPID_FILE)) {
  vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE));
} else {
  vapidKeys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys));
  console.log('Generated VAPID keys and saved to', VAPID_FILE);
}

webpush.setVapidDetails('mailto:example@example.com', vapidKeys.publicKey, vapidKeys.privateKey);

function loadSubs() {
  try {
    return JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE));
  } catch (e) {
    return [];
  }
}
function saveSubs(subs) {
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subs));
}

app.get('/vapidPublicKey', (req, res) => {
  console.log('GET /vapidPublicKey -> returning publicKey');
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/subscribe', (req, res) => {
  const sub = req.body.subscription;
  console.log('POST /subscribe payload length', req.body ? JSON.stringify(req.body).length : 0);
  if (!sub) return res.status(400).json({ error: 'subscription missing' });
  const subs = loadSubs();
  subs.push(sub);
  saveSubs(subs);
  res.json({ ok: true });
});

app.post('/unsubscribe', (req, res) => {
  const sub = req.body.subscription;
  console.log('POST /unsubscribe payload length', req.body ? JSON.stringify(req.body).length : 0);
  if (!sub) return res.status(400).json({ error: 'subscription missing' });
  let subs = loadSubs();
  subs = subs.filter(s => JSON.stringify(s) !== JSON.stringify(sub));
  saveSubs(subs);
  res.json({ ok: true });
});

app.post('/send', async (req, res) => {
  console.log('POST /send payload length', req.body ? JSON.stringify(req.body).length : 0);
  const payload = req.body.payload || { title: 'Dog bark', body: 'A dog bark was detected' };
  const subs = loadSubs();
  const results = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s, JSON.stringify(payload));
      results.push({ sub: s, status: 'ok' });
    } catch (e) {
      results.push({ sub: s, status: 'error', reason: e.message });
    }
  }));
  res.json({ results });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Push server listening on port', PORT));
