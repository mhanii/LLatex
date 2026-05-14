# Skill: tikz_cs_diagrams
Draw computer-science diagrams: finite state machines, recursion trees, Karnaugh maps, automata, protocol flow.

## When to use
Use this skill when the user asks for a state machine (FSM/DFA/NFA/TCP/protocol), algorithm analysis diagram (recursion tree, Big-O breakdown), Karnaugh map, or any CS-specific structured diagram. For generic flowcharts, prefer `tikz_flowchart` instead.

## Required packages
```latex
\usepackage{tikz}
\usetikzlibrary{shapes.geometric, arrows.meta, positioning, calc, backgrounds, automata}
```

## Key concepts

### State machine nodes
Define a rectangular state style (or use the built-in `automata` library):
```latex
\tikzstyle{state}      = [rectangle, rounded corners=4pt, draw=black, thick,
                           minimum width=2.2cm, minimum height=0.7cm, align=center]
\tikzstyle{transition} = [->, >=Stealth, semithick]
```

### Node positioning
Use the `positioning` library for readable relative placement:
```latex
\node[state]              (closed)  {CLOSED};
\node[state, below=of closed] (listen)  {LISTEN};
\node[state, right=2cm of closed] (synrcvd) {SYN RCVD};
```

### Curved edges with mid-labels
```latex
\draw[transition] (closed) to[bend left=20] node[midway, right] {SYN} (listen);
\draw[transition] (listen) -- node[midway, above] {ACK} (established);
```

### Background grouping boxes
Highlight groups of related states using the `backgrounds` library:
```latex
\begin{scope}[on background layer]
  \node[draw=gray, dotted, rounded corners, fit=(synrcvd)(synSent),
        inner sep=6pt, label=above:Active Open] {};
\end{scope}
```

### Recursion trees
Use TikZ `child` syntax with `level` styles:
```latex
\tikzstyle{level 1} = [sibling distance=48mm]
\tikzstyle{level 2} = [sibling distance=24mm]
\node {$n$}
  child { node {$\frac{n}{2}$} child { ... } }
  child { node {$\frac{n}{2}$} child { ... } };
```

## Common patterns & gotchas
- Import `automata` library for built-in `state`, `initial`, `accepting` styles.
- For wide state machines, add `every node/.style={font=\small}` or use `\scalebox`.
- Use `calc` to compute midpoints for complex bent paths: `($0.5*(A)+0.5*(B)$)`.
- `on background layer` scope requires `\usetikzlibrary{backgrounds}` — don't forget it.
- Karnaugh maps require careful Gray-code ordering — copy from the example rather than coding from scratch.
