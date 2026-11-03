<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { HttpError } from '@/api/errors.ts';
import AreaFrame from '@/components/AreaFrame.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import ErrorNotice from '@/components/ErrorNotice.vue';
import { formatTime } from '@/format.ts';
import type { PendingAction } from '@/operator/step-up.ts';
import { useStepUp } from '@/operator/step-up.ts';
import type { Resource } from './api.ts';
import {
  isEnabled,
  isKindUnknown,
  schedulesFiring,
  useFunctionLogs,
  useFunctionVersions,
  useFunctionWrite,
  useFunctions,
  useSchedules,
} from './api.ts';

/**
 * One function (FR-34–FR-36): versions with promote and roll back, logs, and
 * switching it on or off, offering to pause or resume the schedules that
 * fire it. Each write is its own conditional request and is reported on its
 * own row: the console never claims the whole action succeeded when one part
 * did not.
 */
const { name } = defineProps<{ name: string }>();

const { t, locale } = useI18n();
const functions = useFunctions();
const schedules = useSchedules();
const versions = useFunctionVersions(() => name);
const logs = useFunctionLogs(() => name);
const write = useFunctionWrite();
const stepUp = useStepUp();

const fn = computed(() => functions.data.value?.find((f) => f.name === name));
const firing = computed(() => schedulesFiring(schedules.data.value ?? [], name));
const alsoSchedules = ref(true);
/**
 * Schedules this page paused. Enabling offers to resume these and no others:
 * a schedule a person had switched off on purpose stays off (design §6.5).
 * Kept in memory only, so a reload forgets it and nothing is resumed.
 */
const pausedHere = ref<string[]>([]);
const offered = computed(() =>
  targetOp.value === 'disable'
    ? firing.value.filter((s) => isEnabled(s))
    : firing.value.filter((s) => pausedHere.value.includes(s.name) && !isEnabled(s)),
);

interface Outcome {
  readonly what: string;
  readonly ok: boolean;
  readonly error: unknown;
}
const outcomes = ref<Outcome[]>([]);

const target = ref<PendingAction | undefined>(undefined);
const confirming = ref(false);
const wasResumed = ref(false);

/** Offer again an action this page started before a step-up sign-in. */
function adopt(action: PendingAction | undefined): void {
  if (action?.target !== name) return;
  target.value = action;
  confirming.value = true;
  wasResumed.value = true;
}
adopt(stepUp.resume('functions'));

type FnOp = 'promote' | 'disable' | 'enable';
const targetOp = computed<FnOp>(() => {
  const op = target.value?.op;
  return op === 'disable' || op === 'enable' ? op : 'promote';
});
/** For a promote, the version is carried in the label's own field: `promote:<version>`. */
const promoteTo = ref<string | undefined>(undefined);

function askPromote(version: string): void {
  outcomes.value = [];
  wasResumed.value = false;
  promoteTo.value = version;
  target.value = { area: 'functions', op: 'promote', target: name, label: version };
  confirming.value = true;
}

function askSwitch(enable: boolean): void {
  outcomes.value = [];
  wasResumed.value = false;
  target.value = {
    area: 'functions',
    op: enable ? 'enable' : 'disable',
    target: name,
    label: name,
  };
  confirming.value = true;
}

async function setEnabled(resource: Resource, enabled: boolean): Promise<Outcome> {
  const what = `${resource.kind} ${resource.name}`;
  try {
    await write.mutateAsync({ op: 'set-enabled', resource, enabled });
    return { what, ok: true, error: null };
  } catch (error: unknown) {
    return { what, ok: false, error };
  }
}

async function confirm(): Promise<void> {
  const action = target.value;
  if (action === undefined) return;
  const op = targetOp.value;
  try {
    if (op === 'promote') {
      const version = promoteTo.value ?? action.label;
      await stepUp.run({ ...action, label: version }, () =>
        write.mutateAsync({ op: 'promote', name, version, basedOn: versions.data.value?.current }),
      );
      outcomes.value = [{ what: t('functions.promoted', { version }), ok: true, error: null }];
    } else {
      const resource = fn.value;
      if (resource === undefined) return;
      const enable = op === 'enable';
      // The function first, so nothing new fires into a half-switched state;
      // then each schedule, each its own conditional write (design §6.5).
      await stepUp.run(action, () =>
        write.mutateAsync({ op: 'set-enabled', resource, enabled: enable }),
      );
      const results: Outcome[] = [{ what: `Function ${name}`, ok: true, error: null }];
      if (alsoSchedules.value) {
        for (const s of offered.value) {
          const outcome = await setEnabled(s, enable);
          results.push(outcome);
          if (outcome.ok && !enable) pausedHere.value.push(s.name);
          if (outcome.ok && enable) pausedHere.value = pausedHere.value.filter((n) => n !== s.name);
        }
      }
      outcomes.value = results;
    }
    confirming.value = false;
  } catch (error: unknown) {
    if (!(error instanceof HttpError && error.code === 'insufficient_user_authentication')) {
      outcomes.value = [{ what: name, ok: false, error }];
    }
  }
}
</script>

<template>
  <AreaFrame area="functions">
    <p>
      <RouterLink :to="{ name: 'functions' }">← {{ t('functions.all') }}</RouterLink>
    </p>
    <h2 class="mono">{{ name }}</h2>
    <p v-if="isKindUnknown(functions.error.value)" class="notice">{{ t('functions.notServed') }}</p>
    <ErrorNotice v-else-if="functions.error.value !== null" :error="functions.error.value" />
    <template v-else-if="fn !== undefined">
      <p>
        {{ t('functions.switch') }}:
        <strong>{{ isEnabled(fn) ? t('common.on') : t('common.off') }}</strong>
        <button
          type="button"
          :class="isEnabled(fn) ? 'danger' : 'primary'"
          @click="askSwitch(!isEnabled(fn))"
        >
          {{ isEnabled(fn) ? t('functions.disable') : t('functions.enable') }}
        </button>
      </p>
      <ul class="conditions">
        <li v-for="c in fn.conditions" :key="c.type">
          {{ c.type }}:
          <span :class="c.status === 'True' ? 'status-on' : 'status-off'">{{ c.status }}</span>
          <span v-if="c.reason !== undefined" class="hint"> · {{ c.reason }}</span>
          <span v-if="c.message !== undefined" class="hint"> — {{ c.message }}</span>
        </li>
      </ul>
      <p v-if="firing.length > 0" class="hint">
        {{ t('functions.firedBy', { names: firing.map((s) => s.name).join(', ') }) }}
      </p>
    </template>

    <ul v-if="outcomes.length > 0" class="outcomes" aria-live="polite">
      <li v-for="(o, i) in outcomes" :key="i">
        <span :class="o.ok ? 'status-on' : 'status-off'">{{ o.ok ? '✓' : '✗' }}</span>
        {{ o.what }}
        <ErrorNotice v-if="!o.ok" :error="o.error" />
      </li>
    </ul>

    <h3>{{ t('functions.versions') }}</h3>
    <ErrorNotice v-if="versions.error.value !== null" :error="versions.error.value" />
    <p v-else-if="versions.isPending.value">{{ t('common.loading') }}</p>
    <table v-else>
      <thead>
        <tr>
          <th scope="col">{{ t('functions.version') }}</th>
          <th scope="col">{{ t('functions.published') }}</th>
          <th scope="col">{{ t('functions.signer') }}</th>
          <th scope="col">
            <span class="visually-hidden">{{ t('common.actions') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="v in versions.data.value?.versions ?? []" :key="v.version">
          <td class="mono">
            {{ v.version.slice(0, 16) }}
            <span v-if="v.current" class="status-on"> · {{ t('functions.running') }}</span>
            <span v-if="v.quarantined" class="status-off"> · {{ t('functions.quarantined') }}</span>
          </td>
          <td>
            {{ formatTime(v.publishedAt, locale) }}
            <div class="hint">{{ v.publishedBy ?? '' }}</div>
          </td>
          <td class="mono">{{ v.signerMachine ?? v.signerKey?.slice(0, 16) ?? '—' }}</td>
          <td>
            <button
              v-if="!v.current && !v.quarantined"
              type="button"
              @click="askPromote(v.version)"
            >
              {{ t('functions.promote') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <h3>{{ t('functions.logs') }}</h3>
    <ErrorNotice v-if="logs.error.value !== null" :error="logs.error.value" />
    <p v-else-if="(logs.data.value ?? []).length === 0">{{ t('functions.noLogs') }}</p>
    <pre v-else class="logs" tabindex="0" :aria-label="t('functions.logs')">{{
      (logs.data.value ?? []).map((l) => `${l.at} ${l.level.toUpperCase()} ${l.body}`).join('\n')
    }}</pre>

    <ConfirmDialog
      v-model:open="confirming"
      :title="
        t(`functions.confirm.${targetOp}`, {
          name,
          version: (promoteTo ?? target?.label ?? '').slice(0, 16),
        })
      "
      :confirm-label="t(`functions.${targetOp}`)"
      :busy="write.isPending.value"
      @confirm="confirm"
    >
      <p v-if="wasResumed">{{ t('stepUp.resumed') }}</p>
      <p>{{ t(`functions.confirmBody.${targetOp}`) }}</p>
      <label v-if="targetOp !== 'promote' && offered.length > 0">
        <input v-model="alsoSchedules" type="checkbox" />
        {{
          t(targetOp === 'disable' ? 'functions.alsoPause' : 'functions.alsoResume', {
            names: offered.map((s) => s.name).join(', '),
          })
        }}
      </label>
    </ConfirmDialog>
  </AreaFrame>
</template>
