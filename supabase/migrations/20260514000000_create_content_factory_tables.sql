-- CreatorFlow Studio Content Factory foundation.
-- Additive only: this migration does not modify creatorflow_tiktok_connections
-- or repoint any existing TikTok review/publish Edge Functions.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.creatorflow_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.platform_connections (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('tiktok', 'instagram')),
  platform_account_id text not null check (btrim(platform_account_id) <> ''),
  platform_username text,
  display_name text,
  avatar_url text,
  connection_status text not null default 'connected'
    check (connection_status in ('connected', 'expired', 'revoked', 'needs_reauth', 'disabled', 'error')),
  scopes text[] not null default '{}',
  token_type text,
  -- Server-side only OAuth token. Do not expose to browser clients.
  access_token text,
  -- Server-side only OAuth refresh token. Do not expose to browser clients.
  refresh_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  last_token_exchange_at timestamptz,
  last_token_refresh_at timestamptz,
  revoked_at timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, platform_account_id),
  unique (id, owner_user_id),
  unique (id, owner_user_id, platform),
  check (not (metadata ? 'password')),
  check (not (metadata ? 'access_token')),
  check (not (metadata ? 'refresh_token'))
);

comment on table public.platform_connections is
  'OAuth connection metadata for publishing platforms. TikTok passwords must never be stored.';
comment on column public.platform_connections.access_token is
  'Server-side only OAuth access token. Do not grant this column to frontend roles.';
comment on column public.platform_connections.refresh_token is
  'Server-side only OAuth refresh token. Do not grant this column to frontend roles.';

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  platform_connection_id uuid not null,
  platform text not null check (platform in ('tiktok', 'instagram')),
  platform_channel_id text,
  handle text not null check (btrim(handle) <> ''),
  display_name text,
  avatar_url text,
  channel_status text not null default 'active'
    check (channel_status in ('active', 'paused', 'needs_auth', 'disabled', 'archived')),
  timezone text not null default 'UTC',
  daily_post_limit integer not null default 5 check (daily_post_limit between 0 and 50),
  default_privacy_level text,
  default_disable_comment boolean not null default false,
  default_disable_duet boolean not null default false,
  default_disable_stitch boolean not null default false,
  default_brand_content_toggle boolean not null default false,
  default_brand_organic_toggle boolean not null default false,
  default_branded_content_toggle boolean not null default false,
  last_published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_user_id),
  foreign key (platform_connection_id, owner_user_id, platform)
    references public.platform_connections(id, owner_user_id, platform)
    on delete cascade,
  check (default_privacy_level is distinct from 'SELF_ONLY' or default_branded_content_toggle is not true),
  check (not (metadata ? 'password')),
  check (not (metadata ? 'access_token')),
  check (not (metadata ? 'refresh_token'))
);

create table public.content_library (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null default 'video'
    check (content_type in ('video', 'image', 'carousel')),
  content_status text not null default 'draft'
    check (content_status in ('draft', 'processing', 'ready', 'failed', 'archived')),
  title text,
  caption text,
  source_type text not null default 'storage'
    check (source_type in ('storage', 'external_url', 'generated', 'manual')),
  storage_bucket text,
  storage_path text,
  external_url text,
  thumbnail_url text,
  mime_type text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  checksum_sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_user_id),
  check (not (metadata ? 'password')),
  check (not (metadata ? 'access_token')),
  check (not (metadata ? 'refresh_token'))
);

create table public.publishing_queue (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null,
  content_id uuid not null,
  queue_status text not null default 'draft'
    check (queue_status in ('draft', 'ready', 'scheduled', 'publishing', 'published', 'failed', 'retry_scheduled', 'cancelled')),
  scheduled_for timestamptz,
  priority integer not null default 0,
  upload_mode text not null default 'FILE_UPLOAD'
    check (upload_mode in ('PULL_FROM_URL', 'FILE_UPLOAD')),
  title text,
  caption text,
  privacy_level text,
  disable_comment boolean not null default false,
  disable_duet boolean not null default false,
  disable_stitch boolean not null default false,
  brand_content_toggle boolean not null default false,
  brand_organic_toggle boolean not null default false,
  branded_content_toggle boolean not null default false,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_retry_at timestamptz,
  last_attempt_at timestamptz,
  published_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  tiktok_publish_id text,
  platform_post_id text,
  platform_status text,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_user_id),
  foreign key (channel_id, owner_user_id)
    references public.channels(id, owner_user_id)
    on delete cascade,
  foreign key (content_id, owner_user_id)
    references public.content_library(id, owner_user_id)
    on delete restrict,
  check (privacy_level is distinct from 'SELF_ONLY' or branded_content_toggle is not true),
  check (not (metadata ? 'password')),
  check (not (metadata ? 'access_token')),
  check (not (metadata ? 'refresh_token')),
  check (not (metadata ? 'upload_url'))
);

comment on column public.publishing_queue.tiktok_publish_id is
  'TikTok publish_id returned by Direct Post. Raw TikTok upload_url must not be stored.';

create table public.publish_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  publishing_queue_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  attempt_status text not null default 'pending'
    check (attempt_status in ('pending', 'running', 'uploading', 'status_checking', 'succeeded', 'failed', 'retry_scheduled', 'cancelled')),
  upload_mode text check (upload_mode in ('PULL_FROM_URL', 'FILE_UPLOAD')),
  started_at timestamptz,
  completed_at timestamptz,
  tiktok_publish_id text,
  platform_upload_session_id text,
  platform_post_id text,
  platform_status text,
  platform_http_status integer,
  binary_upload_attempted boolean not null default false,
  binary_upload_status integer,
  uploaded_bytes bigint check (uploaded_bytes is null or uploaded_bytes >= 0),
  platform_fail_reason text,
  platform_error_code text,
  platform_error_message text,
  platform_log_id text,
  error_code text,
  error_message text,
  retryable boolean not null default false,
  next_retry_at timestamptz,
  request_summary jsonb not null default '{}'::jsonb,
  response_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publishing_queue_id, attempt_number),
  foreign key (publishing_queue_id, owner_user_id)
    references public.publishing_queue(id, owner_user_id)
    on delete cascade,
  check (not (request_summary ? 'password')),
  check (not (request_summary ? 'access_token')),
  check (not (request_summary ? 'refresh_token')),
  check (not (request_summary ? 'upload_url')),
  check (not (response_summary ? 'password')),
  check (not (response_summary ? 'access_token')),
  check (not (response_summary ? 'refresh_token')),
  check (not (response_summary ? 'upload_url'))
);

comment on column public.publish_attempts.platform_upload_session_id is
  'Opaque platform upload/session identifier only. Do not store raw upload_url.';
comment on column public.publish_attempts.request_summary is
  'Safe diagnostic request summary only. Do not store tokens, passwords, or raw upload_url.';
comment on column public.publish_attempts.response_summary is
  'Safe diagnostic response summary only. Do not store tokens, passwords, or raw upload_url.';

create trigger trg_platform_connections_updated_at
before update on public.platform_connections
for each row execute function public.creatorflow_set_updated_at();

create trigger trg_channels_updated_at
before update on public.channels
for each row execute function public.creatorflow_set_updated_at();

create trigger trg_content_library_updated_at
before update on public.content_library
for each row execute function public.creatorflow_set_updated_at();

create trigger trg_publishing_queue_updated_at
before update on public.publishing_queue
for each row execute function public.creatorflow_set_updated_at();

create trigger trg_publish_attempts_updated_at
before update on public.publish_attempts
for each row execute function public.creatorflow_set_updated_at();

create unique index channels_platform_channel_uidx
  on public.channels(platform_connection_id, platform_channel_id)
  where platform_channel_id is not null;

create index platform_connections_owner_status_idx
  on public.platform_connections(owner_user_id, platform, connection_status);

create index platform_connections_token_expiry_idx
  on public.platform_connections(access_token_expires_at)
  where connection_status = 'connected';

create index channels_owner_status_idx
  on public.channels(owner_user_id, channel_status);

create index channels_connection_idx
  on public.channels(platform_connection_id);

create index content_library_owner_status_idx
  on public.content_library(owner_user_id, content_status, created_at desc);

create index publishing_queue_due_idx
  on public.publishing_queue(scheduled_for, priority desc)
  where queue_status in ('scheduled', 'retry_scheduled');

create index publishing_queue_dashboard_idx
  on public.publishing_queue(channel_id, queue_status, scheduled_for);

create index publishing_queue_content_idx
  on public.publishing_queue(content_id);

create index publishing_queue_published_idx
  on public.publishing_queue(channel_id, published_at)
  where queue_status = 'published';

create index publishing_queue_retry_idx
  on public.publishing_queue(next_retry_at, priority desc)
  where queue_status = 'retry_scheduled';

create index publish_attempts_queue_idx
  on public.publish_attempts(publishing_queue_id, attempt_number desc);

create index publish_attempts_status_idx
  on public.publish_attempts(attempt_status, created_at desc);

create index publish_attempts_tiktok_publish_idx
  on public.publish_attempts(tiktok_publish_id)
  where tiktok_publish_id is not null;

create index publish_attempts_platform_post_idx
  on public.publish_attempts(platform_post_id)
  where platform_post_id is not null;

alter table public.platform_connections enable row level security;
alter table public.channels enable row level security;
alter table public.content_library enable row level security;
alter table public.publishing_queue enable row level security;
alter table public.publish_attempts enable row level security;

revoke all on public.platform_connections from anon, authenticated;
grant select (
  id,
  owner_user_id,
  platform,
  platform_account_id,
  platform_username,
  display_name,
  avatar_url,
  connection_status,
  scopes,
  token_type,
  access_token_expires_at,
  refresh_token_expires_at,
  last_token_exchange_at,
  last_token_refresh_at,
  revoked_at,
  last_error_code,
  last_error_message,
  created_at,
  updated_at
) on public.platform_connections to authenticated;

grant select, insert, update, delete on public.channels to authenticated;
grant select, insert, update, delete on public.content_library to authenticated;
grant select, insert, update, delete on public.publishing_queue to authenticated;
grant select on public.publish_attempts to authenticated;

create policy platform_connections_select_own
on public.platform_connections
for select
to authenticated
using (owner_user_id = auth.uid());

create policy channels_own_all
on public.channels
for all
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy content_library_own_all
on public.content_library
for all
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy publishing_queue_own_all
on public.publishing_queue
for all
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy publish_attempts_select_own
on public.publish_attempts
for select
to authenticated
using (owner_user_id = auth.uid());
