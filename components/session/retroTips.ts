import { enT, MessageKey, Translator } from '../../i18n/translate';

export interface RetroPhaseTip {
  phase: string;
  label: string;
  purpose: string;
  suggestedTimebox: string;
  defaultTimerSeconds?: number;
}

/**
 * The tip of each phase. The wording lives in the `phases` dictionary so it can
 * be read in either interface language; the numbers stay here, side by side, so
 * the suggested timebox and the automatic phase timer cannot drift apart.
 */
interface RetroPhaseTipDefinition {
  phase: string;
  labelKey: MessageKey;
  purposeKey: MessageKey;
  timeboxMinutes: number;
  /** The timebox applies to each discussed topic rather than to the phase. */
  timeboxPerTopic?: boolean;
  defaultTimerSeconds: number;
}

const RETRO_PHASE_TIP_DEFINITIONS: RetroPhaseTipDefinition[] = [
  {
    phase: 'ICEBREAKER',
    labelKey: 'phases.tips.icebreaker.label',
    purposeKey: 'phases.tips.icebreaker.purpose',
    timeboxMinutes: 5,
    defaultTimerSeconds: 300
  },
  {
    phase: 'WELCOME',
    labelKey: 'phases.tips.welcome.label',
    purposeKey: 'phases.tips.welcome.purpose',
    timeboxMinutes: 2,
    defaultTimerSeconds: 120
  },
  {
    phase: 'OPEN_ACTIONS',
    labelKey: 'phases.tips.openActions.label',
    purposeKey: 'phases.tips.openActions.purpose',
    timeboxMinutes: 3,
    defaultTimerSeconds: 180
  },
  {
    phase: 'BRAINSTORM',
    labelKey: 'phases.tips.brainstorm.label',
    purposeKey: 'phases.tips.brainstorm.purpose',
    timeboxMinutes: 7,
    defaultTimerSeconds: 420
  },
  {
    phase: 'GROUP',
    labelKey: 'phases.tips.group.label',
    purposeKey: 'phases.tips.group.purpose',
    timeboxMinutes: 15,
    defaultTimerSeconds: 900
  },
  {
    phase: 'VOTE',
    labelKey: 'phases.tips.vote.label',
    purposeKey: 'phases.tips.vote.purpose',
    timeboxMinutes: 3,
    defaultTimerSeconds: 180
  },
  {
    phase: 'DISCUSS',
    labelKey: 'phases.tips.discuss.label',
    purposeKey: 'phases.tips.discuss.purpose',
    timeboxMinutes: 8,
    timeboxPerTopic: true,
    defaultTimerSeconds: 480
  },
  {
    phase: 'REVIEW',
    labelKey: 'phases.tips.review.label',
    purposeKey: 'phases.tips.review.purpose',
    timeboxMinutes: 3,
    defaultTimerSeconds: 180
  },
  {
    phase: 'CLOSE',
    labelKey: 'phases.tips.close.label',
    purposeKey: 'phases.tips.close.purpose',
    timeboxMinutes: 3,
    defaultTimerSeconds: 180
  }
];

const toTip = (definition: RetroPhaseTipDefinition, t: Translator): RetroPhaseTip => ({
  phase: definition.phase,
  label: t(definition.labelKey),
  purpose: t(definition.purposeKey),
  suggestedTimebox: t(
    definition.timeboxPerTopic ? 'phases.tips.timeboxMinutesPerTopic' : 'phases.tips.timeboxMinutes',
    { minutes: definition.timeboxMinutes }
  ),
  defaultTimerSeconds: definition.defaultTimerSeconds
});

/** The tips in English, as the module exported them before translation existed. */
export const RETRO_PHASE_TIPS: RetroPhaseTip[] = RETRO_PHASE_TIP_DEFINITIONS.map((definition) =>
  toTip(definition, enT)
);

/** The tip for `phase`, in the language of `t` (English when called without one). */
export const getRetroPhaseTip = (phase: string, t: Translator = enT): RetroPhaseTip => {
  const definition = RETRO_PHASE_TIP_DEFINITIONS.find((tip) => tip.phase === phase);
  if (definition) return toTip(definition, t);
  return {
    phase,
    label: phase.replace(/_/g, ' '),
    purpose: t('phases.tips.fallbackPurpose'),
    suggestedTimebox: t('phases.tips.fallbackTimebox')
  };
};

export const getRetroPhaseDefaultTimerSeconds = (phase: string): number | null =>
  RETRO_PHASE_TIP_DEFINITIONS.find((tip) => tip.phase === phase)?.defaultTimerSeconds ?? null;
