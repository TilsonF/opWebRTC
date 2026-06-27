import {
  ImageSegmenter,
  FilesetResolver,
  type MPMask,
} from '@mediapipe/tasks-vision';

/**
 * Blur de fondo opt-in. Entry point separado (`@opwebrtc/core/blur`) para que
 * el core principal siga ligero: MediaPipe solo se descarga si importas esto.
 *
 * Diseño clave: el RENDER (dibujar vídeo + máscara y entregar el frame) corre
 * a la tasa de pantalla, mientras la SEGMENTACIÓN corre aparte y throttleada.
 * Así la salida nunca se congela aunque la GPU tarde: solo la máscara se
 * refresca un poco menos seguido. (Antes, saltarse el dibujo durante la
 * segmentación congelaba el vídeo que veía el otro participante).
 *
 * Por defecto carga wasm + modelo desde CDN. Pásalos en local (wasmPath /
 * modelAssetPath) si quieres offline o cero dependencia de CDN.
 */
export interface BlurOptions {
  /** Radio del difuminado en px. Por defecto 12. */
  blurRadius?: number;
  /** Tasa de SEGMENTACIÓN en fps (el render va a la tasa de pantalla). Por defecto 24. */
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
  private outTrack?: CanvasCaptureMediaStreamTrack;

  private running = false;
  private hasMask = false;
  // Estado de la segmentación asíncrona.
  private processing = false;
  private processingStart = 0;
  private lastSeg = 0;
  private lastTs = 0;

  private readonly opts: Required<BlurOptions>;

  constructor(opts: BlurOptions = {}) {
    this.opts = {
      blurRadius: opts.blurRadius ?? 12,
      fps: opts.fps ?? 24,
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
    this.canvas.width = width;
    this.canvas.height = height;

    this.running = true;
    // captureStream(0): entregamos cada frame manualmente con requestFrame(),
    // garantizando que la salida no se quede sin frames (no se congela).
    const stream = this.canvas.captureStream(0);
    this.outTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    requestAnimationFrame(this.render);
    return this.outTrack;
  }

  /** Detiene el procesamiento y libera recursos. */
  stop(): void {
    this.running = false;
    this.hasMask = false;
    this.processing = false;
    this.lastTs = this.lastSeg = this.processingStart = 0;
    this.outTrack?.stop();
    this.outTrack = undefined;
    this.video.srcObject = null;
    this.segmenter?.close();
    this.segmenter = undefined;
  }

  /** Render a tasa de pantalla: salida fluida, no depende de la segmentación. */
  private readonly render = (): void => {
    if (!this.running) return;
    requestAnimationFrame(this.render);
    if (this.video.readyState < 2) return;
    try {
      this.composite();
    } catch {
      // un frame fallido no debe matar el render
    }
    this.outTrack?.requestFrame();
    this.maybeSegment();
  };

  /** Segmentación asíncrona y throttleada; actualiza la máscara sin bloquear. */
  private maybeSegment(): void {
    const now = performance.now();
    if (now - this.lastSeg < 1000 / this.opts.fps) return;
    // Re-entrancy guard + watchdog (libera si una segmentación quedó colgada).
    if (this.processing) {
      if (now - this.processingStart > 1000) this.processing = false;
      else return;
    }
    if (!this.segmenter) return;

    this.lastSeg = now;
    this.processing = true;
    this.processingStart = now;
    const ts = Math.max(now, this.lastTs + 1); // estrictamente creciente
    this.lastTs = ts;
    try {
      this.segmenter.segmentForVideo(this.video, ts, (res) => {
        try {
          this.updateMask(res.categoryMask);
        } finally {
          res.categoryMask?.close();
          this.processing = false;
        }
      });
    } catch {
      this.processing = false;
    }
  }

  /** Convierte la máscara de MediaPipe en un canvas con alpha = persona. */
  private updateMask(mask?: MPMask): void {
    if (!mask) return;
    if (this.mask.width !== mask.width || this.mask.height !== mask.height) {
      this.mask.width = mask.width;
      this.mask.height = mask.height;
    }
    const data = mask.getAsUint8Array();
    const img = this.maskCtx.createImageData(mask.width, mask.height);
    for (let i = 0; i < data.length; i++) {
      // selfie_segmenter: categoría 0 => persona (opaca/nítida), resto => fondo.
      img.data[i * 4 + 3] = data[i] === 0 ? 255 : 0;
    }
    this.maskCtx.putImageData(img, 0, 0);
    this.hasMask = true;
  }

  /** Compone persona nítida sobre fondo difuminado usando la última máscara. */
  private composite(): void {
    const { width: w, height: h } = this.canvas;
    const ctx = this.ctx;

    if (!this.hasMask) {
      ctx.drawImage(this.video, 0, 0, w, h);
      return;
    }
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
