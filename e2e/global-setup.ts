import { execFileSync } from 'node:child_process';
import { startFakeAs } from './harness/fake-as.ts';
import {
  AS_PORT,
  CONSOLE_ORIGIN,
  OPERATOR_ADMIN_PORT,
  OPERATOR_FQDN,
  OPERATOR_PORT,
  OWNER_SUB,
  STEP_UP_MAX_AGE_SECS,
} from './harness/env.ts';
import { startOperator } from './harness/operator.ts';

/**
 * Starts the fake authorization server and a real airdress-operator before
 * any test, and returns their teardown. The operator is AIRDRESS_OPERATOR_BIN
 * if set (a local build), else the release the API is pinned to, fetched and
 * checksummed by e2e/fetch-operator.sh (e2e/README.md).
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const binary =
    process.env['AIRDRESS_OPERATOR_BIN'] ??
    execFileSync('sh', ['e2e/fetch-operator.sh'], { encoding: 'utf8' }).trim();
  const as = await startFakeAs({
    port: AS_PORT,
    consoleOrigin: CONSOLE_ORIGIN,
    operatorFqdn: OPERATOR_FQDN,
    ownerSub: OWNER_SUB,
  });
  let operator;
  try {
    operator = await startOperator({
      binary,
      port: OPERATOR_PORT,
      adminPort: OPERATOR_ADMIN_PORT,
      airdress: OPERATOR_FQDN,
      consoleOrigin: CONSOLE_ORIGIN,
      hubIssuer: as.issuer,
      ownerSub: OWNER_SUB,
      stepUpMaxAgeSecs: STEP_UP_MAX_AGE_SECS,
    });
  } catch (error: unknown) {
    await as.close();
    throw error;
  }
  return async () => {
    await operator.stop();
    await as.close();
  };
}
