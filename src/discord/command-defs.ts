// The slash-command set, in Discord's application-command JSON shape. Bulk
// PUT at boot (idempotent), so editing this file is the whole deploy story
// for command changes. Names/descriptions must satisfy Discord's limits:
// lowercase names ≤32 chars, descriptions 1-100 chars.

const STRING = 3;
const INTEGER = 4;

export const DISCORD_COMMANDS = [
  { name: 'help', description: 'All commands' },
  { name: 'privacy', description: 'What we store and why' },
  {
    name: 'register',
    description: 'Add your DESCO meter',
    options: [
      {
        type: STRING,
        name: 'account',
        description: "Your DESCO account number (it's on your bill)",
        required: true,
      },
      {
        type: STRING,
        name: 'meter',
        description: 'Your DESCO meter number',
        required: true,
      },
    ],
  },
  { name: 'balance', description: 'Check balances right now' },
  { name: 'meters', description: 'List your registered meters' },
  {
    name: 'threshold',
    description: 'Set alert levels for all your meters',
    options: [
      {
        type: INTEGER,
        name: 'low',
        description: 'Warn below this (BDT)',
        required: true,
        min_value: 1,
      },
      {
        type: INTEGER,
        name: 'critical',
        description: 'Lose my mind below this (BDT, lower than low)',
        required: true,
        min_value: 0,
      },
    ],
  },
  {
    name: 'nickname',
    description: 'Name your meter (e.g. Flat 3B)',
    options: [
      { type: STRING, name: 'name', description: 'The nickname', required: true },
      {
        type: STRING,
        name: 'meter',
        description: 'Meter number (only needed with multiple meters)',
        required: false,
      },
    ],
  },
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
  { name: 'telegram', description: 'Connect the Telegram bot - one account on both apps' },
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
