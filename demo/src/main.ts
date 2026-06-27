import { Call } from '@opwebrtc/core';
import type { BackgroundBlur } from '@opwebrtc/core/blur';

// Puente entre la librería agnóstica y el DOM. El core nunca toca estos nodos.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const prejoin = $('prejoin');
const callView = $('call');
const localVideo = $<HTMLVideoElement>('local');
const remoteVideo = $<HTMLVideoElement>('remote');
const stateBadge = $('state');
const statsBadge = $('stats');

let call: Call | undefined;
let blur: BackgroundBlur | undefined;
let cameraTrack: MediaStreamTrack | undefined; // track real de cámara (para revertir blur)
let blurOn = false;
let camOn = true;
let micOn = true;

const SIGNALING = `ws://${location.hostname}:8080`;
const ICE_ENDPOINT = `http://${location.hostname}:8080/ice`;

// ── Prejoin: poblar dispositivos (requiere permiso para ver labels) ──────────
async function loadDevices(): Promise<void> {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch {
    /* el usuario decidirá al entrar */
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  fillSelect($<HTMLSelectElement>('pre-cam'), devices, 'videoinput');
  fillSelect($<HTMLSelectElement>('pre-mic'), devices, 'audioinput');
}

function fillSelect(sel: HTMLSelectElement, list: MediaDeviceInfo[], kind: MediaDeviceKind): void {
  sel.innerHTML = '';
  for (const d of list.filter((x) => x.kind === kind)) {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || `${kind} ${sel.length + 1}`;
    sel.appendChild(o);
  }
}

// ── Entrar a la llamada ──────────────────────────────────────────────────────
$('join').onclick = async () => {
  const room = $<HTMLInputElement>('room').value.trim() || 'sala-demo';
  const token = $<HTMLInputElement>('token').value.trim() || undefined;
  const camId = $<HTMLSelectElement>('pre-cam').value;
  const micId = $<HTMLSelectElement>('pre-mic').value;

  call = new Call({
    signalingUrl: SIGNALING,
    token,
    audit: true,
    media: {
      video: camId ? { deviceId: { exact: camId }, width: { ideal: 1280 }, height: { ideal: 720 } } : true,
      audio: micId ? { deviceId: { exact: micId }, echoCancellation: true, noiseSuppression: true } : true,
    },
    // TURN efímero: el core pide credenciales frescas al backend antes de conectar.
    iceServersProvider: async () => {
      try {
        const r = await fetch(ICE_ENDPOINT);
        return (await r.json()).iceServers;
      } catch {
        return [{ urls: 'stun:stun.l.google.com:19302' }];
      }
    },
  });

  call.on('localStream', (s) => {
    if (!blurOn) localVideo.srcObject = s;
    cameraTrack = s.getVideoTracks()[0];
  });
  call.on('remoteStream', (s) => (remoteVideo.srcObject = s));
  call.on('stateChange', (s) => {
    stateBadge.textContent = s;
    stateBadge.style.color = s === 'connected' ? '#3fb950' : s === 'failed' ? '#f85149' : '';
  });
  call.on('screenShare', (active) => $('screen').classList.toggle('active', active));
  call.on('error', (e) => console.error('[opWebRTC]', e.message));
  call.on('audit', (e) => console.debug('[audit]', e.type, e.data ?? ''));

  await call.join(room);

  prejoin.classList.add('hidden');
  callView.classList.remove('hidden');

  await populateLiveSelectors();
  startStatsPolling();
};

// Selectores de cambio de dispositivo en vivo (ya con permiso => con labels).
async function populateLiveSelectors(): Promise<void> {
  if (!call) return;
  const { cameras, microphones } = await call.getDevices();
  const camSel = $<HTMLSelectElement>('cam-select');
  const micSel = $<HTMLSelectElement>('mic-select');
  fillSelect(camSel, cameras, 'videoinput');
  fillSelect(micSel, microphones, 'audioinput');
  camSel.onchange = () => call?.switchCamera(camSel.value);
  micSel.onchange = () => call?.switchMicrophone(micSel.value);
}

// ── Controles ────────────────────────────────────────────────────────────────
$('mic').onclick = () => {
  micOn = !micOn;
  call?.toggleMic(micOn);
  $('mic').classList.toggle('off', !micOn);
};

$('cam').onclick = () => {
  camOn = !camOn;
  call?.toggleCamera(camOn);
  $('cam').classList.toggle('off', !camOn);
};

$('screen').onclick = async () => {
  if (!call) return;
  if (call.isScreenSharing) await call.stopScreenShare();
  else await call.startScreenShare();
};

$('blur').onclick = async () => {
  if (!call || !cameraTrack) return;
  const btn = $('blur');
  if (blurOn) {
    blur?.stop();
    blur = undefined;
    blurOn = false;
    await call.replaceOutgoingVideo(cameraTrack);
    localVideo.srcObject = new MediaStream([cameraTrack]);
    btn.classList.remove('active');
  } else {
    btn.textContent = '⏳';
    // Carga diferida: MediaPipe solo se descarga al activar blur.
    const { BackgroundBlur } = await import('@opwebrtc/core/blur');
    blur = new BackgroundBlur({ blurRadius: 12 });
    const blurred = await blur.process(cameraTrack);
    await call.replaceOutgoingVideo(blurred);
    localVideo.srcObject = new MediaStream([blurred]);
    blurOn = true;
    btn.textContent = '🌫️';
    btn.classList.add('active');
  }
};

$('hangup').onclick = async () => {
  blur?.stop();
  await call?.hangup();
  call = undefined;
  blurOn = false;
  callView.classList.add('hidden');
  prejoin.classList.remove('hidden');
  localVideo.srcObject = remoteVideo.srcObject = null;
};

// ── Stats en vivo ─────────────────────────────────────────────────────────────
function startStatsPolling(): void {
  const tick = async () => {
    if (!call || call.currentState === 'closed') return;
    const s = await call.getStats();
    statsBadge.textContent = s.rtt != null ? `RTT ${Math.round(s.rtt)}ms · jitter ${Math.round(s.jitter ?? 0)}ms` : '…';
    setTimeout(tick, 2000);
  };
  tick();
}

void loadDevices();
