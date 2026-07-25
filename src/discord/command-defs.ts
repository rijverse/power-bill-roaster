// The slash-command set, in Discord's application-command JSON shape. Bulk
// PUT at boot (idempotent), so editing this file is the whole deploy story
// for command changes. Names/descriptions must satisfy Discord's limits:
// lowercase names ≤32 chars, descriptions 1-100 chars.

const STRING = 3;

export const DISCORD_COMMANDS = [
  { name: 'help', description: 'All commands' },
  { name: 'privacy', description: 'What we store and why' },
  { name: 'balance', description: 'Check balances right now' },
  { name: 'meters', description: 'List your registered meters' },
  { name: 'plan', description: 'Your current plan' },
  { name: 'dashboard', description: 'Balance history charts in your browser' },
  {
    name: 'tone',
    description: 'How hard should the alerts roast you?',
    options: [
      {
        type: STRING,
        name: 'style',
        description: 'savage or mild',
        required: true,
        choices: [
          { name: 'savage 🌶️', value: 'savage' },
          { name: 'mild 🥛', value: 'mild' },
        ],
      },
    ],
  },
  {
    name: 'webhook',
    description: 'Also post alerts to a channel webhook',
    options: [
      {
        type: STRING,
        name: 'url',
        description: 'Discord webhook URL, or "off" to pause. Empty shows status.',
        required: false,
      },
    ],
  },
  { name: 'connect', description: 'Connect this Discord to your Power Roast web account' },
  { name: 'stop', description: 'Pause all monitoring' },
  {
    name: 'delete',
    description: 'Erase your account and all data',
    options: [
      {
        type: STRING,
        name: 'confirm',
        description: 'Type CONFIRM (all caps) to erase everything. No undo.',
        required: true,
      },
    ],
  },
];
