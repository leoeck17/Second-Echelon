# Correlation

A browser tactical decision game: you command a Soviet motor rifle regiment and win or lose in the planning, by the correlation of forces and means. See DESIGN.md for the design and NOTES.md for the model and assumptions.

## Play online

https://leoeck17.github.io/Second-Echelon/ (works on phone and iPad; in Safari use Share → Add to Home Screen).

## Run locally

Needs Node.js 20 or newer.

```
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173).

To play on a phone or iPad on the same Wi-Fi, run `npm run dev -- --host` and open the "Network" address it prints.

## Develop

- `npm test`: unit and balance tests
- `npm run build`: type check and production build into `dist/`
