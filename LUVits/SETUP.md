# LUVits booking system setup

The website remains a static HTML/CSS/JavaScript site. Supabase handles booking storage, private images, administrator access, and server-side validation. The public website uses only the Supabase URL and public anon/publishable key. Never put the service-role key in browser code.

## 1. Create and configure Supabase

1. Create a Supabase project and keep its project URL and public anon/publishable key available.
2. Install the Supabase CLI and sign in to it.
3. From the project folder, link the project and apply the migration:

   ```text
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

   The migration creates the booking tables, administrator role table, rate-limit RPC, RLS policies, and private `booking-references` bucket.
4. Open `supabase-config.js` and set `url` to the project URL and `anonKey` to the public anon/publishable key. This public key is expected to be visible in the browser. Never add a service-role key to frontend files.
5. In Supabase Auth, create an administrator user with email/password. Copy that user's UUID from Authentication, then run this in the SQL editor:

   ```sql
   insert into public.studio_admins (user_id)
   values ('AUTH_USER_UUID');
   ```

   Only users listed in `studio_admins` can read or update bookings. The dashboard also checks this role after sign-in.

## 2. Configure and deploy Edge Functions

1. Copy `.env.example` to a local, untracked `.env.local` and fill in:
   - `APP_ORIGIN` (the exact origin serving the site, without a trailing slash)
   - `RATE_LIMIT_SALT` (generate a unique random value; never reuse a public value)
   - WhatsApp Business settings only if studio notifications are being enabled
2. Configure the secrets in the linked Supabase project. For example:

   ```text
   supabase secrets set --env-file .env.local
   ```

   Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions automatically. Do not put the service-role key in `.env.local` or frontend code. Supabase Edge Functions must retain JWT verification; the included `supabase/config.toml` enables it for all three functions.
3. Deploy the functions:

   ```text
   supabase functions deploy create-booking-uploads
   supabase functions deploy submit-booking
   supabase functions deploy admin-reference-links
   ```

   `create-booking-uploads` issues short-lived upload tokens for validated image types and paths. `submit-booking` validates fields and uploaded object metadata before inserting a row. `admin-reference-links` verifies the signed-in user is an administrator and returns 60-second signed URLs only for images attached to that booking.
4. The functions allow browser requests only from `APP_ORIGIN`. If you change the development or production domain, update this secret and redeploy/restart the functions.

## 3. Serve and use the website

Do not open the page as a `file://` URL. From the project folder, run a local static server:

```text
py -m http.server 8000
```

Open `http://localhost:8000/luvits.html` for the public site and `http://localhost:8000/admin/` for the administrator dashboard. For a deployed site, host the project folder so the `admin/index.html` file is served at `/admin/`, and allow that URL in the hosting configuration.

The public **Book now**, **Book your session**, and booking-section CTA open the same five-step form. Photos are restricted to JPEG, PNG, and WebP, up to 5 MB each, five inspiration images plus one placement photo, and 15 MB total. The bucket is private. A honeypot and per-IP rate limits reduce spam; rate-limit records contain only a salted hash, not the source IP.

## 4. Optional WhatsApp Business notifications

Booking confirmations to the customer use the existing studio WhatsApp number and are opened client-side after the booking is saved. The customer chooses whether to send the prefilled message.

Automatic studio alerts are disabled by default. To enable them, configure the WhatsApp Business Cloud API credentials as Edge Function secrets and set:

- `WHATSAPP_CLOUD_ENABLED=true`
- `WHATSAPP_CLOUD_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_STUDIO_NUMBER` (the existing studio number is shown in `.env.example`)
- `WHATSAPP_TEMPLATE_NAME`
- `WHATSAPP_TEMPLATE_LANGUAGE`
- `WHATSAPP_GRAPH_API_VERSION`

The approved template must have four body placeholders, in order: booking ID, customer name, tattoo style, and preferred date. Keep the token only in Supabase secrets. A notification error is logged and returned as a notification status; it does not roll back a saved booking.

## 5. Manual end-to-end checks

After configuration:

1. Submit a valid request through the public five-step form, with and without images. Confirm the success page shows a booking ID and the WhatsApp link opens a message with that ID.
2. In Supabase, confirm a `New` row is present and the image objects are in the private bucket. Try an unsupported file, an oversized file, a past date, and an unconfirmed age; each must be rejected.
3. Call `submit-booking` repeatedly from the same origin/IP and verify the rate limit responds with HTTP 429 after the allowed attempts.
4. Open `/admin/` without signing in; booking data must not be visible. Sign in as an Auth user not listed in `studio_admins`; access must still be denied.
5. Sign in as the configured administrator. Search by name/phone, filter by status/date, open a request, view its signed reference images, then update status, notes, and scheduled date/time. Confirm changes persist and display in Asia/Kolkata time.
6. With WhatsApp Business notifications disabled, confirm a booking still saves. If Business API credentials and an approved template are configured, test a new request and confirm the studio alert arrives.
7. Repeat the form and dashboard checks at desktop and mobile widths.

Live database, storage, Auth, and WhatsApp delivery checks require the studio's Supabase project, hosting origin, administrator account, and (optionally) approved WhatsApp Business API credentials. Those are not included in this project.
