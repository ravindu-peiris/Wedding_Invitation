const login = document.querySelector('#admin-login');
const keyInput = document.querySelector('#access-key');
const message = document.querySelector('#admin-message');
const dashboard = document.querySelector('#dashboard');
const accessCard = document.querySelector('#access-card');
let accessKey = sessionStorage.getItem('rsvp-admin-key') || '';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderGuests(guests) {
  const tbody = document.querySelector('#guest-rows');
  const empty = document.querySelector('#guest-table-empty');
  if (!guests?.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  tbody.innerHTML = guests.map(guest => `
    <tr>
      <td data-label="Guest name">${escapeHtml(guest.name)}</td>
      <td data-label="Count">${guest.attendance === 'yes' ? guest.guestCount : '—'}</td>
      <td data-label="Response"><span class="status ${guest.attendance}">${guest.attendance === 'yes' ? 'Accept' : 'Decline'}</span></td>
    </tr>
  `).join('');
}

async function loadCounts(key) {
  message.textContent = 'Loading the RSVP summary…';
  try {
    const response = await fetch('/api/rsvp/count', { headers: { 'x-admin-token': key }, cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load the RSVP summary.');
    document.querySelector('#confirmed-guests').textContent = result.confirmedGuests;
    document.querySelector('#total-responses').textContent = result.totalResponses;
    document.querySelector('#accepted-responses').textContent = result.acceptedResponses;
    document.querySelector('#declined-responses').textContent = result.declinedResponses;
    document.querySelector('#updated-at').textContent = `Updated ${new Date(result.updatedAt).toLocaleString()}`;
    renderGuests(result.guests);
    dashboard.classList.remove('hidden');
    accessCard.hidden = true;
    message.textContent = '';
    return true;
  } catch (error) {
    dashboard.classList.add('hidden');
    accessCard.hidden = false;
    message.textContent = error.message;
    if (error.message.includes('access key')) {
      sessionStorage.removeItem('rsvp-admin-key');
      accessKey = '';
    }
    return false;
  }
}

login.addEventListener('submit', async event => {
  event.preventDefault();
  accessKey = keyInput.value;
  sessionStorage.setItem('rsvp-admin-key', accessKey);
  await loadCounts(accessKey);
});
document.querySelector('#refresh-count').addEventListener('click', () => loadCounts(accessKey));
document.querySelector('#logout').addEventListener('click', () => {
  sessionStorage.removeItem('rsvp-admin-key');
  accessKey = '';
  dashboard.classList.add('hidden');
  accessCard.hidden = false;
  keyInput.value = '';
  keyInput.focus();
});
if (accessKey) loadCounts(accessKey);
window.setInterval(() => { if (accessKey && !document.hidden) loadCounts(accessKey); }, 30_000);
