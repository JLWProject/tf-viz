// Hand-rolled pan/zoom for the graph's single <g id="viewport"> element -
// deliberately not a library, this is small enough (~100 lines) to own
// outright and avoid a dependency for something this self-contained.
const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const WHEEL_ZOOM_INTENSITY = 0.0015;

export interface PanZoom {
  /** Re-fits the viewport so the whole graph is visible and centered. */
  reset(): void;
  /**
   * Current transform snapshot - lets a caller preserve the user's pan/zoom
   * framing across a full re-render (a fresh `<svg>`/`<g id="viewport">`
   * DOM, e.g. after a node drag changes layout - see main.ts's rerender()),
   * which would otherwise start fresh (identity transform) on every
   * `attachPanZoom()` call since it has no memory of the previous DOM's
   * transform.
   */
  getTransform(): Transform;
}

export interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

function applyTransform(viewport: SVGGElement, t: Transform): void {
  viewport.setAttribute('transform', `translate(${t.tx}, ${t.ty}) scale(${t.scale})`);
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Attaches pointer-based panning and wheel-based zoom-to-cursor to
 * `viewportGroup` inside `svgRoot`. Returns a small handle whose `reset()`
 * fits the graph's full bounding box (read from `viewportGroup`'s own
 * geometry via `getBBox()`) into the current SVG viewport size, centered.
 *
 * `initialTransform`, when supplied, seeds the starting transform (and
 * immediately applies it to `viewportGroup`) instead of the default identity
 * transform - lets a caller re-attach against a freshly rebuilt SVG/viewport
 * (e.g. after a node drag triggers a re-render) while preserving whatever
 * pan/zoom framing the user already had, via the previous handle's
 * `getTransform()`, rather than snapping back to the default view.
 */
export function attachPanZoom(
  svgRoot: SVGSVGElement,
  viewportGroup: SVGGElement,
  initialTransform?: Transform
): PanZoom {
  let transform: Transform = initialTransform ? { ...initialTransform } : { scale: 1, tx: 0, ty: 0 };
  if (initialTransform) {
    applyTransform(viewportGroup, transform);
  }
  let isPanning = false;
  let lastPointer = { x: 0, y: 0 };

  function clientToSvgPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = svgRoot.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function onPointerDown(event: PointerEvent): void {
    // Ignore clicks that land on a node/cluster so node clicks still fire
    // cleanly (a drag that starts and ends on the same node without moving
    // is indistinguishable from a click either way, so this is just to make
    // sure a genuine drag doesn't also feel "sticky" over interactive shapes).
    isPanning = true;
    lastPointer = { x: event.clientX, y: event.clientY };
    svgRoot.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!isPanning) {
      return;
    }
    const dx = event.clientX - lastPointer.x;
    const dy = event.clientY - lastPointer.y;
    lastPointer = { x: event.clientX, y: event.clientY };
    transform = { ...transform, tx: transform.tx + dx, ty: transform.ty + dy };
    applyTransform(viewportGroup, transform);
  }

  function onPointerUp(event: PointerEvent): void {
    isPanning = false;
    if (svgRoot.hasPointerCapture(event.pointerId)) {
      svgRoot.releasePointerCapture(event.pointerId);
    }
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();

    const cursor = clientToSvgPoint(event.clientX, event.clientY);
    // World-space point under the cursor *before* the scale changes.
    const worldX = (cursor.x - transform.tx) / transform.scale;
    const worldY = (cursor.y - transform.ty) / transform.scale;

    const zoomFactor = Math.exp(-event.deltaY * WHEEL_ZOOM_INTENSITY);
    const nextScale = clampScale(transform.scale * zoomFactor);

    // Re-derive tx/ty so the same world point stays under the cursor after
    // the scale change: cursor = world * scale + t  =>  t = cursor - world * scale.
    transform = {
      scale: nextScale,
      tx: cursor.x - worldX * nextScale,
      ty: cursor.y - worldY * nextScale,
    };
    applyTransform(viewportGroup, transform);
  }

  function reset(): void {
    const bbox = viewportGroup.getBBox();
    if (bbox.width === 0 || bbox.height === 0) {
      transform = { scale: 1, tx: 0, ty: 0 };
      applyTransform(viewportGroup, transform);
      return;
    }

    const viewportWidth = svgRoot.clientWidth || bbox.width;
    const viewportHeight = svgRoot.clientHeight || bbox.height;
    const padding = 0.9; // leave a little breathing room around the fitted graph
    const scale = clampScale(
      Math.min(viewportWidth / bbox.width, viewportHeight / bbox.height) * padding
    );

    const tx = viewportWidth / 2 - (bbox.x + bbox.width / 2) * scale;
    const ty = viewportHeight / 2 - (bbox.y + bbox.height / 2) * scale;

    transform = { scale, tx, ty };
    applyTransform(viewportGroup, transform);
  }

  svgRoot.addEventListener('pointerdown', onPointerDown);
  svgRoot.addEventListener('pointermove', onPointerMove);
  svgRoot.addEventListener('pointerup', onPointerUp);
  svgRoot.addEventListener('pointercancel', onPointerUp);
  svgRoot.addEventListener('wheel', onWheel, { passive: false });

  return { reset, getTransform: () => ({ ...transform }) };
}
