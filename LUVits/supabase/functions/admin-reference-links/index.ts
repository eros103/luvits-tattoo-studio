import { corsHeaders, jsonResponse, optionsResponse } from "../_shared/http.ts";
import { createServiceClient, getAuthorizedAdmin, STORAGE_BUCKET } from "../_shared/security.ts";

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") {
        return optionsResponse(request);
    }
    if (request.method !== "POST") {
        return jsonResponse(request, { error: "Method not allowed." }, 405);
    }
    if (!corsHeaders(request)) {
        return jsonResponse(request, { error: "Origin is not allowed." }, 403);
    }

    try {
        const client = createServiceClient();
        const admin = await getAuthorizedAdmin(client, request);
        if (!admin) {
            return jsonResponse(request, { error: "Administrator access is required." }, 403);
        }

        let body: { bookingId?: unknown };
        try {
            body = await request.json();
        } catch {
            return jsonResponse(request, { error: "Invalid image request." }, 400);
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return jsonResponse(request, { error: "Invalid image request." }, 400);
        }
        if (typeof body.bookingId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.bookingId)) {
            return jsonResponse(request, { error: "Invalid booking ID." }, 400);
        }

        const { data: booking, error } = await client
            .from("bookings")
            .select("id, inspiration_paths, placement_photo_path")
            .eq("id", body.bookingId)
            .maybeSingle();
        if (error) {
            console.error("Could not load booking references.", error.message);
            return jsonResponse(request, { error: "Booking references are unavailable." }, 503);
        }
        if (!booking) {
            return jsonResponse(request, { error: "Booking not found." }, 404);
        }

        const images = [
            ...(Array.isArray(booking.inspiration_paths)
                ? booking.inspiration_paths.map((path: string) => ({ path, kind: "reference" }))
                : []),
            ...(typeof booking.placement_photo_path === "string"
                ? [{ path: booking.placement_photo_path, kind: "placement" }]
                : []),
        ];
        if (images.length > 6) {
            return jsonResponse(request, { error: "The booking contains an invalid number of images." }, 400);
        }

        const signedImages: Array<{ path: string; kind: string; url: string }> = [];
        for (const image of images) {
            const { data, error: signedUrlError } = await client.storage
                .from(STORAGE_BUCKET)
                .createSignedUrl(image.path, 60);
            if (signedUrlError || !data?.signedUrl) {
                console.error("Could not sign an administrator image URL.", {
                    bookingId: booking.id,
                    reason: signedUrlError?.message ?? "No signed URL returned.",
                });
                return jsonResponse(request, { error: "One or more reference images are unavailable." }, 503);
            }
            signedImages.push({ ...image, url: data.signedUrl });
        }

        return jsonResponse(request, { signedImages });
    } catch (error) {
        console.error("Administrator image request failed.", error instanceof Error ? error.message : "Unknown error.");
        return jsonResponse(request, { error: "Administrator image access is unavailable." }, 503);
    }
});
