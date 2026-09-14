# Ivory and ultramarine product theme

Product: **AI Lead Intelligence & Outbound Automation**. User-authorized presentation refinement, 14 September 2026; L4-06 / L4-07. This supersedes the earlier teal/mint visual direction without changing product positioning, architecture, APIs or domain rules.

## Direction and decisions

Use an editorial, product-led identity: warm ivory paper, near-white working surfaces, ultramarine actions and graphite text. Clear composition and typography carry the identity. Avoid decorative orbit lines, floating-card collages, lightning-bolt branding, oversized glowing gradients and multicolored feature cards. The interactive workflow stays central and visible automatically.

| Token | Value | Use |
| --- | --- | --- |
| Page | #F6F3EB | Warm ivory canvas |
| Surface | #FFFEFA | Reading and working surfaces |
| Brand | #2446E8 | Primary actions, links and selected states |
| Brand strong | #1935B8 | Hover and emphasis |
| Brand light | #E9EDFF | Restrained selection wash |
| Ink | #202535 | Primary text |
| Muted | #686A73 | Supporting text |
| Line | #DEDCD4 | Fine separators |

Typography: Manrope for the interface, navigation, form labels and data; Newsreader for selected editorial headlines. Self-host WOFF2 assets with font-display: swap and local fallbacks. Preserve source and SIL Open Font License files. Use regular display weights and tabular numerals for comparable metrics; avoid serif body text in dense operational tables.

The Relay display wordmark stays paired with the mandated product identity. A custom SVG relay/ribbon monogram replaces the generic bolt and is shared by the website, app, authentication, loading, favicon and touch icon. Vectors remain source-controlled; no image generation or runtime graphics dependency is required.

Semantic green/amber/red remain available for actual success/warning/error states; color never replaces status text. Chart categories use a coordinated blue/neutral palette. Visible keyboard focus, touch targets, reduced motion, form consent and honest error/saved states remain requirements.

## Scope and ownership

Root integrates global tokens/fonts/brand assets/initial HTML, documentation and verification. Landing owner edits only LandingPage.tsx and landing.css. App owner edits layout/auth/availability/loading and small UI primitives. Data owner audits page charts/status mappings and utility styles. Existing data, API, registration, interest capture, review and dispatch behavior is preserved.

## Acceptance and verification

- Consistent identity across public page, automatic interactive walkthrough, login/register, unavailable screen, dashboard, lists, detail, settings, dialogs and loading.
- Try it out / Get started CTAs remain; Book a demo and Reach out still target the saved interest form.
- TypeScript and production build; existing landing, availability, setup and customer-workflow browser checks on the final build. Use owned fixtures and existing installed Playwright; no live providers.
- Inspect desktop and phone screenshots, text contrast, overflow, fonts and brand assets. Retain keyboard/reduced-motion and honest failure/retry checks.
- Record commands, build identity, failures and evidence in verification/PREMIUM_THEME.md before marking local completion.
- Human visual approval, actual-device/screen-reader and hosted deployment remain separate. Do not close L5/L6 launch gates from a theme change.

## Readability and interaction refinement - 15 September 2026

The user approved the visual direction and requested larger supporting text plus visual cues for the walkthrough. Keep headlines, palette and composition. Public fine print and metadata have a 12px floor; supporting prose and controls use 14-16px. Shared app small text is 13px, with legacy 9-11px utility text raised to12px. Walkthrough controls receive subtle selection surfaces, focus outlines and hover arrow movement. Do not add instruction copy, fake activity, automatic step changes or perpetual attention animations. Preserve reduced motion and disabled states.
