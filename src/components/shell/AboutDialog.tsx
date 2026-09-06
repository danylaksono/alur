import { useEffect, useRef } from "react";
import { ExternalLink, X } from "lucide-react";
import { useStore } from "../../store/useStore";
import packageJson from "../../../package.json";

const AUTHOR_URL = "https://github.com/danylaksono";

/**
 * Resolved (installed) versions, read from node_modules at build time. The
 * declared ranges in package.json drift from what npm actually installed (the
 * duckdb-wasm range declares ^1.28.0 but 1.32.0 is what is on disk), so the
 * About list prefers these and only falls back to the declared range below.
 */
const resolvedVersionFiles = import.meta.glob<string>(
  [
    "/node_modules/@duckdb/duckdb-wasm/package.json",
    "/node_modules/screengrid/package.json",
    "/node_modules/maplibre-gl/package.json",
    "/node_modules/react/package.json",
    "/node_modules/@xyflow/react/package.json",
    "/node_modules/zustand/package.json",
    "/node_modules/vite/package.json",
    "/node_modules/tailwindcss/package.json",
    "/node_modules/typescript/package.json",
  ],
  { eager: true, query: "?raw", import: "default" },
);

const resolvedVersion = (pkg: string): string => {
  const raw = resolvedVersionFiles[`/node_modules/${pkg}/package.json`];
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { version?: string };
    return typeof parsed.version === "string" ? parsed.version : "";
  } catch {
    return "";
  }
};

/** Curated highlights of the runtime stack, not an exhaustive inventory. */
const DEPENDENCIES: Array<{ label: string; pkg: string }> = [
  { label: "DuckDB WASM", pkg: "@duckdb/duckdb-wasm" },
  { label: "Screengrid", pkg: "screengrid" },
  { label: "MapLibre GL", pkg: "maplibre-gl" },
  { label: "React", pkg: "react" },
  { label: "React Flow", pkg: "@xyflow/react" },
  { label: "Zustand", pkg: "zustand" },
  { label: "Vite", pkg: "vite" },
  { label: "Tailwind CSS", pkg: "tailwindcss" },
  { label: "TypeScript", pkg: "typescript" },
];

/**
 * Resolves a package's version for display. Prefers what is actually
 * installed; falls back to the declared range (dropping the semver prefix), or
 * the version embedded in a vendored tarball (file:vendor/name-x.y.z.tgz).
 */
const dependencyVersion = (pkg: string): string => {
  const resolved = resolvedVersion(pkg);
  if (resolved) return resolved;
  const manifest = packageJson as unknown as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const version =
    manifest.dependencies?.[pkg] ?? manifest.devDependencies?.[pkg];
  if (!version) return "";
  if (version.startsWith("file:")) {
    const fileVersion = version.match(/-(\d+(?:\.\d+){1,3})\.tgz$/);
    if (fileVersion) return fileVersion[1];
    return "vendored";
  }
  return version.replace(/^[~^]/, "");
};

export const AboutDialog = () => {
  const isOpen = useStore((state) => state.ui.isAboutOpen);
  const setAboutOpen = useStore((state) => state.setAboutOpen);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAboutOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [isOpen, setAboutOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4"
      onClick={() => setAboutOpen(false)}
    >
      <section
        id="about-alur-dialog"
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-alur-title"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2
            id="about-alur-title"
            className="text-sm font-bold text-slate-800"
          >
            About ALUR
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setAboutOpen(false)}
            className="pressable rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            title="Close"
            aria-label="Close About"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-5">
          <div className="flex items-center gap-3">
            <img src="/alur-mark.svg" alt="" className="h-11 w-11" />
            <div>
              <h3 className="flex items-center gap-1.5 text-base font-extrabold tracking-[0.14em] text-slate-900">
                ALUR
                <span
                  className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-extrabold leading-none tracking-[0.12em] text-primary"
                  aria-label="ALUR is in beta"
                >
                  BETA
                </span>
              </h3>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Interactive visual analytics
              </p>
            </div>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            A browser-based workspace for exploring data through coordinated
            tables, charts, maps, and reproducible visual workflows.
          </p>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Built with
            </p>
            <ul className="mt-2 space-y-1">
              {DEPENDENCIES.map(({ label, pkg }) => (
                <li
                  key={pkg}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="text-slate-600">{label}</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {dependencyVersion(pkg)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Created by
            </p>
            <a
              href={AUTHOR_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Dany Laksono
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
};
