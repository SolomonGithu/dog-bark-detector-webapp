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

    // Request notification permission on a user gesture (start button)
    if (window.Notification && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        try {
            await Notification.requestPermission();
        } catch (ex) {
            console.warn('Notification permission request failed', ex);
        }
    }

    // Try to register a service worker if available. This helps for showing
    // notifications when the page is in the background (or for future push support).
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(() => console.log('Service worker registered'))
            .catch((e) => console.warn('Service worker registration failed', e));
    }

    captureInterval = setInterval(updateDogBarkTimer, 1000);

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

function processAudioChunk(chunk) {
    // Use Edge Impulse built-in DSP block for feature extraction

    try {
        let res = classifier.classify(chunk);
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
            console.log('Dog bark notification triggered!');
            // Show popup notification. Prefer using the service worker registration
            // showNotification method where available so the notification can show
            // even if the page is backgrounded.
            (async () => {
                const body = `Confidence: ${topResult.value.toFixed(2)}`;
                try {
                    if (window.Notification && Notification.permission === 'granted') {
                        if (navigator.serviceWorker) {
                            const reg = await navigator.serviceWorker.getRegistration();
                            if (reg && reg.showNotification) {
                                reg.showNotification('Dog bark detected!', { body, tag: 'dog-bark' });
                                return;
                            }
                        }
                        // Fallback to the simple constructor
                        new Notification('Dog bark detected!', { body });
                    } else if (window.Notification && Notification.permission !== 'denied') {
                        // In practice we already requested permission on start, but
                        // still handle this case defensively.
                        const permission = await Notification.requestPermission();
                        if (permission === 'granted') {
                            new Notification('Dog bark detected!', { body });
                        } else {
                            alert(`Dog bark detected! ${body}`);
                        }
                    } else {
                        alert(`Dog bark detected! ${body}`);
                    }
                } catch (ex) {
                    console.warn('Notification error', ex);
                    alert(`Dog bark detected! ${body}`);
                }
            })();
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
});