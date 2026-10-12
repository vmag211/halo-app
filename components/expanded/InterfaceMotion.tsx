'use client';

import { useEffect, useRef } from 'react';
import { useSceneExperience } from '@/components/foundation/SceneExperience';
import './interface-motion.css';

/** Reading sections and useful groups, never an entire long feature or each text node. */
const surfaces = [
  '[data-motion-surface]',
  '.mw-welcome', '.mw-calendar', '.mw-agenda', '.mw-dashboard-tools', '.mw-shelf',
  '.mw-agenda-day', '.mw-shelf > .mw-task', '.mw-connected-work', '.mw-week-details', '.mw-calendar-options',
  '.mw-next-panel', '.mw-review-panel', '.mw-overview', '.mw-home-pulse', '.mw-home-utilities',
  '.mw-workspace > .mw-intro', '.mw-workspace > .mw-form', '.mw-pattern-grid',
  '.mw-workspace > .mw-focus', '.mw-workspace > .mw-week-pulse',
  '.mw-workspace > section', '.mw-workspace > .mw-followup',
  '.hg-workspace-nav', '.hg-intro', '.hg-content section', '.hg-content .hg-card', '.hg-content .hg-form',
  '.hg-content .hg-grid', '.hg-content .hg-deletable-record', '.hg-content .hg-empty',
  '.halo-home-workspace', '.halo-home-household', '.how-module',
  '.halo-ph-introduction', '.halo-ph-family-link', '.halo-ph-sources', '.halo-ph-related', '.halo-expanded-section',
  '.ex-workbench-header', '.ex-fieldwork-layout > section', '.ex-fieldwork-layout > div',
  '.ex-map-entry', '.ex-community-bridge', '.ex-continuations',
  '.ex-detail > :is(section,article,form,details,nav)',
  '.ex-detail-photo', '.ex-community-lesson', '.ex-flow-section', '.ex-local-hero', '.ex-local-purpose',
  '.ex-local-practical', '.ex-local-prepare', '.ex-local-national', '.ex-local-route',
  '.ex-opportunity-card', '.ex-opportunity-programs', '.ex-generated-controls', '.ex-generated-item',
  '.ex-guide-cover', '.ex-guide-purpose', '.ex-guide-scan', '.ex-project-progress', '.ex-guide-sources',
  '.ex-guide-current-step', '.ex-guide-related', '.ex-notebook-toolbar', '.ex-notebook-filters',
  '.ex-notebook > .hg-deletable-record', '.ex-note-page', '.ex-note-fields', '.ex-outcome-status',
  '.halo-explore > .ex-form',
  '.hp-settings-group', '.hp-panel-heading',
  '.hp-panel-content > :is(section,fieldset,details,.hp-form-fields,.hp-toggle-group,.hp-appearance,.hp-about-brand,.hp-note)',
  '.hp-preference-block', '.hp-alert-item', '.hp-alert-toolbar',
  '.halo-f-accordion-body', '.halo-f-card-detail',
  '.halo-family-hero', '.halo-home-member-hero', '.halo-ph-detail-intro',
  '.halo-family-profile', '.halo-family-section-heading', '.halo-family-limits',
  '.halo-home-member-focus', '.halo-home-member-limits', '.halo-home-member-switch',
  '.halo-map-top', '.halo-map-utility', '.halo-map-bottom', '.halo-map-fallback',
  '.halo-map-district', '.halo-map-district-heading', '.halo-map-district-hero', '.halo-map-district-section',
].join(',');
const overlays = '.halo-f-sheet[open], .halo-date-popover';
const excluded = '.halo-env, .mw-ambience, .halo-map-canvas-host, .halo-map-viewport, [data-motion="off"], [aria-live], [role="log"], [role="status"], [role="alert"], .halo-luna, .lc-messages';
const interactive = 'button, a, input, textarea, select, summary';

/**
 * Progressive motion only: nothing starts hidden, waits for motion, or remounts.
 * Mount once within the expanded app and SceneProvider. The hidden anchor scopes
 * observers to that app, including its owned dialogs and date popovers.
 */
export default function InterfaceMotion() {
  const anchor = useRef<HTMLSpanElement>(null);
  const { enabled, deviceReduced, ready } = useSceneExperience();
  useEffect(() => {
    const root = anchor.current?.closest<HTMLElement>('.halo-f-app[data-refined="true"]');
    if (!root || !ready || !enabled || deviceReduced || typeof Element.prototype.animate !== 'function') return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const contrast = matchMedia('(forced-colors: active)');

    let disposed = false;
    let frame = 0;
    const seen = new WeakSet<Element>();
    const waiting = new Set<HTMLElement>();
    const active = new Map<HTMLElement, Animation>();
    const pending = new Set<HTMLElement>();
    const canMove = () => !disposed && !document.hidden && !reduce.matches && !contrast.matches;
    const finish = (element: HTMLElement) => {
      const animation = active.get(element);
      if (!animation) return;
      animation.cancel();
      active.delete(element);
      element.removeAttribute('data-interface-entering');
      intersection.unobserve(element);
    };
    const visible = (element: HTMLElement) => !element.closest('[hidden], [inert]')
      && !element.parentElement?.closest('details:not([open])') && element.getClientRects().length > 0;
    const play = (element: HTMLElement, index = 0, reveal = false) => {
      if (!canMove() || !element.isConnected || !visible(element)) return;
      if (element.closest(excluded)) return;
      // Existing Today/household Reveals own their entrances, not later disclosure openings.
      if (!reveal && element.closest('.halo-reveal')) return;
      if (!reveal && seen.has(element)) return;
      seen.add(element);
      element.removeAttribute('data-interface-pending');
      finish(element);
      // A focused field stays completely stationary. Sheet auto-focus is preserved.
      const focused = element.contains(document.activeElement);
      const sheet = element.matches(overlays);
      const lift = focused ? 0 : sheet ? 18 : reveal ? 12 : 22;
      element.dataset.interfaceManaged = 'true';
      // Focus can scroll a waiting section into view before its observer fires.
      // Do not start even an opacity entrance underneath an active editor.
      if (focused && document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) {
        intersection.unobserve(element);
        return;
      }
      element.dataset.interfaceEntering = sheet ? 'sheet' : reveal ? 'disclosure' : 'surface';
      const animation = element.animate([
        { opacity: focused ? .8 : .16, transform: `translate3d(0,${lift}px,0)` },
        { opacity: 1, transform: 'translate3d(0,0,0)' },
      ], { duration: sheet ? 380 : reveal ? 360 : 580, delay: Math.min(index, 3) * 45, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
      active.set(element, animation);
      animation.onfinish = () => finish(element);
      animation.oncancel = () => {
        if (active.get(element) === animation) {
          active.delete(element);
          element.removeAttribute('data-interface-entering');
          intersection.unobserve(element);
        }
      };
    };
    const intersection = new IntersectionObserver(entries => {
      let index = 0;
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          if (!canMove()) continue;
          waiting.delete(element);
          play(element, index++);
        } else finish(element);
      }
    }, { threshold: .06, rootMargin: '0px 0px -28px 0px' });

    const compact = (element: HTMLElement) => element.getBoundingClientRect().height < innerHeight * .86;
    const isSurface = (element: HTMLElement) => {
      if (element.closest(excluded) || element.closest('.halo-reveal')) return false;
      // Tall calendars, workspaces and lists must not consume their descendants'
      // scroll entrances merely because the top of the container entered view.
      if (!compact(element) && element.querySelector(surfaces)) return false;
      let parent = element.parentElement?.closest<HTMLElement>(surfaces);
      while (parent && root.contains(parent)) {
        if (compact(parent) && !parent.closest('.halo-reveal')) return false;
        parent = parent.parentElement?.closest<HTMLElement>(surfaces);
      }
      return true;
    };

    const register = (element: HTMLElement) => {
      if (element.closest(excluded)) return;
      if (element.matches(overlays)) { play(element, 0, true); return; }
      if (seen.has(element) || waiting.has(element)) return;
      if (element.parentElement?.closest('details:not([open])')) return;
      if (!isSurface(element)) return;
      // The sheet itself handles its first screenful. Its below-fold sections
      // still get independent entrances as the sheet is scrolled.
      const overlay = element.parentElement?.closest<HTMLElement>(overlays);
      if (overlay && active.has(overlay)) {
        const rect = element.getBoundingClientRect();
        const frame = overlay.getBoundingClientRect();
        if (rect.top < Math.min(frame.bottom, innerHeight) && rect.bottom > Math.max(frame.top, 0)) {
          seen.add(element);
          return;
        }
      }
      waiting.add(element);
      element.dataset.interfacePending = 'true';
      intersection.observe(element);
    };
    const scan = (node: HTMLElement) => {
      if (node.matches(`${surfaces},${overlays}`)) register(node);
      node.querySelectorAll<HTMLElement>(`${surfaces},${overlays}`).forEach(register);
    };
    const flush = () => {
      frame = 0;
      for (const node of pending) if (node.isConnected) scan(node);
      pending.clear();
      for (const node of waiting) if (!node.isConnected) { intersection.unobserve(node); waiting.delete(node); }
      for (const node of active.keys()) if (!node.isConnected) finish(node);
    };
    const mutation = new MutationObserver(records => {
      let removed = false;
      for (const record of records) {
        removed ||= record.removedNodes.length > 0;
        if (record.type === 'attributes' && record.target instanceof HTMLDialogElement && record.target.open) pending.add(record.target);
        for (const node of record.addedNodes) if (node instanceof HTMLElement && !node.closest(excluded)) pending.add(node);
      }
      if ((pending.size || removed) && !frame) frame = requestAnimationFrame(flush);
    });
    const toggle = (event: Event) => {
      const detail = event.target;
      if (!(detail instanceof HTMLDetailsElement)) return;
      if (!detail.open) { for (const node of active.keys()) if (detail.contains(node)) finish(node); return; }
      let index = 0;
      // A long expanded feature keeps its below-fold section entrances. Small
      // disclosure content dissolves together, not as a cascade of individual words.
      for (const child of detail.children) if (child instanceof HTMLElement && !child.matches('summary, style, script') && index < 4) {
        if (!compact(child) && child.querySelector(surfaces)) scan(child);
        else play(child, index++, true);
      }
    };
    const interact = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest(interactive)) return;
      for (const node of active.keys()) if (node.contains(event.target)) finish(node);
    };
    const preferenceChanged = () => {
      if (!canMove()) {
        for (const node of active.keys()) finish(node);
        root.removeAttribute('data-interface-motion');
      } else {
        root.dataset.interfaceMotion = 'on';
        // Do not replay content that became visible while the document was hidden.
        for (const node of waiting) {
          const rect = node.getBoundingClientRect();
          if (rect.top < innerHeight && rect.bottom > 0 && visible(node)) { seen.add(node); intersection.unobserve(node); waiting.delete(node); node.removeAttribute('data-interface-pending'); }
        }
      }
    };
    if (canMove()) root.dataset.interfaceMotion = 'on';
    scan(root);
    mutation.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    root.addEventListener('toggle', toggle, true);
    root.addEventListener('focusin', interact);
    root.addEventListener('pointerdown', interact, { passive: true });
    document.addEventListener('visibilitychange', preferenceChanged);
    reduce.addEventListener('change', preferenceChanged);
    contrast.addEventListener('change', preferenceChanged);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      mutation.disconnect(); intersection.disconnect();
      for (const node of active.keys()) finish(node);
      waiting.clear(); pending.clear();
      root.removeAttribute('data-interface-motion');
      root.querySelectorAll('[data-interface-managed]').forEach(node => node.removeAttribute('data-interface-managed'));
      root.querySelectorAll('[data-interface-pending]').forEach(node => node.removeAttribute('data-interface-pending'));
      root.removeEventListener('toggle', toggle, true);
      root.removeEventListener('focusin', interact);
      root.removeEventListener('pointerdown', interact);
      document.removeEventListener('visibilitychange', preferenceChanged);
      reduce.removeEventListener('change', preferenceChanged);
      contrast.removeEventListener('change', preferenceChanged);
    };
  }, [enabled, deviceReduced, ready]);
  return <span ref={anchor} hidden aria-hidden="true" data-interface-motion-anchor="" />;
}
