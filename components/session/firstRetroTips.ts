export interface TimeboxPreset {
  label: string;
  seconds: number;
}

export interface FirstRetroPhaseTip {
  phase: string;
  label: string;
  suggestedTimebox: string;
  guidance: string;
  note?: string;
  presets?: TimeboxPreset[];
}

export const FIRST_RETRO_PHASE_TIPS: FirstRetroPhaseTip[] = [
  {
    phase: 'ICEBREAKER',
    label: 'Icebreaker',
    suggestedTimebox: '2 to 3 min',
    guidance: 'Keep it light and move on once everyone has shared one quick answer.',
    presets: [
      { label: 'Set 2 min', seconds: 120 },
      { label: 'Set 3 min', seconds: 180 }
    ]
  },
  {
    phase: 'WELCOME',
    label: 'Welcome',
    suggestedTimebox: '2 min',
    guidance: 'Check the room, reveal the mood, then move on before the energy drops.',
    presets: [{ label: 'Set 2 min', seconds: 120 }]
  },
  {
    phase: 'OPEN_ACTIONS',
    label: 'Open actions',
    suggestedTimebox: '5 min',
    guidance: 'Review only unfinished actions that still matter to the team today.',
    presets: [{ label: 'Set 5 min', seconds: 300 }]
  },
  {
    phase: 'BRAINSTORM',
    label: 'Brainstorm',
    suggestedTimebox: '5 to 7 min',
    guidance: 'Silent writing usually helps people generate more ideas before discussion starts.',
    note: 'A short timebox keeps the pace high without cutting off useful input.',
    presets: [
      { label: 'Set 5 min', seconds: 300 },
      { label: 'Set 7 min', seconds: 420 }
    ]
  },
  {
    phase: 'GROUP',
    label: 'Group',
    suggestedTimebox: '5 to 8 min',
    guidance: 'Merge duplicates, keep labels clear, and avoid debating solutions yet.',
    presets: [
      { label: 'Set 5 min', seconds: 300 },
      { label: 'Set 8 min', seconds: 480 }
    ]
  },
  {
    phase: 'VOTE',
    label: 'Vote',
    suggestedTimebox: '3 to 5 min',
    guidance: 'Give everyone enough time to spread votes before revealing the top topics.',
    presets: [
      { label: 'Set 3 min', seconds: 180 },
      { label: 'Set 5 min', seconds: 300 }
    ]
  },
  {
    phase: 'DISCUSS',
    label: 'Discuss',
    suggestedTimebox: '10 min/topic',
    guidance: 'Reset the timer for each topic and aim to leave with one concrete next action.',
    note: 'If the group is stuck, use Move On and come back later only if it still matters.',
    presets: [{ label: 'Set 10 min', seconds: 600 }]
  },
  {
    phase: 'REVIEW',
    label: 'Review',
    suggestedTimebox: '5 min',
    guidance: 'Confirm owners, wording, and what success looks like before closing the retro.',
    presets: [{ label: 'Set 5 min', seconds: 300 }]
  },
  {
    phase: 'CLOSE',
    label: 'Close',
    suggestedTimebox: '2 to 3 min',
    guidance: 'Collect ROTI quickly and finish with one takeaway or thank-you.',
    presets: [
      { label: 'Set 2 min', seconds: 120 },
      { label: 'Set 3 min', seconds: 180 }
    ]
  }
];

export const getFirstRetroPhaseTip = (phase: string): FirstRetroPhaseTip =>
  FIRST_RETRO_PHASE_TIPS.find((tip) => tip.phase === phase) ?? {
    phase,
    label: phase.replace(/_/g, ' '),
    suggestedTimebox: 'Adjust to team size',
    guidance: 'Use the timer as a lightweight guardrail, not a hard rule.'
  };
