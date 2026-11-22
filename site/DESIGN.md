# Lumiere landing page: design

The direction is not based on a survey of real sites (no design-reference service was connected). It follows the
product: a quiet tool for reading and writing, so the page is calm, left-aligned and typographic, and the screenshots
carry the weight.

## Principles

- The product is the picture. Every screenshot is real Lumiere in real VS Code, in the visitor's colour scheme.
- Plain system fonts, no external requests, no scripts, no trackers.
- One accent (copper, from the extension's icon) for actions and links. Not Obsidian's purple.
- Say what Lumiere does not do as plainly as what it does.

## Colour

Roles, light then dark. Text pairs are at least 4.5:1 (checked).

| Token           | Light     | Dark      | Role                                  |
| --------------- | --------- | --------- | ------------------------------------- |
| `--bg`          | `#fbf9f5` | `#151310` | Page                                  |
| `--bg-sunken`   | `#f3eee5` | `#1d1a16` | Alternate sections, code              |
| `--text`        | `#1d1a16` | `#efe9df` | Body and headings                     |
| `--text-muted`  | `#5a5349` | `#b3a999` | Secondary text                        |
| `--border`      | `#ded7c9` | `#343029` | Rules and outlines                    |
| `--accent`      | `#9a4216` | `#e8935a` | Links, primary button, focus ring     |
| `--accent-text` | `#ffffff` | `#1b1208` | Text on the primary button            |

## Type

System stacks only. Headings use the system serif (`ui-serif`, Iowan Old Style, Palatino, Georgia), body the system
sans (`system-ui`), code the system monospace. Sizes: 0.875, 1, 1.0625 (body), 1.25, 1.75, 2.25, and a fluid hero
size. Body line height 1.6, measure about 62 characters.

## Space, shape, depth

A 4px scale (4, 8, 12, 16, 24, 32, 48, 64, 96). Content width 70rem. Radius 6px for controls, 10px for screenshots. One
shadow, on screenshots only.

## Components

Buttons: primary (solid accent), secondary (outlined), and plain links. Every interactive element has a visible
`:focus-visible` ring in the accent colour. Screenshots are `<picture>` elements with a light and a dark source,
explicit width and height, and `loading="lazy"` below the fold.
