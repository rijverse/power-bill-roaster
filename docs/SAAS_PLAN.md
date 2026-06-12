# Power Roast SaaS Plan

Right now Power Roast is just a personal script for me. It checks the DESCO prepaid API every 6 hours and sends a brutally honest email when the electricity balance drops. 

But there's a real SaaS opportunity here. Millions of people in Bangladesh are on prepaid meters and the official apps kinda suck because they don't proactively alert you and they definitely don't let landlords or property managers oversee multiple meters easily. 

The goal is to turn this into the main prepaid utility monitor for Bangladesh. We will start with DESCO and then expand to DPDC, NESCO, WZPDCL, etc. We move from a simple personal alert tool to a B2B fleet dashboard for landlords.

The plan 1. Validate with a free Telegram bot (almost zero cost).
2. Monetize by offering SMS alerts and multi meter support via bKash or SSLCommerz.
3. Build the B2B multi meter dashboard from day one.


### The Problem
When a prepaid meter hits zero the power shuts off. That means dead devices, spoiled food in the fridge, and dark stairwells, usually happening at the worst possible time. 

Current official apps * Rely on you remembering to check them
* Crash randomly or have terrible UX
* Don't send reliable proactive alerts
* They're totally useless if you're a landlord trying to manage 20 different meters

### Who's going to use this?

**1. Normal urban households (Dhaka first)**
They get surprise blackouts and hate it. They probably won't pay much (maybe 0 50 BDT/month). We need them for growth and word of mouth but they aren't the main revenue source.

**2. Landlords & Property Managers**
This is where the real money is. They manage anywhere from 10 to 100+ meters in a single building. Right now they have no easy way to check all the balances at once, which causes a lot of arguments with tenants. They'll easily pay per meter for this.

**3. Small offices / shops**
Need to know when to switch to generators. Moderate willingness to pay.

### Realities on the ground
* Emails don't really work well for alerts here. Telegram is widely used and free. SMS is the holy grail because it works during a power cut when WiFi is down and that's what people will pay for.
* Stripe isn't an option. We have to use bKash Merchant API or SSLCommerz.
* Because consumer revenue is low, our free tier has to basically run on air.

### Why us?
* **Proactive alerts ** We tell you before it runs out.
* **Smart prediction ** "At your current burn rate you have 3 days left." Way better than just a static number.
* **The Roast ** Our brutal/funny tone is basically our marketing hook. B2B users can toggle it to professional mode though.
* **B2B fleet view ** Literally nobody is building this for landlords yet.


### Product Rollout

**Phase 1 Validate (Telegram Bot MVP)**
Get this out the door in a few weeks for almost zero cost. The user sends their account and meter number to the bot, picks a threshold, and that's it. No need to mess with auth systems just yet.
* A worker loops through meters and checks balances.
* If it crosses the LOW or CRITICAL threshold it fires an alert.
* We start storing balance histories since this data becomes our main advantage.

**Phase 2 Monetize**
* Build a web dashboard (magic link or Google login) so people can see charts and trends.
* Introduce **SMS alerts** (the premium feature).
* Hook up bKash or SSLCommerz for subscriptions.
* Support adding multiple meters with custom names (e.g. "Flat 3B").

**Phase 3 Expand**
* Add DPDC, NESCO, etc.
* Launch the **B2B Landlord Dashboard** Grid view of all units, tenant alert routing, CSV exports.
* Maybe look into prepaid gas (Titas) or water (WASA) later.

*Note We are NOT touching actual recharges or payments for users (way too much legal headache for now). No mobile apps either, responsive web + Telegram gets the job done.*


### How we make money (Pricing Ideas)
* **Self hosted (free forever) ** the repo stays open source. Devs can fork it and run the email checker on their own GitHub Actions runner like before. They were never going to pay anyway they're our marketing and word of mouth funnel.
* **Free Tier ** 1 meter, Telegram/Email alerts, checks every 6 hours. Tone is Roasted. (Cost to us is basically zero).
* **Plus (~30 50 BDT/mo) ** Up to 5 meters, SMS alerts (with a monthly limit), checks hourly, run out prediction.
* **Business (~15 25 BDT/meter/mo) ** Fleet dashboard, tenant routing, reports, exports, professional tone. (Minimum 10 meters).


### Tech Stack & Arch

It's going to be Node/TypeScript on the backend.
* **Worker/Scheduler ** Need a single worker loop (maybe BullMQ) instead of GitHub Actions. We'll run it on a small VPS to handle thousands of meters.
* **Database ** PostgreSQL. Perfect for multi tenant and storing historical readings cheaply.
* **Emails ** Swap out Gmail for something like Resend with our own domain.
* **Hosting ** Ideally something in the BD region or with a BD IP so DESCO doesn't block us as a foreign scraper. VPS, Fly.io, or Railway.

**How to not get banned**
We're relying on DESCO's unofficial API. If we slam them with requests they'll block us.
* We must use batching with jitter (no thundering herds).
* Cache readings heavily (balances don't change by the minute).
* Back off exponentially if their API throws errors.

**Basic Data Model**
* `users` id, tg_chat_id, email, tone_pref, plan
* `meters` id, user_id, provider, account_no, meter_no, thresholds
* `readings` id, meter_id, balance, timestamp (this is our goldmine)
* `alert_state` keeps track of whether we already warned them so we don't spam.


### Risks
* **DESCO bans us ** This would end the whole thing. We need to be super gentle with their API.
* **DESCO builds this themselves ** Possible but they probably won't build the multi meter predictive stuff or the Telegram bot.
* **Storing meter numbers ** It's a privacy thing. Anyone with the number can check the balance. We need to be transparent about not sharing it.

### Roadmap to Launch
1. **Core setup ** Postgres schema, polite scheduler, abstract the DESCO client.
2. **TG Bot ** Registration, config, on demand checks.
3. **Soft Launch ** Drop it in some local dev/tech communities.
4. **Dashboard ** Build the web app and charts.
5. **Monetization ** Wire up bKash and SMS gateways.
6. **B2B ** Build the landlord view.

### Stuff I still need to figure out
* Is there a good local VPS provider in BD with decent uptime? Or is Singapore fine?
* Does DESCO rate limit per IP? Need to test this gently.
* What are the exact requirements to get a bKash Merchant account as a solo dev?
* Do DPDC and others even have unauthenticated APIs like DESCO does?
* Should I keep the name "Power Roast" for B2B or use something boring like "MeterOps"?
