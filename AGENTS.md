<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# HALO frontend decisions

- Read `docs/WIREFRAME_WORKFLOW.md` before frontend work. Yogi is the sole frontend person; assignments and parallel lanes in supplied documents are superseded. The current foundation previews are proposals, not approved baselines. Keep wireframe review before live implementation.

- Do not use em dashes (U+2014) anywhere in app-facing text. This includes screens, buttons, errors, alerts, accessibility labels, and generated or source-provided copy. Use natural sentences, commas, colons, or parentheses without changing the meaning. This user decision supersedes punctuation in older specifications.
- The approved logo shape comes from `public/halo-logo.png`, supplied by the user as `Untitled design.png`. The blue tile is superseded: use the transparent `public/halo-logo-mark.png` as a monochrome mask, rendered white on the dark Welcome band. Use a contrasting foreground on light surfaces. Earlier logos and generated concepts are superseded.
- Onboarding's Welcome screen uses a centered teal "Welcome" heading in a bold, simple cursive style. It writes itself along the actual pen strokes, including loops and cross-strokes, not a horizontal fade or wipe. After the handwriting finishes, a smaller, lighter, centered subtitle with lowercase "to" above all-caps "HALO" fades in underneath in a complementary font. The description follows both headings. Show both headings immediately under reduced motion and never delay access to Get started. This supersedes the HALO-only heading, Playwrite Argentina, and the earlier letter reveal. Preserve the approved logo and handwriting. The rounded mobile refresh reviewed September 29, 2026 is approved for live onboarding.
- The onboarding wireframes are otherwise approved. The mobile formatting review is complete. Use the approved rounded layout for live onboarding and retain the original archive as a historical reference.
