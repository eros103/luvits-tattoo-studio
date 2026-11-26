create extension if not exists pgcrypto;

create table if not exists public.studio_admins (
    user_id uuid primary key references auth.users (id) on delete cascade,
    created_at timestamptz not null default now()
);

alter table public.studio_admins enable row level security;
revoke all on public.studio_admins from anon, authenticated;
grant select on public.studio_admins to authenticated;

create policy "Studio administrators can view their own role"
    on public.studio_admins
    for select
    to authenticated
    using (user_id = (select auth.uid()));

create or replace function public.is_studio_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.studio_admins as admin
        where admin.user_id = (select auth.uid())
    );
$$;

revoke all on function public.is_studio_admin() from public, anon;
grant execute on function public.is_studio_admin() to authenticated, service_role;

create table if not exists public.bookings (
    id uuid primary key default gen_random_uuid(),
    customer_name text not null,
    whatsapp_number text not null,
    email text not null,
    city text not null,
    tattoo_style text not null,
    tattoo_description text not null,
    meaning_inspiration text,
    body_placement text not null,
    approximate_size_inches numeric(5, 2),
    color_preference text not null check (color_preference in ('Black & Grey', 'Colour')),
    tattoo_history text not null check (tattoo_history in ('First tattoo', 'Existing tattoo')),
    cover_up_type text not null check (cover_up_type in ('None', 'Cover-up', 'Touch-up', 'Both')),
    cover_up_details text,
    inspiration_paths text[] not null default '{}',
    placement_photo_path text,
    preferred_date date not null,
    alternative_date date,
    preferred_time text not null,
    time_zone text not null default 'Asia/Kolkata' check (time_zone = 'Asia/Kolkata'),
    budget_range text not null,
    additional_notes text,
    allergy_sensitivity text,
    age_confirmed boolean not null check (age_confirmed),
    created_at timestamptz not null default now(),
    status text not null default 'New'
        check (status in (
            'New',
            'Under Review',
            'Contacted',
            'Consultation Scheduled',
            'Confirmed',
            'Completed',
            'Cancelled'
        )),
    admin_notes text,
    scheduled_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint bookings_size_positive check (
        approximate_size_inches is null or approximate_size_inches > 0
    ),
    constraint bookings_alternative_date_distinct check (
        alternative_date is null or alternative_date <> preferred_date
    )
);

create index if not exists bookings_status_created_at_idx
    on public.bookings (status, created_at desc);
create index if not exists bookings_preferred_date_idx
    on public.bookings (preferred_date);
create index if not exists bookings_customer_name_idx
    on public.bookings using gin (to_tsvector('simple', customer_name));

create or replace function public.set_booking_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists set_booking_updated_at on public.bookings;
create trigger set_booking_updated_at
    before update on public.bookings
    for each row
    execute function public.set_booking_updated_at();

alter table public.bookings enable row level security;
revoke all on public.bookings from anon, authenticated;
grant select on public.bookings to authenticated;
grant update (status, admin_notes, scheduled_at) on public.bookings to authenticated;

create policy "Studio administrators can view bookings"
    on public.bookings
    for select
    to authenticated
    using (public.is_studio_admin());

create policy "Studio administrators can update booking management fields"
    on public.bookings
    for update
    to authenticated
    using (public.is_studio_admin())
    with check (public.is_studio_admin());

create table if not exists public.booking_rate_limits (
    fingerprint text primary key,
    window_started_at timestamptz not null default now(),
    attempts integer not null default 0
);

create index if not exists booking_rate_limits_window_started_at_idx
    on public.booking_rate_limits (window_started_at);

alter table public.booking_rate_limits enable row level security;
revoke all on public.booking_rate_limits from public, anon, authenticated;
grant all on public.booking_rate_limits to service_role;

create or replace function public.consume_booking_rate_limit(
    p_fingerprint text,
    p_max_attempts integer,
    p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_attempts integer;
begin
    delete from public.booking_rate_limits
    where window_started_at < now() - interval '30 days';

    insert into public.booking_rate_limits as current_limit (fingerprint, window_started_at, attempts)
    values (p_fingerprint, now(), 1)
    on conflict (fingerprint) do update
    set
        attempts = case
            when current_limit.window_started_at
                <= now() - make_interval(secs => p_window_seconds)
            then 1
            else current_limit.attempts + 1
        end,
        window_started_at = case
            when current_limit.window_started_at
                <= now() - make_interval(secs => p_window_seconds)
            then now()
            else current_limit.window_started_at
        end
    returning attempts into current_attempts;

    return current_attempts <= p_max_attempts;
end;
$$;

revoke all on function public.consume_booking_rate_limit(text, integer, integer)
    from public, anon, authenticated;
grant execute on function public.consume_booking_rate_limit(text, integer, integer)
    to service_role;

insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'booking-references',
    'booking-references',
    false,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
    public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy "Studio administrators can read booking reference images"
    on storage.objects
    for select
    to authenticated
    using (
        bucket_id = 'booking-references'
        and public.is_studio_admin()
    );
