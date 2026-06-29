import { useEffect, useRef, useState } from 'react';
import { Call, type CallConfig, type CallState } from '@opwebrtc/core';

export interface ChatMsg {
  from: 'me' | 'them';
  text: string;
}

export interface UseCall {
  /** Instancia subyacente, por si necesitas algo avanzado. */
  call: Call;
  state: CallState;
  localStream?: MediaStream;
  remoteStream?: MediaStream;
  /** Pantalla compartida por el otro peer (o undefined). */
  remoteScreen?: MediaStream;
  screenSharing: boolean;
  isAdmin: boolean;
  peerName?: string;
  messages: ChatMsg[];
  /** Nombre de quien espera aprobación (lado anfitrión). */
  pendingApproval?: string;
  /** Estás en sala de espera aguardando aprobación. */
  waiting: boolean;
  error?: Error;
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
 * Hook que envuelve `Call` y expone su estado de forma reactiva para React.
 * El stream local/remoto se conectan a un <video> con `ref.srcObject = stream`.
 */
export function useCall(config: CallConfig): UseCall {
  const ref = useRef<Call | null>(null);
  if (!ref.current) ref.current = new Call(config);
  const call = ref.current;

  const [state, setState] = useState<CallState>('idle');
  const [localStream, setLocal] = useState<MediaStream>();
  const [remoteStream, setRemote] = useState<MediaStream>();
  const [remoteScreen, setRemoteScreen] = useState<MediaStream>();
  const [screenSharing, setSharing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [peerName, setPeerName] = useState<string>();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [pendingApproval, setPending] = useState<string>();
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<Error>();

  useEffect(() => {
    call.on('stateChange', setState);
    call.on('localStream', setLocal);
    call.on('remoteStream', (s) => {
      setRemote(s);
      setIsAdmin(call.isAdmin);
      setPeerName(call.peerName);
      setWaiting(false);
    });
    call.on('remoteScreen', (s) => setRemoteScreen(s ?? undefined));
    call.on('screenShare', (active) => setSharing(active));
    call.on('remoteLeft', () => {
      setRemote(undefined);
      setPeerName(undefined);
    });
    call.on('chatMessage', (text) =>
      setMessages((m) => [...m, { from: 'them', text }]),
    );
    call.on('participantWaiting', (name) => setPending(name));
    call.on('waitingForApproval', () => setWaiting(true));
    call.on('rejected', () => setWaiting(false));
    call.on('error', setError);
    return () => {
      call.removeAllListeners();
      void call.hangup();
    };
  }, [call]);

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
      if (call.sendChat(text)) setMessages((m) => [...m, { from: 'me', text }]);
    },
    admit: () => {
      call.admit();
      setPending(undefined);
    },
    reject: () => {
      call.reject();
      setPending(undefined);
    },
    kick: () => call.kickParticipant(),
  };
}
