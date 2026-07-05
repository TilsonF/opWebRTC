import {
  ImageSegmenter,
  FilesetResolver,
  type MPMask,
} from '@mediapipe/tasks-vision';

// APIs experimentales (Chromium) no incluidas en lib.dom.
declare global {
  interface MediaStreamTrackProcessor {
    readonly readable: ReadableStream<VideoFrame>;
  }
  // eslint-disable-next-line no-var
  var MediaStreamTrackProcessor: {
    new (init: { track: MediaStreamTrack }): MediaStreamTrackProcessor;
  };
  interface MediaStreamTrackGenerator extends MediaStreamTrack {
    readonly writable: WritableStream<VideoFrame>;
  }
  // eslint-disable-next-line no-var
  var MediaStreamTrackGenerator: {
    new (init: { kind: 'video' | 'audio' }): MediaStreamTrackGenerator;
  };
}

/**
 * Blur de fondo opt-in. Entry point separado (`@opwebrtc/core/blur`) para que
 * el core principal siga ligero: MediaPipe solo se descarga si importas esto.
 *
 * Dos vías de salida:
 *  1. Insertable Streams (WebCodecs) — preferida. Transforma los VideoFrame y
 *     produce un track NATIVO (MediaStreamTrackGenerator). El encoder de WebRTC
 *     lo codifica sin problemas → el peer remoto lo ve fluido.
 *  2. canvas.captureStream() — fallback para navegadores sin insertable streams
 *     (p. ej. Safari/Firefox). Puede congelarse en la vista remota en algunos
 *     navegadores (limitante conocido de capturar un canvas hacia WebRTC).
 *
 * En ambas: la segmentación (persona vs fondo) corre throttleada y actualiza
 * una máscara; el compositing usa la última máscara conocida, así el vídeo
 * nunca se detiene aunque la GPU tarde.
 */
export interface BlurOptions {
  /** Radio del difuminado del fondo en px. Por defecto 12. */
  blurRadius?: number;
  /**
   * Suavizado del borde de la máscara (feather) en px. Reduce el "ruido"/filo
   * dentado del recorte persona/fondo. Por defecto 4.
   */
  maskBlur?: number;
  /** Tasa de SEGMENTACIÓN en fps. Por defecto 24. */
  fps?: number;
  /** Carpeta wasm de MediaPipe. */
  wasmPath?: string;
  /** Ruta del modelo .tflite de segmentación selfie. */
  modelAssetPath?: string;
  /** Forzar el fallback de canvas (para pruebas). Por defecto usa lo mejor disponible. */
  forceCanvas?: boolean;
}

const CDN_WASM =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const CDN_MODEL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

/** ¿El navegador soporta Insertable Streams para video? */
export function supportsInsertableStreams(): boolean {
  return (
    typeof MediaStreamTrackProcessor !== 'undefined' &&
    typeof MediaStreamTrackGenerator !== 'undefined'
  );
}

export class BackgroundBlur {
  private segmenter?: ImageSegmenter;
  private readonly canvas = document.createElement('canvas');
  private readonly mask = document.createElement('canvas');
  private readonly segIn = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly maskCtx: CanvasRenderingContext2D;
  private readonly segCtx: CanvasRenderingContext2D;

  // Vía canvas (fallback).
  private readonly video = document.createElement('video');
  private outTrack?: MediaStreamTrack;

  private running = false;
  private hasMask = false;
  private processing = false;
  private processingStart = 0;
  private lastSeg = 0;
  private lastTs = 0;

  private readonly opts: Required<BlurOptions>;

  constructor(opts: BlurOptions = {}) {
    this.opts = {
      blurRadius: opts.blurRadius ?? 12,
      maskBlur: opts.maskBlur ?? 4,
      fps: opts.fps ?? 24,
      wasmPath: opts.wasmPath ?? CDN_WASM,
      modelAssetPath: opts.modelAssetPath ?? CDN_MODEL,
      forceCanvas: opts.forceCanvas ?? false,
    };
    this.ctx = this.canvas.getContext('2d')!;
    this.maskCtx = this.mask.getContext('2d', { willReadFrequently: true })!;
    this.segCtx = this.segIn.getContext('2d')!;
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
   * Usa Insertable Streams si el navegador lo soporta; si no, cae a canvas.
   */
  async process(input: MediaStreamTrack): Promise<MediaStreamTrack> {
    await this.init();
    const { width = 1280, height = 720 } = input.getSettings();
    this.canvas.width = width;
    this.canvas.height = height;
    this.running = true;

    if (supportsInsertableStreams() && !this.opts.forceCanvas) {
      return this.processInsertable(input);
    }
    return this.processCanvas(input);
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

  // ── Vía 1: Insertable Streams (preferida) ──────────────────────────────────
  private processInsertable(input: MediaStreamTrack): MediaStreamTrack {
    const processor = new MediaStreamTrackProcessor({ track: input });
    const generator = new MediaStreamTrackGenerator({ kind: 'video' });
    this.outTrack = generator;

    const transformer = new TransformStream<VideoFrame, VideoFrame>({
      transform: (frame, controller) => {
        if (!this.running) {
          frame.close();
          return;
        }
        try {
          const out = this.compositeFrame(frame);
          frame.close();
          controller.enqueue(out);
        } catch {
          controller.enqueue(frame); // passthrough si un frame falla
        }
      },
    });

    processor.readable
      .pipeThrough(transformer)
      .pipeTo(generator.writable)
      .catch(() => {
        /* el stream se cierra al detener; ignorar */
      });

    return generator;
  }

  /** Compone un VideoFrame (persona nítida sobre fondo difuminado) → VideoFrame. */
  private compositeFrame(frame: VideoFrame): VideoFrame {
    const { width: w, height: h } = this.canvas;
    this.maybeSegment(frame, w, h);

    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(frame, 0, 0, w, h);
    if (this.hasMask) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.filter = `blur(${this.opts.maskBlur}px)`; // feather del borde
      ctx.drawImage(this.mask, 0, 0, w, h);
      ctx.globalCompositeOperation = 'destination-over';
      ctx.filter = `blur(${this.opts.blurRadius}px)`;
      ctx.drawImage(frame, 0, 0, w, h);
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';
    }
    // Timestamp del frame original: preserva la cadencia para el encoder.
    return new VideoFrame(this.canvas, { timestamp: frame.timestamp ?? 0 });
  }

  /** Segmentación throttleada usando la fuente dada (VideoFrame o video). */
  private maybeSegment(source: CanvasImageSource, w: number, h: number): void {
    const now = performance.now();
    if (now - this.lastSeg < 1000 / this.opts.fps) return;
    if (this.processing) {
      if (now - this.processingStart > 1000) this.processing = false;
      else return;
    }
    if (!this.segmenter) return;

    this.lastSeg = now;
    this.processing = true;
    this.processingStart = now;
    if (this.segIn.width !== w || this.segIn.height !== h) {
      this.segIn.width = w;
      this.segIn.height = h;
    }
    this.segCtx.drawImage(source, 0, 0, w, h);
    const ts = Math.max(now, this.lastTs + 1);
    this.lastTs = ts;
    try {
      this.segmenter.segmentForVideo(this.segIn, ts, (res) => {
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

  // ── Vía 2: canvas.captureStream (fallback) ─────────────────────────────────
  private async processCanvas(input: MediaStreamTrack): Promise<MediaStreamTrack> {
    this.video.srcObject = new MediaStream([input]);
    await this.video.play();
    const stream = this.canvas.captureStream(30);
    this.outTrack = stream.getVideoTracks()[0]!;
    requestAnimationFrame(this.renderCanvas);
    return this.outTrack;
  }

  private readonly renderCanvas = (): void => {
    if (!this.running) return;
    requestAnimationFrame(this.renderCanvas);
    if (this.video.readyState < 2) return;
    const { width: w, height: h } = this.canvas;
    try {
      this.maybeSegment(this.video, w, h);
      const ctx = this.ctx;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.video, 0, 0, w, h);
      if (this.hasMask) {
        ctx.globalCompositeOperation = 'destination-in';
        ctx.filter = `blur(${this.opts.maskBlur}px)`; // feather del borde
        ctx.drawImage(this.mask, 0, 0, w, h);
        ctx.globalCompositeOperation = 'destination-over';
        ctx.filter = `blur(${this.opts.blurRadius}px)`;
        ctx.drawImage(this.video, 0, 0, w, h);
        ctx.filter = 'none';
        ctx.globalCompositeOperation = 'source-over';
      }
    } catch {
      /* un frame fallido no debe matar el loop */
    }
  };

  // ── Segmentación → máscara (compartido) ────────────────────────────────────
  private updateMask(mask?: MPMask): void {
    if (!mask) return;
    if (this.mask.width !== mask.width || this.mask.height !== mask.height) {
      this.mask.width = mask.width;
      this.mask.height = mask.height;
    }
    const data = mask.getAsUint8Array();
    const img = this.maskCtx.createImageData(mask.width, mask.height);
    for (let i = 0; i < data.length; i++) {
      // selfie_segmenter: categoría 0 => persona (nítida), resto => fondo.
      img.data[i * 4 + 3] = data[i] === 0 ? 255 : 0;
    }
    this.maskCtx.putImageData(img, 0, 0);
    this.hasMask = true;
  }
}
