// mic-classify.js
// Handles microphone capture, feature extraction, and classification

let audioContext;
let mediaStream;
let captureInterval;
let classifier;
let lastDogBarkTime = null;
// Set dog bark confidence threshold here
const DOG_BARK_CONFIDENCE_THRESHOLD = 0.9;
// Optional: set this to your push server base URL (https://... or http://... for local testing)
// You can also set a meta tag in index.html: <meta name="push-server-url" content="https://your-server">
let PUSH_SERVER_URL = null;
const metaPush = document.querySelector('meta[name="push-server-url"]');
if (metaPush && metaPush.content) PUSH_SERVER_URL = metaPush.content.replace(/\/$/, '');

function getPushUrl(path) {
    // path should start with '/'
    if (PUSH_SERVER_URL) return PUSH_SERVER_URL + path;
    // fallback to same origin (useful for when push server is co-located)
    return path;
}

async function initClassifier() {
    classifier = new EdgeImpulseClassifier();
    await classifier.init();
    // Initialize debug panel values
    updateDebugNotificationStatus();
    updateDebugSWStatus();
    updateDebugVisibility(document.visibilityState);
}

function updateDogBarkTimer() {
    const timerSpan = document.getElementById('dog-bark-timer');
    if (!lastDogBarkTime) {
        timerSpan.textContent = '';
        return;
    }
    const seconds = Math.floor((Date.now() - lastDogBarkTime) / 1000);
    timerSpan.textContent = ` (${seconds}s ago)`;
}

function updateLastDogBark() {
    const lastSpan = document.getElementById('last-dog-bark');
    if (lastDogBarkTime) {
        lastSpan.textContent = new Date(lastDogBarkTime).toLocaleTimeString();
    } else {
        lastSpan.textContent = 'Never';
    }
}

function updateClassificationResult(label) {
    document.getElementById('classification-result').textContent = label;
}

function updateClassificationConfidence(confidence) {
    const confidenceElem = document.getElementById('classification-confidence');
    if (confidenceElem) {
        confidenceElem.textContent = ` (Model's confidence: ${confidence.toFixed(2)})`;
    }
}

function dbgLog(msg) {
    const log = document.getElementById('dbg-log');
    if (!log) return;
    const t = new Date().toLocaleTimeString();
    log.textContent = `${t} - ${msg}\n` + log.textContent;
}

function updateDebugNotificationStatus() {
    const el = document.getElementById('dbg-notification');
    if (!el) return;
    el.textContent = (window.Notification && Notification.permission) ? Notification.permission : 'unsupported';
}

async function updateDebugSWStatus() {
    const el = document.getElementById('dbg-sw');
    if (!el) return;
    if (!('serviceWorker' in navigator)) {
        el.textContent = 'unsupported';
        return;
    }
    try {
        const reg = await navigator.serviceWorker.getRegistration();
        el.textContent = reg ? 'registered' : 'not-registered';
    } catch (ex) {
        el.textContent = 'error';
    }
}

function updateDebugVisibility(state) {
    const el = document.getElementById('dbg-visibility');
    if (!el) return;
    el.textContent = state;
}

function incrementDebugCounter(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(Number(el.textContent || '0') + 1);
}

async function testSWNotification() {
    dbgLog('testSWNotification clicked');
    const body = 'Test notification (SW)';
    try {
        // Ensure notification permission is granted
        if (window.Notification && Notification.permission !== 'granted') {
            const p = await Notification.requestPermission();
            updateDebugNotificationStatus();
            if (p !== 'granted') {
                dbgLog('Notification permission not granted');
                alert('Notification permission not granted');
                return;
            }
        }
        if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg && reg.showNotification) {
                await reg.showNotification('Test notification', { body, tag: 'test-notif' });
                dbgLog('showNotification via SW invoked');
                return;
            }
        }
        // Fallback
        new Notification('Test notification', { body });
        dbgLog('Notification constructor invoked');
    } catch (ex) {
        dbgLog('testSWNotification error: ' + ex);
        console.warn(ex);
    }
}

// --- Push subscription logic (client) ---
async function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function subscribeToPush() {
    const status = document.getElementById('push-status');
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        status.textContent = 'Push unsupported';
        return;
    }
    try {
        const res = await fetch(getPushUrl('/vapidPublicKey'));
        if (!res.ok) {
            const txt = await res.text().catch(()=>'<no-body>');
            status.textContent = 'vapidPublicKey fetch failed';
            dbgLog('vapidPublicKey fetch failed: ' + res.status + ' ' + txt.slice(0,200));
            return;
        }
        const data = await res.json().catch(e => { throw new Error('vapidPublicKey not JSON: ' + e); });
        const publicKey = data.publicKey;
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) {
            status.textContent = 'No service worker';
            return;
        }
        const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
        const resp = await fetch(getPushUrl('/subscribe'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub }) });
        if (!resp.ok) {
            const txt = await resp.text().catch(()=>'<no-body>');
            throw new Error('subscribe POST failed: ' + resp.status + ' ' + txt.slice(0,200));
        }
        status.textContent = 'Subscribed';
        dbgLog('Push subscribed');
    } catch (ex) {
        console.warn('subscribeToPush error', ex);
        status.textContent = 'Subscribe failed';
        dbgLog('Push subscribe error: ' + (ex && ex.message ? ex.message : ex));
    }
}

async function unsubscribeFromPush() {
    const status = document.getElementById('push-status');
    try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) { status.textContent = 'No service worker'; return; }
        const sub = await reg.pushManager.getSubscription();
        if (!sub) { status.textContent = 'Not subscribed'; return; }
        const resp = await fetch(getPushUrl('/unsubscribe'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub }) });
        if (!resp.ok) dbgLog('unsubscribe POST returned ' + resp.status);
        await sub.unsubscribe();
        status.textContent = 'Unsubscribed';
        dbgLog('Push unsubscribed');
    } catch (ex) {
        console.warn('unsubscribeFromPush error', ex);
        status.textContent = 'Unsubscribe failed';
    }
}

async function sendTestPush() {
    try {
        const payload = { title: 'Test push', body: 'This is a test push from server' };
        const res = await fetch(getPushUrl('/send'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload }) });
        if (!res.ok) {
            const txt = await res.text().catch(()=>'<no-body>');
            dbgLog('sendTestPush failed: ' + res.status + ' ' + txt.slice(0,200));
            return;
        }
        const json = await res.json().catch(()=>null);
        dbgLog('sendTestPush result: ' + JSON.stringify(json));
    } catch (ex) {
        dbgLog('sendTestPush error: ' + ex);
    }
}

async function checkPushServer() {
    dbgLog('checkPushServer clicked');
    try {
        const res = await fetch(getPushUrl('/vapidPublicKey'));
        const txt = await res.text();
        dbgLog('/vapidPublicKey: ' + res.status + ' ' + txt.slice(0,500));
    } catch (ex) {
        dbgLog('checkPushServer error: ' + ex);
    }
}

async function startMicrophoneCapture() {
    // Ensure AudioContext is set to 44100Hz (Impulse sample rate)
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioContext.createMediaStreamSource(mediaStream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    let audioBuffer = [];

    processor.onaudioprocess = function(e) {
        const input = e.inputBuffer.getChannelData(0);
        audioBuffer.push(...input);
        // 1 second buffer (44100 samples)
        while (audioBuffer.length >= 44100) {
            processAudioChunk(audioBuffer.slice(0, 44100));
            audioBuffer = audioBuffer.slice(44100);
        }
    };
    source.connect(processor);
    processor.connect(audioContext.destination);

    captureInterval = setInterval(updateDogBarkTimer, 1000);
    dbgLog('Capture started');
    updateDebugNotificationStatus();
    updateDebugSWStatus();

    document.getElementById('start-capture').disabled = true;
    document.getElementById('stop-capture').disabled = false;
    document.getElementById('sampling-status').textContent = 'Sampling environment sounds';
}

// Auto-send detections to push server (debounced)
let autoSendEnabled = false;
let autoSendIntervalMs = 10000; // default 10s between sends
let autoSendTimer = null;
async function scheduleAutoSend(payload) {
    if (!autoSendEnabled) return;
    // store latest payload and debounce
    window._latestAutoSendPayload = payload;
    if (autoSendTimer) return; // already scheduled
    autoSendTimer = setTimeout(async () => {
        const p = window._latestAutoSendPayload || payload;
        try {
            await fetch(getPushUrl('/send'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: p }) });
            dbgLog('Auto-send push payload');
        } catch (ex) {
            dbgLog('Auto-send failed: ' + ex);
        }
        autoSendTimer = null;
    }, autoSendIntervalMs);
}

function stopMicrophoneCapture() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    clearInterval(captureInterval);
    document.getElementById('start-capture').disabled = false;
    document.getElementById('stop-capture').disabled = true;
    document.getElementById('sampling-status').textContent = 'Not sampling environment sounds';
}

async function processAudioChunk(chunk) {
    // Use Edge Impulse built-in DSP block for feature extraction

    try {
        let res = classifier.classify(chunk);
        incrementDebugCounter('dbg-process-count');
        dbgLog('processAudioChunk called');
        // Print all class confidences to console
        res.results.forEach(r => {
            console.log(`Class: ${r.label}, Confidence: ${r.value.toFixed(4)}`);
        });
        let topResult = res.results.reduce((a, b) => a.value > b.value ? a : b);
        updateClassificationResult(topResult.label);
        updateClassificationConfidence(topResult.value);
        if (topResult.label === 'dog_bark' && topResult.value >= DOG_BARK_CONFIDENCE_THRESHOLD) {
            lastDogBarkTime = Date.now();
            updateLastDogBark();
            incrementDebugCounter('dbg-detection-count');
            if (document.hidden) incrementDebugCounter('dbg-detection-hidden-count');
            dbgLog(`Detection: ${topResult.value.toFixed(2)} (hidden=${document.hidden})`);
            console.log('Dog bark notification triggered!');
            // Show popup notification
            // Auto-send to push server if enabled (send a small payload)
            try {
                const payload = { title: 'Dog bark detected', body: `Confidence ${topResult.value.toFixed(2)}`, ts: Date.now() };
                scheduleAutoSend(payload);
            } catch (ex) { dbgLog('scheduleAutoSend error: ' + ex); }

            if (window.Notification && Notification.permission === 'granted') {
                // Prefer service worker registration for background notifications
                if (navigator.serviceWorker) {
                    try {
                        const reg = await navigator.serviceWorker.getRegistration();
                        if (reg && reg.showNotification) {
                            reg.showNotification('Dog bark detected!', { body: `Confidence: ${topResult.value.toFixed(2)}`, tag: 'dog-bark' });
                        } else {
                            new Notification('Dog bark detected!', { body: `Confidence: ${topResult.value.toFixed(2)}` });
                        }
                    } catch (ex) {
                        console.warn('SW showNotification error', ex);
                        new Notification('Dog bark detected!', { body: `Confidence: ${topResult.value.toFixed(2)}` });
                    }
                } else {
                    new Notification('Dog bark detected!', { body: `Confidence: ${topResult.value.toFixed(2)}` });
                }
            } else if (window.Notification && Notification.permission !== 'denied') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        new Notification('Dog bark detected!', { body: `Confidence: ${topResult.value.toFixed(2)}` });
                        updateDebugNotificationStatus();
                    } else {
                        alert(`Dog bark detected! Confidence: ${topResult.value.toFixed(2)}`);
                    }
                });
            } else {
                alert(`Dog bark detected! Confidence: ${topResult.value.toFixed(2)}`);
            }
        }
    } catch (ex) {
        updateClassificationResult('Error');
        updateClassificationConfidence(0);
        console.error('Classification error:', ex);
    }
    console.log('------------------');
}

window.addEventListener('DOMContentLoaded', async () => {
    // Try to register the service worker early so reg.showNotification can be used
    if ('serviceWorker' in navigator) {
        // Compute a base-relative sw url (so it works for project pages), then
        // try a fallback to /<repo>/sw.js if the first attempt 404s.
        const repoName = 'dog-bark-detector-webapp';
        const tryRegister = async (swUrl) => {
            try {
                const reg = await navigator.serviceWorker.register(swUrl);
                dbgLog('Service worker registered at ' + (reg.scope || swUrl));
                return true;
            } catch (ex) {
                // Return the exception so caller can inspect it
                return ex;
            }
        };

        // Build sw URL relative to current page path
        const pathBase = location.pathname.endsWith('/') ? location.pathname : location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1);
        const swRelative = location.origin + pathBase + 'sw.js';
        let res = await tryRegister(swRelative);
        if (res !== true) {
            // If 404, try repository-rooted path as fallback (useful for project pages hosted under /repo/)
            const message = (res && res.message) ? res.message : String(res);
            if (message.indexOf('404') !== -1 || message.indexOf('Not Found') !== -1) {
                const fallback = location.origin + '/' + repoName + '/sw.js';
                dbgLog('First SW register 404, trying fallback ' + fallback);
                const res2 = await tryRegister(fallback);
                if (res2 !== true) {
                    dbgLog('Service worker registration failed (fallback): ' + (res2 && res2.message ? res2.message : res2));
                    console.warn('SW register failed (fallback)', res2);
                }
            } else {
                dbgLog('Service worker registration failed: ' + message);
                console.warn('SW register failed', res);
            }
        }
        // Refresh the displayed SW status
        await updateDebugSWStatus();
    }
    await initClassifier();
    document.getElementById('start-capture').onclick = startMicrophoneCapture;
    document.getElementById('stop-capture').onclick = stopMicrophoneCapture;
    const btn = document.getElementById('dbg-test-notif');
    if (btn) btn.onclick = testSWNotification;
    const subBtn = document.getElementById('push-subscribe');
    if (subBtn) subBtn.onclick = subscribeToPush;
    const unsubBtn = document.getElementById('push-unsubscribe');
    if (unsubBtn) unsubBtn.onclick = unsubscribeFromPush;
    const sendBtn = document.getElementById('push-send');
    if (sendBtn) sendBtn.onclick = sendTestPush;
    const autoChk = document.getElementById('push-autosend');
    if (autoChk) autoChk.onchange = (e) => { autoSendEnabled = e.target.checked; dbgLog('Auto-send ' + (autoSendEnabled ? 'enabled' : 'disabled')); };
    const checkBtn = document.getElementById('push-check');
    if (checkBtn) checkBtn.onclick = checkPushServer;
    updateLastDogBark();
    document.getElementById('sampling-status').textContent = 'Not sampling environment sounds';
    // Visibility listener for debug panel
    document.addEventListener('visibilitychange', () => {
        updateDebugVisibility(document.visibilityState);
        dbgLog('visibilitychange -> ' + document.visibilityState);
    });
});