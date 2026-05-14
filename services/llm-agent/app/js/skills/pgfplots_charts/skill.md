# Skill: pgfplots_charts
Create publication-quality data plots using PGFPlots: line charts, bar charts, scatter plots, error bars, and 3D surface/contour plots.

## When to use
Use this skill for any plot driven by data: time series, function curves, histograms, scatter diagrams, bar comparisons, 3D surfaces of mathematical functions, or contour maps. PGFPlots handles axis scaling, tick marks, legends, and color maps automatically.

## Required packages
```latex
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}   % always set compat — controls many defaults
% Optional:
\usepgfplotslibrary{fillbetween}  % fill area between two curves
\usepgfplotslibrary{colormaps}    % extra color maps (viridis, hot, …)
\usepgfplotslibrary{statistics}   % boxplot, violin
```

## Key concepts

### Basic axis + plot
```latex
\begin{tikzpicture}
\begin{axis}[
  xlabel={$x$}, ylabel={$f(x)$},
  xmin=-3, xmax=3, ymin=-1.5, ymax=1.5,
  grid=both, grid style={line width=0.2pt, draw=gray!30},
  legend pos=north west,
]
  \addplot[blue, thick, domain=-3:3, samples=100] {sin(deg(x))};
  \addlegendentry{$\sin x$}
  \addplot[red,  thick, domain=-3:3, samples=100] {cos(deg(x))};
  \addlegendentry{$\cos x$}
\end{axis}
\end{tikzpicture}
```
Note: `sin(deg(x))` — PGFPlots' math engine uses degrees; wrap radians with `deg()`.

### Plot from table (inline data)
```latex
\addplot table [x=time, y=value, col sep=comma] {
  time, value
  0,    1.2
  1,    2.5
  2,    3.1
  3,    2.8
};
```

### Bar chart
```latex
\begin{axis}[
  ybar, bar width=12pt,
  symbolic x coords={A,B,C,D},
  xtick=data,
  nodes near coords,       % show value above each bar
  enlarge x limits=0.2,
]
  \addplot coordinates {(A,4) (B,7) (C,3) (D,9)};
\end{axis}
```

### Scatter plot with color coding
```latex
\addplot[scatter, only marks, scatter src=explicit,
  colormap/viridis,
] table [x=x, y=y, meta=z] { ... };
```

### Error bars
```latex
\addplot+[error bars/.cd,
  y dir=both, y explicit,
] coordinates {
  (0,1) +- (0,0.2)
  (1,2) +- (0,0.3)
};
```

### 3D surface plot
```latex
\begin{tikzpicture}
\begin{axis}[
  view={30}{45},
  xlabel=$x$, ylabel=$y$, zlabel=$z$,
  colormap/cool,
]
  \addplot3[surf, domain=-2:2, samples=30] {x^2 - y^2};
\end{axis}
\end{tikzpicture}
```

### Contour plot
```latex
\addplot3[contour gnuplot={levels={0,1,2,3}}, thick, domain=-2:2, samples=30] {x^2+y^2};
```
(Contour requires gnuplot installed; for pure-LaTeX contours use `contour filled` or `surf` with `shader=flat`.)

## Common patterns & gotchas
- **Always** put `\pgfplotsset{compat=1.18}` in the preamble — without it, many axis options silently misbehave.
- Use `domain=a:b` on `\addplot` for function plots; the units are the axis units, not pixels.
- `samples=100` is fine for smooth 2D curves. For 3D use `samples=30` to keep compile time reasonable.
- `ybar` stacks bars on the x-axis. Use `xbar` for horizontal bars.
- Logarithmic axes: add `xmode=log` or `ymode=log` to the `axis` options.
- To share an axis between two plots (dual y-axis): use `axis y line*=right` on the second axis inside a `tikzpicture`.
- `legend pos` values: `north west`, `south east`, `outer north east` (outside the box), etc.
- Avoid very large `samples` in 3D — it bloats the PDF. `samples=25` usually suffices for publication figures.
