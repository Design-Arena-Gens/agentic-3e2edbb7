"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./PacmanGame.module.css";

type Direction = { x: number; y: number };
type GameStatus = "playing" | "gameover" | "won";
type GhostState = "pen" | "exiting" | "chase";

interface TileCoord {
  col: number;
  row: number;
}

interface Player {
  x: number;
  y: number;
  dir: Direction;
  nextDir: Direction;
  speed: number;
}

interface Ghost {
  id: string;
  color: string;
  x: number;
  y: number;
  dir: Direction;
  speed: number;
  state: GhostState;
  releaseAt: number;
  path: TileCoord[];
  scatterTarget: TileCoord;
}

interface LevelData {
  width: number;
  height: number;
  baseTiles: string[][];
  pelletTemplate: boolean[][];
  powerTemplate: boolean[][];
  pelletCount: number;
  playerStart: TileCoord;
  ghostStarts: TileCoord[];
  exitTile: TileCoord;
  scatterTargets: TileCoord[];
}

interface GameState {
  layout: string[][];
  pellets: boolean[][];
  powerPellets: boolean[][];
  pelletCount: number;
  score: number;
  status: GameStatus;
  elapsed: number;
  level: LevelData;
  player: Player;
  ghosts: Ghost[];
}

const TILE_SIZE = 24;
const DIR_VECTORS: Direction[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const LEVEL_LAYOUT = [
  "#####################",
  "#.........###.......#",
  "#.###.###.###.###.#.#",
  "#o###.###.###.###.#o#",
  "#...................#",
  "#.###.#####.#####.###",
  "#.###.#####.#####.###",
  "#...................#",
  "###.###.#######.###.#",
  "#.....#.......#.....#",
  "#.###.#.###.#.#.###.#",
  "#.###.#.#GGG#.#.###.#",
  "#.....#.#GGG#.#.....#",
  "#.###.#.#===#.#.###.#",
  "#.....#.......#.....#",
  "###.###.#######.###.#",
  "#...................#",
  "#.###.###.###.###.###",
  "#o..#.......P...#..o#",
  "###.#.###.###.#.###.#",
  "#.........###.......#",
  "#####################",
] as const;

const SCATTER_TARGETS: TileCoord[] = [
  { col: 1, row: 1 },
  { col: LEVEL_LAYOUT[0].length - 2, row: 1 },
  { col: LEVEL_LAYOUT[0].length - 2, row: LEVEL_LAYOUT.length - 2 },
  { col: 1, row: LEVEL_LAYOUT.length - 2 },
];

const RELEASE_DELAYS = [0, 3, 6, 9];
const GHOST_IDS = ["blinky", "pinky", "inky", "clyde"];
const GHOST_COLORS = ["#ff0000", "#ffb8ff", "#00ffff", "#ffb847"];

const EPSILON = 0.05;
const ENTITY_RADIUS = 0.4;

function cloneStringGrid(grid: string[][]): string[][] {
  return grid.map((row) => [...row]);
}

function cloneBooleanGrid(grid: boolean[][]): boolean[][] {
  return grid.map((row) => [...row]);
}

function parseLevel(): LevelData {
  const baseTiles = LEVEL_LAYOUT.map((row) => row.split(""));
  const height = baseTiles.length;
  const width = baseTiles[0].length;

  const pelletTemplate = baseTiles.map((row) => row.map(() => false));
  const powerTemplate = baseTiles.map((row) => row.map(() => false));
  const ghostStarts: TileCoord[] = [];
  const doors: TileCoord[] = [];
  let pelletCount = 0;
  let playerStart: TileCoord | null = null;

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const char = baseTiles[row][col];
      switch (char) {
        case ".":
          pelletTemplate[row][col] = true;
          pelletCount += 1;
          baseTiles[row][col] = " ";
          break;
        case "o":
          pelletTemplate[row][col] = true;
          powerTemplate[row][col] = true;
          pelletCount += 1;
          baseTiles[row][col] = " ";
          break;
        case "P":
          playerStart = { col, row };
          baseTiles[row][col] = " ";
          break;
        case "G":
          ghostStarts.push({ col, row });
          baseTiles[row][col] = " ";
          break;
        case "=":
          doors.push({ col, row });
          break;
        case "#":
          break;
        default:
          baseTiles[row][col] = " ";
      }
    }
  }

  if (!playerStart) {
    playerStart = { col: Math.floor(width / 2), row: height - 3 };
  }

  if (ghostStarts.length === 0) {
    ghostStarts.push({ col: playerStart.col, row: playerStart.row - 2 });
  }

  const door =
    doors[Math.floor(doors.length / 2)] ?? ghostStarts[0] ?? playerStart;
  const exitTile = {
    col: door.col,
    row: Math.min(height - 2, door.row + 1),
  };

  return {
    width,
    height,
    baseTiles,
    pelletTemplate,
    powerTemplate,
    pelletCount,
    playerStart,
    ghostStarts,
    exitTile,
    scatterTargets: SCATTER_TARGETS.map((target) => ({
      col: Math.min(Math.max(target.col, 1), width - 2),
      row: Math.min(Math.max(target.row, 1), height - 2),
    })),
  };
}

function directionsEqual(a: Direction, b: Direction): boolean {
  return a.x === b.x && a.y === b.y;
}

function isAtCenter(coord: number): boolean {
  return Math.abs(coord - Math.floor(coord) - 0.5) < EPSILON;
}

function isWalkable(
  layout: string[][],
  col: number,
  row: number,
  allowGate: boolean,
): boolean {
  if (
    row < 0 ||
    row >= layout.length ||
    col < 0 ||
    col >= layout[0].length
  ) {
    return false;
  }
  const tile = layout[row][col];
  if (tile === "#") {
    return false;
  }
  if (tile === "=") {
    return allowGate;
  }
  return true;
}

function canMoveFrom(
  layout: string[][],
  col: number,
  row: number,
  dir: Direction,
  allowGate: boolean,
): boolean {
  if (dir.x === 0 && dir.y === 0) {
    return true;
  }
  return isWalkable(layout, col + dir.x, row + dir.y, allowGate);
}

function moveEntity(
  entity: { x: number; y: number; dir: Direction; speed: number },
  layout: string[][],
  dt: number,
  allowGate: boolean,
) {
  if (entity.dir.x === 0 && entity.dir.y === 0) {
    return;
  }

  const step = entity.speed * dt;

  if (entity.dir.x !== 0) {
    const nextX = entity.x + entity.dir.x * step;
    const targetCol =
      entity.dir.x > 0
        ? Math.floor(nextX + ENTITY_RADIUS)
        : Math.floor(nextX - ENTITY_RADIUS);
    const rowTop = Math.floor(entity.y - ENTITY_RADIUS);
    const rowBottom = Math.floor(entity.y + ENTITY_RADIUS);

    if (
      isWalkable(layout, targetCol, rowTop, allowGate) &&
      isWalkable(layout, targetCol, rowBottom, allowGate)
    ) {
      entity.x = nextX;
    } else {
      entity.x = Math.floor(entity.x) + 0.5;
      entity.dir = { x: 0, y: 0 };
    }
  } else if (entity.dir.y !== 0) {
    const nextY = entity.y + entity.dir.y * step;
    const targetRow =
      entity.dir.y > 0
        ? Math.floor(nextY + ENTITY_RADIUS)
        : Math.floor(nextY - ENTITY_RADIUS);
    const colLeft = Math.floor(entity.x - ENTITY_RADIUS);
    const colRight = Math.floor(entity.x + ENTITY_RADIUS);

    if (
      isWalkable(layout, colLeft, targetRow, allowGate) &&
      isWalkable(layout, colRight, targetRow, allowGate)
    ) {
      entity.y = nextY;
    } else {
      entity.y = Math.floor(entity.y) + 0.5;
      entity.dir = { x: 0, y: 0 };
    }
  }
}

function createGameState(level: LevelData): GameState {
  const player: Player = {
    x: level.playerStart.col + 0.5,
    y: level.playerStart.row + 0.5,
    dir: { x: 0, y: 0 },
    nextDir: { x: 0, y: 0 },
    speed: 6,
  };

  const spawnPool = [...level.ghostStarts];
  while (spawnPool.length < GHOST_IDS.length) {
    spawnPool.push(
      level.ghostStarts[spawnPool.length % level.ghostStarts.length],
    );
  }

  const ghosts: Ghost[] = GHOST_IDS.map((id, index) => {
    const spawn = spawnPool[index] ?? level.playerStart;
    return {
      id,
      color: GHOST_COLORS[index],
      x: spawn.col + 0.5,
      y: spawn.row + 0.5,
      dir: { x: 0, y: 0 },
      speed: 4.4,
      state: "pen",
      releaseAt: RELEASE_DELAYS[index],
      path: [],
      scatterTarget: level.scatterTargets[index],
    };
  });

  return {
    layout: cloneStringGrid(level.baseTiles),
    pellets: cloneBooleanGrid(level.pelletTemplate),
    powerPellets: cloneBooleanGrid(level.powerTemplate),
    pelletCount: level.pelletCount,
    score: 0,
    status: "playing",
    elapsed: 0,
    level,
    player,
    ghosts,
  };
}

function keyToDirection(key: string): Direction | null {
  switch (key) {
    case "ArrowLeft":
    case "a":
    case "A":
      return { x: -1, y: 0 };
    case "ArrowRight":
    case "d":
    case "D":
      return { x: 1, y: 0 };
    case "ArrowUp":
    case "w":
    case "W":
      return { x: 0, y: -1 };
    case "ArrowDown":
    case "s":
    case "S":
      return { x: 0, y: 1 };
    default:
      return null;
  }
}

function findPath(
  state: GameState,
  start: TileCoord,
  target: TileCoord,
  allowGate: boolean,
): TileCoord[] | null {
  const queue: TileCoord[] = [start];
  const parent = new Map<string, string | null>();
  const key = (pos: TileCoord) => `${pos.col},${pos.row}`;
  parent.set(key(start), null);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.col === target.col && current.row === target.row) {
      break;
    }

    for (const dir of DIR_VECTORS) {
      const next = { col: current.col + dir.x, row: current.row + dir.y };
      const encoded = key(next);
      if (parent.has(encoded)) {
        continue;
      }
      if (!isWalkable(state.layout, next.col, next.row, allowGate)) {
        continue;
      }
      parent.set(encoded, key(current));
      queue.push(next);
    }
  }

  const targetKey = key(target);
  if (!parent.has(targetKey)) {
    return null;
  }

  const path: TileCoord[] = [];
  let currentKey: string | null = targetKey;

  while (currentKey) {
    const [col, row] = currentKey.split(",").map((value) => Number(value));
    path.push({ col, row });
    currentKey = parent.get(currentKey) ?? null;
  }

  path.reverse();
  return path;
}

function clampTargetToWalkable(state: GameState, target: TileCoord): TileCoord {
  const startCol = Math.min(
    Math.max(target.col, 0),
    state.level.width - 1,
  );
  const startRow = Math.min(
    Math.max(target.row, 0),
    state.level.height - 1,
  );

  if (isWalkable(state.layout, startCol, startRow, false)) {
    return { col: startCol, row: startRow };
  }

  const start = { col: startCol, row: startRow };
  const visited = new Set<string>();
  const queue: TileCoord[] = [start];
  const encode = (pos: TileCoord) => `${pos.col},${pos.row}`;
  visited.add(encode(start));

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (isWalkable(state.layout, current.col, current.row, false)) {
      return current;
    }
    for (const dir of DIR_VECTORS) {
      const next = {
        col: current.col + dir.x,
        row: current.row + dir.y,
      };
      if (
        next.col < 0 ||
        next.col >= state.level.width ||
        next.row < 0 ||
        next.row >= state.level.height
      ) {
        continue;
      }
      const encoded = encode(next);
      if (visited.has(encoded)) {
        continue;
      }
      visited.add(encoded);
      queue.push(next);
    }
  }

  return {
    col: Math.floor(state.player.x),
    row: Math.floor(state.player.y),
  };
}

function determineGhostTarget(state: GameState, ghost: Ghost): TileCoord {
  const player = state.player;
  const playerTile = {
    col: Math.floor(player.x),
    row: Math.floor(player.y),
  };

  switch (ghost.id) {
    case "pinky": {
      return {
        col: playerTile.col + player.dir.x * 4,
        row: playerTile.row + player.dir.y * 4,
      };
    }
    case "inky": {
      const ahead = {
        col: playerTile.col + player.dir.x * 2,
        row: playerTile.row + player.dir.y * 2,
      };
      const blinky = state.ghosts.find((g) => g.id === "blinky");
      if (!blinky) {
        return ahead;
      }
      const blinkyTile = {
        col: Math.floor(blinky.x),
        row: Math.floor(blinky.y),
      };
      return {
        col: blinkyTile.col + (ahead.col - blinkyTile.col) * 2,
        row: blinkyTile.row + (ahead.row - blinkyTile.row) * 2,
      };
    }
    case "clyde": {
      const distance = Math.hypot(ghost.x - player.x, ghost.y - player.y);
      if (distance > 6) {
        return playerTile;
      }
      return ghost.scatterTarget;
    }
    default:
      return playerTile;
  }
}

function randomAvailableDirection(
  state: GameState,
  tile: TileCoord,
  currentDir: Direction,
): Direction {
  const options = DIR_VECTORS.filter((dir) => {
    if (dir.x === -currentDir.x && dir.y === -currentDir.y) {
      return false;
    }
    return isWalkable(
      state.layout,
      tile.col + dir.x,
      tile.row + dir.y,
      false,
    );
  });

  if (options.length === 0) {
    return { x: -currentDir.x, y: -currentDir.y };
  }
  return options[Math.floor(Math.random() * options.length)];
}

function updatePlayer(state: GameState, dt: number) {
  const player = state.player;
  const tileCol = Math.floor(player.x);
  const tileRow = Math.floor(player.y);

  if (isAtCenter(player.x) && isAtCenter(player.y)) {
    player.x = tileCol + 0.5;
    player.y = tileRow + 0.5;

    if (
      (player.nextDir.x !== 0 || player.nextDir.y !== 0) &&
      !directionsEqual(player.nextDir, player.dir) &&
      canMoveFrom(state.layout, tileCol, tileRow, player.nextDir, false)
    ) {
      player.dir = { ...player.nextDir };
    }

    if (!canMoveFrom(state.layout, tileCol, tileRow, player.dir, false)) {
      player.dir = { x: 0, y: 0 };
    }
  }

  moveEntity(player, state.layout, dt, false);

  if (isAtCenter(player.x) && isAtCenter(player.y)) {
    const col = Math.floor(player.x);
    const row = Math.floor(player.y);
    if (state.pellets[row]?.[col]) {
      state.pellets[row][col] = false;
      if (state.powerPellets[row]?.[col]) {
        state.powerPellets[row][col] = false;
        state.score += 50;
      } else {
        state.score += 10;
      }
      state.pelletCount = Math.max(0, state.pelletCount - 1);
    }
  }
}

function updateGhost(state: GameState, ghost: Ghost, dt: number) {
  const tileCol = Math.floor(ghost.x);
  const tileRow = Math.floor(ghost.y);
  const atCenter = isAtCenter(ghost.x) && isAtCenter(ghost.y);

  if (atCenter) {
    ghost.x = tileCol + 0.5;
    ghost.y = tileRow + 0.5;
  }

  if (ghost.state === "pen" && state.elapsed >= ghost.releaseAt) {
    ghost.state = "exiting";
    const path =
      findPath(state, { col: tileCol, row: tileRow }, state.level.exitTile, true) ??
      [];
    ghost.path = path;
  }

  if (ghost.state === "exiting" && atCenter) {
    if (tileCol === state.level.exitTile.col && tileRow === state.level.exitTile.row) {
      ghost.state = "chase";
      ghost.path = [];
    } else {
      if (ghost.path.length <= 1) {
        const path =
          findPath(
            state,
            { col: tileCol, row: tileRow },
            state.level.exitTile,
            true,
          ) ?? [];
        ghost.path = path;
      }
      if (ghost.path.length > 1) {
        const nextStep = ghost.path[1];
        ghost.path.shift();
        ghost.dir = {
          x: nextStep.col - tileCol,
          y: nextStep.row - tileRow,
        };
      }
    }
  } else if (ghost.state === "chase" && atCenter) {
    const target = clampTargetToWalkable(
      state,
      determineGhostTarget(state, ghost),
    );
    const path =
      findPath(state, { col: tileCol, row: tileRow }, target, false) ?? [];
    if (path.length > 1) {
      const nextStep = path[1];
      ghost.dir = {
        x: nextStep.col - tileCol,
        y: nextStep.row - tileRow,
      };
    } else {
      ghost.dir = randomAvailableDirection(
        state,
        { col: tileCol, row: tileRow },
        ghost.dir,
      );
    }
  }

  moveEntity(ghost, state.layout, dt, ghost.state !== "chase");
}

function handleCollisions(state: GameState) {
  if (state.status !== "playing") {
    return;
  }

  for (const ghost of state.ghosts) {
    const distance = Math.hypot(
      ghost.x - state.player.x,
      ghost.y - state.player.y,
    );
    if (distance < 0.45) {
      state.status = "gameover";
      state.player.dir = { x: 0, y: 0 };
      return;
    }
  }

  if (state.pelletCount <= 0) {
    state.status = "won";
    state.player.dir = { x: 0, y: 0 };
  }
}

function updateGame(state: GameState, dt: number) {
  if (state.status !== "playing") {
    return;
  }

  state.elapsed += dt;
  updatePlayer(state, dt);
  for (const ghost of state.ghosts) {
    updateGhost(state, ghost, dt);
  }
  handleCollisions(state);
}

function drawGame(ctx: CanvasRenderingContext2D, state: GameState) {
  const width = state.level.width * TILE_SIZE;
  const height = state.level.height * TILE_SIZE;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);

  for (let row = 0; row < state.level.height; row += 1) {
    for (let col = 0; col < state.level.width; col += 1) {
      const tile = state.layout[row][col];
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      if (tile === "#") {
        ctx.fillStyle = "#001b96";
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = "#1b4bff";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
      } else if (tile === "=") {
        ctx.fillStyle = "#65f7ff";
        ctx.fillRect(
          x,
          y + TILE_SIZE / 2 - 2,
          TILE_SIZE,
          4,
        );
      }

      if (state.pellets[row]?.[col]) {
        ctx.fillStyle = state.powerPellets[row]?.[col]
          ? "#fff2a6"
          : "#f6f6ce";
        const radius = state.powerPellets[row]?.[col]
          ? TILE_SIZE * 0.23
          : TILE_SIZE * 0.1;
        ctx.beginPath();
        ctx.arc(
          x + TILE_SIZE / 2,
          y + TILE_SIZE / 2,
          radius,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }

  const player = state.player;
  const playerX = player.x * TILE_SIZE;
  const playerY = player.y * TILE_SIZE;
  const playerRadius = TILE_SIZE * 0.45;
  const angle =
    player.dir.x === 0 && player.dir.y === 0
      ? 0
      : Math.atan2(player.dir.y, player.dir.x);
  const mouth =
    Math.PI / 8 + (state.status === "playing" ? (Math.sin(state.elapsed * 8) + 1) * (Math.PI / 32) : 0);

  ctx.fillStyle = "#ffe600";
  ctx.beginPath();
  ctx.moveTo(playerX, playerY);
  ctx.arc(
    playerX,
    playerY,
    playerRadius,
    angle + mouth,
    angle - mouth,
    true,
  );
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#03224c";
  ctx.beginPath();
  ctx.arc(
    playerX + Math.cos(angle) * playerRadius * 0.25 - Math.sin(angle) * playerRadius * 0.15,
    playerY + Math.sin(angle) * playerRadius * 0.25 - Math.cos(angle) * playerRadius * 0.15,
    playerRadius * 0.1,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  for (const ghost of state.ghosts) {
    const gx = ghost.x * TILE_SIZE;
    const gy = ghost.y * TILE_SIZE;
    const radius = TILE_SIZE * 0.45;

    ctx.fillStyle = ghost.color;
    ctx.beginPath();
    ctx.arc(gx, gy - radius * 0.2, radius, Math.PI, 0, false);
    ctx.lineTo(gx + radius, gy + radius * 0.6);

    const scallops = 6;
    for (let i = scallops; i >= 0; i -= 1) {
      const waveX = gx + (radius * 2 * i) / scallops - radius;
      const waveY =
        gy + radius * 0.6 + (i % 2 === 0 ? radius * 0.2 : 0);
      ctx.lineTo(waveX, waveY);
    }
    ctx.closePath();
    ctx.fill();

    const eyePositions = [
      { x: gx - radius * 0.32, y: gy - radius * 0.1 },
      { x: gx + radius * 0.1, y: gy - radius * 0.1 },
    ];

    for (const eye of eyePositions) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(eye.x, eye.y, radius * 0.24, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#1d206b";
      ctx.beginPath();
      ctx.arc(
        eye.x + ghost.dir.x * radius * 0.18,
        eye.y + ghost.dir.y * radius * 0.18,
        radius * 0.12,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
}

export default function PacmanGame() {
  const level = useMemo(() => parseLevel(), []);
  const initialState = useMemo(() => createGameState(level), [level]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState>(initialState);
  const requestRef = useRef<number | null>(null);
  const scoreRef = useRef(initialState.score);
  const statusRef = useRef<GameStatus>(initialState.status);

  const [score, setScore] = useState(initialState.score);
  const [status, setStatus] = useState<GameStatus>(initialState.status);

  const resetGame = useCallback(() => {
    const nextState = createGameState(level);
    stateRef.current = nextState;
    scoreRef.current = nextState.score;
    statusRef.current = nextState.status;
    setScore(nextState.score);
    setStatus(nextState.status);

    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      drawGame(ctx, nextState);
    }
  }, [level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }

    let previous = performance.now();

    const loop = (time: number) => {
      const dt = Math.min((time - previous) / 1000, 0.1);
      previous = time;

      const state = stateRef.current;
      updateGame(state, dt);
      drawGame(ctx, state);

      if (state.score !== scoreRef.current) {
        scoreRef.current = state.score;
        setScore(state.score);
      }

      if (state.status !== statusRef.current) {
        statusRef.current = state.status;
        setStatus(state.status);
      }

      requestRef.current = requestAnimationFrame(loop);
    };

    requestRef.current = requestAnimationFrame(loop);

    return () => {
      if (requestRef.current !== null) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const state = stateRef.current;
      if (!state) {
        return;
      }

      if (event.key === " " && state.status !== "playing") {
        event.preventDefault();
        resetGame();
        return;
      }

      const direction = keyToDirection(event.key);
      if (direction) {
        event.preventDefault();
        state.player.nextDir = direction;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [resetGame]);

  const boardWidth = level.width * TILE_SIZE;
  const boardHeight = level.height * TILE_SIZE;
  const overlayText =
    status === "gameover"
      ? "Game Over"
      : status === "won"
      ? "You Win!"
      : null;

  return (
    <div
      className={styles.gameArea}
      style={{ "--board-width": `${boardWidth}px` } as React.CSSProperties}
    >
      <div className={styles.hud}>
        <span>Score&nbsp;{score.toString().padStart(6, "0")}</span>
        <span>Status&nbsp;{status === "playing" ? "Ready" : overlayText}</span>
      </div>
      <div className={styles.canvasWrapper}>
        <canvas
          ref={canvasRef}
          width={boardWidth}
          height={boardHeight}
        />
        <div
          className={
            overlayText ? styles.overlay : styles.overlayHidden
          }
        >
          {overlayText}
        </div>
      </div>
      <p className={styles.instructions}>
        Use the arrow keys or WASD to guide Pac-Man through the maze. Clear every pellet
        while outsmarting the ghosts. If you get caught, press Space to try again once
        the round ends.
      </p>
    </div>
  );
}
