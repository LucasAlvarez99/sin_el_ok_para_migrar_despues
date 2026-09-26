import * as session from '../lib/session.js';
import { supabase } from '../lib/supabase.js';
import { adminDeleteClass, adminListClasses, adminSyncVideo, adminUpdateClass } from '../lib/api.js';
import { messageFor } from '../lib/errors.js';
import { levelLabel, formatDate } from '../lib/format.js';
import { el, icon, mount } from '../lib/dom.js';
import { boot } from '../ui/boot.js';
import { openAuth } from '../ui/auth-modal.js';
import { openClassForm } from '../ui/class-form-modal.js';
import { toast } from '../ui/toast.js';
import { emptyState, errorState, skeletonGrid } from '../ui/states.js';

/**
 * Panel de negocio (Fase 5): catálogo completo (publicadas y sin publicar), crear clase y subir
 * su video, reintentar una subida interrumpida, actualizar el estado del video a mano y borrar.
 * El permiso real lo decide la base (RLS + privilegio por columna); esto solo ordena la interfaz.
 *
 * Pendiente para más adelante: editar metadatos de una clase ya creada, borrado lógico (hoy
 * adminDeleteClass borra físico, ver docs/AUDITORIA-Y-PLAN.md punto 9), usuarios y entitlements.
 */
const root = document.getElementById('panel');
let classes = [];

const VIDEO_STATUS_LABELS = {
  pending: 'Pendiente', uploading: 'Subiendo', processing: 'Procesando', ready: 'Lista', failed: 'Con error',
};
const VIDEO_STATUS_BADGE = {
  pending: 'text-bg-secondary', uploading: 'text-bg-info', processing: 'text-bg-info',
  ready: 'text-bg-success', failed: 'text-bg-danger',
};
const NEEDS_VIDEO = new Set(['pending', 'uploading', 'failed']);

function statusBadge(status) {
  return el('span', { class: `badge ${VIDEO_STATUS_BADGE[status] || 'text-bg-secondary'}` }, VIDEO_STATUS_LABELS[status] || status);
}

async function togglePublish(row, btn) {
  const next = !row.is_published;
  btn.disabled = true;
  try {
    const updated = await adminUpdateClass(row.id, { is_published: next });
    Object.assign(row, updated);
    toast(next ? 'Clase publicada.' : 'Clase despublicada.', { type: 'success' });
    renderTable();
  } catch (err) {
    toast(messageFor(err), { type: 'error' });
    btn.disabled = false;
  }
}

async function refreshStatus(row, btn) {
  btn.disabled = true;
  try {
    const { class: updated } = await adminSyncVideo(row.id);
    Object.assign(row, updated);
    renderTable();
  } catch (err) {
    toast(messageFor(err), { type: 'error' });
    btn.disabled = false;
  }
}

async function removeClass(row) {
  if (!confirm(`¿Eliminar "${row.title}"? Esto borra la clase y su video, y no se puede deshacer.`)) return;
  try {
    await adminDeleteClass(row.id);
    classes = classes.filter((c) => c.id !== row.id);
    toast('Clase eliminada.', { type: 'success' });
    renderTable();
  } catch (err) {
    toast(messageFor(err), { type: 'error' });
  }
}

async function retryUpload(row) {
  if (await openClassForm({ mode: 'retry', row })) loadClasses();
}

function classRow(row) {
  const canPublish = row.is_published || row.video_status === 'ready';
  const actions = [
    el('button', {
      type: 'button',
      class: `btn btn-sm ${row.is_published ? 'btn-outline-secondary' : 'btn-outline-brand'}`,
      disabled: !canPublish,
      title: canPublish ? '' : 'El video todavía no está listo.',
      onclick: (e) => togglePublish(row, e.currentTarget),
    }, row.is_published ? 'Despublicar' : 'Publicar'),
  ];
  if (NEEDS_VIDEO.has(row.video_status)) {
    actions.push(el('button', {
      type: 'button', class: 'btn btn-sm btn-outline-brand',
      onclick: () => retryUpload(row),
    }, row.video_status === 'failed' ? 'Reintentar video' : 'Subir video'));
  }
  if (row.video_status === 'processing' || row.video_status === 'uploading') {
    actions.push(el('button', {
      type: 'button', class: 'btn btn-sm btn-outline-secondary', title: 'Consultar a R2 el estado actual',
      onclick: (e) => refreshStatus(row, e.currentTarget),
    }, icon('arrow-repeat')));
  }
  actions.push(el('button', {
    type: 'button', class: 'btn btn-sm btn-outline-danger', title: 'Eliminar',
    onclick: () => removeClass(row),
  }, icon('trash')));

  return el('tr', {},
    el('td', {}, el('strong', {}, row.title), row.category ? el('div', { class: 'text-muted small' }, row.category) : null),
    el('td', {}, levelLabel(row.level)),
    el('td', {}, statusBadge(row.video_status)),
    el('td', {}, el('span', { class: `badge ${row.is_published ? 'text-bg-success' : 'text-bg-secondary'}` }, row.is_published ? 'Publicada' : 'Sin publicar')),
    el('td', { class: 'text-muted small' }, formatDate(row.updated_at)),
    el('td', { class: 'text-end' }, el('div', { class: 'd-flex gap-1 justify-content-end flex-wrap' }, ...actions)));
}

function newClassButton() {
  return el('button', {
    type: 'button', class: 'btn btn-brand mb-3',
    onclick: async () => { if (await openClassForm({ mode: 'create' })) loadClasses(); },
  }, icon('plus-lg'), ' Nueva clase');
}

function renderTable() {
  if (classes.length === 0) {
    return mount(root, newClassButton(), emptyState('Todavía no hay clases', 'Creá la primera con el botón de arriba.'));
  }
  const scrollHint = el('p', { class: 'table-scroll-hint', hidden: true }, icon('arrow-left-right'), ' Desliza para ver más');
  const wrap = el('div', { class: 'table-responsive' },
    el('table', { class: 'table align-middle' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Clase'), el('th', {}, 'Nivel'), el('th', {}, 'Video'), el('th', {}, 'Estado'),
        el('th', {}, 'Actualizada'), el('th', { class: 'text-end' }, ''))),
      el('tbody', {}, ...classes.map(classRow))));
  mount(root, newClassButton(), scrollHint, wrap);

  // Aviso de scroll horizontal SOLO si la tabla no entra completa; desaparece en cuanto se usa.
  const syncHint = () => { scrollHint.hidden = wrap.scrollWidth <= wrap.clientWidth + 1; };
  syncHint();
  window.addEventListener('resize', syncHint);
  wrap.addEventListener('scroll', () => { scrollHint.hidden = true; }, { once: true });
}

async function loadClasses() {
  mount(root, skeletonGrid(4));
  try {
    classes = await adminListClasses();
  } catch (err) {
    return mount(root, errorState(messageFor(err), loadClasses));
  }
  renderTable();
}

function render() {
  if (!supabase) return mount(root, emptyState('Panel no disponible', 'Falta configurar la conexión con Supabase (js/config.js).'));
  const { user } = session.getState();
  if (!user) {
    return mount(root, emptyState('Iniciá sesión para ver el panel', '',
      el('button', { type: 'button', class: 'btn btn-brand', onclick: () => openAuth() }, 'Iniciar sesión')));
  }
  if (!session.isOwner()) {
    return mount(root, emptyState('Acceso restringido', 'Esta sección es solo para el equipo de gestión.'));
  }
  loadClasses();
}

await boot('panel');
session.onChange((_s, event) => { if (event !== 'SESSION_REFRESHED') render(); });
render();
