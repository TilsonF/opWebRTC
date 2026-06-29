import { ref, shallowRef, onScopeDispose, type Ref, type ShallowRef } from 'vue';
import { Call, type CallConfig, type CallState } from '@opwebrtc/core';

export interface ChatMsg {
  from: 'me' | 'them';
  text: string;
}

export interface UseCall {
  /** Instancia subyacente, por si necesitas algo avanzado. */
  call: Call;
  state: Ref<CallState>;
  localStream: ShallowRef<MediaStream | undefined>;
  remoteStream: ShallowRef<MediaStream | undefined>;
  remoteScreen: ShallowRef<MediaStream | undefined>;
  screenSharing: Ref<boolean>;
  isAdmin: Ref<boolean>;
  peerName: Ref<string | undefined>;
  messages: Ref<ChatMsg[]>;
  pendingApproval: Ref<string | undefined>;
  waiting: Ref<boolean>;
  error: Ref<Error | undefined>;
  join: (room: string) => Promise<void>;
  hangup: () => Promise<void>;
  toggleCamera: (on: boolean) => void;
  toggleMic: (on: boolean) => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
  sendChat: (text: string) => void;
  admit: () => void;
  reject: () => void;
  kick: () => void;
}

/**
 * Composable que envuelve `Call` y expone su estado como refs de Vue.
 * Conecta los streams a un <video> con `videoEl.srcObject = stream`.
 */
export function useCall(config: CallConfig): UseCall {
  const call = new Call(config);

  const state = ref<CallState>('idle');
  const localStream = shallowRef<MediaStream>();
  const remoteStream = shallowRef<MediaStream>();
  const remoteScreen = shallowRef<MediaStream>();
  const screenSharing = ref(false);
  const isAdmin = ref(false);
  const peerName = ref<string>();
  const messages = ref<ChatMsg[]>([]);
  const pendingApproval = ref<string>();
  const waiting = ref(false);
  const error = ref<Error>();

  call.on('stateChange', (s) => (state.value = s));
  call.on('localStream', (s) => (localStream.value = s));
  call.on('remoteStream', (s) => {
    remoteStream.value = s;
    isAdmin.value = call.isAdmin;
    peerName.value = call.peerName;
    waiting.value = false;
  });
  call.on('remoteScreen', (s) => (remoteScreen.value = s ?? undefined));
  call.on('screenShare', (active) => (screenSharing.value = active));
  call.on('remoteLeft', () => {
    remoteStream.value = undefined;
    peerName.value = undefined;
  });
  call.on('chatMessage', (text) => messages.value.push({ from: 'them', text }));
  call.on('participantWaiting', (name) => (pendingApproval.value = name));
  call.on('waitingForApproval', () => (waiting.value = true));
  call.on('rejected', () => (waiting.value = false));
  call.on('error', (e) => (error.value = e));

  onScopeDispose(() => {
    call.removeAllListeners();
    void call.hangup();
  });

  return {
    call,
    state,
    localStream,
    remoteStream,
    remoteScreen,
    screenSharing,
    isAdmin,
    peerName,
    messages,
    pendingApproval,
    waiting,
    error,
    join: (room) => call.join(room),
    hangup: () => call.hangup(),
    toggleCamera: (on) => call.toggleCamera(on),
    toggleMic: (on) => call.toggleMic(on),
    startScreenShare: () => call.startScreenShare(),
    stopScreenShare: () => call.stopScreenShare(),
    sendChat: (text) => {
      if (call.sendChat(text)) messages.value.push({ from: 'me', text });
    },
    admit: () => {
      call.admit();
      pendingApproval.value = undefined;
    },
    reject: () => {
      call.reject();
      pendingApproval.value = undefined;
    },
    kick: () => call.kickParticipant(),
  };
}
