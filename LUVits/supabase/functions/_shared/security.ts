import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const STORAGE_BUCKET = "booking-references";
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_REFERENCE_IMAGES = 5;

export type StudioServiceClient = SupabaseClient;

export function createServiceClient(): StudioServiceClient {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
        throw new Error("Supabase service configuration is missing.");
    }
    return createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

export async function checkRateLimit(
    client: StudioServiceClient,
    request: Request,
    scope: string,
    maximum: number,
    windowSeconds: number,
): Promise<boolean> {
    const salt = Deno.env.get("RATE_LIMIT_SALT");
    const address = request.headers.get("cf-connecting-ip")
        ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        ?? request.headers.get("x-real-ip");
    if (!salt || !address) {
        throw new Error("Rate-limit configuration or client address is unavailable.");
    }

    const input = new TextEncoder().encode(`${salt}:${scope}:${address}`);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
    const fingerprint = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const { data, error } = await client.rpc("consume_booking_rate_limit", {
        p_fingerprint: fingerprint,
        p_max_attempts: maximum,
        p_window_seconds: windowSeconds,
    });
    if (error) {
        throw new Error(`Rate-limit check failed: ${error.message}`);
    }
    return data === true;
}

export async function getAuthorizedAdmin(
    client: StudioServiceClient,
    request: Request,
): Promise<{ id: string } | null> {
    const authorization = request.headers.get("authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
        return null;
    }

    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) {
        return null;
    }

    const { data: role, error: roleError } = await client
        .from("studio_admins")
        .select("user_id")
        .eq("user_id", data.user.id)
        .maybeSingle();
    if (roleError) {
        throw new Error(`Administrator role lookup failed: ${roleError.message}`);
    }

    return role ? { id: data.user.id } : null;
}

export function isAllowedImageType(value: unknown): value is "image/jpeg" | "image/png" | "image/webp" {
    return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

export function extensionForImage(type: string): string {
    switch (type) {
        case "image/jpeg":
            return "jpg";
        case "image/png":
            return "png";
        case "image/webp":
            return "webp";
        default:
            throw new Error("Unsupported image type.");
    }
}

export function hasValidUploadedPath(path: unknown, kind: "reference" | "placement"): path is string {
    return typeof path === "string"
        && new RegExp(`^uploads/[0-9a-f-]{36}/${kind}-[0-9a-f-]{36}\\.(jpg|png|webp)$`, "i").test(path);
}
