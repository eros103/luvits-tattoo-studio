import { corsHeaders, jsonResponse, optionsResponse } from "../_shared/http.ts";
import {
    checkRateLimit,
    createServiceClient,
    extensionForImage,
    isAllowedImageType,
    MAX_FILE_BYTES,
    MAX_REFERENCE_IMAGES,
    MAX_TOTAL_FILE_BYTES,
    STORAGE_BUCKET,
} from "../_shared/security.ts";

type UploadRequest = {
    files?: Array<{ kind?: unknown; type?: unknown; size?: unknown }>;
};

const allowedKinds = new Set(["reference", "placement"]);

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
        const allowed = await checkRateLimit(client, request, "upload", 20, 3600);
        if (!allowed) {
            return jsonResponse(request, { error: "Too many upload attempts. Please try again later." }, 429);
        }

        let body: UploadRequest;
        try {
            body = await request.json() as UploadRequest;
        } catch {
            return jsonResponse(request, { error: "Invalid upload request." }, 400);
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return jsonResponse(request, { error: "Invalid upload request." }, 400);
        }

        const files = body.files;
        if (!Array.isArray(files) || files.length > MAX_REFERENCE_IMAGES + 1) {
            return jsonResponse(request, { error: "Select no more than five references and one placement photo." }, 400);
        }
        if (files.some((file) => !file || typeof file !== "object")) {
            return jsonResponse(request, { error: "Invalid image metadata." }, 400);
        }

        const referenceCount = files.filter((file) => file.kind === "reference").length;
        const placementCount = files.filter((file) => file.kind === "placement").length;
        const totalBytes = files.reduce((total, file) => (
            total + (typeof file.size === "number" && Number.isFinite(file.size) ? file.size : 0)
        ), 0);

        if (referenceCount > MAX_REFERENCE_IMAGES || placementCount > 1 || totalBytes > MAX_TOTAL_FILE_BYTES) {
            return jsonResponse(request, { error: "The selected images exceed the upload limits." }, 400);
        }

        for (const file of files) {
            if (
                !allowedKinds.has(String(file.kind))
                || !isAllowedImageType(file.type)
                || typeof file.size !== "number"
                || !Number.isInteger(file.size)
                || file.size < 1
                || file.size > MAX_FILE_BYTES
            ) {
                return jsonResponse(request, { error: "Use JPEG, PNG, or WebP images no larger than 5 MB each." }, 400);
            }
        }

        const uploadId = crypto.randomUUID();
        const uploads: Array<{ path: string; token: string; kind: string }> = [];

        for (const file of files) {
            const kind = file.kind as "reference" | "placement";
            const extension = extensionForImage(file.type as string);
            const path = `uploads/${uploadId}/${kind}-${crypto.randomUUID()}.${extension}`;
            const { data, error } = await client.storage
                .from(STORAGE_BUCKET)
                .createSignedUploadUrl(path, { upsert: false });

            if (error || !data?.token) {
                if (uploads.length > 0) {
                    const { error: cleanupError } = await client.storage
                        .from(STORAGE_BUCKET)
                        .remove(uploads.map((upload) => upload.path));
                    if (cleanupError) {
                        console.error("Could not clean up incomplete signed uploads.", cleanupError.message);
                    }
                }
                console.error("Could not create signed image upload URL.", error?.message ?? "Missing upload token.");
                return jsonResponse(request, { error: "Image uploads are temporarily unavailable." }, 503);
            }

            uploads.push({ path, token: data.token, kind });
        }

        return jsonResponse(request, { uploads });
    } catch (error) {
        console.error("Upload URL request failed.", error instanceof Error ? error.message : "Unknown error.");
        return jsonResponse(request, { error: "Image uploads are temporarily unavailable." }, 503);
    }
});
