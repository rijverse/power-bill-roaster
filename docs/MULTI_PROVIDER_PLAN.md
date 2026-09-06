# Adding more electricity providers

Status: planning. Last updated 2026-06-25.

Right now Power-Roast only works if your meter is a DESCO prepaid meter. That covers
the northern half of Dhaka and nothing else. Every time someone on DPDC, a Palli
Bidyut meter, or anything outside DESCO tries to register, they hit a wall at the
meter-lookup step and leave. This doc is about getting past that wall, and about
being honest with ourselves on which providers are actually reachable and which
just look reachable from a distance.

The short version, after spending an afternoon poking at the other utilities:
the code side of "support more providers" is the easy 20%. The hard 80% is that
DESCO is the only distributor in the country that hands you a balance over a clean,
open API. Almost everyone else hides it behind a captcha, a login, or an SMS short
code. So this is less a coding plan and more a map of which doors are open.

## Where the code stands today

The provider abstraction is already half-built, which is nice, because it means we
don't have to retrofit anything to add the second one. What's there:

- `src/providers/types.ts` defines the `Provider` interface (`name` plus
  `getBalance(meter)`) and a `MeterIdentity` of `{ accountNo, meterNo }`. The
  comment in there literally says "desco today, dpdc, nesco, etc. in phase 3," so
  past-us already had this in mind.
- `src/providers/index.ts` is a registry keyed by name with one entry (`desco`),
  and `getProvider(name)` throws on anything it doesn't know.
- The read path is already provider-aware. The scheduler does
  `getProvider(meter.provider).getBalance(...)` (`src/core/scheduler.ts:183`), and
  so does the bot's `/balance` (`src/bot/index.ts:157`). The `meters.provider`
  column exists and every meter already carries which company it belongs to.

So what's *not* done is narrower than it sounds:

- Registration hardcodes the provider. Both the bot's `/register`
  (`src/bot/index.ts:660`) and the web "add meter" flow (`src/web/app.ts:415`)
  write `provider: 'desco'` and never ask. A user can't tell us they're on DPDC
  even if we supported it.
- The recharge link is a single global default (DESCO's portal), threaded through
  `MeterContext.rechargeUrl`. It needs to vary by provider, otherwise a DPDC user
  gets nagged to recharge on DESCO's website.
- `MeterIdentity` assumes everyone is identified by account number + meter number.
  That's a DESCO-ism (see below; some providers key off just the meter, some need
  a billing period).
- Config and the Mockoon fixture are DESCO-shaped (`DESCO_API_BASE_URL`,
  `DESCO_TLS_INSECURE`, and the canned `getBalance` response in
  `mock/telegram-desco-mock.json`).

None of that is hard. The architecture holds. The question is what we point it at.

## The thing that actually decides feasibility

For us, a provider is only useful if we can read a balance *unattended*, on a
six-hour cron, without a human in the loop. That single requirement rules out most
of how Bangladeshis actually check their balance today. The ways a balance can be
read, roughly from best to useless for our purposes:

1. **Open JSON API, no auth, no captcha.** Hit a URL with the account/meter
   numbers, get JSON back. This is what DESCO has, and it is the entire reason this
   project exists. It is also, as far as I can tell, unique to DESCO.
2. **Authenticated app/portal API.** There's a real JSON API behind the smart-meter
   app or the customer portal, but it sits behind a login (and sometimes an OTP).
   Pollable in principle, but we either hold a service credential or we'd have to
   store the user's portal password, which is its own can of worms (see "What we
   won't do").
3. **Captcha-gated web form.** You fill in the meter number and a captcha, the
   server renders the answer into the page. Not pollable. Solving captchas on a
   schedule is brittle and abusive and we're not doing it.
4. **SMS / USSD / on-meter code.** Send `BAL ...` to a short code, dial a USSD
   string, or press a button on the physical meter. These are user-initiated and
   tied to the customer's own phone or hardware. We can't drive them from a server
   in any clean way.
5. **Third-party wallet lookups (bKash/Nagad).** Useful to a person, not an API we
   get to build on.

Only the first two are realistic targets. Everything below them is a "no" until the
utility ships something better.

## The provider landscape

These are the electricity distribution utilities in Bangladesh. Between them they
cover the whole country, but they vary wildly in how (and whether) you can read a
balance programmatically. I've verified DESCO, DPDC and NESCO myself; the last
three I'm going on general knowledge and they each need a proper spike before we
trust anything here.

| Provider | Coverage | How you read a balance | Pollable by us? | Status |
|----------|----------|------------------------|-----------------|--------|
| DESCO | North Dhaka (Mirpur, Gulshan, Uttara…) | Open JSON API (`prepaid.desco.org.bd/api/tkdes/customer`) | Yes | Shipped |
| DPDC | Central & south Dhaka | Captcha web form; smart-meter app (ImpresaCX) behind login | Not via web; maybe via the app's authed API | Blocked on a test account |
| NESCO | Rajshahi & Rangpur divisions (northwest) | Portal login (`prepaid.nesco.gov.bd`), SMS to 9555, meter code `037` | Unknown — portal needs inspecting | Spike needed |
| WZPDCL | Khulna & Barishal divisions (southwest) | Online customer services portal | Unknown | Spike needed |
| BPDB | Chattogram, Sylhet, and towns without a dedicated DISCO | Online bill/recharge check | Unknown | Spike needed |
| BREB / Palli Bidyut | Rural, nationwide — by far the largest customer base | SMS, USSD, meter code; a BREB smart-prepaid app | Mostly no; very fragmented | Long shot |

A bit more on each:

**DESCO.** The one that works. Clean, unauthenticated, returns balance, current
month's consumption, and a reading timestamp. We even keep a `DESCO_TLS_INSECURE`
escape hatch because their TLS chain has historically been flaky. Done.

**DPDC.** This is the one we want most, because DESCO + DPDC together is basically
all of metropolitan Dhaka, and that's the densest, highest-value market. The bad
news from the spike: the public balance check at "Check Vending Info" is a captcha
form (meter number, a date range, and a `simple-php-captcha.php` security code),
so it's a hard no for polling. The only real DPDC path is their smart-meter app at
`amiapp.dpdc.org.bd`, which is a single-page app on a platform called ImpresaCX.
That almost certainly has a JSON API behind it, but it's login-gated and only
covers customers who actually have a smart/AMI meter. To go further I need a real
DPDC smart-meter account to watch the network traffic and figure out the auth flow.
Without that, anything I write is guesswork.

**NESCO.** Covers the northwest. Balance lives behind a portal login
(`prepaid.nesco.gov.bd/login.php`), with consumer-facing alternatives that don't
help us: an SMS service (`BAL <meter> <PIN>` to 9555), the on-meter `037` code, and
bKash/Nagad. The portal is the only candidate and I haven't gotten far enough to
say whether it exposes a pollable API or just another captcha/session wall. Needs a
spike, ideally with a real consumer ID.

**WZPDCL.** Southwest (Khulna, Barishal). They have online services but I haven't
looked at how balance is exposed. Treat as unknown until someone runs the spike.

**BPDB.** The national board still does distribution in Chattogram, Sylhet, and
various towns that don't have a dedicated company. There's an online bill/recharge
check; whether prepaid balance is readable without a captcha is unverified.

**BREB / Palli Bidyut Samiti.** This is the elephant: rural electrification covers
the most customers in the country by a wide margin. It's also the hardest, because
it isn't one system — it's ~80 samitis with their own quirks, and balance is mostly
an SMS/USSD/meter-code affair. There is a BREB smart-prepaid app, so a future smart
rollout might open a door, but today this is a research project, not a sprint.

The pattern is clear: urban, modern, smart-metered networks are where an API is even
possible. DESCO got there first and left the front door open. DPDC got there but
locked it. Everyone else is somewhere behind that.

## What "add a provider" means in our code

Assuming a provider clears the feasibility bar, here's the work, roughly in order.

**Generalize the abstraction.** A provider is more than a `getBalance` function; it
has metadata we currently hardcode or assume. I'd extend the registry entry to
carry: a display name and region (for the registration picker), the recharge URL,
which identifier fields it needs, and an auth model. Something like:

```
interface ProviderInfo {
  name: string;              // 'desco'
  label: string;             // 'DESCO (North Dhaka)'
  rechargeUrl: string;
  identifier: 'account+meter' | 'meter-only' | 'customer-id';
  auth: 'none' | 'session' | 'service-credential';
  getBalance(id: MeterIdentity, ctx?: AuthContext): Promise<BalanceData>;
}
```

The exact shape can wait, but the point is the registry should describe a provider,
not just call it.

**Let registration choose a provider.** Today both entry points assume DESCO. The
bot `/register` conversation would gain a "which company?" step before asking for
numbers, and the web add-meter form (`src/web/app.ts`) a dropdown. Both then
validate using the chosen provider's identifier scheme and run the real balance
lookup against it (we already validate DESCO meters at registration by doing a live
fetch; same idea, per provider).

**Handle different identifiers.** `MeterIdentity` is `{ accountNo, meterNo }`. Some
providers only issue a meter/consumer number; some want a billing month and year.
The interface needs to flex, or we accept a small typed union per provider. I'd
rather generalize the identity than special-case it in the scheduler.

**Per-provider recharge URL.** Wire the provider's recharge link into
`MeterContext.rechargeUrl` instead of the single global default, so alerts send
people to the right portal.

**Config and mocks.** Each provider that talks to an external API needs its base URL
and any TLS quirks in config, mirroring `DESCO_API_BASE_URL` / `DESCO_TLS_INSECURE`.
And the Mockoon fixture (`mock/telegram-desco-mock.json`) needs a fake endpoint for
the new provider so the e2e keeps covering the full path.

**Tests.** A unit test for the new provider's client (success, bad response,
upstream error), plus a registration test that the provider picker validates and
stores the right `provider` value.

The schema doesn't need a migration — `meters.provider` already exists, and the
unique index is `(userId, provider, accountNo, meterNo)`, so the same person can run
the same meter number on two different companies without a clash.

## What we won't do

Worth writing down so we don't drift into it later under deadline pressure:

- **No captcha solving.** Not with OCR, not with a solving service. It's brittle,
  it breaks the moment they change the image, and it's plainly against the spirit of
  the captcha. If balance is captcha-only, that provider is out until they ship an
  API.
- **No scraping that violates a site's terms.** We read balances the way the utility
  intends them to be read, or we don't.
- **No storing users' utility portal passwords in plaintext.** For any provider that
  needs a per-user login, the credential-handling question has to be answered first
  (and the answer might be "we don't support that provider yet"). Prefer providers
  that are open, or where we can hold a single service credential.
- **No advertising coverage we can't actually poll.** If we can only register a DPDC
  meter but not refresh its balance, we don't ship DPDC. A meter that never updates
  is worse than an honest "not supported yet."

## Plan

**Phase 0 — groundwork, no external dependency.** Do the abstraction generalization,
the registration provider-picker, and per-provider recharge URLs *now*, even before
a second provider is confirmed. It's all internal, it's testable, and it lets us
show a real "choose your company" list where unsupported ones are visibly "coming
soon" instead of silently absent. This is the safe part and it makes every later
provider a small change.

**Phase 1 — the first real second provider.** Driven by feasibility, not wishlist.
Whichever provider first clears a spike with a pollable balance read gets built. By
market value DPDC is the obvious target (it finishes Dhaka), so the highest-leverage
single action is getting a DPDC smart-meter account and running the spike on the AMI
app. If that turns out to need per-user logins we can't safely store, we reassess.

**Phase 2 and beyond.** Regional networks (NESCO, WZPDCL, BPDB) as their spikes come
back positive, then BREB if/when the smart rollout gives us something to talk to.

No timeline attached on purpose; each phase past 0 is gated on an external unknown.

## How to spike a provider

Concrete checklist for evaluating any new provider, so this isn't vague:

1. Get a real account on that network (our own meter, a friend's, a test customer).
2. Open the official balance-check (portal or app) and watch the network tab while
   you look up a balance.
3. Find the request that actually returns the balance. Note the URL, method, and
   parameters.
4. Answer the one question that matters: can that request be replayed on a schedule
   without a captcha or a fresh OTP each time? If yes, what auth does it need?
5. Note the identifier fields (meter only? account too? billing period?), the
   response shape, and any rate limits or obvious politeness expectations.
6. Note the recharge URL for that provider.
7. Quick legal/terms sanity check on automating that endpoint.

If step 4 is a "no," we stop and write it down in the table above so nobody spends a
second afternoon rediscovering it.

## Open questions

- Which providers can we actually get test accounts for? This gates everything past
  Phase 0.
- For login-gated providers, do we ever store per-user credentials, and if so how?
  Current lean: avoid it; only support open or service-credentialed providers until
  we have a real answer.
- Are SMS/USSD-only providers simply out of scope forever, or is there an SMS-gateway
  trick worth revisiting later? Current lean: out of scope.
- What's our posture if a utility changes or blocks the endpoint we depend on? We
  already alarm the operator when more than half a poll cycle fails
  (`src/core/scheduler.ts`), which would catch a provider going dark, but we should
  decide how loudly to tell affected users.

## References

Pages used while researching this (June 2026):

- DPDC vending/balance check (the captcha form): https://dpdc.org.bd/site/home_gov/check_vending_info
- DPDC smart-meter app: https://amiapp.dpdc.org.bd/
- NESCO prepaid customer portal: https://prepaid.nesco.gov.bd/login.php
- NESCO customer service portal: https://customer.nesco.gov.bd/
- DESCO prepaid portal (the API we already use lives under this host): https://prepaid.desco.org.bd/
