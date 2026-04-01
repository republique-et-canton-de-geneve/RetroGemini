export interface TimeboxPreset {
  label: string;
  seconds: number;
}

export interface RetroPhaseTip {
  phase: string;
  label: string;
  purpose: string;
  suggestedTimebox: string;
  presets?: TimeboxPreset[];
}

export const RETRO_PHASE_TIPS: RetroPhaseTip[] = [
  {
    phase: 'ICEBREAKER',
    label: 'Icebreaker',
    purpose: 'Help everyone speak early and lower the barrier to participation. Keep it light: one quick answer per person is enough.',
    suggestedTimebox: '5 min',
    presets: [{ label: 'Set 5 min', seconds: 300 }]
  },
  {
    phase: 'WELCOME',
    label: 'Welcome',
    purpose: "Check the room before starting the retrospective. This step helps the facilitator understand the team's energy and gives everyone a quick way to signal how they arrive today.",
    suggestedTimebox: '2 min',
    presets: [{ label: 'Set 2 min', seconds: 120 }]
  },
  {
    phase: 'OPEN_ACTIONS',
    label: 'Open actions',
    purpose: 'Review actions from previous retrospectives and decide which ones are still worth pursuing. Some unfinished actions should continue, while others may be outdated and can be closed without carrying them forward.',
    suggestedTimebox: '3 min',
    presets: [{ label: 'Set 3 min', seconds: 180 }]
  },
  {
    phase: 'BRAINSTORM',
    label: 'Brainstorm',
    purpose: 'Give everyone time to think and write silently on their own before any group discussion starts. The goal is to collect as many observations, frustrations, wins, and ideas as possible without influence from others.',
    suggestedTimebox: '5 to 7 min',
    presets: [
      { label: 'Set 5 min', seconds: 300 },
      { label: 'Set 7 min', seconds: 420 }
    ]
  },
  {
    phase: 'GROUP',
    label: 'Group',
    purpose: 'Go through the topics raised by the whole group, clarify what each ticket means, and cluster similar tickets together. Avoid debating solutions at this stage, but clarification questions are welcome.',
    suggestedTimebox: '15 min',
    presets: [{ label: 'Set 15 min', seconds: 900 }]
  },
  {
    phase: 'VOTE',
    label: 'Vote',
    purpose: 'Prioritize which topics deserve discussion in this session. Voting helps the team focus its time on the themes that feel most important right now.',
    suggestedTimebox: '3 to 5 min',
    presets: [
      { label: 'Set 3 min', seconds: 180 },
      { label: 'Set 5 min', seconds: 300 }
    ]
  },
  {
    phase: 'DISCUSS',
    label: 'Discuss',
    purpose: 'Go through the topics starting with the ones that received the most votes. For each topic, aim to agree on one or more concrete actions that the team validates to improve the situation.',
    suggestedTimebox: '8 min per topic',
    presets: [{ label: 'Set 8 min', seconds: 480 }]
  },
  {
    phase: 'REVIEW',
    label: 'Review',
    purpose: 'Review the actions selected during discussion, make sure each one is clear, and assign every action to an owner.',
    suggestedTimebox: '3 min',
    presets: [{ label: 'Set 3 min', seconds: 180 }]
  },
  {
    phase: 'CLOSE',
    label: 'Close',
    purpose: 'Wrap up the retrospective with a quick ROTI vote and close the session cleanly. If the feedback shows the retro did not feel like a good use of time, use this step to capture actions that will improve future retrospectives.',
    suggestedTimebox: '2 to 3 min',
    presets: [
      { label: 'Set 2 min', seconds: 120 },
      { label: 'Set 3 min', seconds: 180 }
    ]
  }
];

export const getRetroPhaseTip = (phase: string): RetroPhaseTip =>
  RETRO_PHASE_TIPS.find((tip) => tip.phase === phase) ?? {
    phase,
    label: phase.replace(/_/g, ' '),
    purpose: 'Use the current stage to keep the conversation focused and move the retrospective forward.',
    suggestedTimebox: 'Adjust to team size'
  };
