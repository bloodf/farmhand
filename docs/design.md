# Design rules

- Tokens: shadcn neutral palette in oklch, `--radius: 0.625rem`, Inter Variable. Monospace only for code, addresses and logs.
- Light and dark through the `.dark` class; default follows the system.
- Every list, card and tile goes through `QueryState`: loading, empty, no match, unavailable, stale. A failed source is "Unavailable", never healthy or zero.
- Status is a text label next to any color.
- Targets are at least 44px. Focus is visible. `prefers-reduced-motion` is respected.
- Every write waits for the server and goes through a confirm dialog that names the target and the effects.
- Works at 390px wide with no horizontal scroll, and at 200% zoom.
- Empty states say what to do next.
