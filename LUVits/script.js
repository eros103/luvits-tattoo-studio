const menuToggle = document.querySelector("[data-menu-toggle]");
const navMenu = document.querySelector("#primary-navigation");

if (menuToggle instanceof HTMLButtonElement && navMenu instanceof HTMLElement) {
    const closeMenu = () => {
        menuToggle.setAttribute("aria-expanded", "false");
        menuToggle.setAttribute("aria-label", "Open navigation menu");
        navMenu.classList.remove("is-open");
    };

    menuToggle.addEventListener("click", () => {
        const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
        menuToggle.setAttribute("aria-expanded", String(!isOpen));
        menuToggle.setAttribute("aria-label", isOpen ? "Open navigation menu" : "Close navigation menu");
        navMenu.classList.toggle("is-open", !isOpen);
    });

    navMenu.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest("a")) {
            closeMenu();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeMenu();
            menuToggle.focus();
        }
    });

    window.matchMedia("(min-width: 761px)").addEventListener("change", closeMenu);
}

const bookingDialog = document.querySelector("#booking-dialog");
const bookingForm = document.querySelector("#booking-form");

if (bookingDialog instanceof HTMLDialogElement && bookingForm instanceof HTMLFormElement) {
    const config = window.LUVITS_SUPABASE_CONFIG;
    const supabaseFactory = window.supabase?.createClient;
    const supabaseClient = config?.url && config?.anonKey && supabaseFactory
        ? supabaseFactory(config.url, config.anonKey, {
            auth: { autoRefreshToken: true, persistSession: true },
        })
        : null;
    const formMessage = bookingForm.querySelector("[data-form-message]");
    const successPanel = bookingDialog.querySelector("[data-booking-success]");
    const referenceInput = bookingForm.querySelector("[data-reference-input]");
    const placementInput = bookingForm.querySelector("[data-placement-input]");
    const referencePreview = bookingForm.querySelector("[data-reference-previews]");
    const placementPreview = bookingForm.querySelector("[data-placement-preview]");
    const coverUpType = bookingForm.elements.namedItem("coverUpType");
    const coverUpDetails = bookingForm.querySelector("[data-cover-up-details]");
    const stepNames = ["Your details", "Tattoo vision", "References", "Appointment preferences", "Review"];
    const maxFileSize = 5 * 1024 * 1024;
    const maxTotalFileSize = 15 * 1024 * 1024;
    const maxReferenceImages = 5;
    const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    let activeStep = 1;
    let referenceFiles = [];
    let placementFile = null;
    let previewUrls = [];

    const todayInIndia = () => {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Kolkata",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).formatToParts(new Date());
        const getPart = (type) => parts.find((part) => part.type === type)?.value ?? "";
        return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
    };

    const setMessage = (message) => {
        if (formMessage) {
            formMessage.textContent = message;
        }
    };

    const formValue = (name) => {
        const value = new FormData(bookingForm).get(name);
        return typeof value === "string" ? value.trim() : "";
    };

    const setActiveStep = (step) => {
        activeStep = step;
        bookingForm.querySelectorAll("[data-form-step]").forEach((panel) => {
            panel.hidden = Number(panel.dataset.formStep) !== step;
        });
        bookingDialog.querySelectorAll("[data-progress-step]").forEach((item) => {
            if (Number(item.dataset.progressStep) === step) {
                item.setAttribute("aria-current", "step");
            } else {
                item.removeAttribute("aria-current");
            }
        });

        const caption = bookingDialog.querySelector("[data-step-caption]");
        const progress = bookingDialog.querySelector("[data-progress-bar]");
        const backButton = bookingDialog.querySelector("[data-step-back]");
        const nextButton = bookingDialog.querySelector("[data-step-next]");
        const submitButton = bookingDialog.querySelector("[data-submit-booking]");
        if (caption) {
            caption.textContent = `Step ${step} of 5 — ${stepNames[step - 1]}`;
        }
        if (progress) {
            progress.style.width = `${step * 20}%`;
        }
        if (backButton instanceof HTMLButtonElement) {
            backButton.hidden = step === 1;
        }
        if (nextButton instanceof HTMLButtonElement) {
            nextButton.hidden = step === 5;
        }
        if (submitButton instanceof HTMLButtonElement) {
            submitButton.hidden = step !== 5;
        }
    };

    const clearPreviewUrls = () => {
        previewUrls.forEach((url) => URL.revokeObjectURL(url));
        previewUrls = [];
    };

    const renderPreviews = () => {
        clearPreviewUrls();
        if (!(referencePreview instanceof HTMLElement) || !(placementPreview instanceof HTMLElement)) {
            return;
        }

        const renderList = (container, files, kind) => {
            container.replaceChildren();
            files.forEach((file, index) => {
                const card = document.createElement("div");
                card.className = "file-preview";
                const image = document.createElement("img");
                const url = URL.createObjectURL(file);
                previewUrls.push(url);
                image.src = url;
                image.alt = `Preview of ${file.name}`;

                const fileName = document.createElement("p");
                fileName.textContent = file.name;
                const remove = document.createElement("button");
                remove.type = "button";
                remove.textContent = "×";
                remove.setAttribute("aria-label", `Remove ${file.name}`);
                remove.addEventListener("click", () => {
                    if (kind === "reference") {
                        referenceFiles = referenceFiles.filter((_, fileIndex) => fileIndex !== index);
                    } else {
                        placementFile = null;
                    }
                    renderPreviews();
                });
                card.append(image, fileName, remove);
                container.append(card);
            });
        };

        renderList(referencePreview, referenceFiles, "reference");
        renderList(placementPreview, placementFile ? [placementFile] : [], "placement");
    };

    const totalSelectedBytes = () => referenceFiles.reduce((sum, file) => sum + file.size, 0)
        + (placementFile?.size ?? 0);

    const setFiles = (files, kind) => {
        let notice = "";
        for (const file of files) {
            if (!allowedImageTypes.has(file.type)) {
                notice = "Use JPEG, PNG, or WebP images only.";
                continue;
            }
            if (file.size < 1 || file.size > maxFileSize) {
                notice = "Each image must be smaller than 5 MB.";
                continue;
            }

            if (kind === "reference") {
                const duplicate = referenceFiles.some((existing) => (
                    existing.name === file.name
                    && existing.size === file.size
                    && existing.lastModified === file.lastModified
                ));
                if (duplicate) {
                    continue;
                }
                if (referenceFiles.length >= maxReferenceImages) {
                    notice = "You can add up to five inspiration images.";
                    continue;
                }
                if (totalSelectedBytes() + file.size > maxTotalFileSize) {
                    notice = "The selected images cannot exceed 15 MB in total.";
                    continue;
                }
                referenceFiles.push(file);
            } else {
                if (placementFile) {
                    notice = "Remove the current placement photo before choosing another.";
                    continue;
                }
                if (totalSelectedBytes() + file.size > maxTotalFileSize) {
                    notice = "The selected images cannot exceed 15 MB in total.";
                    continue;
                }
                placementFile = file;
            }
        }

        renderPreviews();
        setMessage(notice);
    };

    if (referenceInput instanceof HTMLInputElement) {
        referenceInput.addEventListener("change", () => {
            setFiles(Array.from(referenceInput.files ?? []), "reference");
            referenceInput.value = "";
        });
    }
    if (placementInput instanceof HTMLInputElement) {
        placementInput.addEventListener("change", () => {
            setFiles(Array.from(placementInput.files ?? []), "placement");
            placementInput.value = "";
        });
    }

    const updateCoverUpDetails = () => {
        if (
            coverUpType instanceof HTMLSelectElement
            && coverUpDetails instanceof HTMLElement
        ) {
            const detailsInput = coverUpDetails.querySelector("textarea");
            const isRequired = coverUpType.value !== "None";
            coverUpDetails.hidden = !isRequired;
            if (detailsInput instanceof HTMLTextAreaElement) {
                detailsInput.required = isRequired;
                if (!isRequired) {
                    detailsInput.value = "";
                }
            }
        }
    };
    if (coverUpType instanceof HTMLSelectElement) {
        coverUpType.addEventListener("change", updateCoverUpDetails);
        updateCoverUpDetails();
    }

    const setDateLimits = () => {
        const minimum = todayInIndia();
        const preferred = bookingForm.elements.namedItem("preferredDate");
        const alternative = bookingForm.elements.namedItem("alternativeDate");
        if (preferred instanceof HTMLInputElement) {
            preferred.min = minimum;
        }
        if (alternative instanceof HTMLInputElement) {
            alternative.min = minimum;
        }
    };
    setDateLimits();

    const validateActiveStep = () => {
        const activePanel = bookingForm.querySelector(`[data-form-step="${activeStep}"]`);
        if (!(activePanel instanceof HTMLFieldSetElement)) {
            return false;
        }

        const preferredDate = bookingForm.elements.namedItem("preferredDate");
        const alternativeDate = bookingForm.elements.namedItem("alternativeDate");
        if (preferredDate instanceof HTMLInputElement && alternativeDate instanceof HTMLInputElement) {
            alternativeDate.setCustomValidity(
                alternativeDate.value && alternativeDate.value === preferredDate.value
                    ? "Choose a different alternative date."
                    : "",
            );
            if (!alternativeDate.checkValidity()) {
                alternativeDate.reportValidity();
                return false;
            }
        }

        const seenRadioGroups = new Set();
        for (const field of activePanel.querySelectorAll("input, select, textarea")) {
            if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) {
                continue;
            }
            if (field.disabled || (!field.required && !field.value)) {
                continue;
            }
            if (field instanceof HTMLInputElement && field.type === "radio") {
                if (seenRadioGroups.has(field.name)) {
                    continue;
                }
                seenRadioGroups.add(field.name);
            }
            if (!field.checkValidity()) {
                field.reportValidity();
                return false;
            }
        }
        return true;
    };

    const reviewFields = [
        ["Name", () => formValue("customerName")],
        ["WhatsApp", () => formValue("whatsappNumber")],
        ["Email", () => formValue("email")],
        ["City", () => formValue("city")],
        ["Style", () => formValue("tattooStyle")],
        ["Tattoo idea", () => formValue("tattooDescription")],
        ["Meaning / inspiration", () => formValue("meaningInspiration")],
        ["Placement", () => formValue("bodyPlacement")],
        ["Approximate size", () => formValue("approximateSizeInches") ? `${formValue("approximateSizeInches")} inches` : "Not specified"],
        ["Colour", () => formValue("colorPreference")],
        ["Tattoo history", () => formValue("tattooHistory")],
        ["Cover-up / touch-up", () => `${formValue("coverUpType")}${formValue("coverUpDetails") ? ` — ${formValue("coverUpDetails")}` : ""}`],
        ["Preferred date", () => formValue("preferredDate")],
        ["Alternative date", () => formValue("alternativeDate") || "Not specified"],
        ["Preferred time (IST)", () => formValue("preferredTime")],
        ["Budget", () => formValue("budgetRange")],
        ["Allergies / sensitivities", () => formValue("allergySensitivity") || "Not specified"],
        ["Additional notes", () => formValue("additionalNotes") || "None"],
        ["Reference images", () => `${referenceFiles.length} selected`],
        ["Placement photo", () => placementFile ? "1 selected" : "None"],
    ];

    const renderReview = () => {
        const review = bookingDialog.querySelector("[data-booking-review]");
        if (!(review instanceof HTMLElement)) {
            return;
        }
        review.replaceChildren();
        reviewFields.forEach(([label, getValue]) => {
            const item = document.createElement("dl");
            item.className = "review-item";
            if (["Tattoo idea", "Meaning / inspiration", "Cover-up / touch-up", "Allergies / sensitivities", "Additional notes"].includes(label)) {
                item.classList.add("review-item-wide");
            }
            const term = document.createElement("dt");
            term.textContent = label;
            const value = document.createElement("dd");
            value.textContent = getValue();
            item.append(term, value);
            review.append(item);
        });
    };

    const resetBooking = () => {
        bookingForm.reset();
        bookingForm.hidden = false;
        if (successPanel instanceof HTMLElement) {
            successPanel.hidden = true;
        }
        referenceFiles = [];
        placementFile = null;
        clearPreviewUrls();
        renderPreviews();
        setMessage("");
        setDateLimits();
        updateCoverUpDetails();
        setActiveStep(1);
    };

    const openBooking = (event) => {
        event.preventDefault();
        if (!bookingDialog.open) {
            if (successPanel instanceof HTMLElement && !successPanel.hidden) {
                resetBooking();
            }
            setMessage("");
            bookingDialog.showModal();
            setActiveStep(1);
        }
    };
    document.querySelectorAll("[data-booking-open]").forEach((link) => {
        link.addEventListener("click", openBooking);
    });

    bookingDialog.querySelector("[data-dialog-close]")?.addEventListener("click", () => bookingDialog.close());
    bookingDialog.querySelector("[data-success-close]")?.addEventListener("click", () => {
        resetBooking();
        bookingDialog.close();
    });
    bookingDialog.addEventListener("click", (event) => {
        if (event.target === bookingDialog) {
            bookingDialog.close();
        }
    });

    bookingDialog.querySelector("[data-step-back]")?.addEventListener("click", () => {
        setMessage("");
        setActiveStep(Math.max(1, activeStep - 1));
        bookingDialog.scrollTo({ top: 0, behavior: "smooth" });
    });
    bookingDialog.querySelector("[data-step-next]")?.addEventListener("click", () => {
        if (!validateActiveStep()) {
            return;
        }
        setMessage("");
        const nextStep = Math.min(5, activeStep + 1);
        if (nextStep === 5) {
            renderReview();
        }
        setActiveStep(nextStep);
        bookingDialog.scrollTo({ top: 0, behavior: "smooth" });
    });

    const readFunctionError = async (error) => {
        const context = error?.context;
        if (context instanceof Response) {
            try {
                const payload = await context.clone().json();
                if (typeof payload.error === "string") {
                    return payload.error;
                }
            } catch {
                return error.message || "The booking service returned an error.";
            }
        }
        return error?.message || "The booking service returned an error.";
    };

    const invokeFunction = async (name, body) => {
        const { data, error } = await supabaseClient.functions.invoke(name, { body });
        if (error) {
            throw new Error(await readFunctionError(error));
        }
        return data;
    };

    const uploadSelectedImages = async () => {
        const files = [
            ...referenceFiles.map((file) => ({ file, kind: "reference" })),
            ...(placementFile ? [{ file: placementFile, kind: "placement" }] : []),
        ];
        if (files.length === 0) {
            return { referencePaths: [], placementPhotoPath: null };
        }

        const result = await invokeFunction("create-booking-uploads", {
            files: files.map(({ file, kind }) => ({ kind, type: file.type, size: file.size })),
        });
        if (!Array.isArray(result?.uploads) || result.uploads.length !== files.length) {
            throw new Error("Could not prepare the image uploads. Please try again.");
        }

        const paths = { referencePaths: [], placementPhotoPath: null };
        for (let index = 0; index < files.length; index += 1) {
            const { file, kind } = files[index];
            const upload = result.uploads[index];
            const { error } = await supabaseClient.storage
                .from("booking-references")
                .uploadToSignedUrl(upload.path, upload.token, file, {
                    contentType: file.type,
                    upsert: false,
                });
            if (error) {
                throw new Error(`Could not upload ${file.name}. ${error.message}`);
            }
            if (kind === "reference") {
                paths.referencePaths.push(upload.path);
            } else {
                paths.placementPhotoPath = upload.path;
            }
        }
        return paths;
    };

    const makeBookingPayload = (paths) => ({
        company: formValue("company"),
        customerName: formValue("customerName"),
        whatsappNumber: formValue("whatsappNumber"),
        email: formValue("email"),
        city: formValue("city"),
        tattooStyle: formValue("tattooStyle"),
        tattooDescription: formValue("tattooDescription"),
        meaningInspiration: formValue("meaningInspiration"),
        bodyPlacement: formValue("bodyPlacement"),
        approximateSizeInches: formValue("approximateSizeInches"),
        colorPreference: formValue("colorPreference"),
        tattooHistory: formValue("tattooHistory"),
        coverUpType: formValue("coverUpType"),
        coverUpDetails: formValue("coverUpDetails"),
        preferredDate: formValue("preferredDate"),
        alternativeDate: formValue("alternativeDate"),
        preferredTime: formValue("preferredTime"),
        budgetRange: formValue("budgetRange"),
        additionalNotes: formValue("additionalNotes"),
        allergySensitivity: formValue("allergySensitivity"),
        ageConfirmed: bookingForm.elements.namedItem("ageConfirmed").checked,
        referencePaths: paths.referencePaths,
        placementPhotoPath: paths.placementPhotoPath,
    });

    bookingForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (activeStep !== 5 || !validateActiveStep()) {
            return;
        }

        const submitButton = bookingForm.querySelector("[data-submit-booking]");
        if (!(submitButton instanceof HTMLButtonElement)) {
            setMessage("The form could not be submitted. Please reload and try again.");
            return;
        }

        let whatsappWindow = null;
        if (supabaseClient) {
            whatsappWindow = window.open("about:blank", "_blank");
            if (whatsappWindow) {
                whatsappWindow.opener = null;
            }
        }

        submitButton.disabled = true;
        setMessage("");
        if (!supabaseClient) {
            setMessage("Online booking is not configured yet. Please contact the studio using WhatsApp.");
            submitButton.disabled = false;
            if (whatsappWindow) {
                whatsappWindow.close();
            }
            return;
        }

        try {
            const paths = await uploadSelectedImages();
            const result = await invokeFunction("submit-booking", makeBookingPayload(paths));
            if (typeof result?.bookingId !== "string") {
                throw new Error("The booking service did not return a confirmation. Please contact the studio before resubmitting.");
            }

            const message = [
                "Hello LUVits, I have submitted a tattoo booking request.",
                `Booking ID: ${result.bookingId}`,
                `Name: ${formValue("customerName")}`,
                `WhatsApp: ${formValue("whatsappNumber")}`,
                `Email: ${formValue("email")}`,
                `Tattoo style: ${formValue("tattooStyle")}`,
                `Preferred appointment: ${formValue("preferredDate")} at ${formValue("preferredTime")} IST`,
            ].join("\n");
            const whatsappUrl = `https://wa.me/918057167682?text=${encodeURIComponent(message)}`;
            const whatsappLink = bookingDialog.querySelector("[data-whatsapp-success-link]");
            if (whatsappLink instanceof HTMLAnchorElement) {
                whatsappLink.href = whatsappUrl;
                whatsappLink.hidden = Boolean(whatsappWindow);
            }

            bookingForm.hidden = true;
            if (successPanel instanceof HTMLElement) {
                successPanel.hidden = false;
                const bookingId = successPanel.querySelector("[data-success-booking-id]");
                if (bookingId) {
                    bookingId.textContent = result.bookingId;
                }
            }

            if (whatsappWindow) {
                try {
                    whatsappWindow.location.href = whatsappUrl;
                } catch {
                    if (whatsappLink instanceof HTMLAnchorElement) {
                        whatsappLink.hidden = false;
                    }
                }
            }
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "The request could not be submitted. Please try again.");
            if (whatsappWindow) {
                whatsappWindow.close();
            }
        } finally {
            submitButton.disabled = false;
        }
    });
}
