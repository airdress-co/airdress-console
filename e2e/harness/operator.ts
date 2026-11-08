// A real airdress-operator, for the end-to-end harness (SPEC-184 184-D.13).
// The binary is airdress-operator built at the tag the API is pinned to
// (api/operator-openapi.pin); e2e/README.md says how. It runs with embedded
// PostgreSQL in a throwaway directory, admits the console's origin, and
// trusts the fake authorization server as its hub (`[auth] hub_issuer`),
// exactly as a fleet operator trusts account.airdress.co.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export interface OperatorOptions {
  readonly binary: string;
  readonly port: number;
  /** The host-local admin listener; its default (8079) would collide with another operator. */
  readonly adminPort: number;
  readonly airdress: string;
  readonly consoleOrigin: string;
  readonly hubIssuer: string;
  readonly ownerSub: string;
  /** The step-up window; short, so a test can outwait it. */
  readonly stepUpMaxAgeSecs: number;
}

export interface RunningOperator {
  readonly origin: string;
  readonly stop: () => Promise<void>;
  readonly logs: () => string;
}

/** The legacy identity provider the owner validator is configured with (as in hub_as.rs). */
export const LEGACY_ISSUER = 'https://idp.test';

function config(opts: OperatorOptions, dataDir: string, secretsDir: string): string {
  return `
name = "console-e2e"
airdress = "${opts.airdress}"
cors_allowed_origins = ["${opts.consoleOrigin}"]

[database]
data_dir = "${dataDir}"
version = "=18.3.0"
shared_buffers_mb = 32
max_connections = 16
pool_max_size = 8

[logging]
debug_file = ""

[resources]
secrets_dir = "${secretsDir}"

[admin]
bind = "127.0.0.1:${String(opts.adminPort)}"

[dns]
enabled = false

# As every fleet operator: chat on, stored in PostgreSQL. The principal
# routes (sub-users, grants, capabilities, /v1/me) need its per-principal
# key cache and are not mounted without it.
[chat]
enabled = true

[auth]
issuer = "${LEGACY_ISSUER}"
jwks_uri = "${opts.hubIssuer}/legacy/jwks.json"
audience = "${opts.airdress}"
owner_sub = "${opts.ownerSub}"
hub_issuer = "${opts.hubIssuer}"
hub_metadata_url = "${opts.hubIssuer}/.well-known/oauth-authorization-server"

[auth.step_up]
max_age_secs = ${String(opts.stepUpMaxAgeSecs)}
`;
}

/**
 * Embedded PostgreSQL on this workstation: the prestaged binaries and, on
 * Ubuntu 26.04, the 24.04 libxml2/libicu it links (airdress-ops memory note
 * "embedded PG on Ubuntu 26.04"). Each is used only if present; CI images
 * that ship the libraries need neither.
 */
function pgEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const prestage =
    process.env['AIRDRESS_PG_INSTALLATION_DIR'] ?? join(homedir(), '.cargo/.pg-prestage/current');
  if (existsSync(prestage)) env['AIRDRESS_PG_INSTALLATION_DIR'] = prestage;
  const libs =
    process.env['AIRDRESS_PG_LIBS'] ??
    join(homedir(), '.cache/pglibs-noble/root/usr/lib/x86_64-linux-gnu');
  if (existsSync(libs)) {
    env['LD_LIBRARY_PATH'] = [libs, process.env['LD_LIBRARY_PATH'] ?? '']
      .filter((p) => p !== '')
      .join(':');
  }
  return env;
}

async function waitReady(origin: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`the operator exited with ${String(child.exitCode)}`);
    try {
      const response = await fetch(`${origin}/readyz`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the operator was not ready within ${String(timeoutMs)} ms`);
}

export async function startOperator(opts: OperatorOptions): Promise<RunningOperator> {
  if (!existsSync(opts.binary)) {
    throw new Error(
      `no operator binary at ${opts.binary}: see e2e/README.md (AIRDRESS_OPERATOR_BIN)`,
    );
  }
  // A short directory: PostgreSQL's unix socket path is limited to ~100 bytes.
  const root = mkdtempSync(join(tmpdir(), 'ace2e-'));
  // Tests that seed the database directly find it here (network.spec.ts).
  process.env['E2E_OPERATOR_ROOT'] = root;
  const dataDir = join(root, 'pg');
  const credentials = join(root, 'creds');
  const configPath = join(root, 'operator.toml');
  writeFileSync(configPath, config(opts, dataDir, join(root, 'secrets')));
  // Chat is on by default and seals messages with a content key from
  // systemd credentials; the operator's tests write a fixed 32-byte one
  // (tests/common/mod.rs write_content_key_fixture). So does this.
  mkdirSync(credentials, { mode: 0o700 });
  writeFileSync(join(credentials, 'content_key'), Buffer.alloc(32, 0x42), { mode: 0o600 });

  let output = '';
  const child = spawn(
    opts.binary,
    [
      '--config',
      configPath,
      '--log-level',
      process.env['E2E_OPERATOR_LOG'] ?? 'warn',
      'serve',
      // `serve --bind` defaults to 127.0.0.1:8080 and wins over the config's
      // `bind`, so the port is given here.
      '--bind',
      `127.0.0.1:${String(opts.port)}`,
    ],
    {
      env: {
        ...process.env,
        ...pgEnv(),
        TMPDIR: root,
        // The owner bootstrap writes here, not under /var/lib (tests/common/mod.rs).
        AIRDRESS_OWNER_TOKEN_FILE: join(root, 'owner-token.first-boot'),
        CREDENTIALS_DIRECTORY: credentials,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const keep = (chunk: Buffer): void => {
    output = (output + chunk.toString('utf8')).slice(-20_000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);

  const origin = `http://127.0.0.1:${String(opts.port)}`;
  try {
    await waitReady(origin, child, 120_000);
  } catch (error: unknown) {
    child.kill('SIGKILL');
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n--- operator output ---\n${output}`,
    );
  }
  return {
    origin,
    logs: () => output,
    stop: async () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const force = setTimeout(() => child.kill('SIGKILL'), 20_000);
          child.once('exit', () => {
            clearTimeout(force);
            resolve();
          });
        });
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}
