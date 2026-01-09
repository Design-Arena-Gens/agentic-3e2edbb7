## Pac-Man Clone

A fully client-side Pac-Man implementation built with Next.js and canvas rendering. The maze, pellets, and ghosts are rendered on a classic-style board, and each ghost leaves the central pen before chasing the player with unique targeting rules.

## Features

- Responsive canvas rendering with glowing maze walls and pellets.
- Keyboard controls (WASD or arrow keys) with tight grid-based movement.
- Four ghost personalities that exit the pen on timers and pathfind toward the player.
- Breadth-first search pathfinding constrained to maze corridors so ghosts follow valid routes.
- Score tracking, restart handling, and win/lose states with overlays.

## Scripts

```bash
# start the dev server
npm run dev

# lint the project
npm run lint

# produce a production build
npm run build
```

## Controls

- Arrow keys or WASD to move Pac-Man.
- Space to restart after a win or loss.

## Deployment

The app is optimized for Vercel. Create a production build with `npm run build`, then deploy with:

```bash
vercel deploy --prod --yes --token $VERCEL_TOKEN --name agentic-3e2edbb7
```

After deployment, verify the production site with:

```bash
curl https://agentic-3e2edbb7.vercel.app
```
