# The interface system

MoonFlow's look is three scales and one rule. The scales are **type**, **fields**
and **controls**; the rule is that a component picks a step from each rather
than inventing its own numbers. This note is the contract a new component
should be written against.

- Tokens and the shared treatments: [`app/globals.css`](../app/globals.css)
- Class merging (read this before adding a type token): [`lib/utils.ts`](../lib/utils.ts)
- Primitives: [`components/ui/`](../components/ui/)

Colour is a separate axis and is not covered here: graphite surfaces, ivory
type, indigo only for *live*, amber only for achievement.

## Type scale

Five steps are defined in `@theme` and are the only sizes body copy should use.

| Token | Size | Line height | Tracking | Use |
| --- | --- | --- | --- | --- |
| `text-micro` | 11px | 16px | `0.14em` | Uppercase eyebrows, field labels, panel headings |
| `text-caption` | 12px | 17.6px | normal | Secondary meta, hints, compact controls, select labels |
| `text-body` | 14px | 21.6px | normal | Dialog descriptions, routine names, prose |
| `text-title` | 18px | 24px | normal | Card and dialog titles |
| `text-display` | 40px | 40px | `-0.03em` | Reserved; no component uses it today |

Rules that keep the scale from drifting:

- **`text-micro` is an eyebrow, not small body text.** Pair it with
  `font-semibold uppercase` and a muted colour. The tracking lives in the token,
  so do not restate it; override only when a specific placement needs air
  (Focus Mode's phase line widens to `0.22em` at `sm`).
- **`text-caption` is the default for controls and meta**, `text-body` for
  sentences. A new dialog description is `text-body`; a new button label is
  `text-caption` or inherits the button size.
- **Do not use raw `text-sm` / `text-xs`** in new components. They duplicate the
  14/12px steps under different names, so a component stops being reproducible
  from the scale (the `Input` and `Button` primitives are the exceptions).
- **Numbers are mono.** Counters, clocks and timers use `font-mono tabular-nums`.
  Their sizes are deliberately not tokens: stat numerals are 22px (19px under
  22rem, 26px at `sm`), bar labels and tag counters are 10px, and the Focus clock
  is derived from the dial's own geometry.
- **Two raw sizes are sanctioned outside numerals**: 15px for the composer's
  lead input and empty-state headings, and 10px for priority words and tag
  chips. Treat these as exceptions; do not mint a sixth token for them.

### The merge rule

`cn()` is `tailwind-merge`, and tailwind-merge only knows Tailwind's stock
scale. Our tokens have to be registered as a **font size** or it reads
`text-micro` as a *colour* — the same group as `text-muted-foreground` — and
keeps only whichever came last. That is how field labels and Focus Mode's phase
line silently rendered at 16px instead of 11px.

```ts
// lib/utils.ts
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: { "font-size": [{ text: ["micro", "caption", "body", "title", "display"] }] },
  },
});
```

**Any new `text-*` size token must be added here in the same commit.** Size and
colour are independent decisions; `cn("text-caption text-muted-foreground")`
must keep both.

## Fields

Every bordered input, select and editor row in the app wears `.field`. It is a
component class, not a utility, because its border, fill and focus ring are
properties no page should restate.

| Property | Value |
| --- | --- |
| Border | `1px rgba(244, 241, 234, 0.12)` |
| Radius | 12px |
| Fill | `rgba(244, 241, 234, 0.03)` |
| Hover | border `0.20` |
| Focus | indigo border `0.55`, indigo fill `0.045`, `0 0 0 3px` ring at `0.16` |
| Disabled | 50% opacity |

`.field` deliberately does **not** set height, padding or type — a dialog field
and a compact select are the same field, not the same size.

- **Standard input:** `<Input />` — `h-10` (40px), `px-3.5`, `text-sm`, full
  width. Use it instead of a bare `<input>`.
- **Select:** `.field h-10 px-3 pr-9 text-caption` plus a chevron; the extra
  right padding is for the icon.
- **Compact field:** a 36px (`h-9`) height is allowed in the composer, where it
  sits beside 36px controls. Do not go below 36px for a typed field.
- **Label:** use `<Label>` — `text-micro font-semibold uppercase` — with a
  `grid gap-2` between the label and its field.
- **Grouped surfaces:** panels are `.panel` (20px radius, layered graphite,
  hairline edge); nested wells are `.inset` (14px radius, inset hairline). Do
  not build either from a border and a background in a component.
- **Focus accent:** the composer fades an indigo hairline in on
  `group-focus-within`; other fields use the `.field` ring. One focus treatment
  per surface — never both.

## Control scale

Every clickable control is `<Button>` or, for row-level icon actions, an
explicitly sized icon button. The heights are a ladder, not a free choice:

| Tier | Height | Radius | Type | Where |
| --- | --- | --- | --- | --- |
| `size="sm"` | 32px (`h-8`) | 8px | `text-xs` | Quiet in-panel actions: New routine, add another task |
| Compact | 36px (`h-9`) | 8–12px | `text-caption` | Header's sound group and Shortcuts, composer Add and priority chips, Focus top bar. Usually `size="sm"` with `h-9` |
| `size="default"` | 40px | 12px | `text-sm` | Dialog actions, standard buttons |
| `size="lg"` | 48px | 12px | 15px | Pomodoro and Focus Mode controls |
| `size="icon"` | 36px square | 8px | — | Standalone icon control |
| `size="iconSm"` | 32px square | 8px | — | Remove-row actions |
| Row action | 32px (28px on phones) | 8px | — | Task row: timer, focus, edit, delete |

Rules:

- **One height per row.** The header is all 36px; a Focus/Pomodoro control row
  is all 48px; dialog footers are 40px. If two controls share a line, their top
  and bottom edges match.
- **One primary per group.** The accent fills exactly one control; everything
  else is `outline` or `ghost`. In Focus Mode and the Pomodoro card the accent
  means *focus* and the break phase drains to ivory.
- **The quiet icons are square.** Secondary 48px icon controls are `w-12 px-0`;
  their radius and height match the primary beside them. A secondary control
  with a label (Complete) keeps padding and the same height.
- **Phones stack deliberately.** The Focus primary takes the full width with the
  secondaries centred beneath; dialog footers become `flex-col-reverse` at 40px
  with actions full width. Do not rely on wrapping to produce a sane layout.
- **Radii belong to the tier**: 8px for `sm`/icon, 12px for default and `lg`.
  Segmented pills inside an `.inset` are 10px in the task filters and 8px in the
  timer's mode switch. Panels are 20px, dialogs 16px.
- **Do not hand-build a button.** Variants, hover lift, focus ring and icon
  sizing live in [`components/ui/button.tsx`](../components/ui/button.tsx).

## Layout rhythm

- Page: `max-w-6xl`, `px-4` (`sm:px-5`), `py-6` (`lg:py-8`), 20px gaps; the
  right rail is 340px wide with 16px gaps.
- Panels: 16px gutter (`p-4`, or `px-4` on section headers), section headers
  `px-4 py-3` with a hairline divider.
- Lists align to the panel gutter: the list body is `px-1` and each row `px-3`,
  so row text starts at the same 16px as the header. Keep that sum when adding
  a row type.
- Task rows are `py-3`; the completion control is 22px and the row's meta line
  is `text-caption`. On phones the actions take their own line rather than
  squeezing the title, and the title flexes so the priority word stays beside
  it.
- Dialogs: `w-[calc(100vw-2rem)] max-w-lg`, `p-6`, `gap-5`, 16px radius; footer
  `gap-2`.

## Checklist for a new component

1. Pick a panel (`.panel`) or dialog; do not restyle a surface.
2. Label with `<Label>`; field with `<Input>` or `.field` at 40px (36px only in
   the composer).
3. Choose one type step per role — micro for eyebrows, caption for meta and
   control labels, body for prose, title for headings.
4. Choose one control height from the ladder and reuse `<Button>` variants.
5. If you added a `text-*` token, register it in `lib/utils.ts`.
6. Run `npm run verify:visuals` and check the affected measurements.
