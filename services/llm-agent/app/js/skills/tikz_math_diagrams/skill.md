# Skill: tikz_math_diagrams
Draw abstract mathematical diagrams: topology, homotopy, commutative diagrams, matrix structures, and abstract-algebra maps.

## When to use
Use this skill when the user asks for a topology diagram (homotopy, continuous maps, fibre bundles), a matrix or grid with special visual structure (arrow-shaped, triangular), or any abstract mathematical relationship diagram. For function/data plots, use `pgfplots_charts`.

## Required packages
```latex
\usepackage{tikz}
\usetikzlibrary{arrows, calc, decorations.pathreplacing, matrix, shapes.multipart}
```

## Key concepts

### Curved path families (homotopy)
Show continuous deformation between paths with `to[out=...,in=...]`:
```latex
\draw[->] (0,0) to[out=60,  in=120] (4,0);   % high arc (path β)
\draw[->] (0,0) to[out=-60, in=240] (4,0);   % low arc  (path α)
\draw[->, dashed] (0,0) -- (4,0);             % intermediate
```

### Matrix of nodes (structured grids)
```latex
\matrix (mat) [matrix of nodes,
               row sep=-\pgflinewidth,
               column sep=-\pgflinewidth,
               nodes={draw, minimum width=1.2cm, minimum height=0.7cm}] {
  $a_{11}$ & $a_{12}$ \\
  $a_{21}$ & $a_{22}$ \\
};
% Access cells: (mat-1-1), (mat-1-2), etc.
```

### Curly brace decorations
```latex
\usetikzlibrary{decorations.pathreplacing}
\draw[decorate, decoration={brace, amplitude=6pt, raise=3pt}]
     (P1) -- (P2) node[midway, left=10pt] {label};
```

### Split / multi-part nodes (domain rectangles)
```latex
\usetikzlibrary{shapes.multipart}
\node[rectangle split, rectangle split parts=2, draw] (dom) {
  $I$ \nodepart{two} $I$
};
```

### Space-to-space morphisms
```latex
\node[ellipse, draw] (X) at (0,0) {$X$};
\node[ellipse, draw] (Y) at (5,0) {$Y$};
\draw[->, bend left=25]  (X) to node[above] {$f$} (Y);
\draw[->, bend right=25] (X) to node[below] {$g$} (Y);
```

## Common patterns & gotchas
- Matrix cell access is 1-indexed: `(mat-1-1)` is the top-left cell.
- Use `column sep=-\pgflinewidth` so borders share a single line (no double-border artifact).
- `shapes.multipart` and `shapes.geometric` are separate libraries — load both if you use both.
- The `preview` package (`\usepackage[active,tightpage]{preview}`) crops output tightly; remove it when embedding in a full document.
- For arrows at arbitrary positions along a path, use `decorations.markings` with `postaction={decorate}` rather than endpoint arrows.
