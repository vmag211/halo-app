/**
 * Approved Welcome glyph subset, preserved from the onboarding wireframe.
 * Source: https://github.com/techninja/hersheytextjs/blob/master/svg_fonts/HersheyScript1.svg
 * The Hershey Fonts were originally created by Dr. A. V. Hershey while working
 * at the U. S. National Bureau of Standards. The format of this font data was
 * originally created by James Hurt, Cognition, Inc., 900 Technology Park Drive,
 * Billerica, MA 01821 (mit-eddie!ci-dandelion!hurt). May be used for any purpose
 * with these acknowledgements. Do not convert to the U.S. NTIS eight-byte
 * "xxx yyy:" format. SVG conversion: Windell H. Oskay, 2019.
 */
type Point = [number, number];
type Glyph = { advance: number; strokes: Point[][] };
export type PenSample = { x: number; y: number; distance: number };

const scriptGlyphs: Glyph[] = [
  { advance:882, strokes:[[[189,441],[126,472],[94.5,536],[94.5,567],[126,630],[189,662],[220,662],[284,630],[315,567],[315,472],[284,0]],[[598,662],[284,0]],[[598,662],[536,0]],[[976,662],[914,630],[819,536],[724,410],[630,220],[536,0]]] },
  { advance:315, strokes:[[[63,63],[126,94.5],[158,126],[189,189],[189,252],[158,284],[126,284],[63,252],[31.5,189],[31.5,94.5],[63,31.5],[126,0],[189,0],[252,31.5],[284,63],[346,158]]] },
  { advance:252, strokes:[[[31.5,158],[94.5,252],[189,410],[220,472],[252,567],[252,630],[220,662],[158,630],[126,567],[94.5,441],[63,220],[63,31.5],[94.5,0],[126,0],[189,31.5],[220,63],[284,158]]] },
  { advance:346, strokes:[[[252,220],[252,252],[220,284],[158,284],[94.5,252],[63,220],[31.5,158],[31.5,94.5],[63,31.5],[126,0],[220,0],[315,63],[378,158]]] },
  { advance:441, strokes:[[[220,284],[158,284],[94.5,252],[63,220],[31.5,158],[31.5,94.5],[63,31.5],[126,0],[189,0],[252,31.5],[284,63],[315,126],[315,189],[284,252],[220,284],[189,252],[189,189],[220,126],[284,94.5],[378,94.5],[441,126],[472,158]]] },
  { advance:788, strokes:[[[31.5,158],[94.5,252],[158,284],[189,252],[189,220],[158,94.5],[126,0]],[[158,94.5],[189,158],[252,252],[315,284],[378,284],[410,252],[410,220],[378,94.5],[346,0]],[[378,94.5],[410,158],[472,252],[536,284],[598,284],[630,252],[630,189],[598,94.5],[598,31.5],[630,0],[662,0],[724,31.5],[756,63],[819,158]]] },
  { advance:315, strokes:[[[63,63],[126,94.5],[158,126],[189,189],[189,252],[158,284],[126,284],[63,252],[31.5,189],[31.5,94.5],[63,31.5],[126,0],[189,0],[252,31.5],[284,63],[346,158]]] },
];

function makePenStrokes() {
  let offset = 0;
  return scriptGlyphs.flatMap((glyph) => {
    const strokes = glyph.strokes.map((points) => {
      const samples: PenSample[] = [];
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];
        for (let step = 0; step < 16; step++) {
          const t = step / 16;
          const u = 1 - t;
          const point = [0, 1].map((axis) =>
            u * u * u * p1[axis] +
            3 * u * u * t * (p1[axis] + (p2[axis] - p0[axis]) * 0.14) +
            3 * u * t * t * (p2[axis] - (p3[axis] - p1[axis]) * 0.14) +
            t * t * t * p2[axis],
          );
          samples.push({ x: point[0] + offset, y: -point[1], distance: 0 });
        }
      }
      const last = points[points.length - 1];
      samples.push({ x: last[0] + offset, y: -last[1], distance: 0 });
      let length = 0;
      samples.forEach((point, i) => {
        if (i) length += Math.hypot(point.x - samples[i - 1].x, point.y - samples[i - 1].y);
        point.distance = length;
      });
      return { samples, length };
    });
    offset += glyph.advance;
    return strokes;
  });
}

export const penStrokes = makePenStrokes();
export const penLength = penStrokes.reduce((sum, stroke) => sum + stroke.length, 0);
const points = penStrokes.flatMap((stroke) => stroke.samples);
export const penBounds = {
  left: Math.min(...points.map((point) => point.x)),
  right: Math.max(...points.map((point) => point.x)),
  top: Math.min(...points.map((point) => point.y)),
  bottom: Math.max(...points.map((point) => point.y)),
};
export const welcomeTiming = {
  duration: 2600,
  pause: 30,
  lead: 180,
  total: 180 + 2600 + 30 * (penStrokes.length - 1),
  fadeDuration: 400,
};
export const subtitleFadeStart = welcomeTiming.total + 90;
export const welcomeAnimationEnd = subtitleFadeStart + welcomeTiming.fadeDuration;
