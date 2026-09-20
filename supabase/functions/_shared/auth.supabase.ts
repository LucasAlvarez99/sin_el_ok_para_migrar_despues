import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";
import type { AuthedUser, AuthPort } from "./ports.ts";

/**
 * Autenticación y permisos usando el JWT del propio usuario:
 *  - El token se valida contra Supabase Auth (getUser), no solo se decodifica.
 *  - Los permisos se consultan con las funciones SQL is_admin() y can_access_class()
 *    ejecutadas COMO el usuario, así auth.uid() y RLS son los reales.
 */
export function createSupabaseAuth(url: string, anonKey: string): AuthPort {
  async function authenticate(req: Request): Promise<{ client: SupabaseClient; user: AuthedUser }> {
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
    if (!match) throw new HttpError(401, "unauthenticated", "Missing or invalid Authorization header");
    const token = match[1];

    const client = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, "unauthenticated", "Invalid or expired session");

    return {
      client,
      user: {
        id: data.user.id,
        async canAccessClass(classId: string): Promise<boolean> {
          const { data: allowed, error: rpcError } = await client.rpc("can_access_class", { p_class_id: classId });
          if (rpcError) throw new Error(`rpc can_access_class: ${rpcError.message}`);
          return allowed === true;
        },
      },
    };
  }

  return {
    async requireUser(req) {
      return (await authenticate(req)).user;
    },
    async requireAdmin(req) {
      const { client, user } = await authenticate(req);
      const { data, error } = await client.rpc("is_admin");
      if (error) throw new Error(`rpc is_admin: ${error.message}`);
      if (data !== true) throw new HttpError(403, "admin_only", "Administrator access required");
      return user;
    },
  };
}
