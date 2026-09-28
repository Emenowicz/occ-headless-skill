# OCC Headless Frontend Skill

AI coding agent skill for building a **headless storefront on SAP Commerce OCC REST API without Spartacus** (Angular, React / Next.js, Vue / Nuxt).

It covers what a frontend developer needs on SAP Commerce Cloud 2211-jdk21:

- **Login:** authorization code + PKCE, custom login pages, and a BFF with httpOnly cookies.
- **Carts:** anonymous carts, merge at login, guest checkout and PSP plugins.
- **Catalog:** product and search pages.
- **CMS:** SAP CMS pages and components, SmartEdit, and an external CMS next to OCC.
- **B2B:** `orgUsers` calls and pay on account.
- **Debugging:** CORS and 401 troubleshooting.
- **Framework recipes:** Next.js, Nuxt and Angular, each with SSR, BFF and SPA variants.

There is also a catalogue of SAP-specific behaviour that frontend developers don't expect (`references/sap-quirks.md`).

## Installation

```bash
npx skills add Emenowicz/occ-headless-skill
```

## Tested

**Backend.** A vanilla SAP Commerce Cloud **2211-jdk21.19** (local, HSQLDB) with the `electronics` and `powertools` sample stores, `commercewebservices`, `b2bocc`, `cmsocc` and the SmartEdit extensions.

**What was verified live.** Statements marked **(live)** in the references were reproduced there:

- the authorization server: grants, PKCE, code reuse, refresh rotation, session lengths and the custom login page;
- OCC error formats and `fields` rules;
- the cart lifecycle, merge errors, concurrent writes and checkout request formats;
- CMS pages and components;
- SmartEdit preview tickets;
- the B2B `orgUsers` rules;
- CORS.

**What was not verified live.** Statements tagged [SAP Help], [OpenAPI] or [Spartacus] come from those public sources. Not checked live:

- CCv2-only behaviour: custom domains, IP filters, CDN;
- the SmartEdit UI in a browser;
- payment plugins (the Adyen roles and redirect flow are read from the plugin's public source);
- Storyblok and Contentful apps.

**Benchmark.** Built with Anthropic's skill-creator loop: realistic tasks in each framework, run with and without the skill, graded blind against written expectations. The eval set is in `evals/`, and every row below is one run per configuration (Opus 5.5).

| Iteration | Evals | With skill | Without skill |
| --- | --- | --- | --- |
| 2 | 10: cart, login, CORS, CMS, PLP, checkout, B2B, PDP, two code reviews | 96% | 81% |
| 3 | 9: the areas the fixes touched, plus SmartEdit and Storyblok | 94% | 80% |

The largest gains are on 2211-jdk21 login and cart merge (100% vs 50%), SAP CMS rendering and SAP-specific code review.

**Other models, with the skill.** The login, cart and review evals scored 97% on Sonnet 5 and 62% on Haiku 4.5. Use a Sonnet- or Opus-class model. With smaller models, check the output against the hard rules in `SKILL.md`.

**Triggering.** On 20 realistic queries (`evals/trigger-evals.json`), the description triggered on 7 of the 10 frontend tasks (two runs each) and never on the 10 near-misses:

- a Java OCC extension, Spartacus customization, ImpEx, HAC Groovy, a CCv2 build;
- the accelerator JSP storefront;
- Storyblok alone, Shopify, S/4 on BTP, Auth0.

The misses were short debugging questions that the model answered without loading a skill.

**Caveats.**

- There is one run per cell.
- A few grades were corrected after a live or source check, each documented in the grading file.
- The absolute numbers matter less than the gaps on the SAP-specific tasks.
- The current version adds corrections made after the last benchmark run, each checked live or against public source. They were not re-benchmarked.

## Independence

This skill is not affiliated with or endorsed by SAP. It is built only from public documentation (help.sap.com, the OCC OpenAPI spec, the open-source Spartacus code) and a vanilla SAP Commerce distribution. It contains no customer or employer code.
