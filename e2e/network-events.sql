-- A household's week as the operator's event log records it (SPEC-189):
-- the console's network view is drawn from what the operator's `network`
-- projector makes of these, not from any table written here. Mia and Ben
-- were added (and Ben removed) through the operator's own CLI before this
-- runs; their ids arrive as psql variables :'mia' and :'ben'.
--
-- The event names and data shapes are the operator's own (its event
-- catalogue); times are spread over the last week, oldest first, so the
-- projector meets them in order.
SET search_path = airdress_operator, public;

CREATE TEMP TABLE seed_t AS SELECT date_trunc('hour', now()) AS t0;

-- This operator has been recording all week: its history starts before the
-- oldest event below (on a real operator, at its first boot).
UPDATE network_projector_state SET history_starts_at = (SELECT t0 FROM seed_t) - interval '7 days';

CREATE FUNCTION pg_temp.ev(name text, audience text, principal uuid, at interval, data jsonb,
                           actor_kind text DEFAULT 'owner')
RETURNS void LANGUAGE sql AS $$
  INSERT INTO airdress_operator.events
      (id, name, version, audience, principal_id, subject, time, origin, actor_kind, actor_id, data)
  SELECT gen_random_uuid(), name, 1, audience, principal, NULL, (SELECT t0 FROM seed_t) - at,
         'server', actor_kind, NULL, data
$$;

-- Ids that stay the same across events.
CREATE TEMP TABLE seed_ids AS SELECT
  (SELECT id FROM principals WHERE role = 'owner' LIMIT 1) AS owner,
  :'mia'::uuid AS mia,
  :'ben'::uuid AS ben,
  gen_random_uuid() AS op9_old, gen_random_uuid() AS op9, gen_random_uuid() AS s23,
  gen_random_uuid() AS cli, gen_random_uuid() AS pix, gen_random_uuid() AS ipad,
  gen_random_uuid() AS doo, gen_random_uuid() AS nas,
  gen_random_uuid() AS sess1, gen_random_uuid() AS sess2;

DO $$
DECLARE
  i seed_ids;
  ad text := 'op.e2e.test';
  k_old text := '91c091c091c091c0';
  k_new text := '7f3a7f3a7f3a7f3a';
BEGIN
  SELECT * INTO i FROM seed_ids;

  -- Before the week: the owner's first phone under the first root, Ben's phone.
  PERFORM pg_temp.ev('airdress.enrollment.enrolled', 'owner', NULL, interval '6 days 20 hours',
    jsonb_build_object('enrollment_id', i.op9_old, 'airdress', ad, 'principal_id', i.owner,
      'device_label', 'OnePlus 9 Pro', 'role', 'human_held', 'custody', 'client_held',
      'device_class', 'human', 'delegation_only', false, 'via', 'bootstrap_token',
      'root_fingerprint', k_old));
  PERFORM pg_temp.ev('airdress.enrollment.enrolled', 'owner', NULL, interval '6 days 18 hours',
    jsonb_build_object('enrollment_id', i.doo, 'airdress', ad, 'principal_id', i.ben,
      'device_label', 'Doogee X95Pro', 'role', 'human_held', 'custody', 'client_held',
      'device_class', 'human', 'delegation_only', false, 'via', 'pairing_code',
      'root_fingerprint', k_old));
  PERFORM pg_temp.ev('airdress.enrollment.enrolled', 'owner', NULL, interval '6 days 12 hours',
    jsonb_build_object('enrollment_id', i.pix, 'airdress', ad, 'principal_id', i.mia,
      'device_label', 'Pixel 8', 'role', 'human_held', 'custody', 'client_held',
      'device_class', 'human', 'delegation_only', false, 'via', 'pairing_code',
      'root_fingerprint', k_old));

  -- Day 2: Ben's phone falls idle and the sweep takes it.
  PERFORM pg_temp.ev('airdress.enrollment.revoked', 'owner', NULL, interval '5 days 3 hours',
    jsonb_build_object('enrollment_id', i.doo, 'airdress', ad, 'principal_id', i.ben,
      'device_label', 'Doogee X95Pro', 'reason', 'idle', 'revoked_by_kind', 'system',
      'revoked_by_id', 'idle_sweep'), 'system');

  -- Day 2: the root is reset from the host; the devices under it go with it.
  PERFORM pg_temp.ev('airdress.enrollment.revoked', 'owner', NULL, interval '4 days 20 hours',
    jsonb_build_object('enrollment_id', i.op9_old, 'airdress', ad, 'principal_id', i.owner,
      'device_label', 'OnePlus 9 Pro', 'reason', 'root_reset', 'revoked_by_kind', 'host',
      'revoked_by_id', 'cli'), 'host');
  PERFORM pg_temp.ev('airdress.enrollment.revoked', 'owner', NULL, interval '4 days 20 hours',
    jsonb_build_object('enrollment_id', i.pix, 'airdress', ad, 'principal_id', i.mia,
      'device_label', 'Pixel 8', 'reason', 'root_reset', 'revoked_by_kind', 'host',
      'revoked_by_id', 'cli'), 'host');
  PERFORM pg_temp.ev('airdress.break_glass.root_key_reset', 'owner', NULL, interval '4 days 20 hours',
    jsonb_build_object('airdress', ad, 'reason', 'lost phone', 'revoked_enrollments', 2,
      'revoked_enrollment_ids', jsonb_build_array(i.op9_old, i.pix),
      'enrollment_ids_truncated', false), 'host');

  -- After the reset: everyone back under the new root, and two more devices.
  PERFORM pg_temp.ev('airdress.enrollment.enrolled', 'owner', NULL, interval '4 days 19 hours',
    jsonb_build_object('enrollment_id', i.op9, 'airdress', ad, 'principal_id', i.owner,
      'device_label', 'OnePlus 9 Pro', 'role', 'human_held', 'custody', 'client_held',
      'device_class', 'human', 'delegation_only', false, 'via', 'bootstrap_token',
      'root_fingerprint', k_new));
  PERFORM pg_temp.ev('airdress.enrollment.enrolled', 'owner', NULL, interval '4 days 18 hours',
    jsonb_build_object('enrollment_id', i.s23, 'airdress', ad, 'principal_id', i.owner,
      'device_label', 'Galaxy S23', 'role', 'human_held', 'custody', 'client_held',
      'device_class', 'human', 'delegation_only', false, 'via', 'join_request',
      'root_fingerprint', k_new));
  PERFORM pg_temp.ev('airdress.enrollment.enrolled', 'owner', NULL, interval '4 days 2 hours',
    jsonb_build_object('enrollment_id', i.cli, 'airdress', ad, 'principal_id', i.owner,
      'device_label', 'airdress CLI', 'role', 'human_held', 'custody', 'client_held',
      'device_class', 'human', 'delegation_only', true, 'via', 'join_request',
      'root_fingerprint', k_new));
  PERFORM pg_temp.ev('airdress.enrollment.enrolled', 'owner', NULL, interval '3 days 10 hours',
    jsonb_build_object('enrollment_id', i.ipad, 'airdress', ad, 'principal_id', i.mia,
      'device_label', 'iPad', 'role', 'human_held', 'custody', 'client_held',
      'device_class', 'human', 'delegation_only', false, 'via', 'pairing_code',
      'root_fingerprint', k_new));

  -- Day 3: the NAS becomes a machine and a shell host; Mia may read it.
  PERFORM pg_temp.ev('airdress.machine.approved', 'owner', NULL, interval '4 days',
    jsonb_build_object('machine_id', i.nas, 'fingerprint', 'SHA256:nas', 'kid', 'k-nas',
      'authorized_until', null));
  PERFORM pg_temp.ev('airdress.machine.linked', 'owner', NULL, interval '3 days 23 hours',
    jsonb_build_object('machine_id', i.nas, 'kind', 'ShellHost', 'name', 'ai-nas-0',
      'person', i.owner));
  PERFORM pg_temp.ev('airdress.grant.created', 'owner', NULL, interval '3 days 20 hours',
    jsonb_build_object('grant_id', gen_random_uuid(), 'principal_id', i.mia,
      'target', 'ShellHost::ai-nas-0', 'actions', 'ReadStatus', 'actor', 'owner'));
  PERFORM pg_temp.ev('airdress.shell.host.connected', 'principal', i.owner, interval '3 days 14 hours',
    jsonb_build_object('host', 'ai-nas-0', 'machine', i.nas, 'principal_id', i.owner,
      'transport', 'ws'), 'machine');

  -- Two shell sessions on the NAS: one closed, one still open.
  PERFORM pg_temp.ev('airdress.shell.session.opened', 'principal', i.owner, interval '2 days 10 hours',
    jsonb_build_object('host', 'ai-nas-0', 'principal_id', i.owner, 'session', i.sess1,
      'enrollment_id', i.op9), 'device');
  PERFORM pg_temp.ev('airdress.shell.session.closed', 'principal', i.owner, interval '2 days 8 hours',
    jsonb_build_object('host', 'ai-nas-0', 'principal_id', i.owner, 'session', i.sess1,
      'reason', 'closed'), 'device');
  PERFORM pg_temp.ev('airdress.shell.session.opened', 'principal', i.owner, interval '15 hours',
    jsonb_build_object('host', 'ai-nas-0', 'principal_id', i.owner, 'session', i.sess2,
      'enrollment_id', i.cli), 'device');
END $$;
