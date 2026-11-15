"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { getA, loadAladin, type AladinCatalog, type AladinInstance } from "@/lib/aladin";
import { buildExploreUrl, decToDms, formatDegrees, MAX_FOV, MIN_FOV, raToHms } from "@/lib/coordinates";
import { DEFAULT_SURVEY, SURVEYS } from "@/lib/surveys";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import SpherexPanel from "./SpherexPanel";
import MosaicControls from "./MosaicControls";
import { DEFAULT_RGB_FRAMES, rgbUrl } from "@/lib/spherexMosaic";
import type { SpectrumTarget } from "./SpectrumPanel";
import CatalogOverlays from "./CatalogOverlays";
import ObjectInfo from "./ObjectInfo";

const CONTAINER_ID = "aladin-lite-div";
const SPHEREX_SINGLE = "spherex-mosaic-single";
const SPHEREX_RGB = "spherex-mosaic-rgb";
const ZOOM_STEP = 1.6;
const ROTATE_DEGREES_PER_PIXEL = 0.4;

type Mode = "pan" | "rotate";
type Status = "loading" | "ready" | "error";

// Smallest difference between two angles, handling the 359° → 0° wrap.
function angleDiff(a: number, b: number) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function normalizeAngle(deg: number) {
  return ((deg % 360) + 360) % 360;
}

// Aladin's setFoV() sets the LONGER side of the view, so we measure the same way.
function viewSize(aladin: AladinInstance) {
  return Math.max(...aladin.getFov());
}

function formatFov(fov: number) {
  if (fov >= 1) return `${fov.toFixed(2)}°`;
  if (fov >= 1 / 60) return `${(fov * 60).toFixed(1)}′`;
  return `${(fov * 3600).toFixed(1)}″`;
}

type Props = {
  ra: number;
  dec: number;
  initialFov: number; // view width in degrees when arriving / returning
};

export default function SkyViewer({ ra, dec, initialFov }: Props) {
  const router = useRouter();
  const reducedMotion = usePrefersReducedMotion();
  const aladinRef = useRef<AladinInstance | null>(null);
  const initialTarget = useRef({ ra, dec, fov: initialFov });

  const [status, setStatus] = useState<Status>("loading");
  const [center, setCenter] = useState({ ra, dec });
  const [cursor, setCursor] = useState<{ ra: number; dec: number } | null>(null);
  const [fov, setFov] = useState(initialFov);
  const [rotation, setRotation] = useState(0);
  const [mode, setMode] = useState<Mode>("pan");
  // SPHEREx first: open on the SPHEREx all-sky false-colour map
  const [surveyId, setSurveyId] = useState<string>(SPHEREX_RGB);
  const [mosaicUnavailable, setMosaicUnavailable] = useState(false);
  const [playerSlot, setPlayerSlot] = useState<HTMLDivElement | null>(null); // time-machine player goes here
  const [wavelengthRequest, setWavelengthRequest] = useState<{ um: number; n: number } | null>(null);
  const [mosaicLabel, setMosaicLabel] = useState("");
  const [attempt, setAttempt] = useState(0); // bump to retry loading
  const [selected, setSelected] = useState<{ ra: number; dec: number } | null>(null);
  const [spectrumRequest, setSpectrumRequest] = useState<(SpectrumTarget & { n: number }) | null>(null);
  const selectionRef = useRef<AladinCatalog | null>(null);

  // Clicking the sky (without dragging) identifies what is there
  const handleSkyClick = useRef<(ra: number, dec: number) => void>(() => undefined);
  handleSkyClick.current = (clickRa: number, clickDec: number) => {
    const aladin = aladinRef.current;
    const A = getA();
    if (!aladin || !A) return;
    if (!selectionRef.current) {
      selectionRef.current = A.catalog({ name: "Selected position", color: "#ffffff", shape: "cross", sourceSize: 18 });
      aladin.addCatalog(selectionRef.current);
    }
    selectionRef.current.removeAll();
    selectionRef.current.addSources([A.source(clickRa, clickDec, { selected: true })]);
    selectionRef.current.show();
    setSelected({ ra: clickRa, dec: clickDec });
  };

  function clearSelection() {
    selectionRef.current?.hide();
    setSelected(null);
  }

  // 1. Create the viewer once (and again only if the user presses "Try again").
  useEffect(() => {
    let cancelled = false;
    const container = document.getElementById(CONTAINER_ID);
    setStatus("loading");

    loadAladin()
      .then((A) => {
        if (cancelled || !container) return;
        container.innerHTML = "";
        const { ra: startRa, dec: startDec, fov: startFov } = initialTarget.current;
        const aladin = A.aladin(`#${CONTAINER_ID}`, {
          survey: rgbUrl(DEFAULT_RGB_FRAMES), // SPHEREx all-sky mosaic (false colour) from our backend
          target: `${startRa} ${startDec}`,
          fov: startFov,
          projection: "SIN",
          cooFrame: "ICRS",
          backgroundColor: "#000000",
          showReticle: true,
          reticleColor: "#a78bfa", // hex: Aladin fails to parse rgba() colours
          reticleSize: 14,
          inertia: !reducedMotion,
          // We provide our own controls, so hide Aladin's built-in ones
          showZoomControl: false,
          showFullscreenControl: false,
          showLayersControl: false,
          showGotoControl: false,
          showProjectionControl: false,
          showFrame: false,
          showCooGrid: false,
          showCooGridControl: false,
          showSettingsControl: false,
          showShareControl: false,
          showSimbadPointerControl: false,
          showContextMenu: false,
          showStatusBar: false,
          showCooLocation: false,
          showFov: false,
        });
        aladin.gotoRaDec(startRa, startDec);

        aladin.on("positionChanged", ({ ra: r, dec: d }) => setCenter({ ra: r, dec: d }));
        aladin.on("zoomChanged", () => setFov(viewSize(aladin)));
        aladin.on("rotationChanged", () => setRotation(aladin.getRotation()));
        aladin.on("click", (p) => {
          if (!p.isDragging && Number.isFinite(p.ra) && Number.isFinite(p.dec)) handleSkyClick.current(p.ra, p.dec);
        });
        aladin.on("mouseMove", ({ ra: r, dec: d }) => {
          setCursor(Number.isFinite(r) && Number.isFinite(d) ? { ra: r!, dec: d! } : null);
        });

        aladinRef.current = aladin;
        setFov(viewSize(aladin));
        setStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[SPHEREx Xplorer] Aladin Lite failed to load", error);
        setStatus("error");
      });

    return () => {
      cancelled = true;
      aladinRef.current = null;
      selectionRef.current = null;
      if (container) container.innerHTML = "";
    };
    // reducedMotion is read once at creation; changing it later needs a reload
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // 2. When the link changes (new search, Random, Set centre, Back/Forward),
  //    move and zoom the viewer to match it.
  useEffect(() => {
    initialTarget.current = { ra, dec, fov: initialFov };
    const aladin = aladinRef.current;
    if (!aladin) return;
    const [curRa, curDec] = aladin.getRaDec();
    if (angleDiff(curRa, ra) > 1e-6 || Math.abs(curDec - dec) > 1e-6) {
      aladin.gotoRaDec(ra, dec);
    }
    if (Math.abs(viewSize(aladin) - initialFov) / initialFov > 0.01) {
      aladin.setFoV(initialFov);
      setFov(viewSize(aladin));
    }
  }, [ra, dec, initialFov]);

  const zoomBy = useCallback((factor: number) => {
    const aladin = aladinRef.current;
    if (!aladin) return;
    const next = Math.min(MAX_FOV, Math.max(MIN_FOV, viewSize(aladin) * factor));
    aladin.setFoV(next);
    setFov(viewSize(aladin));
  }, []);

  const rotateTo = useCallback((degrees: number) => {
    const aladin = aladinRef.current;
    if (!aladin) return;
    aladin.setRotation(normalizeAngle(degrees));
    setRotation(aladin.getRotation());
  }, []);

  function returnToOriginal() {
    const aladin = aladinRef.current;
    if (!aladin) return;
    aladin.gotoRaDec(ra, dec);
    aladin.setFoV(initialFov);
    aladin.setRotation(0);
    setCenter({ ra, dec });
    setFov(viewSize(aladin));
    setRotation(0);
  }

  function setCurrentAsNew() {
    // Adds a new entry to the browser history, so Back returns to the old centre.
    // The current zoom is kept in the link too.
    router.push(buildExploreUrl(center.ra, center.dec, fov), { scroll: false });
  }

  // The SPHEREx mosaic needs our backend; without it fall back to a labelled reference map
  const onMosaicUnavailable = useCallback(() => {
    setMosaicUnavailable(true);
    setSurveyId(DEFAULT_SURVEY.id);
    aladinRef.current?.setBaseImageLayer(DEFAULT_SURVEY.url);
  }, []);

  // If the fallback happened before the viewer finished loading, apply it once it is ready
  useEffect(() => {
    if (status === "ready" && mosaicUnavailable) aladinRef.current?.setBaseImageLayer(DEFAULT_SURVEY.url);
  }, [status, mosaicUnavailable]);

  // When a single SPHEREx observation is shown, switch the background to the
  // all-sky SPHEREx map at the same wavelength, so the sharp patch blends in.
  const onObservationShown = useCallback((wavelengthUm: number | null) => {
    if (wavelengthUm == null) return;
    setSurveyId(SPHEREX_SINGLE);
    setWavelengthRequest((prev) => ({ um: wavelengthUm, n: (prev?.n ?? 0) + 1 }));
  }, []);

  function changeSurvey(id: string) {
    setSurveyId(id);
    if (id === SPHEREX_SINGLE || id === SPHEREX_RGB) setMosaicUnavailable(false);
    const next = SURVEYS.find((s) => s.id === id);
    if (next) aladinRef.current?.setBaseImageLayer(next.url);
    // SPHEREx mosaic choices are applied by <MosaicControls>
  }

  // Rotate mode: dragging sideways turns the view around its centre
  const drag = useRef<{ x: number; startRotation: number } | null>(null);
  function onRotatePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!aladinRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, startRotation: aladinRef.current.getRotation() };
  }
  function onRotatePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    rotateTo(drag.current.startRotation + dx * ROTATE_DEGREES_PER_PIXEL);
  }
  function onRotatePointerUp() {
    drag.current = null;
  }

  const movedFromOriginal = angleDiff(center.ra, ra) > 1e-5 || Math.abs(center.dec - dec) > 1e-5;
  const changedView =
    movedFromOriginal || Math.abs(fov - initialFov) / initialFov > 0.01 || angleDiff(rotation, 0) > 0.05;
  const survey = SURVEYS.find((s) => s.id === surveyId);
  const spherexMode = surveyId === SPHEREX_SINGLE ? "single" : surveyId === SPHEREX_RGB ? "rgb" : null;

  const buttonClass =
    "rounded-md border border-white/15 bg-black/50 px-3 py-1.5 text-sm text-white/85 backdrop-blur transition hover:border-violet-300/60 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";
  // Controls that float over the map
  const chipClass = "rounded-lg border border-white/15 bg-black/60 shadow-lg shadow-black/40 backdrop-blur-md";
  const iconButtonClass =
    "px-3 py-1 text-lg leading-none text-white/85 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";
  const overlayButtonClass =
    "rounded-lg border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-white/85 shadow-lg shadow-black/40 backdrop-blur-md transition hover:border-violet-300/60 hover:bg-black/75 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <section aria-label="Interactive sky viewer" className="mt-6">
      {/* Two columns on wide screens: sky on the left, SPHEREx tools always visible on the right */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(400px,30rem)] xl:items-start">
      <div className="min-w-0">
      {spherexMode && (
        <MosaicControls
          aladinRef={aladinRef}
          viewerReady={status === "ready"}
          mode={spherexMode}
          onLabel={setMosaicLabel}
          onUnavailable={onMosaicUnavailable}
          wavelengthRequest={wavelengthRequest}
        />
      )}
      {mosaicUnavailable && (
        <p role="status" className="mb-3 rounded-lg border border-amber-300/30 bg-amber-500/10 p-2 text-xs text-amber-100">
          The SPHEREx all-sky map needs the SPHEREx data server, which isn&apos;t answering. Showing the 2MASS reference map
          (not SPHEREx) for now. Start the server, then pick a SPHEREx map in the Background menu.
        </p>
      )}

      {/* The time machine's player appears here (above the map) when its tab is open */}
      <div ref={setPlayerSlot} />

      <CatalogOverlays aladinRef={aladinRef} viewerReady={status === "ready"} center={center} fov={fov} />

      {/* Viewer */}
      <div
        className="relative h-[62vh] min-h-80 w-full overflow-hidden rounded-2xl border border-white/10 bg-black xl:h-[calc(100dvh-10rem)] xl:min-h-[30rem]"
        onMouseLeave={() => setCursor(null)}
      >
        <div id={CONTAINER_ID} className="h-full w-full" />

        {mode === "rotate" && status === "ready" && (
          <div
            className="absolute inset-0 z-10 cursor-ew-resize touch-none"
            onPointerDown={onRotatePointerDown}
            onPointerMove={onRotatePointerMove}
            onPointerUp={onRotatePointerUp}
            onPointerCancel={onRotatePointerUp}
            aria-label="Drag left or right to rotate the view"
          />
        )}

        {status === "loading" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70">
            <p className="animate-pulse text-sm text-white/70 motion-reduce:animate-none">Loading the sky viewer…</p>
          </div>
        )}
        {status === "error" && (
          <div role="alert" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center">
            <p className="text-white/85">The sky viewer couldn&apos;t load.</p>
            <p className="max-w-md text-sm text-white/55">
              It comes from the Aladin Lite service in Strasbourg, so it needs an internet
              connection. Check you&apos;re online, then try again.
            </p>
            <button className={buttonClass} onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </div>
        )}

        {/* Floating controls over the map */}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex flex-wrap items-start justify-between gap-2">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Interaction mode" className={`${chipClass} flex overflow-hidden`}>
              {(["pan", "rotate"] as Mode[]).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 text-sm transition ${
                    mode === m ? "bg-violet-600/85 text-white" : "text-white/75 hover:bg-white/10"
                  }`}
                >
                  {m === "pan" ? "✥ Pan" : "⟳ Rotate"}
                </button>
              ))}
            </div>
            <div className={`${chipClass} flex overflow-hidden`}>
              <button
                className={iconButtonClass}
                onClick={() => zoomBy(1 / ZOOM_STEP)}
                disabled={status !== "ready"}
                aria-label="Zoom in"
                title="Zoom in"
              >
                ＋
              </button>
              <span className="w-px bg-white/15" />
              <button
                className={iconButtonClass}
                onClick={() => zoomBy(ZOOM_STEP)}
                disabled={status !== "ready"}
                aria-label="Zoom out"
                title="Zoom out"
              >
                −
              </button>
            </div>
          </div>

          <label className={`${chipClass} pointer-events-auto flex items-center gap-1 pl-2.5 text-xs text-white/60`}>
            <span className="hidden sm:inline">Map</span>
            <select
              value={surveyId}
              onChange={(e) => changeSurvey(e.target.value)}
              disabled={status !== "ready"}
              aria-label="Background map"
              className="max-w-[15rem] rounded-md border-0 bg-transparent py-1 pl-1 pr-6 text-sm text-white focus:outline-none [&_option]:bg-neutral-900 [&_optgroup]:bg-neutral-900 focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              <optgroup label="SPHEREx (real data)">
                <option value={SPHEREX_SINGLE}>SPHEREx · one wavelength</option>
                <option value={SPHEREX_RGB}>SPHEREx false colour</option>
              </optgroup>
              <optgroup label="Reference maps (other telescopes)">
                {SURVEYS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        </div>

        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-30 flex flex-wrap items-end justify-between gap-2">
          <div className="pointer-events-auto flex flex-wrap gap-2">
            {/* Only shown once you have moved, so the map stays uncluttered */}
            {status === "ready" && changedView && (
              <button className={overlayButtonClass} onClick={returnToOriginal}>
                ↺ Return to original
              </button>
            )}
            {status === "ready" && movedFromOriginal && (
              <button
                className={`${overlayButtonClass} border-violet-400/50`}
                onClick={setCurrentAsNew}
                title="Make the current centre the page's coordinate (adds it to your browser history)"
              >
                ◎ Set as new coordinate
              </button>
            )}
          </div>
          {status === "ready" && (
            <p className="rounded-md bg-black/60 px-2 py-1 text-[11px] text-white/65 backdrop-blur-md">
              {mode === "pan"
                ? "Drag to pan · scroll to zoom · click an object to identify it"
                : `Drag left/right to rotate · ${rotation.toFixed(0)}° from north-up`}
            </p>
          )}
        </div>
      </div>

      {/* Coordinate readout */}
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <dt className="text-xs uppercase tracking-wider text-white/45">View centre</dt>
          <dd className="mt-1 font-mono text-white/90">
            {formatDegrees(Number(center.ra.toFixed(5)))}°, {formatDegrees(Number(center.dec.toFixed(5)))}°
          </dd>
          <dd className="font-mono text-xs text-white/45">
            {raToHms(center.ra)} · {decToDms(center.dec)}
          </dd>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <dt className="text-xs uppercase tracking-wider text-white/45">Under your cursor</dt>
          <dd className="mt-1 font-mono text-white/90">
            {cursor
              ? `${formatDegrees(Number(cursor.ra.toFixed(5)))}°, ${formatDegrees(Number(cursor.dec.toFixed(5)))}°`
              : "—"}
          </dd>
          <dd className="font-mono text-xs text-white/45">
            {cursor ? `${raToHms(cursor.ra)} · ${decToDms(cursor.dec)}` : "Move your mouse over the sky"}
          </dd>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <dt className="text-xs uppercase tracking-wider text-white/45">Field of view · rotation</dt>
          <dd className="mt-1 font-mono text-white/90">
            {formatFov(fov)} across · {rotation.toFixed(0)}°
          </dd>
          <dd className="text-xs text-white/45">
            {movedFromOriginal ? "Moved from your original coordinate (link unchanged)" : "Centred on your coordinate"}
          </dd>
        </div>
      </dl>

      {selected && (
        <ObjectInfo
          position={selected}
          onClose={clearSelection}
          onSpectrum={(target) => setSpectrumRequest((prev) => ({ ...target, n: (prev?.n ?? 0) + 1 }))}
        />
      )}

      {/* Explanations and attribution */}
      <div className="mt-3 space-y-2 text-xs leading-relaxed text-white/50">
        {survey ? (
          <p>
            <span className="text-white/70">Background map: {survey.label}.</span> {survey.description}{" "}
            Images: CDS HiPS, served from the NASA/IPAC IRSA mirror, shown with Aladin Lite. <strong className="font-medium text-amber-200/80">The background map is not SPHEREx data</strong>
            {" "}— pick a SPHEREx map in the Background menu, or show a real SPHEREx observation from the SPHEREx panel.
          </p>
        ) : (
          <p>
            <span className="text-white/70">Background map: {mosaicLabel || "SPHEREx all-sky mosaic"}.</span>{" "}
            <strong className="font-medium text-teal-200/80">Real SPHEREx data</strong> from the DR1 all-sky mosaic
            (IRSA HiPS cube, ~13″ pixels), shown with Aladin Lite. Single observations from the SPHEREx panel are sharper (6″ pixels).
          </p>
        )}
        <details className="group">
          <summary className="cursor-pointer text-white/65 hover:text-white/85">
            Rotate vs. Pan — what&apos;s the difference?
          </summary>
          <p className="mt-1 max-w-3xl">
            <strong className="text-white/70">Pan</strong> slides your window across the sky, like
            moving a map. <strong className="text-white/70">Rotate</strong> turns the picture around its
            centre, like turning a map on a table: the same stars stay in view, only &quot;up&quot;
            changes. Neither one moves you through space. The sky is seen from Earth as a flat
            projection, so there is no true 3D &quot;orbit&quot; around an object. Rotation is the
            honest equivalent.
          </p>
        </details>
      </div>

      </div>

      <aside
        aria-label="SPHEREx tools"
        className="min-w-0 xl:sticky xl:top-3 xl:max-h-[calc(100dvh-1.5rem)] xl:overflow-y-auto xl:overscroll-contain xl:pr-1"
      >
      <SpherexPanel
        aladinRef={aladinRef}
        viewerReady={status === "ready"}
        ra={ra}
        dec={dec}
        suggestedSize={initialFov}
        spectrumRequest={spectrumRequest}
        onObservationShown={onObservationShown}
        playerSlot={playerSlot}
      />
      </aside>
      </div>
    </section>
  );
}
