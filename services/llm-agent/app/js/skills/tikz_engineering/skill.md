# Skill: tikz_engineering
Create engineering technical drawings: cross-sections, 3D structural views, dimension lines, section hatching, and load diagrams.

## When to use
Use this skill when the user asks for a technical drawing, engineering diagram, structural analysis illustration, mechanical cross-section, or any figure that combines precise geometry with dimension annotations, material hatching, or applied-force callouts.

## Required packages
```latex
\usepackage{tikz}
\usetikzlibrary{calc, intersections, patterns, decorations.markings, decorations.pathreplacing}
```

## Key concepts

### Dimension lines
Define a custom style using `decorations.markings`:
```latex
\tikzset{
  dim/.style={
    decoration={
      markings,
      mark=at position 0 with {\arrow[scale=0.8]{<}},
      mark=at position 1 with {\arrow[scale=0.8]{>}}
    },
    postaction={decorate}, thin
  }
}
\draw[dim] (0,-0.4) -- (3,-0.4) node[midway, below] {$L$};
```

### Section hatching (solid material)
```latex
\usetikzlibrary{patterns}
\fill[pattern=north east lines, pattern color=gray!70] (0,0) rectangle (2,1);
\draw[thick] (0,0) rectangle (2,1);   % redraw boundary on top
```

### Symmetric structures with \foreach
Mirror upper and lower halves in one loop:
```latex
\foreach \sign in {1, -1} {
  \draw[thick] (0, \sign*1) -- (3, \sign*0.5);
}
```

### Coordinate intersections
```latex
\usetikzlibrary{intersections}
\path[name path=lineA]   (0,0) -- (4,2);
\path[name path=circleB] (2,0) circle (1.5);
\path[name intersections={of=lineA and circleB, by={P,Q}}];
\draw[fill] (P) circle (1.5pt);
```

### Manual 3D dimetric / isometric projection
```latex
% Dimetric x-axis ≈ 7°, y-axis ≈ 42°; set the x/y/z unit vectors explicitly
\tikzset{dimetric/.style={x={(0.924cm,-0.383cm)}, y={(0cm,1cm)}, z={(-0.383cm,-0.924cm)}}}
\begin{scope}[dimetric]
  \draw (0,0,0) -- (1,0,0) -- (1,1,0) -- (0,1,0) -- cycle;
\end{scope}
```

## Common patterns & gotchas
- Use `standalone` document class with `border=10pt` for clean export without extra whitespace.
- Hatch patterns are textures, not fills — always `\fill[pattern=...]` then `\draw` the boundary again on top.
- Use `\pgfmathsetmacro{\r}{1.5}` to store computed dimensions; keeps coordinate math readable.
- `intersections` library requires `\path[name path=...]` before the `name intersections` call.
- For repeated geometry (screw holes, bolt circles), define a helper command `\newcommand{\bolt}[2]{...}` and call it in a `\foreach`.
