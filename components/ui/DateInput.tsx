'use client';

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { calendarDateAllowed, calendarDateLabel, calendarMonthDays, clampCalendarDate, localCalendarToday, parseCalendarDate, shiftCalendarDay, shiftCalendarMonth } from '@/lib/frontend/date-input';
import './date-input.css';

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'min' | 'max'> & {
  min?: string;
  max?: string;
  /** Date-only Today anchor for an explicitly selected app timezone. Invalid anchors fall back to the device day. */
  todayDate?: string;
  /** Optional field context for a distinct calendar button, such as "Project date". */
  calendarLabel?: string;
};

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** ISO-valued, manually editable field with HALO's keyboard-accessible calendar. */
const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput({ value, defaultValue, onChange, onKeyDown, className = '', calendarLabel = 'date', todayDate, min, max, required, disabled, readOnly, ...props }, forwardedRef) {
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(true);
  const [ownValue, setOwnValue] = useState(String(defaultValue ?? ''));
  const selected = String(value ?? ownValue);
  const [open, setOpen] = useState(false);
  const [portalHost, setPortalHost] = useState<Element | null>(null);
  const [focusedDay, setFocusedDay] = useState('');
  const [month, setMonth] = useState('');
  const uid = useId().replace(/:/g, '');
  const popupId = `halo-date-${uid}`;
  const today = todayDate && parseCalendarDate(todayDate) ? todayDate : localCalendarToday();
  const days = calendarMonthDays(month);
  const shown = parseCalendarDate(month);
  const minYear = parseCalendarDate(min ?? '')?.getUTCFullYear() ?? 1900;
  const maxYear = parseCalendarDate(max ?? '')?.getUTCFullYear() ?? 2100;
  const shownYear = shown?.getUTCFullYear() ?? Number(today.slice(0, 4));
  const years = Array.from({ length: Math.max(0, Math.max(maxYear, shownYear) - Math.min(minYear, shownYear) + 1) }, (_, i) => Math.min(minYear, shownYear) + i);

  useImperativeHandle(forwardedRef, () => input.current!, []);

  const close = useCallback((restore = true) => {
    restoreFocus.current = restore;
    setOpen(false);
  }, []);

  function showCalendar() {
    if (disabled || readOnly || !input.current) return;
    const start = clampCalendarDate(parseCalendarDate(selected) ? selected : today, min, max);
    setFocusedDay(start);
    setMonth(`${start.slice(0, 7)}-01`);
    setPortalHost(input.current.closest('dialog') ?? input.current.closest('.halo-f-app') ?? document.body);
    restoreFocus.current = true;
    setOpen(true);
  }

  function choose(next: string) {
    if (next && !calendarDateAllowed(next, min, max)) return;
    const element = input.current;
    if (!element) return;
    // Use the native setter so React receives the same input/change events as manual entry.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    setOwnValue(next);
    close();
  }

  function change(event: ChangeEvent<HTMLInputElement>) {
    setOwnValue(event.target.value);
    onChange?.(event);
  }

  function moveFocus(next: string) {
    const bounded = clampCalendarDate(next, min, max);
    setFocusedDay(bounded);
    setMonth(`${bounded.slice(0, 7)}-01`);
  }

  function browseMonth(amount: number) {
    moveFocus(shiftCalendarMonth(focusedDay || month, amount));
  }

  function dayKey(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    const date = parseCalendarDate(day)!;
    let next: string;
    if (event.key === 'ArrowRight') next = shiftCalendarDay(day, 1);
    else if (event.key === 'ArrowLeft') next = shiftCalendarDay(day, -1);
    else if (event.key === 'ArrowDown') next = shiftCalendarDay(day, 7);
    else if (event.key === 'ArrowUp') next = shiftCalendarDay(day, -7);
    else if (event.key === 'Home') next = shiftCalendarDay(day, -(date.getUTCDay() + 6) % 7);
    else if (event.key === 'End') next = shiftCalendarDay(day, 6 - (date.getUTCDay() + 6) % 7);
    else if (event.key === 'PageUp') next = shiftCalendarMonth(day, event.shiftKey ? -12 : -1);
    else if (event.key === 'PageDown') next = shiftCalendarMonth(day, event.shiftKey ? 12 : 1);
    else return;
    event.preventDefault();
    event.stopPropagation();
    moveFocus(next);
  }

  useLayoutEffect(() => {
    if (!open || !popup.current || !input.current) return;
    const element = popup.current;
    // Popover top-layer positioning also works inside HALO's modal task sheets.
    if (typeof element.showPopover === 'function' && !element.matches(':popover-open')) element.showPopover();
    const position = () => {
      const anchor = input.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(324, window.innerWidth - 24);
      element.style.width = `${width}px`;
      const height = element.getBoundingClientRect().height;
      const below = anchor.bottom + 8;
      const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, Math.min(anchor.top - height - 8, window.innerHeight - height - 12));
      element.style.left = `${Math.min(Math.max(12, anchor.left), window.innerWidth - width - 12)}px`;
      element.style.top = `${top}px`;
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!element.contains(event.target) && !trigger.current?.contains(event.target) && !input.current?.contains(event.target)) close(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      document.removeEventListener('pointerdown', outside);
      if (typeof element.hidePopover === 'function' && element.matches(':popover-open')) element.hidePopover();
      if (restoreFocus.current && trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open) return;
    popup.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedDay}"]`)?.focus({ preventScroll: true });
  }, [open, focusedDay, month]);

  useEffect(() => {
    if ((disabled || readOnly) && open) close();
  }, [disabled, readOnly, open, close]);

  const calendar = open && portalHost && shown ? createPortal(<div ref={popup} id={popupId} className="halo-date-popover" popover="manual" role="dialog" aria-modal="false" aria-label="Choose a date" onClick={event => event.stopPropagation()} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab') {
      const controls = [...(popup.current?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), select:not(:disabled)') ?? [])];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <div className="halo-date-top">
      <span className="halo-date-eyebrow">Choose a date</span>
      <button type="button" className="halo-date-icon" aria-label="Close calendar" onClick={() => close()}><X size={17} aria-hidden="true" /></button>
    </div>
    <div className="halo-date-month">
      <button type="button" className="halo-date-icon" aria-label="Previous month" disabled={!!min && shiftCalendarMonth(month, -1).slice(0, 7) < min.slice(0, 7)} onClick={() => browseMonth(-1)}><ChevronLeft size={19} aria-hidden="true" /></button>
      <div className="halo-date-heading">
        <select aria-label="Calendar month" value={shown.getUTCMonth()} onChange={event => { const next = `${String(shownYear).padStart(4, '0')}-${String(Number(event.target.value) + 1).padStart(2, '0')}-01`; moveFocus(next); }}>
          {months.map((name, index) => <option key={name} value={index}>{name}</option>)}
        </select>
        <select aria-label="Calendar year" value={shownYear} onChange={event => moveFocus(shiftCalendarMonth(focusedDay, (Number(event.target.value) - shownYear) * 12))}>
          {years.map(year => <option value={year} key={year}>{year}</option>)}
        </select>
      </div>
      <button type="button" className="halo-date-icon" aria-label="Next month" disabled={!!max && shiftCalendarMonth(month, 1).slice(0, 7) > max.slice(0, 7)} onClick={() => browseMonth(1)}><ChevronRight size={19} aria-hidden="true" /></button>
    </div>
    <div className="halo-date-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
    <div className="halo-date-grid" role="grid" aria-label={`${months[shown.getUTCMonth()]} ${shownYear}`}>
      {Array.from({ length: 6 }, (_, row) => <div role="row" className="halo-date-row" key={row}>{days.slice(row * 7, row * 7 + 7).map(day => <span role="gridcell" key={day} aria-selected={day === selected}><button type="button" data-date={day} data-outside={day.slice(0, 7) !== month.slice(0, 7)} aria-label={`${calendarDateLabel(day)}${day === today ? ', today' : ''}`} aria-pressed={day === selected} aria-current={day === today ? 'date' : undefined} disabled={!calendarDateAllowed(day, min, max)} tabIndex={day === focusedDay ? 0 : -1} onClick={() => choose(day)} onKeyDown={event => dayKey(event, day)}>{Number(day.slice(-2))}</button></span>)}</div>)}
    </div>
    <div className="halo-date-foot"><button type="button" className="halo-date-text" disabled={!calendarDateAllowed(today, min, max)} onClick={() => choose(today)}>Today</button>{!required && <button type="button" className="halo-date-text" onClick={() => choose('')}>Clear date</button>}</div>
    <span className="halo-date-sr">Arrow keys move between days. Page Up and Page Down change the month. Escape closes the calendar.</span>
  </div>, portalHost) : null;

  return <span className="halo-date" data-disabled={disabled || readOnly || undefined}>
    <input {...props} ref={input} type="date" className={`halo-date-input ${className}`} value={selected} min={min} max={max} required={required} disabled={disabled} readOnly={readOnly} onChange={change} onKeyDown={event => { onKeyDown?.(event); if (!event.defaultPrevented && event.altKey && event.key === 'ArrowDown') { event.preventDefault(); showCalendar(); } }} />
    <button ref={trigger} type="button" className="halo-date-trigger" disabled={disabled || readOnly} aria-label={`Choose ${calendarLabel}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popupId : undefined} onClick={event => { event.preventDefault(); if (open) close(); else showCalendar(); }}><CalendarDays size={19} strokeWidth={1.7} aria-hidden="true" /></button>
    {calendar}
  </span>;
});

export default DateInput;
