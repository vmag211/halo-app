"use client";

import { useLayoutEffect, useRef } from "react";
import { copy } from "@/lib/frontend/copy";
import {
  penBounds,
  penLength,
  penStrokes,
  subtitleFadeStart,
  welcomeAnimationEnd,
  welcomeTiming,
} from "./lettering";

/** The approved pen-stroke lettering, not an outline trace or horizontal wipe. */
export default function WelcomeTitle({ animate = true, stackedSubtitle = false }: { animate?: boolean; stackedSubtitle?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const heading = headingRef.current;
    const subtitle = subtitleRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !heading || !subtitle || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const appearance = window.matchMedia("(prefers-color-scheme: dark)");
    let frame = 0;
    let start: number | null = null;
    let elapsed = 0;
    let disposed = false;

    function paint(time: number) {
      if (!canvas || !context || !heading || !subtitle || disposed) return;
      elapsed = time;
      const box = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      if (!box.width) return;
      const width = Math.round(box.width * ratio);
      const height = Math.round(box.height * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, box.width, box.height);
      const scale = (box.width - 16) / (penBounds.right - penBounds.left);
      context.translate(
        (box.width - (penBounds.right - penBounds.left) * scale) / 2 - penBounds.left * scale,
        (box.height - (penBounds.bottom - penBounds.top) * scale) / 2 - penBounds.top * scale,
      );
      context.scale(scale, scale);
      context.strokeStyle = getComputedStyle(canvas).color;
      context.lineWidth = 51;
      context.lineCap = "round";
      context.lineJoin = "round";
      let cursor = welcomeTiming.lead;
      penStrokes.forEach((stroke) => {
        const duration = welcomeTiming.duration * stroke.length / penLength;
        const fraction = Math.max(0, Math.min(1, (time - cursor) / duration));
        cursor += duration + welcomeTiming.pause;
        if (!fraction) return;
        const limit = stroke.length * fraction;
        context.beginPath();
        context.moveTo(stroke.samples[0].x, stroke.samples[0].y);
        for (let i = 1; i < stroke.samples.length; i++) {
          const point = stroke.samples[i];
          const previous = stroke.samples[i - 1];
          if (point.distance <= limit) context.lineTo(point.x, point.y);
          else {
            const progress = (limit - previous.distance) / (point.distance - previous.distance);
            context.lineTo(
              previous.x + (point.x - previous.x) * progress,
              previous.y + (point.y - previous.y) * progress,
            );
            break;
          }
        }
        context.stroke();
      });
      const status = time >= welcomeTiming.total ? "complete" : "writing";
      canvas.dataset.writing = status;
      heading.dataset.drawing = status;
      subtitle.style.opacity = String(Math.max(0, Math.min(1,
        (time - subtitleFadeStart) / welcomeTiming.fadeDuration,
      )));
    }

    function tick(now: number) {
      if (disposed || !canvas?.isConnected) return;
      if (start === null) start = now;
      paint(Math.min(now - start, welcomeAnimationEnd));
      if (now - start < welcomeAnimationEnd) frame = requestAnimationFrame(tick);
    }
    function repaint() { paint(elapsed); }
    function motionChanged() {
      if (reducedMotion.matches) {
        cancelAnimationFrame(frame);
        paint(welcomeAnimationEnd);
      }
    }

    paint(animate && !reducedMotion.matches ? 0 : welcomeAnimationEnd);
    if (animate && !reducedMotion.matches) frame = requestAnimationFrame(tick);
    const resizeObserver = new ResizeObserver(repaint);
    resizeObserver.observe(canvas);
    // Theme changes may be applied to any ancestor without resizing the canvas.
    const themeObserver = new MutationObserver(repaint);
    let ancestor: HTMLElement | null = heading.parentElement;
    while (ancestor) {
      themeObserver.observe(ancestor, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme", "data-appearance"],
      });
      ancestor = ancestor.parentElement;
    }
    reducedMotion.addEventListener("change", motionChanged);
    appearance.addEventListener("change", repaint);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      reducedMotion.removeEventListener("change", motionChanged);
      appearance.removeEventListener("change", repaint);
    };
  }, [animate]);

  return (
    <>
      <h1 ref={headingRef} className="halo-wordmark" aria-label={copy.welcome.title}>
        <canvas ref={canvasRef} width={882} height={288} aria-hidden="true">{copy.welcome.title}</canvas>
      </h1>
      <h2 ref={subtitleRef} className="halo-welcome-subtitle">{stackedSubtitle ? <><span>{copy.welcome.subtitleTo}</span>{' '}<span>{copy.welcome.subtitleBrand}</span></> : copy.welcome.subtitle}</h2>
    </>
  );
}
