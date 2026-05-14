# Skill: tikz_3d_graphics
Create 3D graphics using tikz-3dplot or TikZ's built-in 3D coordinate system: axes, surfaces, curves, and labeled 3D scenes.

## When to use
Use this skill when the user asks for 3D coordinate axes, 3D function surfaces, perspective diagrams, 3D vectors, or any scene that needs depth. For pure data-driven 3D surface/contour plots, prefer the `pgfplots_charts` skill instead.

## Required packages
```latex
\usepackage{tikz}
\usepackage{tikz-3dplot}   % \tdplotsetmaincoords and 3D coordinate macros
% Optional for surface shading:
\usetikzlibrary{shadings}
```

## Key concepts

### Setting the viewpoint
`\tdplotsetmaincoords{θ}{φ}` sets the viewing angles before `\begin{tikzpicture}`.
- θ (polar/elevation): 0 = top-down, 90 = side-on. Typical: 70
- φ (azimuthal/rotation): 0 = x-axis points right. Typical: 110

```latex
\tdplotsetmaincoords{70}{110}
\begin{tikzpicture}[tdplot_main_coords, scale=2]
  ...
\end{tikzpicture}
```
Always pass `tdplot_main_coords` as a tikzpicture option to activate the 3D axes.

### Drawing 3D axes
```latex
\draw[thick,->] (0,0,0) -- (1.5,0,0) node[anchor=north east]{$x$};
\draw[thick,->] (0,0,0) -- (0,1.5,0) node[anchor=north west]{$y$};
\draw[thick,->] (0,0,0) -- (0,0,1.5) node[anchor=south]{$z$};
```

### Spherical coordinates (tdplot)
`\tdplotsetcoord{P}{r}{θ}{φ}` defines named coordinates `P`, `Pxy`, `Pxz`, `Pyz`.
```latex
\tdplotsetcoord{P}{1}{60}{45}   % radius=1, polar=60°, azimuthal=45°
\draw[->] (0,0,0) -- (P);
\draw[dashed] (0,0,0) -- (Pxy) -- (P);  % projection on xy-plane
```

### Drawing arcs in 3D planes
```latex
% arc in the xy-plane:
\tdplotdrawarc{(0,0,0)}{0.5}{0}{45}{anchor=north}{$\phi$}
% arc in a tilted plane (set a secondary coord system first):
\tdplotsetthetaplanecoords{45}
\tdplotdrawarc[tdplot_rotated_coords]{(0,0,0)}{0.5}{0}{60}{anchor=south west}{$\theta$}
```

### Parametric curves and surfaces
Use `\foreach` to sample points and connect them:
```latex
\foreach \t in {0,5,...,355} {
  \pgfmathsetmacro{\x}{cos(\t)}
  \pgfmathsetmacro{\y}{sin(\t)}
  \pgfmathsetmacro{\z}{0}
  \fill (\x,\y,\z) circle (0.5pt);
}
```
For full surfaces, draw a grid of patches with `\filldraw` and a light fill color to simulate shading.

### Clipping for cleaner results
Draw the "back" half (dashed) before the "front" half (solid):
```latex
\draw[dashed] (0,0,0) arc (180:360:1 and 0.3);  % back half of ellipse
\draw         (0,0,0) arc (0:180:1 and 0.3);    % front half
```

## Common patterns & gotchas
- Always use `\tdplotsetmaincoords` **before** `\begin{tikzpicture}`, and add `[tdplot_main_coords]` to the tikzpicture options.
- 3D coordinates look like `(x,y,z)` only inside a `tdplot_main_coords` scope — outside that scope they are 2D.
- `tikz-3dplot` ships with most TeX distributions (`texlive-pictures` on Linux). If the class is missing, add `\usepackage{tikz-3dplot}` to the preamble.
- Shading realistic surfaces requires many `\filldraw` patches — for smooth gradients consider `pgfplots` `surf` plots instead.
- Labels on 3D points: use `\node at (x,y,z) {...}` — the 3D transform applies to nodes too.
- For sphere surfaces, a practical approach is drawing latitude and longitude great-circle arcs rather than filled patches.
