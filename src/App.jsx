import { useEffect, useMemo, useRef, useState } from "react";
import { removePronunciation } from "./vocabulary.js";
import { createPackageExport, createPackageId, LANGUAGES, normalizePackages, parsePackageImport } from "./packages.js";

const OCR_API_URL = import.meta.env.VITE_OCR_API_URL || "";
const OCR_USERNAME = import.meta.env.VITE_OCR_USERNAME || "";

function blobToBase64(blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 32_768) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 32_768));
    }
    return window.btoa(binary);
  });
}

async function prepareImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const maxEdge = 2600;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    (result) => result ? resolve(result) : reject(new Error("Das Foto konnte nicht vorbereitet werden.")),
    "image/jpeg",
    0.88,
  ));
  if (blob.size > 3.5 * 1024 * 1024) throw new Error("Das Foto ist auch nach der Verkleinerung noch zu groß.");
  return blobToBase64(blob);
}

async function analyzeImage(file, password, language) {
  if (!OCR_API_URL) throw new Error("Die Bilderkennung ist für diese Umgebung nicht konfiguriert.");
  if (!OCR_USERNAME) throw new Error("Der OCR-Zugang ist für diese Umgebung nicht vollständig konfiguriert.");
  const response = await fetch(OCR_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${window.btoa(`${OCR_USERNAME}:${password}`)}`,
    },
    body: JSON.stringify({ image: await prepareImage(file), language }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Die Bilderkennung ist fehlgeschlagen.");
    error.status = response.status;
    throw error;
  }
  return payload.result?.pages?.flatMap((page) => page.words || []) || [];
}

function readSavedPackages() {
  try {
    return normalizePackages(JSON.parse(localStorage.getItem("wortklar-packages")) || []);
  } catch {
    return [];
  }
}

function readLanguageMode() {
  return localStorage.getItem("wortklar-language") === "fr" ? "fr" : "en";
}

function readLearningState() {
  try {
    return JSON.parse(localStorage.getItem("wortklar-learning")) || {};
  } catch {
    return {};
  }
}

const LEVELS = [
  { label: "Neu", wait: 0 },
  { label: "Im Lernen", wait: 60 * 60 * 1000 },
  { label: "Wird sicher", wait: 24 * 60 * 60 * 1000 },
  { label: "Sicher", wait: 3 * 24 * 60 * 60 * 1000 },
  { label: "Sehr sicher", wait: 7 * 24 * 60 * 60 * 1000 },
];

function wordKey(packageId, word) {
  return `${packageId}::${word.foreign}::${word.de}`;
}

function wordProgress(learning, packageId, word) {
  return learning[wordKey(packageId, word)] || {
    attempts: 0,
    correct: 0,
    streak: 0,
    level: 0,
    lastSeen: 0,
    nextDue: 0,
  };
}

function learningPriority(progress) {
  const isDue = !progress.nextDue || progress.nextDue <= Date.now();
  const age = progress.lastSeen ? Math.min((Date.now() - progress.lastSeen) / 3_600_000, 72) : 120;
  return (progress.attempts === 0 ? 10_000 : 0) + (isDue ? 1_000 : 0) + (4 - progress.level) * 100 + age;
}

function normalize(value) {
  return value
    .toLocaleLowerCase("de")
    .replace(/[.,!?()]/g, "")
    .replace(/\b(der|die|das|ein|eine|to)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function accepted(answer, expected) {
  const a = normalize(answer);
  return expected.split(/[,;/]/).some((part) => {
    const e = normalize(part);
    return a === e || (a.length > 3 && e.includes(a)) || (e.length > 3 && a.includes(e));
  });
}

function speak(text, language) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  utterance.rate = 0.86;
  window.speechSynthesis.speak(utterance);
}

function Steps({ step }) {
  return (
    <ol className="steps" aria-label="Fortschritt">
      {["Start", "Üben", "Ergebnis"].map((label, index) => (
        <li key={label} className={step >= index + 1 ? "active" : ""} aria-current={step === index + 1 ? "step" : undefined}>
          <span>{index + 1}</span>
          <strong>{label}</strong>
        </li>
      ))}
    </ol>
  );
}

function LanguageSwitch({ value, onChange }) {
  return (
    <div className="language-switch" aria-label="Sprachmodus">
      {Object.entries(LANGUAGES).map(([code, language]) => (
        <button key={code} type="button" className={value === code ? "selected" : ""} aria-pressed={value === code} onClick={() => onChange(code)}>
          {language.label}
        </button>
      ))}
    </div>
  );
}

function PackageImportButton({ onImport, className = "secondary-button" }) {
  return (
    <label className={`${className} file-button`}>
      Pakete importieren
      <input type="file" accept="application/json,.json" onChange={onImport} />
    </label>
  );
}

function ImportFlow({ language, onLanguageChange, onCancel, onSave, onManual, onImport, importMessage, canCancel = true }) {
  const [phase, setPhase] = useState("upload");
  const [name, setName] = useState("Mein Vokabelpaket");
  const [previews, setPreviews] = useState([]);
  const [activePreview, setActivePreview] = useState(null);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [lightboxPan, setLightboxPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const [rows, setRows] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [analysisError, setAnalysisError] = useState("");
  const [ocrPassword, setOcrPassword] = useState(() => sessionStorage.getItem("wortklar-ocr-password") || "");
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");

  async function runAnalysis(files) {
    setPhase("analyzing");
    setAnalysisError("");
    setRows([]);
    setAnalysisProgress({ current: 0, total: files.length });
    try {
      const nextRows = [];
      for (let index = 0; index < files.length; index += 1) {
        const words = await analyzeImage(files[index], ocrPassword, language);
        nextRows.push(...words.map((word) => ({
          foreign: removePronunciation(word.foreign ?? word.french ?? word.english),
          de: word.german?.trim() || "",
          uncertain: Boolean(word.uncertain) || Number(word.confidence) < 0.8,
          included: true,
          page: index + 1,
        })).filter((word) => word.foreign && word.de));
        setAnalysisProgress({ current: index + 1, total: files.length });
      }
      if (!nextRows.length) throw new Error("Auf den Fotos wurden keine Vokabelpaare erkannt.");
      setRows(nextRows);
      setPhase("review");
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem("wortklar-ocr-password");
        setOcrPassword("");
        setPasswordInput("");
        setPasswordError("Das Passwort ist nicht richtig.");
        setPhase("auth");
        return;
      }
      setAnalysisError(error.message || "Die Bilderkennung ist fehlgeschlagen.");
      setPhase("analysis-error");
    }
  }

  function handleFile(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setSelectedFiles(files);
    setPreviews(files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })));
    if (ocrPassword) runAnalysis(files);
    else setPhase("auth");
  }

  useEffect(() => () => {
    previews.forEach((preview) => URL.revokeObjectURL(preview.url));
  }, [previews]);

  useEffect(() => {
    if (activePreview === null) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") setActivePreview(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activePreview]);

  function updateRow(index, key, value) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value, uncertain: false } : row));
  }

  function toggleRow(index) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, included: !row.included } : row));
  }

  function cancelReview() {
    if (canCancel) {
      onCancel();
      return;
    }
    setPreviews([]);
    setSelectedFiles([]);
    setPhase("upload");
  }

  function submitPassword(event) {
    event.preventDefault();
    if (!passwordInput) return;
    sessionStorage.setItem("wortklar-ocr-password", passwordInput);
    setOcrPassword(passwordInput);
    setPasswordError("");
  }

  useEffect(() => {
    if (phase === "auth" && ocrPassword && selectedFiles.length) runAnalysis(selectedFiles);
  }, [ocrPassword]);

  function showPreview(index) {
    setActivePreview(index);
    setLightboxZoom(1);
    setLightboxPan({ x: 0, y: 0 });
  }

  function changeZoom(nextZoom) {
    const zoom = Math.min(4, Math.max(1, nextZoom));
    setLightboxZoom(zoom);
    if (zoom === 1) setLightboxPan({ x: 0, y: 0 });
  }

  function startPanning(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, pan: lightboxPan };
  }

  function panImage(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setLightboxPan({
      x: drag.pan.x + event.clientX - drag.x,
      y: drag.pan.y + event.clientY - drag.y,
    });
  }

  function stopPanning(event) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  return (
    <section className="import-view" aria-labelledby="import-title">
      {canCancel && <button className="text-button back-button" onClick={onCancel}>Zurück</button>}
      {phase === "upload" ? (
        <div className="import-upload">
          <LanguageSwitch value={language} onChange={onLanguageChange} />
          <p className="eyebrow">Neues Paket</p>
          <h1 id="import-title">{LANGUAGES[language].label}-Vokabelseite fotografieren</h1>
          <p>Wähle ein oder mehrere gut lesbare Fotos. Du kannst alle erkannten Wörter vor dem Speichern kontrollieren.</p>
          <label className="upload-area">
            <input type="file" accept="image/*" capture="environment" multiple onChange={handleFile} />
            <strong>Fotos aufnehmen oder auswählen</strong>
            <span>JPG, PNG oder HEIC</span>
          </label>
          <p className="privacy-note">Die Fotos werden zur Erkennung verschlüsselt an AWS übertragen und nicht dauerhaft gespeichert.</p>
          <div className="import-alternatives">
            <button className="secondary-button" type="button" onClick={onManual}>Paket von Hand erstellen</button>
            <PackageImportButton onImport={onImport} />
          </div>
          {importMessage && <p className={`import-message ${importMessage.error ? "error" : ""}`} role="status">{importMessage.text}</p>}
        </div>
      ) : phase === "auth" ? (
        <form className="analysis-status" onSubmit={submitPassword}>
          <p className="eyebrow">Geschützte Bilderkennung</p>
          <h1 id="import-title">Passwort eingeben</h1>
          <p>Die KI-Bilderkennung ist vor unbefugter Nutzung geschützt.</p>
          <label className="field-label" htmlFor="ocr-password">Passwort</label>
          <input id="ocr-password" type="password" value={passwordInput} onChange={(event) => setPasswordInput(event.target.value)} autoComplete="current-password" autoFocus />
          {passwordError && <p className="analysis-error">{passwordError}</p>}
          <button className="primary-button" type="submit" disabled={!passwordInput}>Bilder erkennen</button>
          <button className="text-button review-cancel-button" type="button" onClick={cancelReview}>Abbrechen</button>
        </form>
      ) : phase === "analyzing" || phase === "analysis-error" ? (
        <div className="analysis-status" role="status">
          <p className="eyebrow">Bilderkennung</p>
          <h1 id="import-title">{phase === "analyzing" ? "Vokabeln werden erkannt" : "Erkennung fehlgeschlagen"}</h1>
          {phase === "analyzing" ? (
            <>
              <div className="analysis-spinner" aria-hidden="true" />
              <p>Foto {Math.min(analysisProgress.current + 1, analysisProgress.total)} von {analysisProgress.total} wird ausgewertet. Das kann einige Sekunden dauern.</p>
              <button className="text-button review-cancel-button" type="button" onClick={cancelReview}>Abbrechen</button>
            </>
          ) : (
            <>
              <p className="analysis-error">{analysisError}</p>
              <button className="primary-button" type="button" onClick={() => runAnalysis(selectedFiles)}>Erneut versuchen</button>
              <button className="text-button review-cancel-button" type="button" onClick={cancelReview}>Abbrechen</button>
            </>
          )}
        </div>
      ) : (
        <div className="review-layout">
          <div className="photo-column">
            <p className="eyebrow">Foto prüfen</p>
            <h1 id="import-title">Stimmen die Wörter?</h1>
            <div className="photo-previews" aria-label={`${previews.length} ausgewählte Fotos`}>
              {previews.map((preview, index) => (
                <button className="photo-preview-button" type="button" onClick={() => showPreview(index)} key={preview.url} aria-label={`Foto ${index + 1} vergrößern`}>
                  <img src={preview.url} alt={`Ausgewählte Vokabelseite ${index + 1}: ${preview.name}`} />
                  <span>Vergrößern</span>
                </button>
              ))}
            </div>
            <label className="field-label" htmlFor="package-name">Name des Pakets</label>
            <input id="package-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="review-column">
            <p className="review-help"><strong>{rows.filter((row) => row.included).length} von {rows.length} erkannten Vokabeln ausgewählt.</strong> Die Ergebnisse wurden mit KI aus {previews.length} {previews.length === 1 ? "Foto" : "Fotos"} gelesen. Bitte prüfe sie vor dem Speichern; unsichere Zeilen sind markiert.</p>
            <div className="word-table">
              {rows.map((row, index) => (
                <div className={`word-row ${row.uncertain ? "uncertain" : ""} ${row.included ? "" : "excluded"}`} key={index}>
                  <input aria-label={`${LANGUAGES[language].label}, Zeile ${index + 1}`} value={row.foreign} disabled={!row.included} onChange={(event) => updateRow(index, "foreign", event.target.value)} />
                  <input aria-label={`Deutsch, Zeile ${index + 1}`} value={row.de} disabled={!row.included} onChange={(event) => updateRow(index, "de", event.target.value)} />
                  <span>{row.uncertain ? "Bitte prüfen" : "OK"}</span>
                  <button className="row-toggle" type="button" aria-pressed={!row.included} onClick={() => toggleRow(index)}>{row.included ? "Abwählen" : "Rückgängig"}</button>
                </div>
              ))}
            </div>
            <button className="primary-button" disabled={!rows.some((row) => row.included)} onClick={() => onSave({ id: createPackageId(language), name: name.trim() || "Mein Vokabelpaket", language, words: rows.filter((row) => row.included).map(({ foreign, de }) => ({ foreign, de })) })}>Paket speichern</button>
            <button className="text-button review-cancel-button" type="button" onClick={cancelReview}>Abbrechen</button>
          </div>
        </div>
      )}
      {activePreview !== null && previews[activePreview] && (
        <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label={`Foto ${activePreview + 1} von ${previews.length}`} onClick={() => setActivePreview(null)}>
          <button className="lightbox-close" type="button" onClick={() => setActivePreview(null)} aria-label="Großansicht schließen">×</button>
          {previews.length > 1 && (
            <button className="lightbox-nav lightbox-previous" type="button" onClick={(event) => {
              event.stopPropagation();
              showPreview((activePreview - 1 + previews.length) % previews.length);
            }} aria-label="Vorheriges Foto">‹</button>
          )}
          <div className="lightbox-stage" onClick={(event) => event.stopPropagation()} onWheel={(event) => {
            event.preventDefault();
            changeZoom(lightboxZoom + (event.deltaY < 0 ? 0.25 : -0.25));
          }}>
            <img
              src={previews[activePreview].url}
              alt={`Vokabelseite ${activePreview + 1} in Großansicht`}
              draggable="false"
              style={{ transform: `translate3d(${lightboxPan.x}px, ${lightboxPan.y}px, 0) scale(${lightboxZoom})` }}
              onPointerDown={startPanning}
              onPointerMove={panImage}
              onPointerUp={stopPanning}
              onPointerCancel={stopPanning}
              onDoubleClick={() => changeZoom(lightboxZoom > 1 ? 1 : 2)}
            />
          </div>
          {previews.length > 1 && (
            <button className="lightbox-nav lightbox-next" type="button" onClick={(event) => {
              event.stopPropagation();
              showPreview((activePreview + 1) % previews.length);
            }} aria-label="Nächstes Foto">›</button>
          )}
          <div className="lightbox-zoom-controls" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => changeZoom(lightboxZoom - 0.25)} disabled={lightboxZoom <= 1} aria-label="Verkleinern">−</button>
            <button type="button" onClick={() => changeZoom(1)} aria-label="Zoom zurücksetzen">{Math.round(lightboxZoom * 100)} %</button>
            <button type="button" onClick={() => changeZoom(lightboxZoom + 0.25)} disabled={lightboxZoom >= 4} aria-label="Vergrößern">+</button>
          </div>
          <span className="lightbox-count">{activePreview + 1} / {previews.length}</span>
        </div>
      )}
    </section>
  );
}

function PackageEditor({ item, language, onSave, onCancel }) {
  const activeLanguage = item?.language || language;
  const [name, setName] = useState(item?.name || "Mein Vokabelpaket");
  const [rows, setRows] = useState(() => item?.words?.length
    ? item.words.map((word) => ({ ...word }))
    : [{ foreign: "", de: "" }]);

  function updateRow(index, key, value) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  }

  function removeRow(index) {
    setRows((current) => current.length === 1
      ? [{ foreign: "", de: "" }]
      : current.filter((_, rowIndex) => rowIndex !== index));
  }

  function addRow() {
    setRows((current) => [...current, { foreign: "", de: "" }]);
  }

  const completeRows = rows
    .map((word) => ({ foreign: removePronunciation(word.foreign), de: word.de.trim() }))
    .filter((word) => word.foreign && word.de);
  const hasIncompleteRow = rows.some((word) => Boolean(word.foreign.trim()) !== Boolean(word.de.trim()));

  return (
    <section className="editor-view" aria-labelledby="editor-title">
      <button className="text-button back-button" type="button" onClick={onCancel}>Zurück</button>
      <p className="eyebrow">{item ? "Paket bearbeiten" : "Neues Paket"}</p>
      <h1 id="editor-title">Vokabeln von Hand pflegen</h1>
      <p className="editor-intro">Ergänze, korrigiere oder lösche Wortpaare. Das Paket gehört zum Sprachmodus {LANGUAGES[activeLanguage].label}.</p>
      <label className="field-label" htmlFor="editor-package-name">Name des Pakets</label>
      <input id="editor-package-name" value={name} onChange={(event) => setName(event.target.value)} />
      <div className="editor-labels" aria-hidden="true">
        <span>{LANGUAGES[activeLanguage].label}</span>
        <span>Deutsch</span>
      </div>
      <div className="editor-rows">
        {rows.map((row, index) => (
          <div className="editor-row" key={index}>
            <input aria-label={`${LANGUAGES[activeLanguage].label}, Zeile ${index + 1}`} value={row.foreign} placeholder={activeLanguage === "fr" ? "z. B. la maison" : "z. B. the house"} onChange={(event) => updateRow(index, "foreign", event.target.value)} />
            <input aria-label={`Deutsch, Zeile ${index + 1}`} value={row.de} placeholder="z. B. das Haus" onChange={(event) => updateRow(index, "de", event.target.value)} />
            <button className="row-delete" type="button" onClick={() => removeRow(index)} aria-label={`Zeile ${index + 1} löschen`}>Löschen</button>
          </div>
        ))}
      </div>
      <button className="secondary-button add-word-button" type="button" onClick={addRow}>Vokabel hinzufügen</button>
      {hasIncompleteRow && <p className="editor-error" role="status">Bitte vervollständige oder lösche angefangene Wortpaare.</p>}
      <div className="editor-actions">
        <button className="primary-button" type="button" disabled={!name.trim() || !completeRows.length || hasIncompleteRow} onClick={() => onSave({
          id: item?.id || createPackageId(activeLanguage),
          name: name.trim(),
          language: activeLanguage,
          words: completeRows,
        })}>{item ? "Änderungen speichern" : "Paket erstellen"}</button>
        <button className="text-button" type="button" onClick={onCancel}>Abbrechen</button>
      </div>
    </section>
  );
}

function VocabularyRanking({ item, learning }) {
  const ranked = [...item.words]
    .map((word) => ({ word, progress: wordProgress(learning, item.id, word) }))
    .sort((a, b) => learningPriority(b.progress) - learningPriority(a.progress));

  return (
    <section className="ranking" aria-labelledby="ranking-title">
      <div className="ranking-heading">
        <div>
          <p className="eyebrow">Lernstand</p>
          <h2 id="ranking-title">Diese Wörter sind als Nächstes dran</h2>
        </div>
        <span>{item.words.length} Wörter</span>
      </div>
      <div className="ranking-list">
        {ranked.map(({ word, progress }, index) => (
          <div className="ranking-row" key={wordKey(item.id, word)}>
            <span className="rank-number">{index + 1}</span>
            <div>
              <strong>{word.foreign}</strong>
              <span>{word.de}</span>
            </div>
            <span className={`level level-${progress.level}`}>{LEVELS[progress.level].label}</span>
            <span className="attempts">{progress.attempts ? `${progress.correct}/${progress.attempts} richtig` : "Noch nicht geübt"}</span>
          </div>
        ))}
      </div>
      <p className="ranking-note">Neue, unsichere und fällige Wörter stehen oben. Sichere Wörter erscheinen in kurzen Sessions seltener.</p>
    </section>
  );
}

function StartScreen({ language, onLanguageChange, packages, selectedId, setSelectedId, count, setCount, learning, importMessage, onStart, onPhotoImport, onManualCreate, onEdit, onJsonImport, onExport, onDelete, onClearLearning }) {
  const selectedPackage = packages.find((item) => item.id === selectedId) || packages[0];

  return (
    <section className="start-view">
      <Steps step={1} />
      <LanguageSwitch value={language} onChange={onLanguageChange} />
      <div className="start-copy">
        <h1>Was möchtest du heute üben?</h1>
        <p>{selectedPackage ? `Wähle ein ${LANGUAGES[language].label}-Vokabelpaket und die Länge der Session.` : `Lege dein erstes ${LANGUAGES[language].label}-Vokabelpaket an oder importiere eines.`}</p>
      </div>
      <div className="start-form">
        {selectedPackage ? (
          <>
            <label htmlFor="package">Vokabelpaket</label>
            <select id="package" value={selectedPackage.id} onChange={(event) => setSelectedId(event.target.value)}>
              {packages.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
            <div className="package-actions" aria-label="Vokabelpaket verwalten">
              <button className="secondary-button" type="button" onClick={() => onEdit(selectedPackage)}>Paket bearbeiten</button>
              <button className="secondary-button" type="button" onClick={onExport}>Alle exportieren</button>
              <button className="secondary-button danger-button" type="button" onClick={() => onDelete(selectedPackage)}>Paket löschen</button>
            </div>
            <fieldset>
              <legend>Anzahl der Wörter</legend>
              <div className="segments">
                {[5, 10, 20, "all"].map((value) => (
                  <button type="button" className={count === value ? "selected" : ""} onClick={() => setCount(value)} key={value}>{value === "all" ? "Alle" : value}</button>
                ))}
              </div>
            </fieldset>
            <button className="primary-button" onClick={onStart}>Session starten</button>
          </>
        ) : (
          <div className="empty-packages">
            <strong>Noch kein Paket für {LANGUAGES[language].label}</strong>
            <span>Du kannst Fotos auslesen lassen, Wörter selbst eingeben oder eine Sicherungsdatei importieren.</span>
          </div>
        )}
        <div className="package-create-actions">
          <button className="secondary-button" type="button" onClick={onPhotoImport}>Aus Fotos erstellen</button>
          <button className="secondary-button" type="button" onClick={onManualCreate}>Von Hand erstellen</button>
          <PackageImportButton onImport={onJsonImport} />
        </div>
        {importMessage && <p className={`import-message ${importMessage.error ? "error" : ""}`} role="status">{importMessage.text}</p>}
        <button className="text-button clear-learning-button" type="button" onClick={onClearLearning}>Lernstand löschen</button>
      </div>
      {selectedPackage && <VocabularyRanking item={selectedPackage} learning={learning} />}
    </section>
  );
}

function PracticeScreen({ queue, index, score, onAnswer, onQuit }) {
  const item = queue[index];
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const recognitionHandledRef = useRef(false);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isMultipleChoice = index % 3 === 1;
  const reverse = index % 2 === 1;
  const foreignLanguage = LANGUAGES[item.language] || LANGUAGES.en;
  const prompt = reverse ? item.foreign : item.de;
  const expected = reverse ? item.de : item.foreign;
  const language = reverse ? foreignLanguage.locale : "de-DE";

  useEffect(() => {
    setAnswer("");
    setFeedback(null);
    setSpeechError("");
    inputRef.current?.focus();
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, [index]);

  const choices = useMemo(() => {
    if (!isMultipleChoice) return [];
    const alternatives = queue.filter((entry) => entry.foreign !== item.foreign).slice(0, 3).map((entry) => reverse ? entry.de : entry.foreign);
    return [...alternatives, expected].sort((a, b) => a.localeCompare(b));
  }, [expected, isMultipleChoice, item.foreign, queue, reverse]);

  function submit(value = answer) {
    if (!value.trim() || feedback) return;
    const correct = accepted(value, expected);
    setAnswer(value);
    setFeedback({ correct, expected });
  }

  function listen() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechError("Spracherkennung ist in diesem Browser nicht verfügbar. Du kannst die Antwort eintippen.");
      return;
    }
    recognitionRef.current?.abort();
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognitionHandledRef.current = false;
    recognition.lang = reverse ? "de-DE" : foreignLanguage.locale;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setSpeechError("");
    setListening(true);
    recognition.onresult = (event) => {
      recognitionHandledRef.current = true;
      const result = event.results[event.resultIndex] || event.results[event.results.length - 1];
      const transcript = result?.[0]?.transcript?.trim() || "";
      if (transcript) {
        setAnswer(transcript);
        submit(transcript);
      } else {
        setSpeechError("Ich konnte nichts verstehen. Versuch es noch einmal oder tippe die Antwort ein.");
      }
      setListening(false);
    };
    recognition.onnomatch = () => {
      recognitionHandledRef.current = true;
      setSpeechError("Ich konnte die Antwort nicht sicher erkennen. Versuch es bitte noch einmal.");
      setListening(false);
    };
    recognition.onerror = (event) => {
      recognitionHandledRef.current = true;
      const messages = {
        "not-allowed": "Der Mikrofonzugriff wurde nicht erlaubt.",
        "audio-capture": "Es wurde kein verfügbares Mikrofon gefunden.",
        "no-speech": "Ich habe keine Sprache erkannt. Versuch es bitte noch einmal.",
        network: isSafari
          ? "Safari erreicht die Apple-Spracherkennung nicht. Aktiviere unter Systemeinstellungen → Tastatur die Diktierfunktion oder nutze das macOS-Diktat direkt im Eingabefeld."
          : "Die Spracherkennung ist gerade nicht erreichbar. Du kannst die Antwort eintippen.",
        aborted: "Die Aufnahme wurde beendet, bevor eine Antwort erkannt wurde.",
      };
      setSpeechError(messages[event.error] || "Die Spracherkennung wurde unterbrochen. Versuch es bitte noch einmal.");
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (!recognitionHandledRef.current) {
        setSpeechError(isSafari
          ? "Safari hat kein Transkript geliefert. Aktiviere unter Systemeinstellungen → Tastatur die Diktierfunktion. Alternativ: Eingabefeld anklicken und die macOS-Diktierfunktion starten."
          : "Es wurde kein Transkript geliefert. Versuch es noch einmal oder tippe die Antwort ein.");
      }
    };
    recognition.start();
  }

  return (
    <section className="practice-view">
      <Steps step={2} />
      <div className="practice-topline">
        <button className="text-button" onClick={onQuit}>Session beenden</button>
        <span>{index + 1} von {queue.length}</span>
      </div>
      <div className="progress-track"><span style={{ width: `${((index + 1) / queue.length) * 100}%` }} /></div>
      <div className="question">
        <p className="eyebrow">{reverse ? `${foreignLanguage.label} → Deutsch` : `Deutsch → ${foreignLanguage.label}`} · {isMultipleChoice ? "Auswählen" : "Schreiben oder sprechen"}</p>
        <h1>{prompt}</h1>
        <button className="secondary-button audio-button" onClick={() => speak(prompt, language)}>Anhören</button>
      </div>
      {isMultipleChoice ? (
        <div className="choice-list">
          {choices.map((choice) => <button key={choice} disabled={Boolean(feedback)} className={feedback && choice === expected ? "correct-choice" : ""} onClick={() => submit(choice)}>{choice}</button>)}
        </div>
      ) : (
        <div className="answer-row">
          <input ref={inputRef} value={answer} disabled={Boolean(feedback)} placeholder="Deine Antwort" onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submit()} />
          <button className={`secondary-button ${listening ? "listening" : ""}`} disabled={Boolean(feedback) || listening} onClick={listen}>{listening ? "Ich höre zu …" : "Antwort sprechen"}</button>
        </div>
      )}
      {speechError && <p className="speech-error" role="status">{speechError}</p>}
      {isSafari && !speechError && !feedback && !isMultipleChoice && (
        <p className="speech-hint">Safari benötigt die aktivierte macOS-Diktierfunktion. Du kannst alternativ das Eingabefeld auswählen und das Systemdiktat verwenden.</p>
      )}
      {feedback ? (
        <div className={`feedback ${feedback.correct ? "success" : "error"}`} role="status">
          <strong>{feedback.correct ? "Richtig!" : "Noch nicht ganz."}</strong>
          <span>{feedback.message || (!feedback.correct ? `Die Lösung ist: ${feedback.expected}` : "Gut gemacht.")}</span>
          <button className="primary-button" onClick={() => onAnswer(feedback.correct, item)}>{index + 1 === queue.length && feedback.correct ? "Ergebnis ansehen" : "Weiter"}</button>
        </div>
      ) : !isMultipleChoice ? <button className="primary-button submit-button" disabled={!answer.trim()} onClick={() => submit()}>Antwort prüfen</button> : null}
      <span className="score-note">Bisher {score} richtig</span>
    </section>
  );
}

function ResultScreen({ score, total, aborted, onRestart, onHome }) {
  const percent = total ? Math.round((score / total) * 100) : 0;
  return (
    <section className="result-view">
      <Steps step={3} />
      <p className="eyebrow">{aborted ? "Session beendet" : "Session abgeschlossen"}</p>
      <h1>{score} von {total} richtig</h1>
      <p>{total === 0 ? "Kein Problem – du kannst jederzeit eine neue Session starten." : aborted ? "Dein bisheriger Stand wurde gespeichert. Du kannst später einfach weitermachen." : percent >= 80 ? "Das sitzt schon richtig gut." : percent >= 50 ? "Guter Anfang – eine Runde festigt die Wörter." : "Die schwierigen Wörter schauen wir uns einfach noch einmal an."}</p>
      <div className="result-number" aria-label={`${percent} Prozent`}>{percent}<span>%</span></div>
      <button className="primary-button" onClick={onRestart}>Noch einmal üben</button>
      <button className="text-button" onClick={onHome}>Andere Wörter wählen</button>
    </section>
  );
}

export function App() {
  const [customPackages, setCustomPackages] = useState(readSavedPackages);
  const [language, setLanguage] = useState(readLanguageMode);
  const packages = useMemo(() => customPackages.filter((item) => item.language === language), [customPackages, language]);
  const [selectedId, setSelectedId] = useState(() => customPackages.find((item) => item.language === readLanguageMode())?.id || "");
  const [count, setCount] = useState(10);
  const [learning, setLearning] = useState(readLearningState);
  const [view, setView] = useState(() => customPackages.length ? "start" : "import");
  const [editingPackage, setEditingPackage] = useState(null);
  const [importMessage, setImportMessage] = useState(null);
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [attempted, setAttempted] = useState(0);
  const [aborted, setAborted] = useState(false);

  useEffect(() => {
    localStorage.setItem("wortklar-packages", JSON.stringify(customPackages));
  }, []);

  useEffect(() => {
    if (!packages.some((item) => item.id === selectedId)) setSelectedId(packages[0]?.id || "");
  }, [language, packages, selectedId]);

  function changeLanguage(nextLanguage) {
    setLanguage(nextLanguage);
    localStorage.setItem("wortklar-language", nextLanguage);
    const firstPackage = customPackages.find((item) => item.language === nextLanguage);
    setSelectedId(firstPackage?.id || "");
    setImportMessage(null);
    if (view !== "import") setView("start");
  }

  function startSession() {
    const current = packages.find((item) => item.id === selectedId) || packages[0];
    if (!current) {
      setView("import");
      return;
    }
    const ranked = current.words
      .map((word) => ({ ...word, language: current.language, packageId: current.id, isRepeat: false, progress: wordProgress(learning, current.id, word) }))
      .sort((a, b) => learningPriority(b.progress) - learningPriority(a.progress))
      .map(({ progress, ...word }) => word);
    setQueue(count === "all" ? ranked : ranked.slice(0, Math.min(count, ranked.length)));
    setIndex(0);
    setScore(0);
    setAttempted(0);
    setAborted(false);
    setView("practice");
  }

  function updateWordProgress(item, correct) {
    const key = wordKey(item.packageId, item);
    const previous = wordProgress(learning, item.packageId, item);
    const reachesNextLevel = correct && previous.streak + 1 >= 2;
    const level = correct
      ? Math.min(4, previous.level + (reachesNextLevel ? 1 : 0))
      : Math.max(0, previous.level - 1);
    const next = {
      attempts: previous.attempts + 1,
      correct: previous.correct + (correct ? 1 : 0),
      streak: correct ? (reachesNextLevel ? 0 : previous.streak + 1) : 0,
      level,
      lastSeen: Date.now(),
      nextDue: correct ? Date.now() + LEVELS[level].wait : Date.now(),
    };
    const nextLearning = { ...learning, [key]: next };
    setLearning(nextLearning);
    localStorage.setItem("wortklar-learning", JSON.stringify(nextLearning));
  }

  function finishSession(wasAborted, finalScore = score, finalAttempted = attempted) {
    setAborted(wasAborted);
    localStorage.setItem("wortklar-last-result", JSON.stringify({ score: finalScore, total: finalAttempted, aborted: wasAborted, date: new Date().toISOString() }));
    setView("result");
  }

  function handleAnswer(correct, item) {
    updateWordProgress(item, correct);
    const finalScore = score + (correct ? 1 : 0);
    const finalAttempted = attempted + 1;
    setScore(finalScore);
    setAttempted(finalAttempted);

    let nextQueue = queue;
    if (!correct && !item.isRepeat) {
      const insertionIndex = Math.min(index + 3, queue.length);
      nextQueue = [...queue.slice(0, insertionIndex), { ...item, isRepeat: true }, ...queue.slice(insertionIndex)];
      setQueue(nextQueue);
    }

    if (index + 1 >= nextQueue.length) {
      finishSession(false, finalScore, finalAttempted);
    } else {
      setIndex((current) => current + 1);
    }
  }

  function abortSession() {
    finishSession(true);
  }

  function resetToStart() {
    setView("start");
  }

  function savePackage(item) {
    const exists = customPackages.some((candidate) => candidate.id === item.id);
    const next = exists
      ? customPackages.map((candidate) => candidate.id === item.id ? item : candidate)
      : [...customPackages, item];
    setCustomPackages(next);
    localStorage.setItem("wortklar-packages", JSON.stringify(next));
    setLanguage(item.language);
    localStorage.setItem("wortklar-language", item.language);
    setSelectedId(item.id);
    setEditingPackage(null);
    setImportMessage(null);
    setView("start");
  }

  function openEditor(item = null) {
    setEditingPackage(item);
    setView("editor");
  }

  function cancelEditor() {
    setEditingPackage(null);
    setView(customPackages.length ? "start" : "import");
  }

  function deletePackage(item) {
    if (!window.confirm(`Vokabelpaket „${item.name}“ wirklich löschen? Der zugehörige Lernstand wird ebenfalls gelöscht.`)) return;

    const nextPackages = customPackages.filter((candidate) => candidate.id !== item.id);
    const learningPrefix = `${item.id}::`;
    const nextLearning = Object.fromEntries(
      Object.entries(learning).filter(([key]) => !key.startsWith(learningPrefix)),
    );

    setCustomPackages(nextPackages);
    setLearning(nextLearning);
    localStorage.setItem("wortklar-packages", JSON.stringify(nextPackages));
    localStorage.setItem("wortklar-learning", JSON.stringify(nextLearning));

    const remainingInLanguage = nextPackages.filter((candidate) => candidate.language === language);
    if (nextPackages.length === 0) {
      setSelectedId("");
      setView("import");
    } else if (item.id === selectedId) {
      setSelectedId(remainingInLanguage[0]?.id || "");
    }
  }

  function exportPackages() {
    const payload = createPackageExport(customPackages);
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wortklar-vokabelpakete-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function importPackages(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Die Importdatei ist größer als 2 MB.");
      const imported = parsePackageImport(await file.text());
      const next = [...customPackages, ...imported];
      setCustomPackages(next);
      localStorage.setItem("wortklar-packages", JSON.stringify(next));
      setLanguage(imported[0].language);
      localStorage.setItem("wortklar-language", imported[0].language);
      setSelectedId(imported[0].id);
      setImportMessage({ text: `${imported.length} ${imported.length === 1 ? "Vokabelpaket wurde" : "Vokabelpakete wurden"} importiert.`, error: false });
      setView("start");
    } catch (error) {
      setImportMessage({ text: error.message, error: true });
      if (customPackages.length) setView("start");
    }
  }

  function clearLearning() {
    if (!window.confirm("Den gesamten Lernstand in diesem Browser wirklich löschen? Deine Vokabelpakete bleiben erhalten.")) return;
    setLearning({});
    localStorage.removeItem("wortklar-learning");
    localStorage.removeItem("wortklar-last-result");
  }

  return (
    <main className="app-shell">
      {view === "start" && <StartScreen language={language} onLanguageChange={changeLanguage} packages={packages} selectedId={selectedId} setSelectedId={setSelectedId} count={count} setCount={setCount} learning={learning} importMessage={importMessage} onStart={startSession} onPhotoImport={() => setView("import")} onManualCreate={() => openEditor()} onEdit={openEditor} onJsonImport={importPackages} onExport={exportPackages} onDelete={deletePackage} onClearLearning={clearLearning} />}
      {view === "import" && <ImportFlow language={language} onLanguageChange={changeLanguage} onCancel={resetToStart} onSave={savePackage} onManual={() => openEditor()} onImport={importPackages} importMessage={importMessage} canCancel={customPackages.length > 0} />}
      {view === "editor" && <PackageEditor key={editingPackage?.id || `new-${language}`} item={editingPackage} language={language} onSave={savePackage} onCancel={cancelEditor} />}
      {view === "practice" && queue.length > 0 && <PracticeScreen queue={queue} index={index} score={score} onAnswer={handleAnswer} onQuit={abortSession} />}
      {view === "result" && <ResultScreen score={score} total={attempted} aborted={aborted} onRestart={startSession} onHome={resetToStart} />}
    </main>
  );
}
