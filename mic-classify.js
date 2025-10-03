// mic-classify.js
// Handles microphone capture, feature extraction, and classification

let audioContext;
let mediaStream;
let captureInterval;
let classifier;
let lastDogBarkTime = null;
// Set dog bark confidence threshold here
const DOG_BARK_CONFIDENCE_THRESHOLD = 0.9;

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
    await initClassifier();
    document.getElementById('start-capture').onclick = startMicrophoneCapture;
    document.getElementById('stop-capture').onclick = stopMicrophoneCapture;
    updateLastDogBark();
    document.getElementById('sampling-status').textContent = 'Not sampling environment sounds';
    // Visibility listener for debug panel
    document.addEventListener('visibilitychange', () => {
        updateDebugVisibility(document.visibilityState);
        dbgLog('visibilitychange -> ' + document.visibilityState);
    });
});