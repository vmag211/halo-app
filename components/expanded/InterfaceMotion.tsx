'use client';

import { useEffect, useRef } from 'react';
import { useSceneExperience } from '@/components/foundation/SceneExperience';
import './interface-motion.css';

/** A small choreography vocabulary, not a blanket animation on every DOM node. */
const surfaces = [
  '[data-motion-surface]',
  '.mw-welcome', '.mw-calendar', '.mw-agenda', '.mw-dashboard-tools', '.mw-shelf',
  '.mw-next-panel', '.mw-review-panel', '.mw-overview', '.mw-home-pulse', '.mw-home-utilities',
  '.mw-workspace > .mw-intro', '.mw-workspace > .mw-form', '.mw-pattern-grid',
  '.mw-workspace > .mw-focus', '.mw-workspace > .mw-week-pulse',
  '.hg-intro', '.hg-content > section', '.hg-content > .hg-form',
  '.hg-content > .hg-grid', '.hg-content > .hg-stack', '.halo-home-workspace',
  '.ex-workbench-header', '.ex-fieldwork-layout > section', '.ex-fieldwork-layout > div',
  '.ex-map-entry', '.ex-community-bridge', '.halo-explore > .ex-detail',
  '.halo-explore > .ex-form', '.halo-explore > .ex-notebook',
  '.hp-settings-group', '.hp-panel-heading', '.halo-settings > .hp-panel-content',
  '.halo-f-accordion-body', '.halo-f-card-detail',
  '.halo-family-hero', '.halo-home-member-hero', '.halo-ph-detail-intro',
  '.halo-map-top', '.halo-map-utility', '.halo-map-bottom', '.halo-map-fallback',
  '.halo-map-district',
].join(',');
const overlays = '.halo-f-sheet[open], .halo-date-popover';
const excluded = '.halo-reveal, .halo-env, .mw-ambience, .halo-map-canvas-host, .halo-map-viewport, [data-motion="off"], [aria-live], [role="log"], [role="status"], [role="alert"], .halo-luna, .lc-messages';
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
    const visible = (element: HTMLElement) => !element.closest('[hidden], [inert], details:not([open])') && element.getClientRects().length > 0;
    const play = (element: HTMLElement, index = 0, reveal = false) => {
      if (!canMove() || !element.isConnected || !visible(element)) return;
      if (element.closest(excluded)) return;
      if (!reveal && seen.has(element)) return;
      seen.add(element);
      finish(element);
      // A focused field stays completely stationary. Sheet auto-focus is preserved.
      const focused = element.contains(document.activeElement);
      const sheet = element.matches(overlays);
      const lift = focused ? 0 : sheet ? 14 : reveal ? 6 : 10;
      element.dataset.interfaceManaged = 'true';
      element.dataset.interfaceEntering = sheet ? 'sheet' : reveal ? 'disclosure' : 'surface';
      const animation = element.animate([
        { opacity: .64, transform: `translate3d(0,${lift}px,0)` },
        { opacity: 1, transform: 'translate3d(0,0,0)' },
      ], { duration: sheet ? 320 : reveal ? 220 : 340, delay: Math.min(index, 3) * 20, easing: 'cubic-bezier(.2,.75,.2,1)', fill: 'none' });
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
    }, { threshold: .06, rootMargin: '0px 0px -12px 0px' });

    const register = (element: HTMLElement) => {
      if (element.closest(excluded)) return;
      if (element.matches(overlays)) { play(element, 0, true); return; }
      if (seen.has(element) || waiting.has(element)) return;
      if (element.closest('dialog, [popover], details:not([open])')) return;
      // One moving level only. Existing approved Reveal sections keep their motion.
      const parent = element.parentElement?.closest(surfaces);
      if (parent && root.contains(parent)) return;
      waiting.add(element);
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
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof HTMLDialogElement && record.target.open) pending.add(record.target);
        for (const node of record.addedNodes) if (node instanceof HTMLElement) pending.add(node);
      }
      if (!frame) frame = requestAnimationFrame(flush);
    });
    const toggle = (event: Event) => {
      const detail = event.target;
      if (!(detail instanceof HTMLDetailsElement)) return;
      if (!detail.open) { for (const node of active.keys()) if (detail.contains(node)) finish(node); return; }
      let index = 0;
      // Reveal the immediate content, not the summary or every nested text span.
      for (const child of detail.children) if (child instanceof HTMLElement && !child.matches('summary, style, script') && index < 4) play(child, index++, true);
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
          if (rect.top < innerHeight && rect.bottom > 0 && visible(node)) { seen.add(node); intersection.unobserve(node); waiting.delete(node); }
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
