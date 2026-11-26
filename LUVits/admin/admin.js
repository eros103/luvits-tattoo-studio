const adminConfig = window.LUVITS_SUPABASE_CONFIG;
const adminSupabaseFactory = window.supabase?.createClient;
const adminClient = adminConfig?.url && adminConfig?.anonKey && adminSupabaseFactory
    ? adminSupabaseFactory(adminConfig.url, adminConfig.anonKey, {
        auth: { autoRefreshToken: true, persistSession: true },
    })
    : null;

const loginPanel = document.querySelector("#admin-login");
const dashboardPanel = document.querySelector("#admin-dashboard");
const loginForm = document.querySelector("#admin-login-form");
const loginMessage = document.querySelector("[data-admin-login-message]");
const dashboardMessage = document.querySelector("[data-admin-dashboard-message]");
const bookingList = document.querySelector("[data-booking-list]");
const detailDialog = document.querySelector("#admin-booking-detail");
const detailContent = document.querySelector("[data-detail-content]");
const detailImages = document.querySelector("[data-detail-images]");
const detailMessage = document.querySelector("[data-detail-message]");
const saveMessage = document.querySelector("[data-save-message]");
const adminBookingForm = document.querySelector("[data-booking-admin-form]");
const statusFilter = document.querySelector("[data-booking-status-filter]");
const searchInput = document.querySelector("[data-booking-search]");
const dateFilter = document.querySelector("[data-booking-date-filter]");

let bookings = [];
let selectedBooking = null;
let refreshInProgress = false;

const setMessage = (element, message) => {
    if (element instanceof HTMLElement) {
        element.textContent = message;
    }
};

const formatIndiaDate = (value) => {
    if (!value) {
        return "Not set";
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, 12));
    return new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
    }).format(date);
};

const dateInIndia = (value) => {
    if (!value) {
        return "";
    }
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date(value));
    const part = (type) => parts.find((entry) => entry.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
};

const formatIndiaDateTime = (value) => {
    if (!value) {
        return "Not scheduled";
    }
    return new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
    }).format(new Date(value));
};

const getScheduledInputValues = (value) => {
    if (!value) {
        return { date: "", time: "" };
    }
    const dateParts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date(value));
    const timeParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(new Date(value));
    const datePart = (parts, type) => parts.find((entry) => entry.type === type)?.value ?? "";
    return {
        date: `${datePart(dateParts, "year")}-${datePart(dateParts, "month")}-${datePart(dateParts, "day")}`,
        time: `${datePart(timeParts, "hour")}:${datePart(timeParts, "minute")}`,
    };
};

const escapeText = (value, fallback = "Not provided") => (
    typeof value === "string" && value.trim() ? value.trim() : fallback
);

function updateOverview() {
    const pendingStatuses = new Set(["New", "Under Review", "Contacted", "Consultation Scheduled"]);
    const totals = {
        total: bookings.length,
        new: bookings.filter((booking) => booking.status === "New").length,
        pending: bookings.filter((booking) => pendingStatuses.has(booking.status)).length,
        confirmed: bookings.filter((booking) => booking.status === "Confirmed").length,
        completed: bookings.filter((booking) => booking.status === "Completed").length,
    };
    Object.entries(totals).forEach(([key, value]) => {
        const element = document.querySelector(`[data-stat-${key}]`);
        if (element) {
            element.textContent = String(value);
        }
    });
}

function renderBookings() {
    if (!(bookingList instanceof HTMLElement)) {
        return;
    }
    const term = searchInput instanceof HTMLInputElement ? searchInput.value.trim().toLowerCase() : "";
    const status = statusFilter instanceof HTMLSelectElement ? statusFilter.value : "";
    const preferredDate = dateFilter instanceof HTMLInputElement ? dateFilter.value : "";
    const filtered = bookings.filter((booking) => {
        const matchesText = !term
            || booking.customer_name.toLowerCase().includes(term)
            || booking.whatsapp_number.toLowerCase().includes(term);
        const matchesStatus = !status || booking.status === status;
        const appointmentDate = booking.scheduled_at
            ? dateInIndia(booking.scheduled_at)
            : booking.preferred_date;
        const matchesDate = !preferredDate || appointmentDate === preferredDate;
        return matchesText && matchesStatus && matchesDate;
    });

    bookingList.replaceChildren();
    if (filtered.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = bookings.length === 0
            ? "No booking requests have been received."
            : "No requests match these filters.";
        bookingList.append(empty);
        return;
    }

    filtered.forEach((booking) => {
        const card = document.createElement("button");
        card.className = "booking-card";
        card.type = "button";
        card.setAttribute("aria-label", `Open booking from ${booking.customer_name}`);

        const customer = document.createElement("span");
        const customerName = document.createElement("strong");
        customerName.textContent = booking.customer_name;
        const customerPhone = document.createElement("span");
        customerPhone.textContent = booking.whatsapp_number;
        customer.append(customerName, customerPhone);

        const tattoo = document.createElement("span");
        const tattooStyle = document.createElement("strong");
        tattooStyle.textContent = booking.tattoo_style;
        const createdAt = document.createElement("span");
        createdAt.textContent = `Received ${formatIndiaDateTime(booking.created_at)}`;
        tattoo.append(tattooStyle, createdAt);

        const appointment = document.createElement("span");
        const appointmentDate = document.createElement("strong");
        appointmentDate.textContent = booking.scheduled_at
            ? formatIndiaDateTime(booking.scheduled_at)
            : formatIndiaDate(booking.preferred_date);
        const preferredTime = document.createElement("span");
        preferredTime.textContent = booking.scheduled_at
            ? "Scheduled appointment"
            : `${booking.preferred_time} preferred`;
        appointment.append(appointmentDate, preferredTime);

        const bookingStatus = document.createElement("span");
        bookingStatus.className = "booking-card-status";
        bookingStatus.textContent = booking.status;
        card.append(customer, tattoo, appointment, bookingStatus);
        card.addEventListener("click", () => openBookingDetails(booking));
        bookingList.append(card);
    });
}

async function loadBookings() {
    if (!adminClient || refreshInProgress) {
        return;
    }
    refreshInProgress = true;
    setMessage(dashboardMessage, "Loading booking requests…");
    const { data, error } = await adminClient
        .from("bookings")
        .select("*")
        .order("created_at", { ascending: false });
    refreshInProgress = false;

    if (error) {
        setMessage(dashboardMessage, `Could not load requests: ${error.message}`);
        return;
    }
    bookings = data ?? [];
    setMessage(dashboardMessage, "");
    updateOverview();
    renderBookings();
}

function addDetailItem(label, value, wide = false) {
    const item = document.createElement("dl");
    item.className = wide ? "detail-group detail-group-wide" : "detail-group";
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = escapeText(value);
    item.append(term, description);
    detailContent.append(item);
}

async function loadReferenceImages(booking) {
    if (!(detailImages instanceof HTMLElement)) {
        return;
    }
    detailImages.replaceChildren();
    const imageCount = (booking.inspiration_paths?.length ?? 0) + (booking.placement_photo_path ? 1 : 0);
    if (imageCount === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No reference images were included.";
        detailImages.append(empty);
        return;
    }

    setMessage(detailMessage, "Loading private image links…");
    const { data, error } = await adminClient.functions.invoke("admin-reference-links", {
        body: { bookingId: booking.id },
    });
    if (error) {
        setMessage(detailMessage, `Reference images are unavailable: ${error.message}`);
        return;
    }
    if (!Array.isArray(data?.signedImages)) {
        setMessage(detailMessage, "The image service returned an invalid response.");
        return;
    }

    data.signedImages.forEach((image, index) => {
        const link = document.createElement("a");
        link.href = image.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", `Open ${image.kind === "placement" ? "placement photo" : `reference image ${index + 1}`}`);
        const preview = document.createElement("img");
        preview.src = image.url;
        preview.alt = image.kind === "placement" ? "Customer placement photo" : `Tattoo reference ${index + 1}`;
        const caption = document.createElement("p");
        caption.textContent = image.kind === "placement" ? "Placement photo" : `Reference ${index + 1}`;
        link.append(preview, caption);
        detailImages.append(link);
    });
    setMessage(detailMessage, "");
}

async function openBookingDetails(booking) {
    if (
        !(detailDialog instanceof HTMLDialogElement)
        || !(detailContent instanceof HTMLElement)
        || !(adminBookingForm instanceof HTMLFormElement)
    ) {
        return;
    }
    selectedBooking = booking;
    const title = detailDialog.querySelector("#detail-title");
    if (title) {
        title.textContent = `Request ${booking.id}`;
    }
    detailContent.replaceChildren();
    addDetailItem("Customer", booking.customer_name);
    addDetailItem("WhatsApp", booking.whatsapp_number);
    addDetailItem("Email", booking.email);
    addDetailItem("City", booking.city);
    addDetailItem("Tattoo style", booking.tattoo_style);
    addDetailItem("Tattoo description", booking.tattoo_description, true);
    addDetailItem("Meaning / inspiration", booking.meaning_inspiration, true);
    addDetailItem("Body placement", booking.body_placement);
    addDetailItem("Approximate size", booking.approximate_size_inches
        ? `${booking.approximate_size_inches} inches`
        : "Not specified");
    addDetailItem("Colour preference", booking.color_preference);
    addDetailItem("Tattoo history", booking.tattoo_history);
    addDetailItem("Cover-up / touch-up", booking.cover_up_type);
    addDetailItem("Cover-up details", booking.cover_up_details, true);
    addDetailItem("Preferred date", `${formatIndiaDate(booking.preferred_date)} at ${booking.preferred_time} IST`);
    addDetailItem("Alternative date", formatIndiaDate(booking.alternative_date));
    addDetailItem("Scheduled appointment", formatIndiaDateTime(booking.scheduled_at));
    addDetailItem("Budget", booking.budget_range);
    addDetailItem("Allergies / skin sensitivities", booking.allergy_sensitivity, true);
    addDetailItem("Additional notes", booking.additional_notes, true);
    addDetailItem("Age confirmation", booking.age_confirmed ? "Confirmed 18 or older" : "Not confirmed");
    addDetailItem("Received", formatIndiaDateTime(booking.created_at));
    addDetailItem("Booking status", booking.status);

    adminBookingForm.elements.namedItem("status").value = booking.status;
    adminBookingForm.elements.namedItem("adminNotes").value = booking.admin_notes ?? "";
    const scheduled = getScheduledInputValues(booking.scheduled_at);
    adminBookingForm.elements.namedItem("scheduledDate").value = scheduled.date;
    adminBookingForm.elements.namedItem("scheduledTime").value = scheduled.time;
    setMessage(detailMessage, "");
    setMessage(saveMessage, "");
    detailDialog.showModal();
    await loadReferenceImages(booking);
}

async function establishAdminSession(user) {
    setMessage(loginMessage, "Checking administrator access…");
    const { data: role, error } = await adminClient
        .from("studio_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
    if (error || !role) {
        await adminClient.auth.signOut();
        setMessage(loginMessage, error
            ? `Could not verify administrator access: ${error.message}`
            : "This account is not authorized to access the studio dashboard.");
        return;
    }

    loginPanel.hidden = true;
    dashboardPanel.hidden = false;
    setMessage(loginMessage, "");
    await loadBookings();
}

if (!(loginPanel instanceof HTMLElement) || !(dashboardPanel instanceof HTMLElement)) {
    throw new Error("The administrator page is missing required content.");
}

if (!adminClient) {
    setMessage(loginMessage, "Set the Supabase project URL and public anon/publishable key in supabase-config.js before signing in.");
} else {
    adminClient.auth.getSession().then(({ data, error }) => {
        if (error) {
            setMessage(loginMessage, `Could not restore the administrator session: ${error.message}`);
        } else if (data.session?.user) {
            establishAdminSession(data.session.user);
        }
    });

    loginForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!(loginForm instanceof HTMLFormElement)) {
            return;
        }
        const values = new FormData(loginForm);
        const email = String(values.get("email") ?? "").trim();
        const password = String(values.get("password") ?? "");
        const submitButton = loginForm.querySelector('button[type="submit"]');
        if (submitButton instanceof HTMLButtonElement) {
            submitButton.disabled = true;
        }
        setMessage(loginMessage, "Signing in…");
        const { data, error } = await adminClient.auth.signInWithPassword({ email, password });
        if (error) {
            setMessage(loginMessage, `Sign-in failed: ${error.message}`);
        } else if (data.user) {
            await establishAdminSession(data.user);
        }
        if (submitButton instanceof HTMLButtonElement) {
            submitButton.disabled = false;
        }
    });

    document.querySelector("[data-admin-sign-out]")?.addEventListener("click", async () => {
        const { error } = await adminClient.auth.signOut();
        if (error) {
            setMessage(dashboardMessage, `Could not sign out: ${error.message}`);
            return;
        }
        bookings = [];
        dashboardPanel.hidden = true;
        loginPanel.hidden = false;
        loginForm?.reset();
        setMessage(loginMessage, "");
    });

    document.querySelector("[data-booking-refresh]")?.addEventListener("click", loadBookings);
    searchInput?.addEventListener("input", renderBookings);
    statusFilter?.addEventListener("change", renderBookings);
    dateFilter?.addEventListener("change", renderBookings);

    detailDialog?.querySelector("[data-detail-close]")?.addEventListener("click", () => detailDialog.close());
    detailDialog?.addEventListener("click", (event) => {
        if (event.target === detailDialog) {
            detailDialog.close();
        }
    });

    adminBookingForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!selectedBooking || !(adminBookingForm instanceof HTMLFormElement)) {
            return;
        }
        const formData = new FormData(adminBookingForm);
        const date = String(formData.get("scheduledDate") ?? "");
        const time = String(formData.get("scheduledTime") ?? "");
        if (Boolean(date) !== Boolean(time)) {
            setMessage(saveMessage, "Enter both an appointment date and time, or leave both empty.");
            return;
        }

        let scheduledAt = null;
        if (date && time) {
            const timestamp = new Date(`${date}T${time}:00+05:30`);
            if (Number.isNaN(timestamp.getTime())) {
                setMessage(saveMessage, "Enter a valid appointment date and time.");
                return;
            }
            scheduledAt = timestamp.toISOString();
        }

        const saveButton = adminBookingForm.querySelector("[data-save-booking]");
        if (saveButton instanceof HTMLButtonElement) {
            saveButton.disabled = true;
        }
        setMessage(saveMessage, "Saving changes…");
        const { data, error } = await adminClient
            .from("bookings")
            .update({
                status: String(formData.get("status")),
                admin_notes: String(formData.get("adminNotes") ?? "").trim(),
                scheduled_at: scheduledAt,
            })
            .eq("id", selectedBooking.id)
            .select("id")
            .single();

        if (error || !data) {
            setMessage(saveMessage, `Could not save changes: ${error?.message ?? "No booking was updated."}`);
        } else {
            setMessage(saveMessage, "Changes saved.");
            await loadBookings();
            selectedBooking = bookings.find((booking) => booking.id === selectedBooking.id) ?? selectedBooking;
            const title = detailDialog.querySelector("#detail-title");
            if (title) {
                title.textContent = `Request ${selectedBooking.id}`;
            }
        }
        if (saveButton instanceof HTMLButtonElement) {
            saveButton.disabled = false;
        }
    });
}

