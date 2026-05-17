/**
 * Non-intrusive toast notifications.
 * @param {string} message
 * @param {'ok'|'err'|'info'} [type]
 * @param {number}            [ms]
 */
export function toast(message, type = 'info', ms = 3500) {
  const container = document.getElementById('toasts');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);

  setTimeout(() => {
    el.style.animation = 'toast-out .3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, ms);
}
