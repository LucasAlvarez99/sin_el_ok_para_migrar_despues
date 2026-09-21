/** Dobles de prueba en memoria: API de Bunny, base de datos y autenticación. */
import { BunnyService } from "../_shared/bunny/bunny.service.ts";
import { HttpError } from "../_shared/http.ts";
import type {
  AppConfig,
  AuditEntry,
  AuditPort,
  AuthedUser,
  AuthPort,
  ClassRepo,
  ClassRow,
  HandlerDeps,
  NewClass,
  ProgressRow,
  Role,
  VideoStatePatch,
} from "../_shared/ports.ts";

export const LIB = "12345";
export const NOW = 1_800_000_000;
export const ADMIN_ID = "aaaaaaaa-0000-4000-8000-000000000001";
export const USER_ID = "bbbbbbbb-0000-4000-8000-000000000002";
export const USER2_ID = "cccccccc-0000-4000-8000-000000000003";
export const DEV_ID = "dddddddd-0000-4000-8000-000000000004";

// ------------------------------------------------------------------ Bunny (API HTTP simulada)
interface FakeVideo {
  guid: string;
  videoLibraryId: number;
  title: string;
  length: number;
  status: number;
}

export class FakeBunnyApi {
  videos = new Map<string, FakeVideo>();
  calls: { method: string; path: string; accessKey: string | null }[] = [];
  /** Si se define, la próxima llamada a esa operación responde con este status HTTP. */
  failWith: { method: string; status: number } | null = null;

  fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    this.calls.push({ method, path: url.pathname, accessKey: headers.get("AccessKey") });

    if (this.failWith && this.failWith.method === method) {
      const { status } = this.failWith;
      this.failWith = null;
      return Promise.resolve(new Response("upstream error", { status }));
    }
    if (headers.get("AccessKey") !== "bunny-api-key") return Promise.resolve(new Response("nope", { status: 401 }));

    const base = `/library/${LIB}/videos`;
    if (method === "POST" && url.pathname === base) {
      const guid = crypto.randomUUID();
      const v: FakeVideo = {
        guid,
        videoLibraryId: Number(LIB),
        title: JSON.parse(String(init?.body)).title,
        length: 0,
        status: 0,
      };
      this.videos.set(guid, v);
      return Promise.resolve(Response.json(v));
    }
    const m = url.pathname.startsWith(base + "/") ? url.pathname.slice(base.length + 1) : null;
    if (m) {
      const v = this.videos.get(m);
      if (!v) return Promise.resolve(new Response("not found", { status: 404 }));
      if (method === "GET") return Promise.resolve(Response.json(v));
      if (method === "DELETE") {
        this.videos.delete(m);
        return Promise.resolve(Response.json({ success: true }));
      }
    }
    return Promise.resolve(new Response("bad route", { status: 400 }));
  };
}

export function makeBunny(api: FakeBunnyApi): BunnyService {
  return new BunnyService({
    apiKey: "bunny-api-key",
    libraryId: LIB,
    cdnHostname: "vz-test-000.b-cdn.net",
    tokenAuthKey: "token-key",
    fetchImpl: api.fetch as typeof fetch,
    nowSeconds: () => NOW,
  });
}

// ------------------------------------------------------------------ Base de datos en memoria
export class FakeRepo implements ClassRepo {
  classes = new Map<string, ClassRow>();
  progress = new Map<string, ProgressRow>(); // key: userId|classId
  failInsert = false;
  pingFails = false;
  deleteCalls = 0;

  addClass(p: Partial<ClassRow> = {}): ClassRow {
    const row: ClassRow = {
      id: crypto.randomUUID(),
      title: "Clase",
      description: null,
      thumbnail_url: null,
      duration_seconds: null,
      level: "todos",
      category: null,
      access_level: "free",
      sort_order: 0,
      is_published: false,
      video_status: "pending",
      bunny_video_id: null,
      bunny_library_id: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...p,
    };
    this.classes.set(row.id, row);
    return row;
  }

  insertClass(input: NewClass): Promise<ClassRow> {
    if (this.failInsert) return Promise.reject(new Error("db down"));
    return Promise.resolve({ ...this.addClass({ ...input }) });
  }
  getClass(id: string) {
    const c = this.classes.get(id);
    return Promise.resolve(c ? { ...c } : null);
  }
  getClassByBunnyVideoId(v: string) {
    const c = [...this.classes.values()].find((c) => c.bunny_video_id === v);
    return Promise.resolve(c ? { ...c } : null);
  }
  attachVideo(classId: string, video: { bunny_video_id: string; bunny_library_id: string }) {
    const c = this.classes.get(classId);
    if (!c || c.bunny_video_id) return Promise.resolve(null);
    Object.assign(c, video, { video_status: "pending", duration_seconds: null });
    return Promise.resolve({ ...c });
  }
  replaceFailedVideo(classId: string, video: { bunny_video_id: string; bunny_library_id: string }) {
    const c = this.classes.get(classId);
    if (!c || c.video_status !== "failed") return Promise.resolve(null);
    Object.assign(c, video, { video_status: "pending", duration_seconds: null });
    return Promise.resolve({ ...c });
  }
  deletedThumbnails: (string | null)[] = [];
  failThumbnailDelete = false;
  deleteThumbnail(url: string | null) {
    if (this.failThumbnailDelete) return Promise.reject(new Error("storage down"));
    this.deletedThumbnails.push(url);
    return Promise.resolve();
  }
  updateVideoState(classId: string, patch: VideoStatePatch) {
    const c = this.classes.get(classId)!;
    const next = { ...c, ...patch };
    // Réplica del CHECK classes_published_requires_ready de la migración.
    if (next.is_published && next.video_status !== "ready") {
      return Promise.reject(new Error("violates check constraint classes_published_requires_ready"));
    }
    Object.assign(c, patch);
    return Promise.resolve({ ...c });
  }
  deleteClass(id: string) {
    this.deleteCalls++;
    this.classes.delete(id);
    return Promise.resolve();
  }
  getProgress(userId: string, classId: string) {
    return Promise.resolve(this.progress.get(`${userId}|${classId}`) ?? null);
  }
  ping() {
    return this.pingFails ? Promise.reject(new Error("db down")) : Promise.resolve();
  }
}

// ------------------------------------------------------------------ Auth simulada
export class FakeAuth implements AuthPort {
  /** userId -> clases a las que tiene entitlement */
  entitlements = new Map<string, Set<string>>();
  private tokens: Record<string, { id: string; role: Role }> = {
    owner: { id: ADMIN_ID, role: "owner" },
    developer: { id: DEV_ID, role: "developer" },
    user: { id: USER_ID, role: "user" },
    user2: { id: USER2_ID, role: "user" },
  };
  constructor(private repo: FakeRepo) {}

  private user(req: Request): AuthedUser {
    const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
    const t = m ? this.tokens[m[1]] : undefined;
    if (!t) throw new HttpError(401, "unauthenticated", "Invalid or expired session");
    const isStaff = t.role === "owner" || t.role === "developer";
    return {
      id: t.id,
      role: t.role,
      canAccessClass: (classId: string) => {
        // Réplica de public.can_access_class() de la migración.
        if (isStaff) return Promise.resolve(true);
        const c = this.repo.classes.get(classId);
        if (!c || !c.is_published || c.video_status !== "ready") return Promise.resolve(false);
        return Promise.resolve(c.access_level === "free" || (this.entitlements.get(t.id)?.has(c.id) ?? false));
      },
    };
  }
  requireUser(req: Request) {
    return Promise.resolve(this.user(req));
  }
  requireOwner(req: Request) {
    const u = this.user(req);
    if (u.role !== "owner" && u.role !== "developer") throw new HttpError(403, "owner_only", "Owner access required");
    return Promise.resolve(u);
  }
  requireDeveloper(req: Request) {
    const u = this.user(req);
    if (u.role !== "developer") throw new HttpError(403, "developer_only", "Developer access required");
    return Promise.resolve(u);
  }
}

// ------------------------------------------------------------------ Auditoría en memoria
export class FakeAudit implements AuditPort {
  entries: AuditEntry[] = [];
  fail = false;
  record(entry: AuditEntry): Promise<void> {
    if (this.fail) return Promise.reject(new Error("audit down"));
    this.entries.push(entry);
    return Promise.resolve();
  }
}

// ------------------------------------------------------------------ Armado
export function makeDeps(over: Partial<AppConfig> = {}) {
  const api = new FakeBunnyApi();
  const repo = new FakeRepo();
  const auth = new FakeAuth(repo);
  const audit = new FakeAudit();
  const bunny = makeBunny(api);
  const config: AppConfig = {
    allowedOrigins: ["https://yogapopup.test"],
    playbackTtlSeconds: 7200,
    uploadTtlSeconds: 14400,
    webhookSecret: "readonly-key",
    ...over,
  };
  const deps: HandlerDeps = { bunny, repo, auth, audit, config };
  return { api, repo, auth, audit, bunny, config, deps };
}

export function post(body: unknown, token?: string, extra: Record<string, string> = {}): Request {
  return new Request("https://fn.test/x", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
