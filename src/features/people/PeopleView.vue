<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AreaFrame from '@/components/AreaFrame.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import ErrorNotice from '@/components/ErrorNotice.vue';
import { HttpError } from '@/api/errors.ts';
import { formatTime } from '@/format.ts';
import type { PendingAction } from '@/operator/step-up.ts';
import { useStepUp } from '@/operator/step-up.ts';
import type { AccountChoice, SubUser } from './api.ts';
import { usePeopleWrite, useSubUsers } from './api.ts';

/**
 * Sub-users (FR-27). Revoking one and changing their publication block are
 * destructive (step-up); creating one is not. Pairing codes are not minted
 * here: the operator refuses hub tokens on that route (`/v1/endpoints/
 * pairing-codes`), so a person's device joins from the app or the CLI.
 */
type PeopleOp = 'revoke' | 'block' | 'unblock';

const { t, locale } = useI18n();
const people = useSubUsers();
const write = usePeopleWrite();
const stepUp = useStepUp();

const name = ref('');
const created = ref<string | undefined>(undefined);
/** The operator asked how the person gets an account; held until answered. */
const choosing = ref<string | undefined>(undefined);

const resumed = stepUp.resume('people');
const target = ref<PendingAction | undefined>(resumed);
const confirming = ref(resumed !== undefined);
const wasResumed = ref(resumed !== undefined);
const done = ref<string | undefined>(undefined);

const rows = computed(() => people.data.value ?? []);
const targetOp = computed<PeopleOp>(() => {
  const op = target.value?.op;
  return op === 'block' || op === 'unblock' ? op : 'revoke';
});

async function create(account?: AccountChoice): Promise<void> {
  const displayName = choosing.value ?? name.value.trim();
  if (displayName === '') return;
  created.value = undefined;
  try {
    await write.mutateAsync(
      account === undefined
        ? { op: 'create', displayName }
        : { op: 'create', displayName, account },
    );
    created.value = displayName;
    choosing.value = undefined;
    name.value = '';
  } catch (error: unknown) {
    // An operator with the person lane on asks how the person gets an
    // account; nothing was created, so ask the owner and send it again
    // with the answer. Anything else is shown from `write.error` (a taken
    // name answers 409), and the form keeps what was typed.
    if (error instanceof HttpError && error.code === 'account_choice_required') {
      choosing.value = displayName;
      write.reset();
    }
  }
}

function ask(person: SubUser, op: PeopleOp): void {
  done.value = undefined;
  wasResumed.value = false;
  target.value = { area: 'people', op, target: person.id, label: person.displayName };
  confirming.value = true;
}

async function confirm(): Promise<void> {
  const action = target.value;
  if (action === undefined) return;
  const op = targetOp.value;
  try {
    await stepUp.run(action, () => write.mutateAsync({ op, id: action.target }));
    done.value = t(`people.done.${op}`, { name: action.label });
    confirming.value = false;
  } catch {
    // Shown from `write.error`; a step-up has already redirected.
  }
}
</script>

<template>
  <AreaFrame area="people">
    <p class="hint">{{ t('people.lead') }}</p>
    <form class="form" @submit.prevent="create()">
      <label for="person-name">{{ t('people.nameLabel') }}</label>
      <input id="person-name" v-model="name" type="text" maxlength="80" autocomplete="off" />
      <div class="actions">
        <button
          type="submit"
          class="primary"
          :disabled="write.isPending.value || name.trim() === ''"
        >
          {{ t('people.add') }}
        </button>
      </div>
    </form>
    <section v-if="choosing !== undefined" class="card" aria-labelledby="account-choice">
      <h3 id="account-choice">{{ t('people.choice.title', { name: choosing }) }}</h3>
      <p class="hint">{{ t('people.choice.recommended') }}</p>
      <p>{{ t('people.choice.offerBody') }}</p>
      <div class="actions">
        <button
          type="button"
          class="primary"
          :disabled="write.isPending.value"
          @click="create('offer')"
        >
          {{ t('people.choice.offer') }}
        </button>
      </div>
      <p>{{ t('people.choice.noneBody') }}</p>
      <ul class="hint">
        <li>{{ t('people.choice.noneCost1') }}</li>
        <li>{{ t('people.choice.noneCost2') }}</li>
      </ul>
      <div class="actions">
        <button type="button" :disabled="write.isPending.value" @click="choosing = undefined">
          {{ t('common.cancel') }}
        </button>
        <button type="button" :disabled="write.isPending.value" @click="create('none')">
          {{ t('people.choice.none') }}
        </button>
      </div>
    </section>
    <p v-if="created !== undefined" class="notice notice-ok" role="status">
      {{ t('people.created', { name: created }) }}
    </p>
    <p v-if="done !== undefined" class="notice notice-ok" role="status">{{ done }}</p>
    <ErrorNotice v-if="write.error.value !== null" :error="write.error.value" />
    <ErrorNotice v-if="people.error.value !== null" :error="people.error.value" />
    <p v-else-if="people.isPending.value">{{ t('common.loading') }}</p>
    <p v-else-if="rows.length === 0">{{ t('people.none') }}</p>
    <table v-else>
      <thead>
        <tr>
          <th scope="col">{{ t('people.name') }}</th>
          <th scope="col">{{ t('people.added') }}</th>
          <th scope="col">{{ t('people.lastUsed') }}</th>
          <th scope="col">
            <span class="visually-hidden">{{ t('common.actions') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in rows" :key="p.id">
          <td>{{ p.displayName }}</td>
          <td>{{ formatTime(p.createdAt, locale) }}</td>
          <td>{{ formatTime(p.lastUsedAt, locale) }}</td>
          <td class="row-actions">
            <button type="button" @click="ask(p, 'block')">{{ t('people.block') }}</button>
            <button type="button" @click="ask(p, 'unblock')">{{ t('people.unblock') }}</button>
            <button type="button" class="danger" @click="ask(p, 'revoke')">
              {{ t('people.revoke') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="hint">{{ t('people.pairingHint') }}</p>
    <ConfirmDialog
      v-model:open="confirming"
      :resumed="wasResumed ? 'confirm' : 'none'"
      :title="t(`people.confirm.${targetOp}`, { name: target?.label ?? '' })"
      :confirm-label="t(`people.${targetOp}`)"
      :busy="write.isPending.value"
      @confirm="confirm"
    >
      <p>{{ t(`people.confirmBody.${targetOp}`) }}</p>
    </ConfirmDialog>
  </AreaFrame>
</template>
