# SolidJS project direction — August 15, 2026

## What is going on

Solid is consolidating framework and metaframework responsibilities into one Vite plugin. The immediate headline is not merely “Solid 2 has new APIs”: Solid 2's async-first reactive runtime, compiler, serving layer, server functions, and routing story are being presented as one platform.

## Timeline

- **March 3:** Solid 2.0 beta introduced the new async model and breaking API cleanup. [Beta release](https://github.com/solidjs/solid/releases/tag/v2.0.0-beta.0)
- **August 4:** SolidStart 2.0 became stable on Vite Environment API + Nitro v3. [Announcement](https://github.com/solidjs/solid-start/discussions/2281)
- **August 13:** Solid 2.0 RC shipped and announced Vite-plugin Start mode as SolidStart's eventual replacement. [RC release](https://github.com/solidjs/solid/releases/tag/v2.0.0-rc.0)
- **August 15 snapshot:** npm `latest` is still Solid 1.9.14; `next` is 2.0.0-rc.0. [npm registry](https://registry.npmjs.org/solid-js)

## Interpretation

This is a major simplification attempt: async behavior moves into reactivity, full-stack behavior moves into the core Vite plugin, and SolidStart becomes a maintained migration bridge rather than the future top-level metaframework. It is also a large migration boundary, because many familiar 1.x APIs and scheduling assumptions change.

## Uncertainty

The RC is usable for evaluation and early migration, but it is not stable GA. Ecosystem readiness is improving but uneven, and reactive server components remain experimental. Production 1.x apps have no urgent forced migration; new projects can test the official Solid V2 templates while pinning versions carefully.
