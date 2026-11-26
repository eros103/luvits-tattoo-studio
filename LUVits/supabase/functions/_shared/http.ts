export function corsHeaders(request: Request): Record<string, string> | null {
    const appOrigin = Deno.env.get("APP_ORIGIN");
    const requestOrigin = request.headers.get("origin");

    if (!appOrigin || (requestOrigin && requestOrigin !== appOrigin)) {
        return null;
    }

    return {
        "Access-Control-Allow-Origin": appOrigin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
    };
}

export function jsonResponse(
    request: Request,
    body: Record<string, unknown>,
    status = 200,
): Response {
    const headers = corsHeaders(request);
    if (!headers) {
        return new Response(JSON.stringify({ error: "Origin is not allowed." }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(body), {
        status,
        headers: { ...headers, "Content-Type": "application/json" },
    });
}

export function optionsResponse(request: Request): Response {
    const headers = corsHeaders(request);
    return headers
        ? new Response("ok", { headers })
        : new Response("Origin is not allowed.", { status: 403 });
}

