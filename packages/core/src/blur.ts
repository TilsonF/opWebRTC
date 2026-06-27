import {
  ImageSegmenter,
  FilesetResolver,
  type MPMask,
} from '@mediapipe/tasks-vision';

/**
 * Blur de fondo opt-in. Entry point separado (`@opwebrtc/core/blur`) para que
 * el core principal siga ligero: MediaPipe solo se descarga si importas esto.
 *
 * Pipeline: track de cámara -> <video> -> segmentación (persona vs fondo) ->
 * canvas que difumina el fondo y deja la persona nítida -> nuevo track.
 *
 * Por defecto carga wasm + modelo desde CDN. Pásalos en local (wasmPath /
 * modelAssetPath) si quieres offline o cero dependencia de CDN.
 */
export interface BlurOptions {
  /** Radio del difuminado en px. Por defecto 10. */
  blurRadius?: number;
  /** FPS de salida del canvas. Por defecto 30. */
  fps?: number;
  /** Carpeta wasm de MediaPipe. */
  wasmPath?: string;
  /** Ruta del modelo .tflite de segmentación selfie. */
  modelAssetPath?: string;
}

const CDN_WASM =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const CDN_MODEL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

export class BackgroundBlur {
  private segmenter?: ImageSegmenter;
  private readonly video = document.createElement('video');
  private readonly canvas = document.createElement('canvas');
  private readonly mask = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly maskCtx: CanvasRenderingContext2D;
  private running = false;
  private lastTs = 0;
  private readonly opts: Required<BlurOptions>;

  constructor(opts: BlurOptions = {}) {
    this.opts = {
      blurRadius: opts.blurRadius ?? 10,
      fps: opts.fps ?? 30,
      wasmPath: opts.wasmPath ?? CDN_WASM,
      modelAssetPath: opts.modelAssetPath ?? CDN_MODEL,
    };
    this.ctx = this.canvas.getContext('2d')!;
    this.maskCtx = this.mask.getContext('2d', { willReadFrequently: true })!;
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
  }

  /** Carga el modelo de segmentación (idempotente). */
  async init(): Promise<void> {
    if (this.segmenter) return;
    const vision = await FilesetResolver.forVisionTasks(this.opts.wasmPath);
    this.segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: this.opts.modelAssetPath, delegate: 'GPU' },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
  }

  /**
   * Procesa un track de cámara y devuelve un track con el fondo difuminado.
   * Pásalo a `call.replaceOutgoingVideo(track)` para enviarlo al peer.
   */
  async process(input: MediaStreamTrack): Promise<MediaStreamTrack> {
    await this.init();
    this.video.srcObject = new MediaStream([input]);
    await this.video.play();

    const { width = 1280, height = 720 } = input.getSettings();
    this.canvas.width = this.mask.width = width;
    this.canvas.height = this.mask.height = height;

    this.running = true;
    this.loop();
    return this.canvas.captureStream(this.opts.fps).getVideoTracks()[0]!;
  }

  /** Detiene el procesamiento y libera el segmentador. */
  stop(): void {
    this.running = false;
    this.video.srcObject = null;
    this.segmenter?.close();
    this.segmenter = undefined;
  }

  private readonly loop = (): void => {
    if (!this.running) return;
    try {
      if (this.video.readyState >= 2 && this.segmenter) {
        // Timestamp estrictamente creciente (MediaPipe lo exige en modo VIDEO).
        const ts = Math.max(performance.now(), this.lastTs + 1);
        this.lastTs = ts;
        this.segmenter.segmentForVideo(this.video, ts, (res) => {
          try {
            this.composite(res.categoryMask);
          } finally {
            res.categoryMask?.close();
          }
        });
      }
    } catch {
      // Un frame fallido no debe matar el loop (antes congelaba el blur).
    }
    // Siempre se reprograma, pase lo que pase.
    requestAnimationFrame(this.loop);
  };

  /** Compone: persona nítida sobre fondo difuminado, usando la máscara. */
  private composite(mask?: MPMask): void {
    const { width: w, height: h } = this.canvas;
    const ctx = this.ctx;

    if (!mask) {
      ctx.drawImage(this.video, 0, 0, w, h);
      return;
    }

    // Construye una máscara con alpha: opaca donde hay persona.
    const data = mask.getAsUint8Array();
    const img = this.maskCtx.createImageData(mask.width, mask.height);
    for (let i = 0; i < data.length; i++) {
      // selfie_segmenter: categoría 0 => persona (primer plano), resto => fondo.
      // La persona queda opaca (nítida); el fondo, transparente (se difumina).
      img.data[i * 4 + 3] = data[i] === 0 ? 255 : 0;
    }
    this.maskCtx.putImageData(img, 0, 0);

    // 1) persona nítida
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.video, 0, 0, w, h);
    // 2) recorta a la silueta de la persona
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this.mask, 0, 0, w, h);
    // 3) fondo difuminado detrás
    ctx.globalCompositeOperation = 'destination-over';
    ctx.filter = `blur(${this.opts.blurRadius}px)`;
    ctx.drawImage(this.video, 0, 0, w, h);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
  }
}
