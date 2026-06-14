import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  boolean,
  doublePrecision,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  telegramChatId: bigint('telegram_chat_id', { mode: 'number' }).unique(),
  email: text('email'),
  tonePref: text('tone_pref').notNull().default('roast'),
  plan: text('plan').notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const meters = pgTable(
  'meters',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider').notNull().default('desco'),
    accountNo: text('account_no').notNull(),
    meterNo: text('meter_no').notNull(),
    nickname: text('nickname'),
    lowThreshold: integer('low_threshold').notNull().default(150),
    criticalThreshold: integer('critical_threshold').notNull().default(100),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('meters_user_provider_account_meter_idx').on(
      table.userId,
      table.provider,
      table.accountNo,
      table.meterNo
    ),
  ]
);

export const readings = pgTable(
  'readings',
  {
    id: serial('id').primaryKey(),
    meterId: integer('meter_id')
      .notNull()
      .references(() => meters.id),
    balance: doublePrecision('balance').notNull(),
    currentMonthConsumption: doublePrecision('current_month_consumption'),
    readingTime: text('reading_time'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index('readings_meter_fetched_idx').on(table.meterId, table.fetchedAt)]
);

export const alertState = pgTable('alert_state', {
  meterId: integer('meter_id')
    .primaryKey()
    .references(() => meters.id),
  level: text('level').notNull().default('ok'),
  lastAlertAt: timestamp('last_alert_at', { withTimezone: true }),
  lastBalance: doublePrecision('last_balance'),
  rechargeDetectedAt: timestamp('recharge_detected_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const channels = pgTable('channels', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  type: text('type').notNull(), // telegram | email | sms
  address: text('address').notNull(), // chat id, email address, or phone number
  verified: boolean('verified').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const alertsLog = pgTable('alerts_log', {
  id: serial('id').primaryKey(),
  meterId: integer('meter_id')
    .notNull()
    .references(() => meters.id),
  channelId: integer('channel_id').references(() => channels.id),
  level: text('level').notNull(),
  action: text('action').notNull(),
  deliveryStatus: text('delivery_status').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  plan: text('plan').notNull(), // plus | business
  provider: text('provider').notNull(), // sandbox | bkash | sslcommerz | manual
  status: text('status').notNull().default('pending'), // pending | active | cancelled | expired
  externalRef: text('external_ref'), // provider-side payment/agreement id
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Immutable money ledger: one row per confirmed payment. Subscriptions track
// state; this table is the record for reconciliation and disputes. The unique
// external_ref makes confirmation idempotent - a duplicate IPN + redirect for
// the same payment can't book the same money twice.
export const payments = pgTable(
  'payments',
  {
    id: serial('id').primaryKey(),
    subscriptionId: integer('subscription_id')
      .notNull()
      .references(() => subscriptions.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider').notNull(),
    externalRef: text('external_ref'),
    amountBdt: integer('amount_bdt').notNull(),
    status: text('status').notNull().default('completed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [uniqueIndex('payments_external_ref_idx').on(table.externalRef)]
);

export type User = typeof users.$inferSelect;
export type Meter = typeof meters.$inferSelect;
export type Reading = typeof readings.$inferSelect;
export type AlertStateRow = typeof alertState.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Payment = typeof payments.$inferSelect;
