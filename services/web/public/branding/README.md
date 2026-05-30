# DoubleBackSlash Branding Assets

Edit the SVGs in this folder to change the app identity in one place.

## Logos (Wordmark + Monogram)

| Asset | Use Case | Background |
|-------|----------|------------|
| `logo-dark.svg` | Primary logo | Light backgrounds |
| `logo-white.svg` | Primary logo | Dark backgrounds |

## Marks (Monogram Only)

| Asset | Use Case | Background |
|-------|----------|------------|
| `mark-dark.svg` | Compact icon slots | Dark UI surfaces |
| `mark-white.svg` | Compact icon slots | Dark backgrounds |
| `mark-grey.svg` | Compact icon slots | Light backgrounds |

## App Icon & Compilation States

| Asset | Use Case | Color |
|-------|----------|-------|
| `favicon.svg` | Default app icon (rounded dark square with white monogram) | White on `#1a1a1a` |
| `favicon-compiling.svg` | Shows compilation in progress | Amber/gold monogram with matching glow |
| `favicon-error.svg` | Indicates failed compilation | Red monogram with matching glow |
| `favicon-compiled.svg` | Indicates successful compilation | Green monogram with matching glow |

## Browser Favicon

| Asset | Use Case |
|-------|----------|
| `mask-favicon.svg` | Browser tab icon (transparent background, dark monogram for light browser UI) |
| `mask-favicon-white.svg` | Browser tab icon (transparent background, white monogram for dark browser UI) |

## Color Reference

| Color | Hex | Usage |
|-------|-----|-------|
| Dark background | `#1a1a1a` | App icon, mark-dark |
| White text | `#ffffff` | Logos, marks on dark |
| Dark text | `#1a1a1a` | Logos on light |
| Grey text | `#6b7280` | Mark-grey |
| Amber | `#e0a030` | Compiling state |
| Red | `#e03a3a` | Error state |
| Green | `#4ade80` | Success state |

## Design Notes

- All SVGs use `'Helvetica Neue', 'Arial Black', 'Impact', sans-serif` font stack
- Monogram `\\d` features tight letter-spacing for a modern, compact look
- App icon uses rounded square shape (`rx="96"`) with subtle inner glow
- Compilation state icons use colored text with matching radial glow for visual feedback
