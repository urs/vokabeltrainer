export function removePronunciation(value) {
  return String(value || "")
    .replace(/\s*\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
