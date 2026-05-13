# Skill: tikz_2d_graphics
Create 2D vector graphics using TikZ: shapes, paths, fills, arrows, decorations, and coordinate systems.

## When to use
Use this skill when the user asks for any 2D figure drawn with TikZ — geometric shapes, annotated diagrams, illustrations with arrows, circuit-like diagrams, or any freehand vector art that does not require 3D perspective or data plotting.

## Required packages
```latex
\usepackage{tikz}
% Common TikZ libraries (add only what you need):
\usetikzlibrary{arrows.meta}      % modern arrowheads
\usetikzlibrary{shapes.geometric} % ellipse, diamond, polygon, star …
\usetikzlibrary{patterns}         % hatch, crosshatch, dots …
\usetikzlibrary{decorations.pathmorphing}  % snake, zigzag …
\usetikzlibrary{decorations.markings}      % midway arrows on paths
\usetikzlibrary{calc}             % coordinate arithmetic: ($(A)+(B)$)
\usetikzlibrary{positioning}      % node placement: right=of, above=of …
\usetikzlibrary{fit}              % bounding-box node around other nodes
\usetikzlibrary{backgrounds}      % draw behind existing content
```

## Key concepts

### Coordinate systems
- Cartesian: `(x,y)` in cm by default, or use `[x=1cm,y=1cm]` on tikzpicture
- Polar: `(angle:radius)` e.g. `(45:2)` means 2 cm at 45°
- Named nodes: `(mynode.east)`, `(mynode.north east)` — anchor points
- Relative: `++(dx,dy)` moves from the last point; `+(dx,dy)` does not update the "current" point

### Drawing paths
```latex
\draw (0,0) -- (1,0) -- (1,1) -- cycle;      % triangle
\draw[->] (0,0) -- (2,0);                     % arrow
\draw[thick, dashed, red] (0,0) circle (1);   % styled circle
\filldraw[fill=blue!20, draw=blue] (0,0) rectangle (2,1);
```

### Nodes
```latex
\node[draw, circle, fill=yellow] (A) at (0,0) {Label};
\node[draw, rectangle, right=1cm of A] (B) {B};
\draw[->] (A) -- (B);
```

### Styles and scopes
Define reusable styles with `\tikzset` or `[style=...]` on the tikzpicture.
Use `\begin{scope}[...]\end{scope}` to apply options to a group of commands.

### Clipping
```latex
\begin{scope}
  \clip (0,0) circle (1.5);
  \fill[blue] (-2,-2) rectangle (2,2);
\end{scope}
```

## Common patterns & gotchas
- Always end standalone `\begin{tikzpicture}` inside a `figure` environment with `\centering` and `\caption{}`.
- Use `\usetikzlibrary` in the preamble, not inside the tikzpicture.
- Coordinates default to cm. Use `scale=` on tikzpicture if you want to resize everything uniformly.
- `->` uses the old arrow tip. Prefer `[-{Stealth}]` (from `arrows.meta`) for modern-looking arrows.
- Use `baseline=(current bounding box.center)` when embedding tikz in inline math.
- Avoid hard-coded absolute coordinates for node-heavy diagrams — use `positioning` library offsets instead so layout is easy to adjust.
