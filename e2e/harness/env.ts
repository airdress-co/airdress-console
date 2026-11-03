// One place for the harness's fixed ports and names. Fixed, not random, so
// the console's build-time origins (VITE_*) can name them.
export const CONSOLE_PORT = Number(process.env['E2E_CONSOLE_PORT'] ?? 47900);
export const AS_PORT = Number(process.env['E2E_AS_PORT'] ?? 47901);
export const OPERATOR_PORT = Number(process.env['E2E_OPERATOR_PORT'] ?? 47902);
export const OPERATOR_ADMIN_PORT = Number(process.env['E2E_OPERATOR_ADMIN_PORT'] ?? 47903);

export const CONSOLE_ORIGIN = `http://127.0.0.1:${String(CONSOLE_PORT)}`;
export const AS_ORIGIN = `http://127.0.0.1:${String(AS_PORT)}`;
export const OPERATOR_ORIGIN = `http://127.0.0.1:${String(OPERATOR_PORT)}`;

/** The operator's airdress: what its `/v1` resource and the hub's list name. */
export const OPERATOR_FQDN = 'op.e2e.test';
export const OPERATOR_RESOURCE = `https://${OPERATOR_FQDN}/v1`;
export const OWNER_SUB = 'owner-e2e';
/** Short, so a test can outwait it: the operator's [auth.step_up] max_age_secs. */
export const STEP_UP_MAX_AGE_SECS = 8;
