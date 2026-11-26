import { corsHeaders, jsonResponse, optionsResponse } from "../_shared/http.ts";
import {
    checkRateLimit,
    createServiceClient,
    hasValidUploadedPath,
    isAllowedImageType,
    MAX_FILE_BYTES,
    MAX_REFERENCE_IMAGES,
    MAX_TOTAL_FILE_BYTES,
    STORAGE_BUCKET,
} from "../_shared/security.ts";

type BookingInput = Record<string, unknown>;

const styles = new Set([
    "Fine line",
    "Blackwork",
    "Traditional",
    "Realism",
    "Illustrative",
    "Ornamental",
    "Other",
]);
const colors = new Set(["Black & Grey", "Colour"]);
const tattooHistories = new Set(["First tattoo", "Existing tattoo"]);
const coverUpTypes = new Set(["None", "Cover-up", "Touch-up", "Both"]);
const appointmentTimes = new Set([
    "09:00",
    "10:00",
    "11:00",
    "12:00",
    "13:00",
    "14:00",
    "15:00",
    "16:00",
    "17:00",
    "18:00",
    "Flexible",
]);
const budgetRanges = new Set([
    "Under ₹5,000",
    "₹5,000–₹10,000",
    "₹10,000–₹20,000",
    "₹20,000+",
    "To be discussed",
]);

function text(value: unknown, maximum: number): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length <= maximum ? trimmed : null;
}

function isValidDate(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const parsed = new Date(`${value}T12:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function indiaToday(): string {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());
    const part = (type: string) => parts.find((value) => value.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
}

async function validateStoredImage(
    client: ReturnType<typeof createServiceClient>,
    path: string,
    kind: "reference" | "placement",
): Promise<{ valid: boolean; size: number }> {
    if (!hasValidUploadedPath(path, kind)) {
        return { valid: false, size: 0 };
    }

    const parts = path.split("/");
    const folder = parts.slice(0, -1).join("/");
    const filename = parts[parts.length - 1];
    const { data, error } = await client.storage
        .from(STORAGE_BUCKET)
        .list(folder, { search: filename, limit: 2 });
    if (error) {
        throw new Error(`Could not verify uploaded image: ${error.message}`);
    }

    const object = data?.find((entry) => entry.name === filename);
    const metadata = object?.metadata as { mimetype?: unknown; contentType?: unknown; size?: unknown } | undefined;
    const mimeType = metadata?.mimetype ?? metadata?.contentType;
    const size = Number(metadata?.size);
    return {
        valid: Boolean(object) && isAllowedImageType(mimeType) && Number.isInteger(size) && size > 0 && size <= MAX_FILE_BYTES,
        size: Number.isFinite(size) ? size : 0,
    };
}

async function notifyStudio(booking: {
    id: string;
    customer_name: string;
    tattoo_style: string;
    preferred_date: string;
}): Promise<"sent" | "failed" | "skipped"> {
    if (Deno.env.get("WHATSAPP_CLOUD_ENABLED") !== "true") {
        return "skipped";
    }

    const token = Deno.env.get("WHATSAPP_CLOUD_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const studioNumber = Deno.env.get("WHATSAPP_STUDIO_NUMBER")?.replace(/\D/g, "");
    const templateName = Deno.env.get("WHATSAPP_TEMPLATE_NAME");
    const templateLanguage = Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE");
    const apiVersion = Deno.env.get("WHATSAPP_GRAPH_API_VERSION");
    if (!token || !phoneNumberId || !studioNumber || !templateName || !templateLanguage || !apiVersion) {
        console.error("WhatsApp Cloud notification is enabled but required settings are incomplete.");
        return "skipped";
    }

    try {
        const response = await fetch(
            `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: studioNumber,
                    type: "template",
                    template: {
                        name: templateName,
                        language: { code: templateLanguage },
                        components: [{
                            type: "body",
                            parameters: [
                                { type: "text", text: booking.id },
                                { type: "text", text: booking.customer_name },
                                { type: "text", text: booking.tattoo_style },
                                { type: "text", text: booking.preferred_date },
                            ],
                        }],
                    },
                }),
                signal: AbortSignal.timeout(8000),
            },
        );
        if (!response.ok) {
            console.error("WhatsApp Cloud notification failed.", { bookingId: booking.id, status: response.status });
            return "failed";
        }
        return "sent";
    } catch (error) {
        console.error("WhatsApp Cloud notification failed.", {
            bookingId: booking.id,
            reason: error instanceof Error ? error.message : "Unknown network error.",
        });
        return "failed";
    }
}

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

    let body: BookingInput;
    try {
        body = await request.json() as BookingInput;
    } catch {
        return jsonResponse(request, { error: "Invalid booking request." }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return jsonResponse(request, { error: "Invalid booking request." }, 400);
    }

    if (typeof body.company === "string" && body.company.trim().length > 0) {
        return jsonResponse(request, { error: "Unable to submit this request." }, 400);
    }

    try {
        const client = createServiceClient();
        const allowed = await checkRateLimit(client, request, "booking", 5, 3600);
        if (!allowed) {
            return jsonResponse(request, { error: "Too many booking attempts. Please try again later." }, 429);
        }

        const customerName = text(body.customerName, 120);
        const phone = text(body.whatsappNumber, 24);
        const email = text(body.email, 254);
        const city = text(body.city, 100);
        const style = text(body.tattooStyle, 40);
        const description = text(body.tattooDescription, 2000);
        const inspiration = text(body.meaningInspiration, 1200);
        const placement = text(body.bodyPlacement, 160);
        const color = text(body.colorPreference, 20);
        const history = text(body.tattooHistory, 30);
        const coverUpType = text(body.coverUpType, 20);
        const coverUpDetails = text(body.coverUpDetails, 1200);
        const preferredTime = text(body.preferredTime, 20);
        const budget = text(body.budgetRange, 40);
        const notes = text(body.additionalNotes, 2000);
        const sensitivities = text(body.allergySensitivity, 1200);
        const preferredDate = body.preferredDate;
        const alternativeDate = body.alternativeDate === "" || body.alternativeDate == null
            ? null
            : body.alternativeDate;
        const sizeValue = body.approximateSizeInches === "" || body.approximateSizeInches == null
            ? null
            : Number(body.approximateSizeInches);

        if (
            !customerName || customerName.length < 2
            || !phone || !/^\+?[0-9][0-9\s()-]{7,22}$/.test(phone)
            || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
            || !city || city.length < 2
            || !style || !styles.has(style)
            || !description || description.length < 10
            || inspiration === null
            || !placement || placement.length < 2
            || !color || !colors.has(color)
            || !history || !tattooHistories.has(history)
            || !coverUpType || !coverUpTypes.has(coverUpType)
            || (coverUpType !== "None" && (!coverUpDetails || coverUpDetails.length < 3))
            || !preferredTime || !appointmentTimes.has(preferredTime)
            || !budget || !budgetRanges.has(budget)
            || notes === null
            || sensitivities === null
            || body.ageConfirmed !== true
            || !isValidDate(preferredDate)
            || preferredDate < indiaToday()
            || (alternativeDate !== null && (
                !isValidDate(alternativeDate)
                || alternativeDate < indiaToday()
                || alternativeDate === preferredDate
            ))
            || (sizeValue !== null && (!Number.isFinite(sizeValue) || sizeValue <= 0 || sizeValue > 100))
        ) {
            return jsonResponse(request, { error: "Some booking details are missing or invalid. Review the form and try again." }, 400);
        }

        const referencePaths = body.referencePaths;
        const placementPhotoPath = body.placementPhotoPath === "" || body.placementPhotoPath == null
            ? null
            : body.placementPhotoPath;
        if (
            !Array.isArray(referencePaths)
            || referencePaths.length > MAX_REFERENCE_IMAGES
            || referencePaths.some((path) => typeof path !== "string")
            || new Set(referencePaths).size !== referencePaths.length
            || (placementPhotoPath !== null && typeof placementPhotoPath !== "string")
        ) {
            return jsonResponse(request, { error: "The image references are invalid. Please select them again." }, 400);
        }

        const verifiedReferences = await Promise.all(
            referencePaths.map((path) => validateStoredImage(client, path as string, "reference")),
        );
        const verifiedPlacement = placementPhotoPath
            ? await validateStoredImage(client, placementPhotoPath as string, "placement")
            : null;
        const uploadedBytes = verifiedReferences.reduce((sum, item) => sum + item.size, 0)
            + (verifiedPlacement?.size ?? 0);
        if (
            verifiedReferences.some((item) => !item.valid)
            || (verifiedPlacement !== null && !verifiedPlacement.valid)
            || uploadedBytes > MAX_TOTAL_FILE_BYTES
        ) {
            return jsonResponse(request, { error: "One or more uploaded images could not be verified. Please upload them again." }, 400);
        }

        const bookingPayload = {
            customer_name: customerName,
            whatsapp_number: phone,
            email,
            city,
            tattoo_style: style,
            tattoo_description: description,
            meaning_inspiration: inspiration,
            body_placement: placement,
            approximate_size_inches: sizeValue,
            color_preference: color,
            tattoo_history: history,
            cover_up_type: coverUpType,
            cover_up_details: coverUpDetails,
            inspiration_paths: referencePaths,
            placement_photo_path: placementPhotoPath,
            preferred_date: preferredDate,
            alternative_date: alternativeDate,
            preferred_time: preferredTime,
            time_zone: "Asia/Kolkata",
            budget_range: budget,
            additional_notes: notes,
            allergy_sensitivity: sensitivities,
            age_confirmed: true,
        };
        const { data: booking, error } = await client
            .from("bookings")
            .insert(bookingPayload)
            .select("id, customer_name, tattoo_style, preferred_date, created_at")
            .single();
        if (error || !booking) {
            console.error("Booking insert failed.", error?.message ?? "No booking row returned.");
            return jsonResponse(request, { error: "Your request could not be saved. Please try again." }, 503);
        }

        const notificationStatus = await notifyStudio({
            id: booking.id,
            customer_name: booking.customer_name,
            tattoo_style: booking.tattoo_style,
            preferred_date: booking.preferred_date,
        });
        return jsonResponse(request, {
            bookingId: booking.id,
            createdAt: booking.created_at,
            notificationStatus,
        }, 201);
    } catch (error) {
        console.error("Booking submission failed.", error instanceof Error ? error.message : "Unknown error.");
        return jsonResponse(request, { error: "Your request could not be saved. Please try again." }, 503);
    }
});
