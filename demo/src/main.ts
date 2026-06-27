import { Call } from '@opwebrtc/core';

// El "puente" entre la librería agnóstica y el DOM vive aquí, en la app.
// El core nunca toca estos elementos: solo emite streams y eventos.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const localVideo = $<HTMLVideoElement>('local');
const remoteVideo = $<HTMLVideoElement>('remote');
const stateLabel = $<HTMLSpanElement>('state');
const roomInput = $<HTMLInputElement>('room');

let call: Call | undefined;
let camOn = true;
let micOn = true;

$('join').onclick = async () => {
  if (call) return;

  call = new Call({
    signalingUrl: `ws://${location.hostname}:8080`,
    audit: true,
  });

  call.on('localStream', (s) => (localVideo.srcObject = s));
  call.on('remoteStream', (s) => (remoteVideo.srcObject = s));
  call.on('stateChange', (s) => (stateLabel.textContent = s));
  call.on('error', (e) => console.error('[opWebRTC]', e.message));
  call.on('audit', (e) => console.debug('[audit]', e.type, e.data ?? ''));

  await call.join(roomInput.value.trim() || 'sala-demo');
};

$('cam').onclick = () => {
  camOn = !camOn;
  call?.toggleCamera(camOn);
};

$('mic').onclick = () => {
  micOn = !micOn;
  call?.toggleMic(micOn);
};

$('hangup').onclick = async () => {
  await call?.hangup();
  call = undefined;
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
};
