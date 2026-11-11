-- Step 30b-1: the web service (PostgREST) only exposes the public schema, so the app cannot call app.claim_invite or
-- app.create_gym directly. These public functions just pass the call on, as the signed-in person (security invoker),
-- so all the checks in the app.* functions still decide. Signed-out visitors (anon) may not call them.

create function public.claim_invite() returns text language sql security invoker set search_path = '' as $$
  select app.claim_invite()
$$;
create function public.create_gym(g text, n text) returns void language sql security invoker set search_path = '' as $$
  select app.create_gym(g, n)
$$;

revoke all on function public.claim_invite(), public.create_gym(text, text) from public, anon;
grant execute on function public.claim_invite(), public.create_gym(text, text) to authenticated;
