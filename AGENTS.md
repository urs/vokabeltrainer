# Repository guidance

## Entwicklung

- Installiere Abhängigkeiten mit `npm install`.
- Starte die lokale Anwendung mit `npm run dev`.
- Prüfe Änderungen mit `npm test` und `npm run build`.
- Anwendungslogik und UI liegen in `src/`, Infrastruktur in `infra/`.
- Halte `.openai/hosting.json`, `worker/index.js`,
  `scripts/prepare-sites-build.mjs` und die Sites-Tests funktionsfähig.

## Produktprinzipien

- Der Ablauf bleibt linear: Session starten, üben, Ergebnis ansehen.
- Es gibt keine Konten, Dashboards, Streaks, Abzeichen oder Ranglisten.
- Englisch und Französisch sind globale Sprachmodi; jedes Paket gehört genau
  zu einer Sprache.
- Paketverwaltung, Fotoimport, manuelle Pflege und JSON-Transfer bleiben im
  Startablauf.
- Exporte enthalten nur Paketname, Sprache und Wortpaare, niemals Fotos oder
  Lernfortschritt.
- Desktop und Mobilgeräte nutzen denselben responsiven Ablauf.

## Sicherheit und Veröffentlichung

- Keine Passwörter, Zugangsdaten, privaten Endpunkte, physischen
  Cloud-Ressourcenkennungen oder absoluten lokalen Pfade committen.
- Lokale Konfiguration gehört in ignorierte `.env.*`-Dateien; private
  Betriebsinformationen in `OPERATIONS.local.md`.
- Beispielwerte in öffentlichen Dateien müssen generisch und nicht produktiv
  sein.
- Fotos aus Lernmaterialien dürfen nicht eingecheckt werden.
- Infrastruktur- und Code-Deployment bleiben getrennte Befehle.
