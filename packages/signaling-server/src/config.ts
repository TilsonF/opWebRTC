import { existsSync, readFileSync } from 'node:fs';

/**
 * Configuración del servidor con dos fuentes:
 *   1. Archivo JSON opcional (CONFIG_FILE o ./opwebrtc.config.json)
 *   2. Variables de entorno  ← tienen prioridad (deploy-friendly, 12-factor)
 *
 * Así personalizas todo por JSON en desarrollo y sobreescribes por env en
 * producción/CI sin tocar archivos.
 */
export interface ServerConfig {
  port: number;
  auth: { enabled: boolean; token: string };
  turn: { secret: string; urls: string[]; ttl: number; stunUrl: string };
  tls: { cert?: string; key?: string };
}

type DeepPartial<T> = { [K in keyof T]?: Partial<T[K]> };

function loadFile(): DeepPartial<ServerConfig> {
  const path = process.env.CONFIG_FILE ?? 'opwebrtc.config.json';
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as DeepPartial<ServerConfig>;
  } catch {
    console.warn(`⚠️  No se pudo leer ${path}; usando env/valores por defecto.`);
    return {};
  }
}

const bool = (v: string | undefined): boolean | undefined =>
  v == null ? undefined : v.toLowerCase() === 'true';

const num = (v: string | undefined): number | undefined =>
  v == null || v === '' ? undefined : Number(v);

const list = (v: string | undefined): string[] | undefined =>
  v == null ? undefined : v.split(',').map((s) => s.trim()).filter(Boolean);

const file = loadFile();
const e = process.env;

export const config: ServerConfig = {
  port: num(e.PORT) ?? file.port ?? 8080,
  auth: {
    enabled: bool(e.AUTH_ENABLED) ?? file.auth?.enabled ?? false,
    token: e.AUTH_TOKEN ?? file.auth?.token ?? '',
  },
  turn: {
    secret: e.TURN_SECRET ?? file.turn?.secret ?? '',
    urls: list(e.TURN_URLS) ?? file.turn?.urls ?? [],
    ttl: num(e.TURN_TTL) ?? file.turn?.ttl ?? 3600,
    stunUrl: e.STUN_URL ?? file.turn?.stunUrl ?? 'stun:stun.l.google.com:19302',
  },
  tls: {
    cert: e.TLS_CERT ?? file.tls?.cert,
    key: e.TLS_KEY ?? file.tls?.key,
  },
};
