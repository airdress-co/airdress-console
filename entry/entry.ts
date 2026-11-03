// The entry document (SPEC-184 design §4): pick the channel, read its
// pointer, load that release. At /callback, hand the hub's answer to the
// release that asked (entry/route.ts). No inline script: the console's CSP
// admits same-origin scripts only.
import {
  CHANNEL_KEY,
  buildPath,
  callbackTarget,
  chooseChannel,
  isChannel,
  versionFromPointer,
} from './route.ts';

function say(text: string): void {
  const status = document.getElementById('status');
  if (status !== null) status.textContent = text;
}

function rememberedChannel(): string | null {
  try {
    return window.localStorage.getItem(CHANNEL_KEY);
  } catch {
    return null;
  }
}

function remember(channel: string): void {
  try {
    window.localStorage.setItem(CHANNEL_KEY, channel);
  } catch {
    // Storage refused (private mode): the choice lasts for this load only.
  }
}

async function main(): Promise<void> {
  if (window.location.pathname === '/callback') {
    const target = callbackTarget(window.location.search);
    if (target === null) {
      say('This sign-in answer names no console version. Open the console again and sign in.');
      return;
    }
    window.location.replace(target);
    return;
  }

  const asked = new URLSearchParams(window.location.search).get('channel');
  if (isChannel(asked)) remember(asked);
  const channel = chooseChannel(asked, rememberedChannel());

  let body: unknown;
  try {
    const response = await fetch(`/channels/${channel}.json`, { cache: 'no-store' });
    if (!response.ok) {
      say(`No console version is published on the ${channel} channel yet.`);
      return;
    }
    body = await response.json();
  } catch {
    say('The console could not be loaded. Check your connection and reload.');
    return;
  }
  const version = versionFromPointer(body);
  if (version === null) {
    say(`The ${channel} channel names no valid version.`);
    return;
  }
  window.location.replace(`${buildPath(version)}${window.location.hash}`);
}

void main();
