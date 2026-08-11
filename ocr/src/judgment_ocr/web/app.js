const state = {
  tasks: [],
  counts: {},
  current: 0,
  detail: null,
  activeCandidate: "embedded",
  candidates: {},
  editorSource: "manual",
  editorTexts: {},
  zoom: 100,
  dirty: false,
};

const elements = Object.fromEntries([
  "task-meta", "progress-label", "status-counts", "progress-bar", "previous-task",
  "next-task", "position-label", "status-filter", "task-list", "document-label",
  "document-status", "zoom-out", "zoom-in", "zoom-label", "pdf-link", "page-image",
  "candidate-tabs", "use-candidate", "candidate-quality", "candidate-confidence",
  "candidate-runtime", "candidate-text", "source-control", "ground-truth",
  "review-notes", "verified", "save-state", "save-review", "toast"
].map((id) => [id, document.getElementById(id)]));

function showToast(message, error = false) {
  elements.toast.textContent = message;
  elements.toast.className = error ? "show error" : "show";
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { elements.toast.className = ""; }, 2400);
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

function statusLabel(value) {
  return {pending: "OCR pending", ready: "Ready", draft: "Draft", verified: "Verified"}[value] || value;
}

function renderProgress() {
  const verified = state.counts.verified || 0;
  const total = state.tasks.length;
  elements["progress-label"].textContent = `${verified} of ${total} verified`;
  elements["status-counts"].textContent = `${state.counts.ready || 0} ready · ${state.counts.draft || 0} draft`;
  elements["progress-bar"].style.width = total ? `${verified / total * 100}%` : "0%";
}

function renderTaskList() {
  const filter = elements["status-filter"].value;
  elements["task-list"].replaceChildren();
  state.tasks.forEach((task) => {
    if (filter !== "all" && task.status !== filter) return;
    const button = document.createElement("button");
    button.className = `task-item${task.index === state.current ? " active" : ""}`;
    button.type = "button";
    button.dataset.index = task.index;
    button.innerHTML = `
      <span class="status-dot ${task.status}"></span>
      <span>
        <span class="task-id"><span>${task.gold_id || task.sample_id}</span><span>${task.decision_year}</span></span>
        <span class="task-detail">${task.sample_id} · PDF ${task.pdf_page}<br>${task.gold_bucket || "queue"} · ${task.severity}</span>
      </span>`;
    button.addEventListener("click", () => loadTask(task.index));
    elements["task-list"].append(button);
  });
}

function normalizedCandidate(candidate, source) {
  return {
    source,
    text: candidate?.text || "",
    metrics: candidate?.metrics || {},
    confidence: candidate?.mean_confidence,
    runtime: candidate?.elapsed_seconds,
    error: candidate?.error,
  };
}

function buildCandidates(detail) {
  const candidates = {embedded: normalizedCandidate(detail.embedded, "embedded")};
  detail.candidates.forEach((candidate) => {
    candidates[candidate.engine] = normalizedCandidate(candidate, candidate.engine);
  });
  return candidates;
}

function chooseInitialSource(detail) {
  if (detail.review) return detail.review.selected_source;
  if (detail.task.gold_bucket === "clean") return "embedded";
  return Object.values(state.candidates)
    .filter((candidate) => !candidate.error)
    .sort((left, right) => (right.metrics.quality_score || 0) - (left.metrics.quality_score || 0))[0]?.source || "embedded";
}

function renderCandidateTabs() {
  elements["candidate-tabs"].replaceChildren();
  Object.values(state.candidates).forEach((candidate) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `candidate-tab${candidate.source === state.activeCandidate ? " active" : ""}`;
    button.textContent = candidate.source;
    button.addEventListener("click", () => {
      state.activeCandidate = candidate.source;
      renderCandidateTabs();
      renderCandidate();
    });
    elements["candidate-tabs"].append(button);
  });
}

function formatMetric(value, digits = 3) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
}

function renderCandidate() {
  const candidate = state.candidates[state.activeCandidate];
  elements["candidate-quality"].textContent = `Quality ${formatMetric(candidate?.metrics.quality_score)}`;
  elements["candidate-confidence"].textContent = `Confidence ${formatMetric(candidate?.confidence)}`;
  elements["candidate-runtime"].textContent = `Runtime ${formatMetric(candidate?.runtime, 1)}s`;
  elements["candidate-text"].textContent = candidate?.error || candidate?.text || "OCR result pending";
  elements["candidate-text"].classList.toggle("error", Boolean(candidate?.error));
  elements["use-candidate"].disabled = !candidate || Boolean(candidate.error);
}

function renderSourceControl(selected) {
  elements["source-control"].replaceChildren();
  ["embedded", "paddle", "tesseract", "manual"].forEach((source) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="radio" name="selected-source" value="${source}"${source === selected ? " checked" : ""}><span>${source}</span>`;
    label.querySelector("input").addEventListener("change", () => selectEditorSource(source));
    elements["source-control"].append(label);
  });
}

function selectEditorSource(source) {
  state.editorTexts[state.editorSource] = elements["ground-truth"].value;
  if (source === "manual" && !state.editorTexts.manual) {
    state.editorTexts.manual = elements["ground-truth"].value;
  }
  state.editorSource = source;
  elements["ground-truth"].value = state.editorTexts[source] || "";
  markDirty();
}

function setChecks(review) {
  document.querySelectorAll("[data-check]").forEach((input) => {
    input.checked = Boolean(review?.checks?.[input.dataset.check]);
  });
  elements.verified.checked = Boolean(review?.verified);
}

function updateZoom() {
  elements["zoom-label"].textContent = `${state.zoom}%`;
  elements["page-image"].style.width = `${state.zoom}%`;
  elements["zoom-out"].disabled = state.zoom <= 50;
  elements["zoom-in"].disabled = state.zoom >= 200;
}

function markDirty() {
  state.dirty = true;
  elements["save-state"].textContent = "Unsaved";
}

async function loadTask(index, force = false) {
  if (!force && state.dirty && !window.confirm("Discard unsaved changes?")) return;
  try {
    const detail = await request(`/api/tasks/${index}`);
    state.current = index;
    state.detail = detail;
    state.candidates = buildCandidates(detail);
    state.activeCandidate = chooseInitialSource(detail);
    const source = detail.review?.selected_source || state.activeCandidate;
    state.editorTexts = Object.fromEntries(
      Object.entries(state.candidates).map(([name, candidate]) => [name, candidate.text])
    );
    state.editorTexts.manual = detail.review?.selected_source === "manual"
      ? detail.review.corrected_text
      : "";
    if (detail.review && detail.review.selected_source !== "manual") {
      state.editorTexts[detail.review.selected_source] = detail.review.corrected_text;
    }
    state.editorSource = source;
    state.dirty = false;

    const summary = detail.summary;
    elements["task-meta"].textContent = `${summary.sample_id} · ${summary.era} · PDF page ${summary.pdf_page}`;
    elements["position-label"].textContent = `${index + 1} / ${state.tasks.length}`;
    elements["document-label"].textContent = `${summary.gold_id || summary.sample_id} · PDF page ${summary.pdf_page}`;
    elements["document-status"].textContent = statusLabel(summary.status);
    elements["pdf-link"].href = detail.task.pdf_url;
    elements["page-image"].src = `${detail.image_url}?dpi=144`;
    elements["previous-task"].disabled = index === 0;
    elements["next-task"].disabled = index === state.tasks.length - 1;

    renderCandidateTabs();
    renderCandidate();
    renderSourceControl(source);
    elements["ground-truth"].value = state.editorTexts[source] || "";
    elements["review-notes"].value = detail.review?.notes || "";
    setChecks(detail.review);
    elements["save-state"].textContent = detail.review ? "Saved" : "Not saved";
    renderTaskList();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function refreshTasks() {
  const payload = await request("/api/tasks");
  state.tasks = payload.tasks;
  state.counts = payload.counts;
  renderProgress();
  renderTaskList();
}

async function saveReview() {
  const source = document.querySelector('input[name="selected-source"]:checked')?.value || "manual";
  const checks = Object.fromEntries([...document.querySelectorAll("[data-check]")].map((input) => [input.dataset.check, input.checked]));
  const payload = {
    selected_source: source,
    corrected_text: elements["ground-truth"].value,
    checks,
    verified: elements.verified.checked,
    notes: elements["review-notes"].value,
  };
  elements["save-review"].disabled = true;
  try {
    await request(`/api/tasks/${state.current}/review`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload),
    });
    state.dirty = false;
    elements["save-state"].textContent = "Saved";
    showToast("Review saved");
    await refreshTasks();
    await loadTask(state.current, true);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements["save-review"].disabled = false;
  }
}

elements["previous-task"].addEventListener("click", () => loadTask(state.current - 1));
elements["next-task"].addEventListener("click", () => loadTask(state.current + 1));
elements["status-filter"].addEventListener("change", renderTaskList);
elements["zoom-out"].addEventListener("click", () => { state.zoom = Math.max(50, state.zoom - 25); updateZoom(); });
elements["zoom-in"].addEventListener("click", () => { state.zoom = Math.min(200, state.zoom + 25); updateZoom(); });
elements["use-candidate"].addEventListener("click", () => {
  const candidate = state.candidates[state.activeCandidate];
  if (!candidate || candidate.error) return;
  state.editorTexts[state.editorSource] = elements["ground-truth"].value;
  state.editorSource = candidate.source;
  state.editorTexts[candidate.source] = candidate.text;
  elements["ground-truth"].value = candidate.text;
  renderSourceControl(candidate.source);
  markDirty();
});
elements["ground-truth"].addEventListener("input", () => {
  state.editorTexts[state.editorSource] = elements["ground-truth"].value;
  markDirty();
});
elements["review-notes"].addEventListener("input", markDirty);
elements.verified.addEventListener("change", markDirty);
document.querySelectorAll("[data-check]").forEach((input) => input.addEventListener("change", markDirty));
elements["save-review"].addEventListener("click", saveReview);
window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  event.preventDefault();
});

updateZoom();
refreshTasks().then(() => {
  if (state.tasks.length) loadTask(0, true);
}).catch((error) => showToast(error.message, true));
