import { test, expect } from '@playwright/test';

/**
 * Verifica el MECANISMO del fix del blur: un track producido por
 * MediaStreamTrackGenerator (Insertable Streams / WebCodecs) se transmite EN
 * VIVO por una conexión WebRTC real (frames que cambian, no congelados) — que
 * es justo lo que fallaba con canvas.captureStream en la vista remota.
 *
 * No usa MediaPipe (no depende de GPU): el transform dibuja un contador que se
 * mueve, así garantizamos que el contenido cambia frame a frame.
 */
test('un track de Insertable Streams se transmite en vivo por WebRTC', async ({ page }) => {
  await page.goto('/'); // origen del demo: cámara falsa + permisos concedidos

  const result = await page.evaluate(async () => {
    const w = window as unknown as {
      MediaStreamTrackProcessor?: new (i: { track: MediaStreamTrack }) => {
        readable: ReadableStream<VideoFrame>;
      };
      MediaStreamTrackGenerator?: new (i: { kind: string }) => MediaStreamTrack & {
        writable: WritableStream<VideoFrame>;
      };
      VideoFrame: new (src: CanvasImageSource, init: { timestamp: number }) => VideoFrame;
    };
    if (!w.MediaStreamTrackProcessor || !w.MediaStreamTrackGenerator) return 'unsupported';

    const cam = await navigator.mediaDevices.getUserMedia({ video: true });
    const track = cam.getVideoTracks()[0]!;

    const processor = new w.MediaStreamTrackProcessor({ track });
    const generator = new w.MediaStreamTrackGenerator({ kind: 'video' });

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d')!;
    let n = 0;
    const transformer = new TransformStream<VideoFrame, VideoFrame>({
      transform: (frame, controller) => {
        ctx.drawImage(frame, 0, 0, 320, 240);
        ctx.fillStyle = 'white';
        ctx.fillRect((n * 11) % 300, 0, 20, 240); // barra que se mueve
        n++;
        const out = new w.VideoFrame(canvas, { timestamp: frame.timestamp ?? 0 });
        frame.close();
        controller.enqueue(out);
      },
    });
    processor.readable.pipeThrough(transformer).pipeTo(generator.writable).catch(() => {});

    // Loopback pc1 -> pc2 en la misma página.
    const pc1 = new RTCPeerConnection();
    const pc2 = new RTCPeerConnection();
    pc1.onicecandidate = (e) => e.candidate && pc2.addIceCandidate(e.candidate);
    pc2.onicecandidate = (e) => e.candidate && pc1.addIceCandidate(e.candidate);
    const remote = new MediaStream();
    pc2.ontrack = (e) => remote.addTrack(e.track);
    pc1.addTrack(generator);
    await pc1.setLocalDescription(await pc1.createOffer());
    await pc2.setRemoteDescription(pc1.localDescription!);
    await pc2.setLocalDescription(await pc2.createAnswer());
    await pc1.setRemoteDescription(pc2.localDescription!);

    const v = document.createElement('video');
    v.autoplay = true;
    v.muted = true;
    v.playsInline = true;
    v.srcObject = remote;
    await v.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));

    const s = document.createElement('canvas');
    s.width = 64;
    s.height = 48;
    const sctx = s.getContext('2d', { willReadFrequently: true })!;
    const sample = () => {
      sctx.drawImage(v, 0, 0, 64, 48);
      return sctx.getImageData(0, 0, 64, 48).data;
    };
    const a = sample();
    await new Promise((r) => setTimeout(r, 800));
    const b = sample();
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i]! - b[i]!);

    cam.getTracks().forEach((t) => t.stop());
    pc1.close();
    pc2.close();
    return diff > 1000 ? 'changing' : 'frozen';
  });

  expect(result).toBe('changing');
});
