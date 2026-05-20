/**
 * toast.js — lightweight toast notifications
 * @param {string} message
 * @param {'success'|'error'|'warn'|'info'} [type]
 * @param {number}  [ms]
 */
export function toast(message, type = 'info', ms = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 260);
  }, ms);
}
