(() => {
  'use strict';

  const SIZE = 9;
  const BOX = 3;
  const STORAGE_KEY = 'sudoku-v1';
  const DIFF = {
    easy:   { label: '入门', clues: [40, 46], mistakes: true,  hints: 5 },
    medium: { label: '中等', clues: [32, 38], mistakes: true,  hints: 3 },
    hard:   { label: '困难', clues: [26, 31], mistakes: true,  hints: 2 },
    master: { label: '大师', clues: [22, 25], mistakes: false, hints: 0 },
  };

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const timerEl = $('timer');
  const mistakesEl = $('mistakes');
  const mistakeChip = $('mistake-chip');
  const hintCountEl = $('hint-count');
  const diffSelect = $('difficulty');
  const pauseIcon = $('pause-icon');
  const toastEl = $('toast');

  let state = {
    difficulty: 'medium',
    solution: null,
    puzzle: null,
    grid: null,
    notes: null,
    given: null,
    selected: -1,
    notesMode: false,
    mistakes: 0,
    hintsLeft: 3,
    history: [],
    startedAt: 0,
    elapsedMs: 0,
    running: false,
    paused: false,
    over: false,
    won: false,
    hinted: null,
  };

  let timerRaf = null;
  let toastTimer = null;
  let cells = [];
  let pendingDiff = null;

  const idx = (r, c) => r * SIZE + c;
  const rc = (i) => [Math.floor(i / SIZE), i % SIZE];

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function showToast(msg, ms = 1600) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), ms);
  }

  // ---------- Solver / Generator ----------
  function isValidPlace(board, pos, n) {
    const r = (pos / SIZE) | 0;
    const c = pos % SIZE;
    const br = ((r / BOX) | 0) * BOX;
    const bc = ((c / BOX) | 0) * BOX;
    for (let i = 0; i < SIZE; i++) {
      if (board[r * SIZE + i] === n) return false;
      if (board[i * SIZE + c] === n) return false;
    }
    for (let i = 0; i < BOX; i++) {
      for (let j = 0; j < BOX; j++) {
        if (board[(br + i) * SIZE + (bc + j)] === n) return false;
      }
    }
    return true;
  }

  function findEmpty(board) {
    for (let i = 0; i < 81; i++) if (board[i] === 0) return i;
    return -1;
  }

  /** Count solutions up to `limit` using MRV heuristic. */
  function countSolutions(board, limit = 2) {
    let count = 0;
    function dfs() {
      if (count >= limit) return;
      let best = -1;
      let bestCount = 10;
      let bestCands = null;
      for (let pos = 0; pos < 81; pos++) {
        if (board[pos] !== 0) continue;
        const cands = [];
        for (let n = 1; n <= 9; n++) {
          if (isValidPlace(board, pos, n)) cands.push(n);
        }
        if (cands.length < bestCount) {
          bestCount = cands.length;
          best = pos;
          bestCands = cands;
          if (bestCount === 0) break;
        }
      }
      if (best < 0) {
        count++;
        return;
      }
      if (bestCount === 0) return;
      for (const n of bestCands) {
        board[best] = n;
        dfs();
        board[best] = 0;
        if (count >= limit) return;
      }
    }
    dfs();
    return count;
  }

  function generateComplete() {
    const board = new Int8Array(81);
    function fill() {
      const pos = findEmpty(board);
      if (pos < 0) return true;
      const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      for (const n of nums) {
        if (isValidPlace(board, pos, n)) {
          board[pos] = n;
          if (fill()) return true;
          board[pos] = 0;
        }
      }
      return false;
    }
    fill();
    return board;
  }

  function digPuzzle(complete, minClues, maxClues) {
    const target = minClues + ((Math.random() * (maxClues - minClues + 1)) | 0);
    const puzzle = Int8Array.from(complete);
    const order = shuffle([...Array(81).keys()]);
    let clues = 81;
    for (const pos of order) {
      if (clues <= target) break;
      const backup = puzzle[pos];
      puzzle[pos] = 0;
      const probe = Int8Array.from(puzzle);
      if (countSolutions(probe, 2) !== 1) {
        puzzle[pos] = backup;
      } else {
        clues--;
      }
    }
    return { puzzle, clues };
  }

  function generatePuzzle(difficulty) {
    const cfg = DIFF[difficulty];
    const complete = generateComplete();
    const { puzzle } = digPuzzle(complete, cfg.clues[0], cfg.clues[1]);
    return { solution: complete, puzzle };
  }

  // ---------- Conflicts (duplicates only) ----------
  function computeConflicts(grid) {
    const conflict = new Array(81).fill(false);
    for (let r = 0; r < SIZE; r++) {
      const seen = new Map();
      for (let c = 0; c < SIZE; c++) {
        const i = idx(r, c);
        const v = grid[i];
        if (!v) continue;
        if (seen.has(v)) {
          conflict[i] = true;
          conflict[seen.get(v)] = true;
        } else seen.set(v, i);
      }
    }
    for (let c = 0; c < SIZE; c++) {
      const seen = new Map();
      for (let r = 0; r < SIZE; r++) {
        const i = idx(r, c);
        const v = grid[i];
        if (!v) continue;
        if (seen.has(v)) {
          conflict[i] = true;
          conflict[seen.get(v)] = true;
        } else seen.set(v, i);
      }
    }
    for (let br = 0; br < SIZE; br += BOX) {
      for (let bc = 0; bc < SIZE; bc += BOX) {
        const seen = new Map();
        for (let i = 0; i < BOX; i++) {
          for (let j = 0; j < BOX; j++) {
            const p = idx(br + i, bc + j);
            const v = grid[p];
            if (!v) continue;
            if (seen.has(v)) {
              conflict[p] = true;
              conflict[seen.get(v)] = true;
            } else seen.set(v, p);
          }
        }
      }
    }
    return conflict;
  }

  function digitCounts(grid) {
    const counts = Array(10).fill(0);
    for (let i = 0; i < 81; i++) if (grid[i]) counts[grid[i]]++;
    return counts;
  }

  function isCompleteCorrect() {
    for (let i = 0; i < 81; i++) {
      if (state.grid[i] !== state.solution[i]) return false;
    }
    return true;
  }

  // ---------- Persistence ----------
  function serialize() {
    return {
      difficulty: state.difficulty,
      solution: Array.from(state.solution),
      puzzle: Array.from(state.puzzle),
      grid: Array.from(state.grid),
      notes: state.notes.map((s) => [...s]),
      given: Array.from(state.given),
      selected: state.selected,
      notesMode: state.notesMode,
      mistakes: state.mistakes,
      hintsLeft: state.hintsLeft,
      history: state.history.slice(-80),
      elapsedMs: getElapsed(),
      over: state.over,
      won: state.won,
      hinted: state.hinted ? [...state.hinted] : [],
      savedAt: Date.now(),
    };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
    } catch (_) { /* ignore */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || !d.solution || !d.grid) return false;
      state.difficulty = d.difficulty || 'medium';
      state.solution = Int8Array.from(d.solution);
      state.puzzle = Int8Array.from(d.puzzle);
      state.grid = Int8Array.from(d.grid);
      state.notes = d.notes.map((arr) => new Set(arr));
      state.given = d.given;
      state.selected = typeof d.selected === 'number' ? d.selected : -1;
      state.notesMode = !!d.notesMode;
      state.mistakes = d.mistakes || 0;
      state.hintsLeft = typeof d.hintsLeft === 'number' ? d.hintsLeft : DIFF[state.difficulty].hints;
      state.history = d.history || [];
      state.elapsedMs = d.elapsedMs || 0;
      state.over = !!d.over;
      state.won = !!d.won;
      state.hinted = new Set(d.hinted || []);
      state.paused = false;
      state.running = !state.over && !state.won;
      state.startedAt = Date.now();
      return true;
    } catch (_) {
      return false;
    }
  }

  // ---------- Timer ----------
  function getElapsed() {
    if (!state.running || state.paused || state.over || state.won) return state.elapsedMs;
    return state.elapsedMs + (Date.now() - state.startedAt);
  }

  function tickTimer() {
    timerEl.textContent = formatTime(getElapsed());
    if (state.running && !state.paused) {
      timerRaf = requestAnimationFrame(tickTimer);
    }
  }

  function startTimer() {
    cancelAnimationFrame(timerRaf);
    if (state.over || state.won) {
      timerEl.textContent = formatTime(state.elapsedMs);
      return;
    }
    state.running = true;
    state.paused = false;
    state.startedAt = Date.now();
    pauseIcon.textContent = '⏸';
    tickTimer();
  }

  function pauseTimer() {
    if (!state.running || state.paused || state.over || state.won) return;
    state.elapsedMs = getElapsed();
    state.paused = true;
    state.running = false;
    cancelAnimationFrame(timerRaf);
    pauseIcon.textContent = '▶';
    timerEl.textContent = formatTime(state.elapsedMs);
  }

  // ---------- History ----------
  function pushHistory() {
    state.history.push({
      grid: Array.from(state.grid),
      notes: state.notes.map((s) => [...s]),
      mistakes: state.mistakes,
      hinted: [...(state.hinted || [])],
    });
    if (state.history.length > 100) state.history.shift();
  }

  function undo() {
    if (state.over || state.won || !state.history.length) return;
    const snap = state.history.pop();
    state.grid = Int8Array.from(snap.grid);
    state.notes = snap.notes.map((arr) => new Set(arr));
    state.mistakes = snap.mistakes;
    state.hinted = new Set(snap.hinted || []);
    render();
    save();
  }

  // ---------- Lifecycle ----------
  function hideModals() {
    ['modal-pause', 'modal-win', 'modal-lose', 'modal-confirm'].forEach((id) => {
      $(id).classList.add('hidden');
    });
  }

  function newGame(difficulty) {
    const diff = difficulty || state.difficulty || 'medium';
    state.difficulty = diff;
    diffSelect.value = diff;
    pendingDiff = null;
    showToast('生成谜题中…', 900);

    setTimeout(() => {
      const { solution, puzzle } = generatePuzzle(diff);
      const cfg = DIFF[diff];
      state.solution = solution;
      state.puzzle = puzzle;
      state.grid = Int8Array.from(puzzle);
      state.given = Array.from(puzzle, (v) => v !== 0);
      state.notes = Array.from({ length: 81 }, () => new Set());
      state.selected = -1;
      state.notesMode = false;
      state.mistakes = 0;
      state.hintsLeft = cfg.hints;
      state.history = [];
      state.elapsedMs = 0;
      state.over = false;
      state.won = false;
      state.paused = false;
      state.hinted = new Set();

      hideModals();
      render();
      startTimer();
      save();
      showToast(`${cfg.label} · 开始！`);
    }, 30);
  }

  function openPause() {
    if (state.over || state.won) return;
    pauseTimer();
    save();
    $('modal-pause').classList.remove('hidden');
  }

  function resumeGame() {
    $('modal-pause').classList.add('hidden');
    if (!state.over && !state.won) startTimer();
    save();
  }

  function askNewGame(nextDiff) {
    pendingDiff = nextDiff || diffSelect.value;
    const idle = state.over || state.won || (state.elapsedMs < 1500 && !state.history.length);
    if (idle) {
      newGame(pendingDiff);
      return;
    }
    pauseTimer();
    $('modal-confirm').classList.remove('hidden');
  }

  // ---------- Input ----------
  function selectCell(i) {
    if (state.over || state.won) return;
    state.selected = i;
    render();
  }

  function clearPeerNotes(pos, num) {
    const [r, c] = rc(pos);
    const br = ((r / BOX) | 0) * BOX;
    const bc = ((c / BOX) | 0) * BOX;
    for (let i = 0; i < SIZE; i++) {
      state.notes[idx(r, i)].delete(num);
      state.notes[idx(i, c)].delete(num);
    }
    for (let i = 0; i < BOX; i++) {
      for (let j = 0; j < BOX; j++) {
        state.notes[idx(br + i, bc + j)].delete(num);
      }
    }
  }

  function placeNumber(num) {
    if (state.over || state.won || state.selected < 0) return;
    const i = state.selected;
    if (state.given[i]) return;

    if (state.notesMode) {
      pushHistory();
      if (state.grid[i]) state.grid[i] = 0;
      const set = state.notes[i];
      if (set.has(num)) set.delete(num);
      else set.add(num);
      render();
      save();
      return;
    }

    if (state.grid[i] === num) {
      pushHistory();
      state.grid[i] = 0;
      if (state.hinted) state.hinted.delete(i);
      render();
      save();
      return;
    }

    pushHistory();
    state.notes[i].clear();
    state.grid[i] = num;
    if (state.hinted) state.hinted.delete(i);
    clearPeerNotes(i, num);

    const cfg = DIFF[state.difficulty];
    if (cfg.mistakes && num !== state.solution[i]) {
      state.mistakes++;
      if (state.mistakes >= 3) {
        state.over = true;
        state.elapsedMs = getElapsed();
        state.running = false;
        cancelAnimationFrame(timerRaf);
        render();
        save();
        $('modal-lose').classList.remove('hidden');
        return;
      }
    }

    render();
    checkWin(cfg);
    save();
  }

  function checkWin(cfg) {
    if (!isCompleteCorrect()) return;
    state.won = true;
    state.elapsedMs = getElapsed();
    state.running = false;
    cancelAnimationFrame(timerRaf);
    $('win-time').textContent = formatTime(state.elapsedMs);
    $('win-meta').textContent = `${cfg.label} · 错误 ${cfg.mistakes ? state.mistakes : '—'} 次`;
    save();
    $('modal-win').classList.remove('hidden');
  }

  function erase() {
    if (state.over || state.won || state.selected < 0) return;
    const i = state.selected;
    if (state.given[i]) return;
    if (!state.grid[i] && state.notes[i].size === 0) return;
    pushHistory();
    state.grid[i] = 0;
    state.notes[i].clear();
    if (state.hinted) state.hinted.delete(i);
    render();
    save();
  }

  function useHint() {
    const cfg = DIFF[state.difficulty];
    if (cfg.hints === 0) {
      showToast('大师模式无提示');
      return;
    }
    if (state.over || state.won) return;
    if (state.hintsLeft <= 0) {
      showToast('提示已用完');
      return;
    }

    let target = -1;
    if (
      state.selected >= 0 &&
      !state.given[state.selected] &&
      state.grid[state.selected] !== state.solution[state.selected]
    ) {
      target = state.selected;
    } else {
      const candidates = [];
      for (let i = 0; i < 81; i++) {
        if (!state.given[i] && state.grid[i] !== state.solution[i]) candidates.push(i);
      }
      if (!candidates.length) return;
      target = candidates[(Math.random() * candidates.length) | 0];
    }

    pushHistory();
    state.hintsLeft--;
    state.grid[target] = state.solution[target];
    state.notes[target].clear();
    clearPeerNotes(target, state.solution[target]);
    if (!state.hinted) state.hinted = new Set();
    state.hinted.add(target);
    state.selected = target;
    render();
    checkWin(cfg);
    save();
  }

  // ---------- Render ----------
  function buildBoard() {
    boardEl.innerHTML = '';
    cells = [];
    for (let i = 0; i < 81; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.setAttribute('role', 'gridcell');
      cell.dataset.i = String(i);
      cell.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        selectCell(i);
      });
      boardEl.appendChild(cell);
      cells.push(cell);
    }
  }

  function render() {
    if (!state.grid) return;
    const conflicts = computeConflicts(state.grid);
    const counts = digitCounts(state.grid);
    const sel = state.selected;
    const selVal = sel >= 0 ? state.grid[sel] : 0;
    const [sr, sc] = sel >= 0 ? rc(sel) : [-1, -1];
    const cfg = DIFF[state.difficulty];

    if (cfg.mistakes) {
      mistakeChip.classList.remove('hidden-mode');
      mistakesEl.textContent = `${state.mistakes}/3`;
      mistakeChip.classList.toggle('danger', state.mistakes > 0);
    } else {
      mistakeChip.classList.add('hidden-mode');
    }

    $('btn-notes').classList.toggle('active', state.notesMode);
    $('btn-notes').setAttribute('aria-pressed', String(state.notesMode));

    const hintBtn = $('btn-hint');
    if (cfg.hints === 0) {
      hintBtn.disabled = true;
      hintCountEl.textContent = '0';
    } else {
      hintBtn.disabled = state.hintsLeft <= 0 || state.over || state.won;
      hintCountEl.textContent = String(state.hintsLeft);
    }

    $('btn-undo').disabled = !state.history.length || state.over || state.won;

    for (let i = 0; i < 81; i++) {
      const cell = cells[i];
      const [r, c] = rc(i);
      const v = state.grid[i];
      cell.className = 'cell';
      if (state.given[i]) cell.classList.add('given');
      else if (state.hinted && state.hinted.has(i)) cell.classList.add('hinted');
      else if (v) cell.classList.add('user');

      if (sel === i) cell.classList.add('selected');
      else if (
        sel >= 0 &&
        (r === sr ||
          c === sc ||
          (((r / BOX) | 0) === ((sr / BOX) | 0) && ((c / BOX) | 0) === ((sc / BOX) | 0)))
      ) {
        cell.classList.add('in-unit');
      }
      if (selVal && v === selVal && i !== sel) cell.classList.add('same-num');
      if (conflicts[i]) cell.classList.add('conflict');

      cell.innerHTML = '';
      if (v) {
        cell.textContent = String(v);
      } else if (state.notes[i].size) {
        const notes = document.createElement('div');
        notes.className = 'notes';
        for (let n = 1; n <= 9; n++) {
          const span = document.createElement('span');
          span.textContent = state.notes[i].has(n) ? String(n) : '';
          notes.appendChild(span);
        }
        cell.appendChild(notes);
      }
    }

    document.querySelectorAll('.num-btn').forEach((btn) => {
      const n = +btn.dataset.num;
      btn.classList.toggle('exhausted', counts[n] >= 9);
    });

    timerEl.textContent = formatTime(getElapsed());
  }

  function selNav(e) {
    if (state.selected < 0) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        selectCell(40);
        return true;
      }
      return false;
    }
    let [r, c] = rc(state.selected);
    if (e.key === 'ArrowUp') r = (r + 8) % 9;
    else if (e.key === 'ArrowDown') r = (r + 1) % 9;
    else if (e.key === 'ArrowLeft') c = (c + 8) % 9;
    else if (e.key === 'ArrowRight') c = (c + 1) % 9;
    else return false;
    selectCell(idx(r, c));
    return true;
  }

  function bind() {
    $('btn-new').addEventListener('click', () => askNewGame(diffSelect.value));

    $('btn-confirm-ok').addEventListener('click', () => {
      $('modal-confirm').classList.add('hidden');
      newGame(pendingDiff || diffSelect.value);
    });

    $('btn-confirm-cancel').addEventListener('click', () => {
      $('modal-confirm').classList.add('hidden');
      diffSelect.value = state.difficulty;
      pendingDiff = null;
      if (!state.over && !state.won) startTimer();
    });

    diffSelect.addEventListener('change', () => {
      askNewGame(diffSelect.value);
    });

    $('btn-pause').addEventListener('click', () => {
      if ($('modal-pause').classList.contains('hidden')) openPause();
      else resumeGame();
    });
    $('btn-resume').addEventListener('click', resumeGame);

    $('btn-undo').addEventListener('click', undo);
    $('btn-erase').addEventListener('click', erase);
    $('btn-notes').addEventListener('click', () => {
      state.notesMode = !state.notesMode;
      render();
      save();
    });
    $('btn-hint').addEventListener('click', useHint);

    $('numpad').addEventListener('click', (e) => {
      const btn = e.target.closest('.num-btn');
      if (!btn) return;
      placeNumber(+btn.dataset.num);
    });

    $('btn-win-new').addEventListener('click', () => newGame(state.difficulty));
    $('btn-lose-new').addEventListener('click', () => newGame(state.difficulty));

    window.addEventListener('keydown', (e) => {
      if (!$('modal-pause').classList.contains('hidden')) {
        if (e.key === 'Escape' || e.key === ' ') {
          e.preventDefault();
          resumeGame();
        }
        return;
      }
      if (!$('modal-confirm').classList.contains('hidden')) return;
      if (!$('modal-win').classList.contains('hidden') || !$('modal-lose').classList.contains('hidden')) return;
      if (state.over || state.won) return;

      if (e.key >= '1' && e.key <= '9') placeNumber(+e.key);
      else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') erase();
      else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        undo();
      } else if (e.key === 'n' || e.key === 'N') {
        state.notesMode = !state.notesMode;
        render();
      } else if (e.key === 'p' || e.key === 'P') openPause();
      else if (selNav(e)) e.preventDefault();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !state.paused && !state.over && !state.won) {
        pauseTimer();
        save();
      }
    });

    setInterval(() => {
      if (state.grid && !state.over && !state.won) save();
    }, 5000);
  }

  function init() {
    buildBoard();
    bind();
    state.hinted = new Set();

    if (load()) {
      diffSelect.value = state.difficulty;
      render();
      if (state.won) {
        $('win-time').textContent = formatTime(state.elapsedMs);
        $('win-meta').textContent = `${DIFF[state.difficulty].label}`;
        $('modal-win').classList.remove('hidden');
      } else if (state.over) {
        $('modal-lose').classList.remove('hidden');
      } else {
        startTimer();
      }
    } else {
      newGame('medium');
    }
  }

  init();
})();
