(() => {
  "use strict";

  const STORAGE_KEY = "routine-tracker-data-v1";
  const THEME_KEY = "routine-tracker-theme";
  const PALETTE = [
    "#4f46e5", "#16a34a", "#f59e0b", "#ec4899",
    "#06b6d4", "#ef4444", "#8b5cf6", "#0ea5e9",
    "#84cc16", "#f97316"
  ];
  const MAX_SETTLEMENT_WEEKS = 26;

  // ---------- date helpers (all dates as local YYYY-MM-DD strings) ----------
  function toKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  function fromKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }
  function startOfWeek(date) {
    // Monday-start week
    const d = new Date(date);
    const day = d.getDay(); // 0=Sun..6=Sat
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function endOfWeek(date) {
    return addDays(startOfWeek(date), 6);
  }
  function fmtRange(start, end) {
    const opts = { month: "short", day: "numeric" };
    return `${start.toLocaleDateString("ko-KR", opts)} - ${end.toLocaleDateString("ko-KR", opts)}`;
  }
  function todayKey() {
    return toKey(new Date());
  }

  // ---------- state ----------
  let state = loadState();
  let selectedCheckDate = todayKey();
  let calendarCursor = startOfMonth(new Date());
  let editingRoutineId = null;
  let dayModalDate = null;

  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.routines) && typeof parsed.logs === "object") {
          return parsed;
        }
      }
    } catch (e) {
      console.warn("failed to load state", e);
    }
    return { routines: [], logs: {} };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("failed to save state", e);
      showToast("저장에 실패했어요 (저장 공간 확인)");
    }
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  // ---------- DOM refs ----------
  const $ = (id) => document.getElementById(id);
  const routineList = $("routineList");
  const routineEmpty = $("routineEmpty");
  const checkList = $("checkList");
  const checkEmpty = $("checkEmpty");
  const checkDateInput = $("checkDate");
  const weekProgressList = $("weekProgressList");
  const weekRangeLabel = $("weekRangeLabel");
  const calendarGrid = $("calendarGrid");
  const calendarWeekdayRow = $("calendarWeekdayRow");
  const calendarTitle = $("calendarTitle");
  const calendarLegend = $("calendarLegend");
  const settlementList = $("settlementList");

  const routineModal = $("routineModal");
  const routineForm = $("routineForm");
  const modalTitle = $("modalTitle");
  const routineNameInput = $("routineName");
  const routineTargetInput = $("routineTarget");
  const colorPicker = $("colorPicker");
  const deleteRoutineBtn = $("deleteRoutineBtn");

  const dayModal = $("dayModal");
  const dayModalTitle = $("dayModalTitle");
  const dayModalList = $("dayModalList");

  let selectedColor = PALETTE[0];

  // ---------- routine helpers ----------
  function getRoutine(id) {
    return state.routines.find((r) => r.id === id);
  }
  function activeRoutines() {
    return state.routines.filter((r) => !r.archived);
  }
  function isCheckedOn(dateKey, routineId) {
    return !!(state.logs[dateKey] && state.logs[dateKey].includes(routineId));
  }
  function toggleCheck(dateKey, routineId) {
    if (!state.logs[dateKey]) state.logs[dateKey] = [];
    const idx = state.logs[dateKey].indexOf(routineId);
    if (idx >= 0) {
      state.logs[dateKey].splice(idx, 1);
      if (state.logs[dateKey].length === 0) delete state.logs[dateKey];
    } else {
      state.logs[dateKey].push(routineId);
    }
    saveState();
  }
  function countInRange(routineId, start, end) {
    let count = 0;
    for (const key in state.logs) {
      const d = fromKey(key);
      if (d >= start && d <= end && state.logs[key].includes(routineId)) count++;
    }
    return count;
  }
  function routinesActiveDuring(dateEnd) {
    // routines created on or before the given date, not archived after that date (simplified: not archived at all, or archivedAt after dateEnd)
    return state.routines.filter((r) => {
      const created = r.createdAt ? fromKey(r.createdAt) : new Date(0);
      if (created > dateEnd) return false;
      if (r.archived && r.archivedAt) {
        const archivedAt = fromKey(r.archivedAt);
        if (archivedAt <= dateEnd) return false;
      } else if (r.archived) {
        return false;
      }
      return true;
    });
  }

  // ---------- rendering: routine list ----------
  function renderRoutines() {
    routineList.innerHTML = "";
    const routines = activeRoutines();
    routineEmpty.classList.toggle("hidden", routines.length > 0);
    routines.forEach((r) => {
      const li = document.createElement("li");
      li.className = "routine-item";
      li.innerHTML = `
        <span class="dot" style="background:${r.color}"></span>
        <span class="name">${escapeHtml(r.name)}</span>
        <span class="target">주 ${r.weeklyTarget}회</span>
      `;
      li.addEventListener("click", () => openRoutineModal(r.id));
      routineList.appendChild(li);
    });
  }

  // ---------- rendering: today/selected-date check list ----------
  function renderCheckList() {
    checkDateInput.value = selectedCheckDate;
    checkList.innerHTML = "";
    const dateEnd = fromKey(selectedCheckDate);
    const routines = routinesActiveDuring(dateEnd);
    checkEmpty.classList.toggle("hidden", routines.length > 0);
    const weekStart = startOfWeek(dateEnd);
    const weekEnd = endOfWeek(dateEnd);

    routines.forEach((r) => {
      const checked = isCheckedOn(selectedCheckDate, r.id);
      const weekCount = countInRange(r.id, weekStart, weekEnd);
      const li = document.createElement("li");
      li.className = "check-item" + (checked ? " checked" : "");
      const cbId = `chk-${r.id}`;
      li.innerHTML = `
        <label for="${cbId}">
          <input type="checkbox" id="${cbId}" ${checked ? "checked" : ""} />
          <span class="dot" style="background:${r.color}"></span>
          <span>${escapeHtml(r.name)}</span>
        </label>
        <span class="count-badge">이번 주 ${weekCount}/${r.weeklyTarget}</span>
      `;
      li.querySelector("input").addEventListener("change", () => {
        toggleCheck(selectedCheckDate, r.id);
        renderAll();
      });
      checkList.appendChild(li);
    });
  }

  // ---------- rendering: this week progress ----------
  function renderWeekProgress() {
    const now = new Date();
    const weekStart = startOfWeek(now);
    const weekEnd = endOfWeek(now);
    weekRangeLabel.textContent = fmtRange(weekStart, weekEnd);
    weekProgressList.innerHTML = "";
    const routines = routinesActiveDuring(weekEnd);
    if (routines.length === 0) {
      weekProgressList.innerHTML = `<p class="empty-hint">표시할 루틴이 없어요.</p>`;
      return;
    }
    routines.forEach((r) => {
      const count = countInRange(r.id, weekStart, weekEnd);
      const pct = Math.min(100, Math.round((count / r.weeklyTarget) * 100));
      const done = count >= r.weeklyTarget;
      const row = document.createElement("li");
      row.className = "progress-row" + (done ? " done" : "");
      row.innerHTML = `
        <div class="progress-top">
          <span class="rname"><span class="dot" style="background:${r.color}"></span>${escapeHtml(r.name)}</span>
          <span class="rcount">${count}/${r.weeklyTarget}${done ? " ✓" : ""}</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${pct}%;background:${done ? "var(--success)" : r.color}"></div>
        </div>
      `;
      weekProgressList.appendChild(row);
    });
  }

  // ---------- rendering: calendar ----------
  function renderCalendar() {
    const y = calendarCursor.getFullYear();
    const m = calendarCursor.getMonth();
    calendarTitle.textContent = `${y}년 ${m + 1}월`;

    calendarWeekdayRow.innerHTML = "";
    ["월", "화", "수", "목", "금", "토", "일"].forEach((d) => {
      const span = document.createElement("span");
      span.textContent = d;
      calendarWeekdayRow.appendChild(span);
    });

    calendarGrid.innerHTML = "";
    const monthStart = new Date(y, m, 1);
    const monthEnd = new Date(y, m + 1, 0);
    const gridStart = startOfWeek(monthStart);
    const gridEnd = endOfWeek(monthEnd);
    const todayK = todayKey();

    let cursor = new Date(gridStart);
    while (cursor <= gridEnd) {
      const weekStart = new Date(cursor);
      const weekEnd = addDays(weekStart, 6);

      for (let i = 0; i < 7; i++) {
        const dKey = toKey(cursor);
        const outside = cursor.getMonth() !== m;
        const cell = document.createElement("div");
        cell.className = "cal-day" + (outside ? " outside" : "") + (dKey === todayK ? " today" : "");
        const dots = (state.logs[dKey] || [])
          .map((rid) => getRoutine(rid))
          .filter(Boolean)
          .map((r) => `<span class="dot" style="background:${r.color}" title="${escapeHtml(r.name)}"></span>`)
          .join("");
        cell.innerHTML = `<span class="daynum">${cursor.getDate()}</span><span class="dots">${dots}</span>`;
        cell.addEventListener("click", () => openDayModal(dKey));
        calendarGrid.appendChild(cell);
        cursor = addDays(cursor, 1);
      }

      // week achievement badge row
      const routines = routinesActiveDuring(weekEnd);
      if (routines.length > 0) {
        const allDone = routines.every((r) => countInRange(r.id, weekStart, weekEnd) >= r.weeklyTarget);
        const marker = document.createElement("div");
        marker.className = "cal-week-marker";
        marker.innerHTML = `<span class="week-badge${allDone ? " achieved" : ""}">${allDone ? "✓ 이번 주 달성" : "진행중"}</span>`;
        calendarGrid.appendChild(marker);
      }
    }

    calendarLegend.innerHTML = "";
    activeRoutines().forEach((r) => {
      const item = document.createElement("span");
      item.className = "legend-item";
      item.innerHTML = `<span class="dot" style="background:${r.color}"></span>${escapeHtml(r.name)}`;
      calendarLegend.appendChild(item);
    });
  }

  // ---------- rendering: settlement ----------
  function renderSettlement() {
    settlementList.innerHTML = "";
    if (state.routines.length === 0) {
      settlementList.innerHTML = `<p class="settlement-empty">루틴을 추가하면 주간 정산이 여기에 표시돼요.</p>`;
      return;
    }
    // earliest date to consider: earliest routine createdAt, else today
    let earliest = new Date();
    state.routines.forEach((r) => {
      if (r.createdAt) {
        const c = fromKey(r.createdAt);
        if (c < earliest) earliest = c;
      }
    });
    const earliestWeekStart = startOfWeek(earliest);
    const now = new Date();
    let weekStart = startOfWeek(now);
    const weeks = [];
    let guard = 0;
    while (weekStart >= earliestWeekStart && guard < MAX_SETTLEMENT_WEEKS) {
      weeks.push(new Date(weekStart));
      weekStart = addDays(weekStart, -7);
      guard++;
    }

    if (weeks.length === 0) {
      settlementList.innerHTML = `<p class="settlement-empty">아직 정산할 주가 없어요.</p>`;
      return;
    }

    weeks.forEach((wStart, idx) => {
      const wEnd = addDays(wStart, 6);
      const routines = routinesActiveDuring(wEnd);
      if (routines.length === 0) return;
      const rows = routines.map((r) => {
        const count = countInRange(r.id, wStart, wEnd);
        const ok = count >= r.weeklyTarget;
        return { r, count, ok };
      });
      const allOk = rows.every((row) => row.ok);
      const card = document.createElement("div");
      card.className = "settlement-card" + (allOk ? " achieved" : "");
      const isCurrent = idx === 0;
      card.innerHTML = `
        <div class="settlement-head">
          <span class="range">${fmtRange(wStart, wEnd)}${isCurrent ? " (이번 주)" : ""}</span>
          <span class="badge${allOk ? " achieved" : ""}">${allOk ? "달성" : "진행중"}</span>
        </div>
        ${rows.map((row) => `
          <div class="settlement-row${row.ok ? " ok" : ""}">
            <span class="rname"><span class="dot" style="background:${row.r.color}"></span>${escapeHtml(row.r.name)}</span>
            <span class="rcount">${row.count}/${row.r.weeklyTarget}${row.ok ? " ✓" : ""}</span>
          </div>
        `).join("")}
      `;
      settlementList.appendChild(card);
    });
  }

  function renderAll() {
    renderRoutines();
    renderCheckList();
    renderWeekProgress();
    renderCalendar();
    renderSettlement();
  }

  // ---------- day modal ----------
  function openDayModal(dateKey) {
    dayModalDate = dateKey;
    const d = fromKey(dateKey);
    dayModalTitle.textContent = d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
    dayModalList.innerHTML = "";
    const routines = routinesActiveDuring(d);
    if (routines.length === 0) {
      dayModalList.innerHTML = `<p class="empty-hint">이 날짜에는 활성화된 루틴이 없어요.</p>`;
    } else {
      routines.forEach((r) => {
        const checked = isCheckedOn(dateKey, r.id);
        const li = document.createElement("li");
        li.className = "check-item" + (checked ? " checked" : "");
        const cbId = `day-chk-${r.id}`;
        li.innerHTML = `
          <label for="${cbId}">
            <input type="checkbox" id="${cbId}" ${checked ? "checked" : ""} />
            <span class="dot" style="background:${r.color}"></span>
            <span>${escapeHtml(r.name)}</span>
          </label>
        `;
        li.querySelector("input").addEventListener("change", () => {
          toggleCheck(dateKey, r.id);
          renderAll();
          openDayModal(dateKey);
        });
        dayModalList.appendChild(li);
      });
    }
    dayModal.classList.remove("hidden");
  }
  $("closeDayModalBtn").addEventListener("click", () => dayModal.classList.add("hidden"));
  dayModal.addEventListener("click", (e) => {
    if (e.target === dayModal) dayModal.classList.add("hidden");
  });

  // ---------- routine modal ----------
  function buildColorPicker() {
    colorPicker.innerHTML = "";
    PALETTE.forEach((c) => {
      const sw = document.createElement("span");
      sw.className = "color-swatch" + (c === selectedColor ? " selected" : "");
      sw.style.background = c;
      sw.addEventListener("click", () => {
        selectedColor = c;
        [...colorPicker.children].forEach((el) => el.classList.remove("selected"));
        sw.classList.add("selected");
      });
      colorPicker.appendChild(sw);
    });
  }

  function nextUnusedColor() {
    const used = new Set(state.routines.map((r) => r.color));
    return PALETTE.find((c) => !used.has(c)) || PALETTE[state.routines.length % PALETTE.length];
  }

  function openRoutineModal(id) {
    editingRoutineId = id || null;
    if (id) {
      const r = getRoutine(id);
      modalTitle.textContent = "루틴 수정";
      routineNameInput.value = r.name;
      routineTargetInput.value = r.weeklyTarget;
      selectedColor = r.color;
      deleteRoutineBtn.classList.remove("hidden");
    } else {
      modalTitle.textContent = "루틴 추가";
      routineNameInput.value = "";
      routineTargetInput.value = 3;
      selectedColor = nextUnusedColor();
      deleteRoutineBtn.classList.add("hidden");
    }
    buildColorPicker();
    routineModal.classList.remove("hidden");
    setTimeout(() => routineNameInput.focus(), 0);
  }
  function closeRoutineModal() {
    routineModal.classList.add("hidden");
    editingRoutineId = null;
  }

  $("addRoutineBtn").addEventListener("click", () => openRoutineModal(null));
  $("cancelModalBtn").addEventListener("click", closeRoutineModal);
  routineModal.addEventListener("click", (e) => {
    if (e.target === routineModal) closeRoutineModal();
  });

  routineForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = routineNameInput.value.trim();
    const target = Math.max(1, Math.min(14, parseInt(routineTargetInput.value, 10) || 1));
    if (!name) return;

    if (editingRoutineId) {
      const r = getRoutine(editingRoutineId);
      r.name = name;
      r.weeklyTarget = target;
      r.color = selectedColor;
    } else {
      state.routines.push({
        id: uid(),
        name,
        weeklyTarget: target,
        color: selectedColor,
        createdAt: todayKey(),
        archived: false
      });
    }
    saveState();
    closeRoutineModal();
    renderAll();
    showToast("저장했어요");
  });

  deleteRoutineBtn.addEventListener("click", () => {
    if (!editingRoutineId) return;
    const r = getRoutine(editingRoutineId);
    if (!r) return;
    const hasLogs = Object.values(state.logs).some((ids) => ids.includes(r.id));
    if (hasLogs) {
      // keep history intact: archive instead of hard delete
      r.archived = true;
      r.archivedAt = todayKey();
    } else {
      state.routines = state.routines.filter((x) => x.id !== r.id);
    }
    saveState();
    closeRoutineModal();
    renderAll();
    showToast("삭제했어요");
  });

  // ---------- date nav ----------
  checkDateInput.addEventListener("change", () => {
    selectedCheckDate = checkDateInput.value || todayKey();
    renderCheckList();
  });

  $("prevMonthBtn").addEventListener("click", () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
    renderCalendar();
  });
  $("nextMonthBtn").addEventListener("click", () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
    renderCalendar();
  });
  $("todayBtn").addEventListener("click", () => {
    calendarCursor = startOfMonth(new Date());
    renderCalendar();
  });

  // ---------- theme ----------
  function applyTheme(theme) {
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
      $("themeToggle").textContent = "☀️";
    } else {
      document.documentElement.removeAttribute("data-theme");
      $("themeToggle").textContent = "🌙";
    }
  }
  function initTheme() {
    let theme = localStorage.getItem(THEME_KEY);
    if (!theme) {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    applyTheme(theme);
  }
  $("themeToggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });

  // ---------- export / import ----------
  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `routine-tracker-backup-${todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("백업 파일을 내보냈어요");
  });

  $("importInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.routines) || typeof parsed.logs !== "object") {
          throw new Error("invalid format");
        }
        state = parsed;
        saveState();
        renderAll();
        showToast("백업을 불러왔어요");
      } catch (err) {
        showToast("올바른 백업 파일이 아니에요");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  // ---------- misc ----------
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
  let toastTimer = null;
  function showToast(msg) {
    const toast = $("toast");
    toast.textContent = msg;
    toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add("hidden"), 2200);
  }

  // ---------- init ----------
  initTheme();
  renderAll();
})();
