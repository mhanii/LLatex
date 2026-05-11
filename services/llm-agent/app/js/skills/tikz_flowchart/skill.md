# Skill: tikz_flowchart
Create flowcharts, decision trees, and process diagrams using TikZ with the shapes and positioning libraries.

## When to use
Use this skill for flowcharts (start/process/decision/end boxes connected by arrows), block diagrams, pipeline diagrams, architecture diagrams, decision trees, and any node-and-edge graph where layout matters.

## Required packages
```latex
\usepackage{tikz}
\usetikzlibrary{shapes.geometric}  % diamond (decision), cylinder, …
\usetikzlibrary{positioning}       % right=of, below=of, …
\usetikzlibrary{arrows.meta}       % modern arrowheads
\usetikzlibrary{fit}               % bounding box around a group
\usetikzlibrary{backgrounds}       % draw a box behind a group (optional)
```

## Node shapes
| Shape | TikZ option | Typical use |
|-------|-------------|-------------|
| Rectangle | `rectangle` (default) | Process step |
| Rounded rectangle | `rounded corners` on draw | Soft process |
| Diamond | `diamond, aspect=2` | Decision (yes/no) |
| Ellipse / oval | `ellipse` | Start / End (terminal) |
| Circle | `circle` | Small connector |
| Cylinder | `cylinder, shape border rotate=90` | Database / storage |

## Key concepts

### Defining styles
Define reusable node styles at the top to keep the diagram clean:
```latex
\tikzset{
  startstop/.style = {ellipse, draw, fill=green!20, minimum width=2.5cm, minimum height=1cm},
  process/.style   = {rectangle, draw, fill=blue!10, minimum width=3cm, minimum height=1cm,
                       text centered, rounded corners},
  decision/.style  = {diamond, draw, fill=orange!20, aspect=2,
                       minimum width=3cm, minimum height=1cm, text centered},
  arrow/.style     = {thick, -{Stealth}},
}
```

### Placing nodes
Use `positioning` offsets — much easier to adjust than absolute coordinates:
```latex
\node[startstop] (start) {Start};
\node[process,   below=1cm of start] (step1) {Read input};
\node[decision,  below=1.5cm of step1] (cond) {Valid?};
\node[process,   below=1.5cm of cond]  (step2) {Process};
\node[process,   right=2cm of cond]    (err)  {Show error};
\node[startstop, below=1cm of step2]   (stop) {Stop};
```

### Drawing arrows
```latex
\draw[arrow] (start)  -- (step1);
\draw[arrow] (step1)  -- (cond);
\draw[arrow] (cond)   -- node[right]{Yes} (step2);
\draw[arrow] (cond)   -- node[above]{No}  (err);
\draw[arrow] (step2)  -- (stop);
% Loop back:
\draw[arrow] (err.south) |- (step1.west);    % L-shaped path back up
```

### Edge routing
- `--` straight line
- `|-` go vertical first, then horizontal (useful for routing around nodes)
- `-|` go horizontal first, then vertical
- `..controls (cp1) and (cp2)..` Bézier curve
- Use `[rounded corners=5pt]` on a path for smooth corners

### Labels on edges
```latex
\draw[arrow] (cond) -- node[right, font=\small]{Yes} (step2);
\draw[arrow] (cond) -| node[above, near start]{No}   (err);
```

### Grouping with `fit`
```latex
\begin{scope}[on background layer]
  \node[fit=(step1)(cond)(step2), draw=gray, dashed, rounded corners,
        inner sep=10pt, label=above:{\small Phase 1}] {};
\end{scope}
```

## Common patterns & gotchas
- Set `minimum width` and `minimum height` on your styles so all boxes have consistent size even with short labels.
- `aspect=2` on `diamond` makes it wider than tall — more readable for text labels.
- For long labels in diamonds use `text width=2.5cm, text centered`.
- When looping back (e.g. retry), use `|-` or `-|` routing to avoid overlapping other nodes. Add intermediate coordinates if needed: `\draw[arrow] (err.east) -- ++(0.5,0) |- (step1.east);`
- `font=\small` or `font=\footnotesize` on edge labels keeps them from clashing with nearby nodes.
- For very large flowcharts, use `matrix of nodes` or place nodes on a grid `(col*3, -row*2)` to keep coordinates manageable.
- Avoid `[->]` shorthand in flowcharts — use a named `arrow` style so you can change arrowheads globally.
