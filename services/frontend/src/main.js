const form      = document.getElementById('note-form');
const notesList = document.getElementById('notes-list');

// ── Helpers ──────────────────────────────────────────────────────────
function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function timeAgo(dateStr) {
  return new Date(dateStr).toLocaleString();
}

// ── Load notes ───────────────────────────────────────────────────────
async function loadNotes() {
  try {
    const res = await fetch('/api/notes');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const notes = await res.json();

    if (notes.length === 0) {
      notesList.innerHTML = '<p class="empty">No notes yet. Add one above.</p>';
      return;
    }

    notesList.innerHTML = notes
      .map(
        (n) => `
      <article class="note">
        <div class="note-header">
          <h3>${escapeHtml(n.title)}</h3>
          <button class="delete-btn" data-id="${n.id}" title="Delete">✕</button>
        </div>
        <p>${escapeHtml(n.content)}</p>
        <time>${timeAgo(n.created_at)}</time>
      </article>`
      )
      .join('');
  } catch (err) {
    notesList.innerHTML = '<p class="error">Could not load notes.</p>';
    console.error('loadNotes:', err);
  }
}

// ── Create note ──────────────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const title   = document.getElementById('title').value.trim();
  const content = document.getElementById('content').value.trim();
  if (!title || !content) return;

  try {
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    form.reset();
    await loadNotes();
  } catch (err) {
    console.error('createNote:', err);
  }
});

// ── Delete note (event delegation) ───────────────────────────────────
notesList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.delete-btn');
  if (!btn) return;

  const id = btn.dataset.id;
  try {
    await fetch(`/api/notes/${id}`, { method: 'DELETE' });
    await loadNotes();
  } catch (err) {
    console.error('deleteNote:', err);
  }
});

// ── Initial load ─────────────────────────────────────────────────────
loadNotes();
