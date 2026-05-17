/**
 * node-palette.js
 * Sets up drag-and-drop from palette items to the canvas.
 */

export function initNodePalette() {
  document.querySelectorAll('.palette-item[draggable]').forEach((item) => {
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('nc-kind', item.dataset.kind);
      e.dataTransfer.effectAllowed = 'copy';
    });
  });
}
