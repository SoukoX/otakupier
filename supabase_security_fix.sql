-- OtakuPier - Supabase Security Warnings Fix
-- Run this in Supabase Dashboard > SQL Editor > New query, then click Run.
-- Fixes all SECURITY DEFINER linter warnings.

-- =============================================================================
-- PART 1: Revoke ANON execute from all public-facing functions
-- This is the CRITICAL fix — anonymous (unauthenticated) users should NOT
-- be able to call these functions.
-- =============================================================================

-- XP system
revoke execute on function public.add_xp(integer) from anon;
revoke execute on function public.award_xp_to(uuid, integer) from anon;
revoke execute on function public.claim_daily_xp() from anon;

-- RP system
revoke execute on function public.add_rp(integer, text) from anon;
revoke execute on function public.award_rp_to(uuid, integer, text) from anon;
revoke execute on function public.spend_rp(text, text) from anon;
revoke execute on function public.set_rp_config(text, text) from anon;
revoke execute on function public.grant_rp(uuid, integer, text) from anon;
revoke execute on function public.cleanup_spendings() from anon;

-- Invite system
revoke execute on function public.create_invite() from anon;

-- Chat prune
revoke execute on function public.prune_chat_messages(integer) from anon;
revoke execute on function public.prune_chat_messages(interval) from anon;

-- Trigger functions (should never be callable via RPC at all)
revoke execute on function public.watch_links_limit() from anon, authenticated, public;

-- =============================================================================
-- PART 2: SECURITY DEFINER vs INVOKER notes
-- =============================================================================
-- The authenticated_security_definer warnings are INTENTIONAL for most functions.
-- These functions need SECURITY DEFINER because:
--   - profiles.rp, profiles.rp_earned, profiles.xp columns are revoked from
--     direct UPDATE by anon/authenticated (see line 435, 1136 in schema)
--   - Only SECURITY DEFINER functions (running as the DB owner) can write them
--   - Each function has internal auth.uid() checks + input validation
--
-- Functions that should only be admin-callable:
--   - grant_rp() — already checks is_admin internally, returns 'admin only'
--     if caller is not admin. No change needed; the function is safe.
--
-- Trigger-only functions (not meant for RPC):
--   - watch_links_limit() — revoked above from all roles
--   - enforce_one_vote_per_user() — already revoked in schema
--   - ensure_admin_can_change_admin_flag() — already revoked in schema
--   - handle_new_user() — already revoked in schema

-- =============================================================================
-- PART 3: Verify grants are correct (idempotent)
-- =============================================================================

-- Ensure authenticated can call user functions
grant execute on function public.add_xp(integer) to authenticated;
grant execute on function public.award_xp_to(uuid, integer) to authenticated;
grant execute on function public.claim_daily_xp() to authenticated;
grant execute on function public.add_rp(integer, text) to authenticated;
grant execute on function public.award_rp_to(uuid, integer, text) to authenticated;
grant execute on function public.spend_rp(text, text) to authenticated;
grant execute on function public.set_rp_config(text, text) to authenticated;
grant execute on function public.grant_rp(uuid, integer, text) to authenticated;
grant execute on function public.cleanup_spendings() to authenticated;
grant execute on function public.create_invite() to authenticated;
grant execute on function public.prune_chat_messages(integer) to authenticated;
grant execute on function public.prune_chat_messages(interval) to authenticated;

-- =============================================================================
-- DONE. After running, the anon_security_definer warnings should disappear.
-- The authenticated_security_definer warnings will remain but are BY DESIGN
-- (these functions need SECURITY DEFINER to write protected columns).
-- =============================================================================
