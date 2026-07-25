# Power-Roast User Guide

Welcome to **Power-Roast**. This guide explains how to create your account, add a
DESCO meter, and get low-balance alerts on Telegram, Discord, and WhatsApp.

Your account lives on the **web dashboard** and is keyed to your email. You add and
manage meters there, then connect any chat app you like to receive alerts. One
email, one account, no matter how many apps you connect.

---

## 1. Create your account

1. Open the web app sign-in page at `/app`.
2. Enter your email and click **Send sign-in link**.
3. Open the link in your inbox (or type the 6-digit code from the email). That's
   it, no password.

---

## 2. Add your meter

On the dashboard, add your DESCO meter with its **account number** and **meter
number** (both are on your bill). The dashboard is also where you set alert
thresholds, rename a meter, and pause monitoring. The free plan watches one meter.

---

## 3. Get alerts where you want

Connect any of these from the dashboard's **Alerts** screen. They are delivery
channels for the same account, so connecting more apps never changes your meter
limit.

### Telegram
Tap **Connect Telegram**. It opens the bot with a one-time link. Press **Start**
and you're connected. Alerts arrive as Telegram messages.

### Discord
Alerts arrive as a direct message from the bot. In Discord, run `/connect` and
open the link it gives you (sign in on the web first if you haven't). Make sure
your Discord privacy settings allow DMs from server members. If you'd rather post
alerts to a channel, use a webhook instead (see below).

### WhatsApp
Tap **Connect WhatsApp** on the dashboard. It opens WhatsApp with a short code
already filled in, just hit send to link your number.

### Discord channel webhook (optional)
To post alerts into a specific Discord channel instead of a DM:
1. In Discord: **Server Settings → Integrations → Webhooks → New Webhook → Copy URL**.
2. Paste it into **Alerts & Thresholds** on the dashboard and click **Connect**
   (or run `/webhook <url>` in the Discord bot, or `/discord <url>` in Telegram).

---

## 4. What the chat bots can do

Meters are managed on the dashboard, so the bots focus on alerts plus a few quick
read-only commands:

| Action | Telegram | Discord |
| :--- | :--- | :--- |
| Check balance now | `/balance` | `/balance` |
| List your meters | `/meters` | `/meters` |
| Open your dashboard | `/dashboard` | `/dashboard` |
| Pause all monitoring | `/stop` | `/stop` |
| Connect this app to your account | `/email <address>` | `/connect` |
| Erase your account | `/delete` | `/delete` |

To add a meter or change thresholds and nicknames, open your dashboard
(`/dashboard` links straight to it).
