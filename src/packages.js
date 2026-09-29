import { removePronunciation } from "./vocabulary.js";

export const LANGUAGES = {
  en: { label: "Englisch", locale: "en-GB" },
  fr: { label: "Französisch", locale: "fr-FR" },
};

export const PACKAGE_EXPORT_FORMAT = "wortklar-vocabulary-packages";
export const PACKAGE_EXPORT_VERSION = 1;

export function createPackageId(language = "en") {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${language}-${suffix}`;
}

export function normalizePackage(item, { regenerateId = false } = {}) {
  if (!item || typeof item !== "object") return null;
  const language = item.language === "fr" ? "fr" : "en";
  const words = Array.isArray(item.words)
    ? item.words.map((word) => ({
      foreign: removePronunciation(word?.foreign ?? word?.en ?? word?.fr),
      de: String(word?.de ?? word?.german ?? "").trim(),
    })).filter((word) => word.foreign && word.de)
    : [];
  if (!words.length) return null;
  return {
    id: !regenerateId && typeof item.id === "string" && item.id ? item.id : createPackageId(language),
    name: String(item.name || "Vokabelpaket").trim() || "Vokabelpaket",
    language,
    words,
  };
}

export function normalizePackages(value, options) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizePackage(item, options)).filter(Boolean);
}

export function createPackageExport(packages) {
  return {
    format: PACKAGE_EXPORT_FORMAT,
    version: PACKAGE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    packages: normalizePackages(packages).map(({ name, language, words }) => ({ name, language, words })),
  };
}

export function parsePackageImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Die Datei enthält kein gültiges JSON.");
  }
  if (data?.format !== PACKAGE_EXPORT_FORMAT || data?.version !== PACKAGE_EXPORT_VERSION || !Array.isArray(data.packages)) {
    throw new Error("Die Datei ist kein unterstützter Wortklar-Vokabelpaket-Export.");
  }
  const packages = normalizePackages(data.packages, { regenerateId: true });
  if (!packages.length) throw new Error("Die Datei enthält keine vollständigen Vokabelpakete.");
  return packages;
}
