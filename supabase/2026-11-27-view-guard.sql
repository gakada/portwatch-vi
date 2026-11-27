-- View guard, 2026-11-27. Paste the whole file into Supabase's SQL editor (signed in) and run it once.
-- It's safe to run again. supabase/schema.sql has the same definitions.
--
-- Why: before 2026-11-26 the homepage's "watching now" pill showed about 10 million people. Anyone can call
-- track_view with the site's public key, a made-up tab id and a weight of up to 50, and live_viewers added
-- up one weight per tab id, so a script sending fake views could push the count anywhere it liked.
-- The real site has only ever sent weights 1, 5 and 20.
--
-- What changes:
-- 1. track_view counts only calls made from the site itself (the browser's Origin is https://portwatch-vi.xyz),
--    only tab ids shaped like the site's own, and at most 30 views per internet address in 10 minutes.
--    The weight is capped at 20 (backend.js samples 1 tab in 20).
-- 2. Each view stores a salted, daily-rotating hash of the address (private.client_hash, as the board used).
--    Raw addresses are never stored.
-- 3. live_viewers and the dashboard's admin_live count each address as at most 3 sampled tabs, so one
--    machine can add at most 60 to the live number, while people sharing an address (offices, mobile
--    networks) still mostly count.
-- View counting stays off on the site (STATS_PAUSED in assets/js/config.js) until it's turned back on.

-- The board's address hash (unchanged; repeated here so this file works on its own).
create or replace function private.client_hash() returns text
language plpgsql stable security definer set search_path = '' as $$
declare hdr json; ip text; salt text;
begin
  hdr := nullif(current_setting('request.headers', true), '')::json;
  ip := btrim(split_part(coalesce(hdr ->> 'cf-connecting-ip', hdr ->> 'x-real-ip', hdr ->> 'x-forwarded-for', ''), ',', 1));
  if ip = '' then return null; end if; -- unknown client: skip flood limits rather than lump everyone together
  select value into salt from private.settings where key = 'ip_salt';
  return encode(extensions.digest(ip || '|' || current_date::text || '|' || coalesce(salt, ''), 'sha256'), 'hex');
end $$;

alter table public.pageviews add column if not exists ip_hash text;
-- Partial: older rows have no hash, so building it is quick.
create index if not exists pageviews_ip_ts on public.pageviews (ip_hash, ts) where ip_hash is not null;

create or replace function public.track_view(p_page text, p_w integer, p_ref text default null, p_sid text default null, p_new boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare hdr json; h text;
begin
  -- Browsers send the page's Origin with this cross-site call, so copies of the site hosted elsewhere aren't
  -- counted. A script can fake the header; the per-address limits below cover that.
  hdr := nullif(current_setting('request.headers', true), '')::json;
  if lower(coalesce(hdr ->> 'origin', '')) <> 'https://portwatch-vi.xyz' then return; end if;
  -- The site's tab ids: 20 hex characters, or 'nostorage' when the browser blocks sessionStorage.
  if p_sid is null or not (p_sid ~ '^[0-9a-f]{20}$' or p_sid = 'nostorage') then return; end if;
  h := private.client_hash();
  -- At most 30 views per address in 10 minutes: far more than people browsing, far fewer than a script.
  if h is not null and (select count(*) from (
      select 1 from public.pageviews where ip_hash = h and ts > now() - interval '10 minutes' limit 30) x) >= 30 then
    return;
  end if;
  insert into public.pageviews (page, ref, sid, new_session, w, ip_hash)
  values (left(coalesce(p_page, '/'), 120), left(nullif(p_ref, ''), 120), p_sid, coalesce(p_new, false),
          least(greatest(coalesce(p_w, 1), 1), 20), h);
end $$;
revoke all on function public.track_view(text, integer, text, text, boolean) from public;
grant execute on function public.track_view(text, integer, text, text, boolean) to anon, authenticated;

create or replace function public.live_viewers() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  cached_n integer;
  cached_at timestamptz;
begin
  select n, at into cached_n, cached_at from private.live_cache where id = 1;
  -- Fresh enough, or another call is already recounting: hand out the last answer.
  if cached_at > now() - interval '60 seconds' or not pg_try_advisory_xact_lock(hashtext('live_viewers')) then
    return cached_n;
  end if;
  -- Each address counts as at most 3 sampled tabs (rows from before the hash existed fall back to the tab id).
  select case when s >= 25 then s end into cached_n from (
    select coalesce(sum(n), 0)::integer as s from (
      select least(count(distinct sid), 3) * max(w) as n from public.pageviews
      where ts >= now() - interval '5 minutes' and sid <> '' group by coalesce(ip_hash, sid)) t) x;
  update private.live_cache set n = cached_n, at = now() where id = 1;
  return cached_n;
end $$;
revoke all on function public.live_viewers() from public;
grant execute on function public.live_viewers() to anon, authenticated;

create or replace function public.admin_live(p_minutes integer default 5) returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return (
    with latest as (
      select distinct on (sid) sid, coalesce(ip_hash, sid) as who, page, w from public.pageviews
      where ts >= now() - make_interval(mins => least(greatest(coalesce(p_minutes, 5), 1), 60)) and sid <> ''
      order by sid, ts desc
    ), per_address as (
      select least(count(*), 3) * max(w) as n from latest group by who
    )
    select json_build_object(
      'total', (select coalesce(sum(n), 0) from per_address),
      'pages', coalesce((select json_agg(p) from (
        select page, sum(w) as n from latest group by page order by 2 desc limit 8) p), '[]'::json))
  );
end $$;
revoke all on function public.admin_live(integer) from public, anon;
grant execute on function public.admin_live(integer) to authenticated;

-- Forget the last cached count, so the next answer uses the new rules.
update private.live_cache set at = '-infinity' where id = 1;
