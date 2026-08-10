-- OtakuPier - Supabase schema (v2)
-- Run this in Supabase Dashboard > SQL Editor > New query, then click Run.
-- Safe to re-run; uses IF NOT EXISTS / OR REPLACE.

-- 1. Profiles (created automatically via trigger after signup)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  name text default '',
  avatar_url text,
  bio text default '',
  xp integer default 0,
  last_daily_xp date,
  is_admin boolean default false,
  created_at timestamptz default now()
);

-- Idempotent upgrade for databases created before the admin feature
alter table public.profiles add column if not exists is_admin boolean default false;

-- 2. Reviews
create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade not null,
  anime_mal_id integer not null,
  anime_title text default '',
  rating integer check (rating between 1 and 10),
  text text not null,
  is_comment boolean default false,
  created_at timestamptz default now()
);

-- 3. Rankings (one entry per user per anime; admins may vote multiple times)
create table if not exists public.rankings (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade not null,
  anime_mal_id integer not null,
  anime_title text default '',
  anime_image text,
  position integer not null check (position between 1 and 10),
  created_at timestamptz default now()
);
-- Drop the old unique constraint if present so the trigger below can take
-- over enforcement (it allows admins to vote repeatedly).
alter table public.rankings drop constraint if exists rankings_user_id_anime_mal_id_key;

-- Enforce "one vote per user per anime" for regular users only. Admins
-- (profiles.is_admin) are exempt and may cast unlimited votes.
create or replace function public.enforce_one_vote_per_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.user_id and p.is_admin
  ) and exists (
    select 1 from public.rankings r
    where r.user_id = new.user_id and r.anime_mal_id = new.anime_mal_id
  ) then
    raise exception 'You have already voted for this anime.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_one_vote_per_user on public.rankings;
create trigger enforce_one_vote_per_user
  before insert on public.rankings
  for each row execute function public.enforce_one_vote_per_user();

-- Trigger-only: not callable via the REST API by anyone.
revoke execute on function public.enforce_one_vote_per_user() from anon, authenticated, public;

-- 4. Chat messages (global room)
create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade not null,
  author_name text default '',
  message text not null,
  created_at timestamptz default now()
);

-- Server-side message length cap (1000 chars) so clients can't bypass the UI
alter table public.chat_messages drop constraint if exists chat_messages_length_ok;
alter table public.chat_messages add constraint chat_messages_length_ok check (char_length(message) <= 1000);

-- 5. Saved anime (My List)
create table if not exists public.saved_anime (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade not null,
  anime_mal_id integer not null,
  anime_title text default '',
  anime_image text,
  created_at timestamptz default now(),
  unique (user_id, anime_mal_id)
);

-- 6. Friendships (friend requests)
create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  requester_id uuid references auth.users on delete cascade not null,
  addressee_id uuid references auth.users on delete cascade not null,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz default now(),
  unique (requester_id, addressee_id)
);

-- 7. Direct messages (private 1-on-1 chat)
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  sender_id uuid references auth.users on delete cascade not null,
  recipient_id uuid references auth.users on delete cascade not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz default now()
);

-- Server-side DM length cap (1000 chars)
alter table public.messages drop constraint if exists messages_length_ok;
alter table public.messages add constraint messages_length_ok check (char_length(body) <= 1000);

-- 8. Review likes
create table if not exists public.review_likes (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade not null,
  review_id bigint references public.reviews on delete cascade not null,
  created_at timestamptz default now(),
  unique (user_id, review_id)
);

-- 8b. Forum threads
create table if not exists public.forum_threads (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade not null,
  title text not null,
  body text not null,
  category text default 'general',
  created_at timestamptz default now()
);

-- 8c. Forum replies
create table if not exists public.forum_replies (
  id bigint generated always as identity primary key,
  thread_id bigint references public.forum_threads on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  body text not null,
  created_at timestamptz default now()
);

-- 8d. Clubs
create table if not exists public.clubs (
  id bigint generated always as identity primary key,
  created_by uuid references auth.users on delete cascade not null,
  name text not null unique,
  description text default '',
  created_at timestamptz default now()
);

-- 8e. Club memberships
create table if not exists public.club_members (
  id bigint generated always as identity primary key,
  club_id bigint references public.clubs on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz default now(),
  unique (club_id, user_id)
);

-- 8f. Club posts (discussion inside a club)
create table if not exists public.club_posts (
  id bigint generated always as identity primary key,
  club_id bigint references public.clubs on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  body text not null,
  created_at timestamptz default now()
);

-- 8g. Anime metadata overrides (admin-curated; overrides Jikan API data)
create table if not exists public.anime_edits (
  mal_id integer primary key,
  title text,
  image_url text,
  synopsis text,
  status text,
  edited_by uuid references auth.users on delete set null,
  updated_at timestamptz default now()
);

-- 8h. Custom anime added by admins (not on MyAnimeList)
create table if not exists public.custom_anime (
  id bigint generated always as identity primary key,
  title text not null,
  jp_title text default '',
  synopsis text default '',
  image_url text default '',
  status text default 'Unknown',
  year integer,
  type text default 'Anime',
  added_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);

-- 8i. Bans (user cannot post/chat while banned)
create table if not exists public.bans (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade unique not null,
  reason text default '',
  banned_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);

-- 9. Helper: create a profile row automatically when a user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- handle_new_user is trigger-only: nobody may call it via the API
revoke execute on function public.handle_new_user() from public;

-- 10. XP award helper (called from client via supabase.rpc('add_xp', {amount}))
-- Amount is clamped to the whitelist of legit action rewards so the public
-- API can't be abused to farm arbitrary XP.
-- SECURITY DEFINER: the owner can write the xp column even though direct
-- column updates are revoked for anon/authenticated (see section 15).
create or replace function public.add_xp(amount integer)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  if amount not in (1, 5, 10, 15, 20) then return; end if;
  update public.profiles set xp = xp + amount where id = auth.uid();
end;
$$;

revoke execute on function public.add_xp(integer) from public;
grant execute on function public.add_xp(integer) to authenticated;

-- 10b. Award XP to a specific user (used for review-likes etc.)
-- Only the whitelisted amounts are accepted; callers cannot grant arbitrary XP.
create or replace function public.award_xp_to(recipient uuid, amount integer)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if recipient is null or auth.uid() is null then return; end if;
  if amount not in (5, 10) then return; end if;
  update public.profiles set xp = xp + amount where id = recipient;
end;
$$;

revoke execute on function public.award_xp_to(uuid, integer) from public;
grant execute on function public.award_xp_to(uuid, integer) to authenticated;

-- 11. Mark daily-login bonus only once per day
-- SECURITY DEFINER: owner writes xp even though direct column updates are
-- revoked for anon/authenticated.
create or replace function public.claim_daily_xp()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  today date := current_date;
  cur_xp integer;
  cur_daily date;
  bonus integer := 5;
begin
  select xp, last_daily_xp into cur_xp, cur_daily from public.profiles where id = auth.uid();
  if cur_xp is null then return 0; end if;
  if cur_daily is distinct from today then
    update public.profiles set xp = xp + bonus, last_daily_xp = today where id = auth.uid();
    return bonus;
  end if;
  return 0;
end;
$$;

revoke execute on function public.claim_daily_xp() from public;
grant execute on function public.claim_daily_xp() to authenticated;

-- 12. Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.reviews enable row level security;
alter table public.rankings enable row level security;
alter table public.chat_messages enable row level security;
alter table public.saved_anime enable row level security;
alter table public.friendships enable row level security;
alter table public.messages enable row level security;
alter table public.review_likes enable row level security;
alter table public.forum_threads enable row level security;
alter table public.forum_replies enable row level security;
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.club_posts enable row level security;
alter table public.anime_edits enable row level security;
alter table public.custom_anime enable row level security;
alter table public.bans enable row level security;

-- Profiles
drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
create policy "Public profiles are viewable by everyone"
  on public.profiles for select using (true);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update using (auth.uid() = id);

drop policy if exists "Admins can update any profile" on public.profiles;
create policy "Admins can update any profile"
  on public.profiles for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- Users may edit their own display fields, but NOT xp/last_daily_xp directly.
-- XP only changes through the clamped SECURITY DEFINER functions (add_xp,
-- award_xp_to, claim_daily_xp), which run as the owner and bypass these
-- column restrictions safely.
revoke update (xp, last_daily_xp) on public.profiles from anon, authenticated;

-- Reviews
drop policy if exists "Reviews are viewable by everyone" on public.reviews;
create policy "Reviews are viewable by everyone"
  on public.reviews for select using (true);

drop policy if exists "Users can insert their own reviews" on public.reviews;
create policy "Users can insert their own reviews"
  on public.reviews for insert
  with check (auth.uid() = user_id and not exists (select 1 from public.bans b where b.user_id = auth.uid()));

drop policy if exists "Users can delete their own reviews" on public.reviews;
create policy "Users can delete their own reviews"
  on public.reviews for delete using (auth.uid() = user_id);

-- Rankings
drop policy if exists "Rankings are viewable by everyone" on public.rankings;
create policy "Rankings are viewable by everyone"
  on public.rankings for select using (true);

drop policy if exists "Users can insert their own rankings" on public.rankings;
create policy "Users can insert their own rankings"
  on public.rankings for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own rankings" on public.rankings;
create policy "Users can update their own rankings"
  on public.rankings for update using (auth.uid() = user_id);

drop policy if exists "Users can delete their own rankings" on public.rankings;
create policy "Users can delete their own rankings"
  on public.rankings for delete using (auth.uid() = user_id);

-- Chat
drop policy if exists "Chat messages are viewable by everyone" on public.chat_messages;
create policy "Chat messages are viewable by everyone"
  on public.chat_messages for select using (true);

drop policy if exists "Users can insert chat messages" on public.chat_messages;
create policy "Users can insert chat messages"
  on public.chat_messages for insert
  with check (auth.uid() = user_id and not exists (select 1 from public.bans b where b.user_id = auth.uid()));

drop policy if exists "Users can delete their own chat messages" on public.chat_messages;
create policy "Users can delete their own chat messages"
  on public.chat_messages for delete using (auth.uid() = user_id);

-- Saved anime
drop policy if exists "Saved anime are viewable by everyone" on public.saved_anime;
create policy "Saved anime are viewable by everyone"
  on public.saved_anime for select using (true);

drop policy if exists "Users can insert their own saved anime" on public.saved_anime;
create policy "Users can insert their own saved anime"
  on public.saved_anime for insert with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own saved anime" on public.saved_anime;
create policy "Users can delete their own saved anime"
  on public.saved_anime for delete using (auth.uid() = user_id);

-- Friendships: participants can see and manage their own
drop policy if exists "Users can see friendships they are part of" on public.friendships;
create policy "Users can see friendships they are part of"
  on public.friendships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists "Users can send friend requests" on public.friendships;
create policy "Users can send friend requests"
  on public.friendships for insert
  with check (auth.uid() = requester_id);

drop policy if exists "Users can update friendships they are part of" on public.friendships;
create policy "Users can update friendships they are part of"
  on public.friendships for update
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists "Users can delete friendships they are part of" on public.friendships;
create policy "Users can delete friendships they are part of"
  on public.friendships for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Messages: sender or recipient can see/read their own conversations
drop policy if exists "Users can see their own messages" on public.messages;
create policy "Users can see their own messages"
  on public.messages for select
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "Users can send messages" on public.messages;
create policy "Users can send messages"
  on public.messages for insert
  with check (auth.uid() = sender_id and not exists (select 1 from public.bans b where b.user_id = auth.uid()));

drop policy if exists "Recipients can mark messages read" on public.messages;
create policy "Recipients can mark messages read"
  on public.messages for update
  using (auth.uid() = recipient_id);

-- Review likes
drop policy if exists "Review likes are viewable by everyone" on public.review_likes;
create policy "Review likes are viewable by everyone"
  on public.review_likes for select using (true);

drop policy if exists "Users can like reviews" on public.review_likes;
create policy "Users can like reviews"
  on public.review_likes for insert with check (auth.uid() = user_id);

drop policy if exists "Users can unlike reviews" on public.review_likes;
create policy "Users can unlike reviews"
  on public.review_likes for delete using (auth.uid() = user_id);

-- Forum threads
drop policy if exists "Forum threads are viewable by everyone" on public.forum_threads;
create policy "Forum threads are viewable by everyone"
  on public.forum_threads for select using (true);

drop policy if exists "Users can create forum threads" on public.forum_threads;
create policy "Users can create forum threads"
  on public.forum_threads for insert
  with check (auth.uid() = user_id and not exists (select 1 from public.bans b where b.user_id = auth.uid()));

drop policy if exists "Authors can delete forum threads" on public.forum_threads;
create policy "Authors can delete forum threads"
  on public.forum_threads for delete using (auth.uid() = user_id);

-- Forum replies
drop policy if exists "Forum replies are viewable by everyone" on public.forum_replies;
create policy "Forum replies are viewable by everyone"
  on public.forum_replies for select using (true);

drop policy if exists "Users can reply to forum threads" on public.forum_replies;
create policy "Users can reply to forum threads"
  on public.forum_replies for insert
  with check (auth.uid() = user_id and not exists (select 1 from public.bans b where b.user_id = auth.uid()));

drop policy if exists "Authors can delete forum replies" on public.forum_replies;
create policy "Authors can delete forum replies"
  on public.forum_replies for delete using (auth.uid() = user_id);

-- Clubs
drop policy if exists "Clubs are viewable by everyone" on public.clubs;
create policy "Clubs are viewable by everyone"
  on public.clubs for select using (true);

drop policy if exists "Users can create clubs" on public.clubs;
create policy "Users can create clubs"
  on public.clubs for insert with check (auth.uid() = created_by);

drop policy if exists "Club owners can delete clubs" on public.clubs;
create policy "Club owners can delete clubs"
  on public.clubs for delete using (auth.uid() = created_by);

-- Club members
drop policy if exists "Club members are viewable by everyone" on public.club_members;
create policy "Club members are viewable by everyone"
  on public.club_members for select using (true);

drop policy if exists "Users can join clubs" on public.club_members;
create policy "Users can join clubs"
  on public.club_members for insert with check (auth.uid() = user_id);

drop policy if exists "Users can leave clubs" on public.club_members;
create policy "Users can leave clubs"
  on public.club_members for delete using (auth.uid() = user_id);

drop policy if exists "Owners can manage their club members" on public.club_members;
create policy "Owners can manage their club members"
  on public.club_members for update
  using (exists (select 1 from public.clubs c where c.id = club_id and c.created_by = auth.uid()));

drop policy if exists "Owners can remove club members" on public.club_members;
create policy "Owners can remove club members"
  on public.club_members for delete
  using (exists (select 1 from public.clubs c where c.id = club_id and c.created_by = auth.uid()));

-- Club posts
drop policy if exists "Club posts are viewable by everyone" on public.club_posts;
create policy "Club posts are viewable by everyone"
  on public.club_posts for select using (true);

drop policy if exists "Club members can post" on public.club_posts;
create policy "Club members can post"
  on public.club_posts for insert
  with check (
    auth.uid() = user_id
    and not exists (select 1 from public.bans b where b.user_id = auth.uid())
    and exists (select 1 from public.club_members m where m.club_id = club_id and m.user_id = auth.uid())
  );

drop policy if exists "Authors can delete club posts" on public.club_posts;
create policy "Authors can delete club posts"
  on public.club_posts for delete using (auth.uid() = user_id);

-- Admins can remove any violating content (moderation)
drop policy if exists "Admins can delete reviews" on public.reviews;
create policy "Admins can delete reviews"
  on public.reviews for delete using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "Admins can delete chat messages" on public.chat_messages;
create policy "Admins can delete chat messages"
  on public.chat_messages for delete using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "Admins can delete forum threads" on public.forum_threads;
create policy "Admins can delete forum threads"
  on public.forum_threads for delete using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "Admins can delete forum replies" on public.forum_replies;
create policy "Admins can delete forum replies"
  on public.forum_replies for delete using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "Admins can delete club posts" on public.club_posts;
create policy "Admins can delete club posts"
  on public.club_posts for delete using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "Admins can delete club members" on public.club_members;
create policy "Admins can delete club members"
  on public.club_members for delete using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "Admins can delete messages" on public.messages;
create policy "Admins can delete messages"
  on public.messages for delete using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- Anime edits (admin-only writes, everyone reads)
drop policy if exists "Anime edits are viewable by everyone" on public.anime_edits;
create policy "Anime edits are viewable by everyone"
  on public.anime_edits for select using (true);

drop policy if exists "Admins can edit anime" on public.anime_edits;
create policy "Admins can edit anime"
  on public.anime_edits for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- Custom anime (admin-only writes, everyone reads)
drop policy if exists "Custom anime are viewable by everyone" on public.custom_anime;
create policy "Custom anime are viewable by everyone"
  on public.custom_anime for select using (true);

drop policy if exists "Admins can manage custom anime" on public.custom_anime;
create policy "Admins can manage custom anime"
  on public.custom_anime for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- Bans (everyone can see them; only admins create/remove them)
drop policy if exists "Bans are viewable by everyone" on public.bans;
create policy "Bans are viewable by everyone"
  on public.bans for select using (true);

drop policy if exists "Admins can manage bans" on public.bans;
create policy "Admins can manage bans"
  on public.bans for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- Nobody can flip the admin flag except a verified admin.
-- (RLS can't express this, so a trigger enforces it instead.)
-- Server-side calls (SQL editor / service role: auth.uid() IS NULL) are
-- allowed, so the bootstrap UPDATE and service-role tooling still work.
create or replace function public.ensure_admin_can_change_admin_flag()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.is_admin is distinct from old.is_admin then
    if auth.uid() is not null and not exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.is_admin
    ) then
      raise exception 'Only admins can change admin status';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_admin_flag on public.profiles;
create trigger trg_admin_flag
  before update on public.profiles
  for each row execute procedure public.ensure_admin_can_change_admin_flag();

-- Trigger-only: not callable via the REST API by anyone.
revoke execute on function public.ensure_admin_can_change_admin_flag() from anon, authenticated, public;

-- 12b. Chat cleanup: delete chat messages older than the retention window
-- (default 24 hours) to keep the table small. SECURITY DEFINER + owner-only
-- delete so any logged-in user can trigger it from the chat page without
-- being able to delete specific (e.g. recent) messages themselves.
create or replace function public.prune_chat_messages(older_than interval default interval '24 hours')
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  deleted integer;
begin
  if auth.uid() is null then return 0; end if;
  delete from public.chat_messages
    where created_at < now() - coalesce(older_than, interval '24 hours');
  get diagnostics deleted = row_count;
  return coalesce(deleted, 0);
end;
$$;

revoke execute on function public.prune_chat_messages(interval) from public, anon;
grant execute on function public.prune_chat_messages(interval) to authenticated;

-- Optional: nightly purge via pg_cron (best-effort; enabled on Supabase free tier).
-- If pg_cron isn't available this block is skipped, and the chat page's
-- client-side call to prune_chat_messages still keeps things tidy.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'otakupier-chat-prune') then
      perform cron.schedule('otakupier-chat-prune', '0 4 * * *',
        'select public.prune_chat_messages(interval ''24 hours'')');
    end if;
  end if;
exception when others then
  null; -- pg_cron unavailable or no permission; client-side prune covers it
end;
$$;

-- 13. Realtime: broadcast chat + DMs live (idempotent — safe to re-run)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

-- 14. Indexes for faster lookups
create index if not exists idx_reviews_anime on public.reviews (anime_mal_id);
create index if not exists idx_rankings_anime on public.rankings (anime_mal_id);
create index if not exists idx_chat_created on public.chat_messages (created_at desc);
create index if not exists idx_saved_user on public.saved_anime (user_id);
create index if not exists idx_friends_user on public.friendships (addressee_id, status);
create index if not exists idx_messages_pair on public.messages (sender_id, recipient_id, created_at desc);
create index if not exists idx_likes_review on public.review_likes (review_id);
create index if not exists idx_forum_threads_created on public.forum_threads (created_at desc);
create index if not exists idx_forum_replies_thread on public.forum_replies (thread_id, created_at);
create index if not exists idx_club_members_club on public.club_members (club_id);
create index if not exists idx_club_posts_club on public.club_posts (club_id, created_at);
create index if not exists idx_bans_user on public.bans (user_id);
create index if not exists idx_custom_anime_created on public.custom_anime (created_at desc);

-- 15. One-time bootstrap: promote yourself to admin. Run this ONCE, replacing
--     with your account email, then delete it from the editor:
--     update public.profiles set is_admin = true where email = 'YOUR-EMAIL@example.com';
--     (email is not a column here — match by id instead):
--     update public.profiles set is_admin = true
--     where id = (select id from auth.users where email = 'YOUR-EMAIL@example.com');
