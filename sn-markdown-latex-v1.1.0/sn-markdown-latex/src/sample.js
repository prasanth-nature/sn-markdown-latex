const TOP = String.raw`# Markdown + LaTeX

This page is running outside Standard Notes, so it shows a sample. Open any note with the plugin to edit your own text.

தமிழிலும் எழுதலாம்.

## Math

Inline math works with $e^{i\pi} + 1 = 0$ or \(a^2 + b^2 = c^2\). Prices such as $5 or $10 stay plain text.

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

\[
\nabla \times \vec{B} = \mu_0 \vec{J} + \mu_0 \varepsilon_0 \frac{\partial \vec{E}}{\partial t}
\]

\begin{align}
(a+b)^2 &= a^2 + 2ab + b^2 \\
(a-b)^2 &= a^2 - 2ab + b^2
\end{align}

Chemistry: $\ce{2H2 + O2 -> 2H2O}$

## Markdown

- [x] Tables, task lists and code
- [ ] Your notes, saved back to Standard Notes

| Symbol | Meaning |
|--------|---------|
| $\hbar$ | reduced Planck constant |
| $\nabla$ | gradient operator |

> Edit on the left, read on the right.

`;

export const SAMPLE = TOP + '```js\nconsole.log("hello");\n```\n';
