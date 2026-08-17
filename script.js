const el = (id) => document.getElementById(id);

const speedRange = el('speedRange');
const speedValue = el('speedValue');
const memorizeRange = el('memorizeRange');
const memorizeValue = el('memorizeValue');
const startBtn = el('startBtn');

const phaseLabel = el('phaseLabel');
const statusRow = el('statusRow');
const elapsedDisplay = el('elapsedDisplay');
const missDisplay = el('missDisplay');
const remainingDisplay = el('remainingDisplay');
const timerBarWrap = el('timerBarWrap');
const timerBar = el('timerBar');
const board = el('board');
const resultMessage = el('resultMessage');

const statAttempts = el('statAttempts');
const statClears = el('statClears');
const statRate = el('statRate');
const statStreak = el('statStreak');
const statMaxStreak = el('statMaxStreak');
const statBestTime = el('statBestTime');

const HOUSE_SVG = '<svg viewBox="0 0 24 24"><path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/></svg>';
const FLAG_SVG = '<svg viewBox="0 0 24 24"><path d="M6 21V4"/><path d="M6 4h12l-3 4 3 4H6"/></svg>';

const GRID = 7;
const TOTAL = GRID * GRID; // 49
const TARGET = TOTAL - 1; // 48
const MAX_MISS = 3;

const STATS_KEY = 'nummeiroStats';
const stats = Object.assign(
    { attempts: 0, clears: 0, streak: 0, maxStreak: 0, bestTime: null },
    JSON.parse(localStorage.getItem(STATS_KEY) || '{}')
);

let phase = 'idle'; // idle | play | result
let values = [];        // number shown/used per cell (0 for start/target)
let bestRoute = new Map(); // position -> jump distance, for the reference solution
let blinkA = 0, blinkB = 0; // the two candidate first-move positions
let lastPos = 0;
let missCount = 0;
let cellState = new Map(); // position -> 'good' | 'bad'
let numbersHidden = false;
let firstClickMade = false;
let lastWon = false;
let playStartTime = 0;
let timerInterval = null;
let hideTimeout = null;
let phaseDeadline = 0;
let phaseDuration = 0;

function randRange(min, maxExclusive) {
    return Math.floor(Math.random() * Math.max(0, maxExclusive - min)) + min;
}

function maxHorizontal(pos) {
    return (GRID - 1) - (pos % GRID);
}
function maxVertical(pos) {
    return Math.floor((TARGET - pos) / GRID);
}

function nextStep(pos) {
    const maxH = maxHorizontal(pos);
    const maxV = maxVertical(pos);
    if (maxV === 0) {
        const step = randRange(randRange(1, maxH), maxH) || 1;
        return [step, pos + step];
    }
    if (maxH === 0) {
        const step = randRange(randRange(1, maxV), maxV) || 1;
        return [step, pos + GRID * step];
    }
    if (Math.random() < 0.5) {
        const step = randRange(randRange(1, maxH), maxH) || 1;
        return [step, pos + step];
    }
    const step = randRange(randRange(1, maxV), maxV) || 1;
    return [step, pos + GRID * step];
}

function generateBestRoute(startBlink) {
    const route = new Map();
    let pos = Math.random() < 0.5 ? startBlink * GRID : startBlink;
    while (pos < TARGET) {
        const [step, nextPos] = nextStep(pos);
        route.set(pos, step);
        pos = nextPos;
    }
    return route;
}

function renderStats() {
    statAttempts.textContent = stats.attempts;
    statClears.textContent = stats.clears;
    statRate.textContent = stats.attempts ? Math.round((stats.clears / stats.attempts) * 100) + '%' : '-';
    statStreak.textContent = stats.streak;
    statMaxStreak.textContent = stats.maxStreak;
    statBestTime.textContent = stats.bestTime !== null ? (stats.bestTime / 1000).toFixed(3) + 's' : '-';
}

function saveResult(won, elapsedMs) {
    stats.attempts++;
    if (won) {
        stats.clears++;
        stats.streak++;
        if (stats.streak > stats.maxStreak) stats.maxStreak = stats.streak;
        if (stats.bestTime === null || elapsedMs < stats.bestTime) stats.bestTime = elapsedMs;
    } else {
        stats.streak = 0;
    }
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    renderStats();
}

speedRange.addEventListener('input', () => { speedValue.textContent = speedRange.value; });
memorizeRange.addEventListener('input', () => { memorizeValue.textContent = memorizeRange.value; });

function renderBoard() {
    const cellSize = 48;
    board.style.setProperty('--cell-size', cellSize + 'px');
    board.style.gridTemplateColumns = `repeat(${GRID}, var(--cell-size))`;
    board.innerHTML = '';

    const revealPositions = phase === 'result' && !lastWon
        ? new Set([...bestRoute.keys(), TARGET])
        : null;

    for (let i = 0; i < TOTAL; i++) {
        const btn = document.createElement('button');
        btn.className = 'cell';
        btn.disabled = phase !== 'play';

        const isStart = i === 0;
        const isTarget = i === TARGET;
        const state = cellState.get(i);

        if (isStart || isTarget || state === 'good') btn.classList.add('node');
        if (state === 'bad') btn.classList.add('wrong');
        if (revealPositions && revealPositions.has(i)) btn.classList.add('reveal');
        if (phase === 'play' && !numbersHidden && !isStart && !isTarget && (i === blinkA || i === blinkB)) {
            btn.classList.add('breathing');
        }

        if (isStart) btn.innerHTML = HOUSE_SVG;
        else if (isTarget) btn.innerHTML = FLAG_SVG;
        else if (!numbersHidden || (revealPositions && revealPositions.has(i))) {
            btn.textContent = values[i] || '';
        }

        btn.addEventListener('click', () => onCellClick(i));
        board.appendChild(btn);
    }
}

function hideNumbersNow() {
    if (numbersHidden) return;
    numbersHidden = true;
    clearTimeout(hideTimeout);
    if (phase === 'play') renderBoard();
}

function onCellClick(pos) {
    if (phase !== 'play' || pos === 0) return;

    if (!firstClickMade) {
        firstClickMade = true;
        hideNumbersNow();
    }

    let ok;
    if (lastPos === 0) {
        ok = pos === blinkA || pos === blinkB;
    } else {
        const n = values[lastPos];
        const maxH = maxHorizontal(lastPos);
        const maxV = maxVertical(lastPos);
        ok = (n <= maxH && pos === lastPos + n) || (n <= maxV && pos === lastPos + GRID * n);
    }

    if (ok) {
        lastPos = pos;
        cellState.set(pos, 'good');
    } else {
        missCount++;
        cellState.set(pos, 'bad');
    }

    missDisplay.textContent = `ミス: ${missCount} / ${MAX_MISS}`;
    renderBoard();

    if (missCount >= MAX_MISS) {
        finishGame(false);
    } else if (lastPos === TARGET) {
        finishGame(true);
    }
}

function startPhaseTimer(durationMs, onExpire, onTick) {
    clearInterval(timerInterval);
    phaseDeadline = performance.now() + durationMs;
    phaseDuration = durationMs;
    timerBarWrap.classList.add('active');
    timerBar.style.transition = 'none';
    timerBar.style.width = '100%';
    timerBar.classList.remove('danger');
    void timerBar.offsetWidth;
    timerBar.style.transition = `width ${durationMs}ms linear`;
    timerBar.style.width = '0%';

    timerInterval = setInterval(() => {
        const remaining = phaseDeadline - performance.now();
        if (onTick) onTick(Math.max(0, remaining));
        if (remaining / phaseDuration < 0.25) timerBar.classList.add('danger');
        if (remaining <= 0) {
            clearInterval(timerInterval);
            onExpire();
        }
    }, 50);
}

function startGame() {
    startBtn.disabled = true;
    resultMessage.textContent = '';
    resultMessage.className = 'result-message';
    clearTimeout(hideTimeout);
    clearInterval(timerInterval);
    timerBarWrap.classList.remove('active');
    statusRow.classList.remove('active');

    lastPos = 0;
    missCount = 0;
    cellState = new Map();
    numbersHidden = false;
    firstClickMade = false;

    blinkA = randRange(1, 4);
    blinkB = blinkA * GRID;
    bestRoute = generateBestRoute(blinkA);

    values = new Array(TOTAL).fill(0);
    for (let i = 1; i < TARGET; i++) {
        if (i === blinkA || i === blinkB) values[i] = randRange(1, 4) || 1;
        else values[i] = randRange(1, 5) || 1;
    }
    for (const [pos, step] of bestRoute.entries()) values[pos] = step;

    phase = 'play';
    phaseLabel.textContent = '覚えてください';
    missDisplay.textContent = `ミス: 0 / ${MAX_MISS}`;
    playStartTime = performance.now();
    statusRow.classList.add('active');
    elapsedDisplay.textContent = '経過: 0.000s';
    renderBoard();

    const speedMs = Number(speedRange.value) * 1000;
    startPhaseTimer(speedMs, () => finishGame(false), (remaining) => {
        elapsedDisplay.textContent = `経過: ${((performance.now() - playStartTime) / 1000).toFixed(3)}s`;
        remainingDisplay.textContent = `残り: ${(remaining / 1000).toFixed(1)}s`;
    });

    const memorizeMs = Number(memorizeRange.value) * 1000;
    hideTimeout = setTimeout(() => {
        hideNumbersNow();
        phaseLabel.textContent = 'スタートから数字の数だけ右か下へジャンプしてゴールまで繋げてください';
    }, memorizeMs);
}

function finishGame(won) {
    clearInterval(timerInterval);
    clearTimeout(hideTimeout);
    timerBarWrap.classList.remove('active');
    statusRow.classList.remove('active');

    const elapsedMs = performance.now() - playStartTime;
    phase = 'result';
    lastWon = won;
    numbersHidden = false;

    phaseLabel.textContent = '';
    resultMessage.textContent = won
        ? `クリア! (${(elapsedMs / 1000).toFixed(3)}s)`
        : '失敗...正解ルートを表示します';
    resultMessage.className = 'result-message ' + (won ? 'success' : 'fail');

    renderBoard();
    saveResult(won, elapsedMs);
    startBtn.disabled = false;
}

startBtn.addEventListener('click', startGame);

renderStats();
phase = 'idle';
values = new Array(TOTAL).fill(0);
renderBoard();
