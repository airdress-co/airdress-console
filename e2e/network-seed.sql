-- A household for the network view's proof of concept (SPEC-189): written
-- straight into the e2e operator's database, as if the last week had happened.
-- Robert (the owner, the bootstrap principal) and two people, their devices,
-- a root key reset, a shell host on a machine with two sessions, a grant, a
-- removed person and an idle-revoked device, and the events of the week.
SET search_path = airdress_operator, public;

DO $$
DECLARE
  owner   uuid := (SELECT id FROM principals WHERE role = 'owner' LIMIT 1);
  ad      text := 'op.e2e.test';
  mia     uuid := gen_random_uuid();
  ben     uuid := gen_random_uuid();
  nas     uuid := gen_random_uuid();
  op9     uuid := gen_random_uuid();
  s23     uuid := gen_random_uuid();
  cli     uuid := gen_random_uuid();
  pix     uuid := gen_random_uuid();
  ipad    uuid := gen_random_uuid();
  doo     uuid := gen_random_uuid();
  k_old   bytea := decode(repeat('91c0', 16), 'hex');
  k_new   bytea := decode(repeat('7f3a', 16), 'hex');
  d       interval := interval '1 day';
  t0      timestamptz := date_trunc('hour', now());
BEGIN
  UPDATE principals SET display_name = 'Robert', created_at = t0 - 40 * d WHERE id = owner;

  INSERT INTO principals (id, role, kind, display_name, token_hash, created_at, revoked_at) VALUES
    (mia, 'sub_user', 'human', 'Mia', sha256(gen_random_uuid()::text::bytea), t0 - 30 * d, NULL),
    (ben, 'sub_user', 'human', 'Ben', sha256(gen_random_uuid()::text::bytea), t0 - 30 * d, t0 - 2 * d),
    (nas, 'sub_user', 'machine', 'ai-nas-0', sha256(gen_random_uuid()::text::bytea), t0 - 20 * d, NULL);

  INSERT INTO endpoint_enrollments
    (id, airdress, device_label, device_session_public_key, airdress_root_public_key, delegation,
     token_hash, transport_profile, role, key_custody, principal_id, created_at, revoked_at, revoked_reason,
     delegation_only)
  VALUES
    (op9, ad, 'OnePlus 9 Pro', sha256(gen_random_uuid()::text::bytea), k_new, '{"seed": true}', sha256(gen_random_uuid()::text::bytea), 'default', 'human_held', 'client_held', owner, t0 - 25 * d, NULL, NULL, false),
    (s23, ad, 'Galaxy S23', sha256(gen_random_uuid()::text::bytea), k_new, '{"seed": true}', sha256(gen_random_uuid()::text::bytea), 'default', 'human_held', 'client_held', owner, t0 - 25 * d, NULL, NULL, false),
    (cli, ad, 'airdress CLI', sha256(gen_random_uuid()::text::bytea), k_new, '{"seed": true}', sha256(gen_random_uuid()::text::bytea), 'default', 'human_held', 'client_held', owner, t0 - 4 * d, NULL, NULL, true),
    (pix, ad, 'Pixel 8', sha256(gen_random_uuid()::text::bytea), k_new, '{"seed": true}', sha256(gen_random_uuid()::text::bytea), 'default', 'human_held', 'client_held', mia, t0 - 10 * d, NULL, NULL, false),
    (ipad, ad, 'iPad', sha256(gen_random_uuid()::text::bytea), k_new, '{"seed": true}', sha256(gen_random_uuid()::text::bytea), 'default', 'human_held', 'client_held', mia, t0 - 3 * d, NULL, NULL, false),
    (doo, ad, 'Doogee X95Pro', sha256(gen_random_uuid()::text::bytea), k_old, '{"seed": true}', sha256(gen_random_uuid()::text::bytea), 'default', 'human_held', 'client_held', ben, t0 - 28 * d, t0 - 5 * d, 'idle', false);

  -- The root was reset five days ago: the old key archived, the new one pinned.
  DELETE FROM airdress_root_keys WHERE airdress = ad;
  INSERT INTO airdress_root_key_archive (airdress, root_public_key, established_at, reset_at, reset_reason)
    VALUES (ad, k_old, t0 - 40 * d, t0 - 5 * d + interval '6 hours', 'recovery');
  INSERT INTO airdress_root_keys (airdress, root_public_key, established_at)
    VALUES (ad, k_new, t0 - 5 * d + interval '6 hours');

  -- The NAS as a shell host, and two sessions on it.
  INSERT INTO resources (kind, name, api_version, spec, created_at)
    VALUES ('ShellHost', 'ai-nas-0', 'airdress.co/v1alpha1',
            jsonb_build_object('machine', nas::text, 'principal', owner::text), t0 - 20 * d);
  INSERT INTO shell_sessions (id, host, machine, principal_id, profile, opened_by, opened_at, ended_at, end_reason) VALUES
    (gen_random_uuid(), 'ai-nas-0', nas, owner, 'htop', op9::text, t0 - 3 * d + interval '14 hours', t0 - 3 * d + interval '16 hours', 'closed'),
    (gen_random_uuid(), 'ai-nas-0', nas, owner, 'bash', cli::text, t0 - 1 * d + interval '9 hours', NULL, NULL);

  -- Mia may read the NAS's status, granted four days ago (opening a shell is a person's own and never granted).
  INSERT INTO resource_grants (principal_id, kind, resource_name, actions, created_at, created_by_sub)
    VALUES (mia, 'ShellHost', 'ai-nas-0', ARRAY['ReadStatus'], t0 - 4 * d, 'owner-e2e');

  -- The week's events, as the engine would have recorded them.
  INSERT INTO events (id, name, version, audience, time, origin, actor_kind, actor_id, subject, data) VALUES
    (gen_random_uuid(), 'airdress.enrollment.idle_revoked', 1, 'owner', t0 - 5 * d, 'server', NULL, NULL, doo::text, '{}'),
    (gen_random_uuid(), 'airdress.root_recovery.executed', 1, 'owner', t0 - 5 * d + interval '6 hours', 'server', 'owner', owner::text, ad, '{}'),
    (gen_random_uuid(), 'airdress.grant.created', 1, 'owner', t0 - 4 * d, 'server', 'owner', owner::text, mia::text, '{}'),
    (gen_random_uuid(), 'airdress.enrollment.sibling_enrolled', 1, 'owner', t0 - 4 * d, 'server', 'device', s23::text, cli::text, '{}'),
    (gen_random_uuid(), 'airdress.enrollment.sibling_enrolled', 1, 'owner', t0 - 3 * d, 'server', 'device', pix::text, ipad::text, '{}'),
    (gen_random_uuid(), 'airdress.shell.host.connected', 1, 'owner', t0 - 3 * d + interval '13 hours', 'server', 'machine', nas::text, 'ai-nas-0', '{}'),
    (gen_random_uuid(), 'airdress.person.revoked', 1, 'owner', t0 - 2 * d, 'server', 'owner', owner::text, ben::text, '{}'),
    (gen_random_uuid(), 'airdress.shell.host.connected', 1, 'owner', t0 - 1 * d + interval '8 hours', 'server', 'machine', nas::text, 'ai-nas-0', '{}');
END $$;
