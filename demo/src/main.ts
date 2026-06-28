import { Call } from '@opwebrtc/core';
import type { BackgroundBlur } from '@opwebrtc/core/blur';

// Puente entre la librería agnóstica y el DOM. El core nunca toca estos nodos.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const prejoin = $('prejoin');
const callView = $('call');
const localVideo = $<HTMLVideoElement>('local');
const remoteVideo = $<HTMLVideoElement>('remote');
const screenView = $<HTMLVideoElement>('screenView');
const stage = $('stage');
const placeholder = $('placeholder');
const stateBadge = $('state');
const statsBadge = $('stats');
const kickBtn = $('kick');
const adminBadge = $('admin-badge');

let call: Call | undefined;
let blur: BackgroundBlur | undefined;
let cameraTrack: MediaStreamTrack | undefined; // track real de cámara (para revertir blur)
let blurOn = false;
let camOn = true;
let micOn = true;
let localShare = false;
let remoteShare = false;
let hasRemote = false;

// Layout estilo Meet: si alguien comparte, pantalla grande + participantes a la derecha.
function updateStage(): void {
  stage.classList.toggle('sharing', localShare || remoteShare);
  // has-remote controla que el tile del otro participante exista o no.
  stage.classList.toggle('has-remote', hasRemote);
  // El placeholder solo cuando no hay remoto y no estoy presentando.
  placeholder.classList.toggle('hidden', hasRemote || localShare);
}

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
  call.on('remoteStream', (s) => {
    remoteVideo.srcObject = s;
    hasRemote = true;
    // El admin puede expulsar mientras haya alguien a quien expulsar.
    kickBtn.classList.toggle('hidden', !call!.isAdmin);
    updateStage();
  });
  // El otro se fue: limpiar su vista y quitar su tile (sin frame congelado).
  call.on('remoteLeft', () => {
    remoteVideo.srcObject = null;
    hasRemote = false;
    remoteShare = false;
    kickBtn.classList.add('hidden');
    updateStage();
  });
  // Me expulsaron: el core ya colgó; solo reseteo la UI y aviso.
  call.on('kicked', () => {
    blur?.stop();
    resetToPrejoin();
    setTimeout(() => alert('El administrador te sacó de la sala.'), 50);
  });
  // Yo comparto pantalla: previsualizo mi propia pantalla como vista principal.
  call.on('screenShare', (active, s) => {
    localShare = active;
    if (active && s) screenView.srcObject = s;
    $('screen').classList.toggle('active', active);
    updateStage();
  });
  // El otro comparte (o deja de compartir) pantalla.
  call.on('remoteScreen', (s) => {
    remoteShare = Boolean(s);
    if (s) screenView.srcObject = s;
    updateStage();
  });
  call.on('stateChange', (s) => {
    stateBadge.textContent = s;
    stateBadge.style.color = s === 'connected' ? '#3fb950' : s === 'failed' ? '#f85149' : '';
  });
  call.on('error', (e) => console.error('[opWebRTC]', e.message));
  call.on('audit', (e) => {
    console.debug('[audit]', e.type, e.data ?? '');
    // Al unirse ya sabemos si somos admin (lo trae el mensaje 'joined').
    if (e.type === 'joined') adminBadge.classList.toggle('hidden', !call!.isAdmin);
  });

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
    btn.classList.add('loading');
    // Carga diferida: MediaPipe solo se descarga al activar blur.
    const { BackgroundBlur } = await import('@opwebrtc/core/blur');
    blur = new BackgroundBlur({ blurRadius: 12 });
    const blurred = await blur.process(cameraTrack);
    await call.replaceOutgoingVideo(blurred);
    localVideo.srcObject = new MediaStream([blurred]);
    blurOn = true;
    btn.classList.remove('loading');
    btn.classList.add('active');
  }
};

kickBtn.onclick = () => call?.kickParticipant();

function resetToPrejoin(): void {
  blurOn = localShare = remoteShare = hasRemote = false;
  updateStage();
  kickBtn.classList.add('hidden');
  adminBadge.classList.add('hidden');
  callView.classList.add('hidden');
  prejoin.classList.remove('hidden');
  localVideo.srcObject = remoteVideo.srcObject = screenView.srcObject = null;
  call = undefined;
}

$('hangup').onclick = async () => {
  blur?.stop();
  await call?.hangup();
  resetToPrejoin();
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
