# Wortklar – Vokabeltrainer

Wortklar ist ein schlanker, browserbasierter Vokabeltrainer für
Englisch–Deutsch und Französisch–Deutsch. Vokabelpakete lassen sich aus Fotos
per KI/OCR erzeugen, manuell pflegen sowie als JSON exportieren und importieren.

Produktiv läuft die Anwendung unter <https://vokabeln.urs-martini.de>.

## Funktionen

- globaler Sprachmodus für Englisch oder Französisch
- mehrere getrennte Vokabelpakete pro Sprachmodus
- Foto-Upload mit KI-gestützter Erkennung über Amazon Bedrock
- Prüfansicht vor dem Speichern erkannter Vokabeln
- manuelles Erstellen, Bearbeiten, Umbenennen und Löschen von Paketen
- JSON-Export und -Import ausschließlich der Vokabelpakete
- lokaler Lernstand pro Browser
- responsive Oberfläche für Desktop und Mobilgeräte

Vokabelpakete und Lernfortschritt liegen ausschließlich im Browser. Fotos sind
nicht Bestandteil der gespeicherten Pakete oder JSON-Exporte. Für die Erkennung
werden vorbereitete Bilder verschlüsselt an den konfigurierten AWS-Dienst und
Amazon Bedrock übertragen.

## Voraussetzungen

- Node.js und npm
- für Deployments: AWS CLI v2 und ein autorisiertes AWS-Profil
- für OCR-Deployments: Amazon-Bedrock-Zugriff in der gewählten Region

## Lokale Entwicklung

```bash
npm install
cp .env.example .env.local
npm run dev
```

Die App ist anschließend unter <http://localhost:5173> erreichbar. Für lokale
OCR-Aufrufe müssen `VITE_OCR_API_URL` und `VITE_OCR_USERNAME` in der ignorierten
`.env.local` gesetzt sein. Zugangswerte gehören niemals in versionierte Dateien.

Produktionsbuild und Tests:

```bash
npm test
npm run build
npm run preview
```

Der Build erzeugt `dist/client/index.html`, `dist/server/index.js` und
`dist/.openai/hosting.json`.

## Deployment

Infrastruktur und Webapp-Code werden getrennt deployt. Produktionswerte wie
AWS-Profil, Stacknamen, Parameter-Store-Pfade, Domain und OCR-Benutzername
werden ausschließlich über die Umgebung beziehungsweise ein privates Runbook
bereitgestellt.

Infrastruktur validieren und aktualisieren:

```bash
AWS_PROFILE=<profile> \
APPLICATION_NAME=<application> \
ENVIRONMENT=<environment> \
STACK_NAME=<stack> \
CERTIFICATE_STACK_NAME=<certificate-stack> \
OCR_ORIGIN_SECRET_PARAMETER=<secure-parameter-name> \
OCR_BASIC_AUTHORIZATION_PARAMETER=<secure-parameter-name> \
npm run deploy:infra
```

Webapp bauen, in den vom Stack ausgegebenen privaten Site-Bucket laden und
CloudFront invalidieren:

```bash
AWS_PROFILE=<profile> \
STACK_NAME=<stack> \
VITE_OCR_USERNAME=<username> \
npm run deploy:code
```

Das Code-Deployment verändert keine CloudFormation-Infrastruktur. Änderungen
an der inline definierten OCR-Lambda werden über `deploy:infra` veröffentlicht.

Das konfigurierte AWS-Budget ist ein verzögerter Kosten-Backstop und kein
garantierter harter Ausgabendeckel.

## Eigene Domain und Zertifikat

CloudFront benötigt das ACM-Zertifikat in `us-east-1`. Das Setup erwartet
Domain, Validierungsdomain und einen frei gewählten Zertifikatsstack über die
Umgebung:

```bash
AWS_PROFILE=<profile> \
APPLICATION_NAME=<application> \
CUSTOM_DOMAIN_NAME=<app.example.com> \
VALIDATION_DOMAIN=<example.com> \
CERTIFICATE_STACK_NAME=<certificate-stack> \
npm run domain:setup
```

Das Skript zeigt den ACM-Validierungs-CNAME an. Dieser DNS-Eintrag muss für die
automatische Zertifikatserneuerung bestehen bleiben. Der öffentliche CNAME der
Anwendung zeigt anschließend auf den vom Anwendungsstack ausgegebenen
CloudFront-Domainnamen.

## npm-Skripte

| Skript | Zweck |
|---|---|
| `npm run dev` | Vite-Entwicklungsserver starten |
| `npm run build` | Produktionsbuild und Sites-Artefakte erzeugen |
| `npm run preview` | Produktionsbuild lokal anzeigen |
| `npm test` | alle Node-Tests ausführen |
| `npm run test:sites` | Hosting-/Sites-Tests ausführen |
| `npm run domain:setup` | ACM-Zertifikat vorbereiten oder prüfen |
| `npm run deploy:infra` | CloudFormation-Infrastruktur aktualisieren |
| `npm run deploy:code` | Webapp-Code veröffentlichen |

## Sicherheitsmodell

- Der Site-Bucket und der temporäre OCR-Bucket blockieren öffentlichen Zugriff.
- CloudFront liest die Webapp per Origin Access Control.
- Der OCR-Pfad wird am CloudFront-Viewer und zusätzlich zwischen CloudFront und
  Lambda geschützt.
- Geheimnisse werden zur Deployment-Zeit aus der Umgebung oder aus
  AWS Systems Manager Parameter Store geladen.
- API-Drosselung und AWS Budgets reduzieren Missbrauchs- und Kostenrisiken.

Die konkrete Ressourceninventur und Zugangskonfiguration gehören nicht in das
öffentliche Repository.

## Datenhaltung im Browser

| Schlüssel | Inhalt |
|---|---|
| `wortklar-packages` | Vokabelpakete beider Sprachmodi |
| `wortklar-language` | zuletzt gewählter Sprachmodus |
| `wortklar-learning` | Lernfortschritt je Wortpaar |
| `wortklar-last-result` | Ergebnis der letzten Session |
| `wortklar-ocr-password` | OCR-Passwort im `sessionStorage` |

Das Exportformat enthält ausschließlich Paketname, Sprachmodus und Wortpaare.
Fotos, Zugangsdaten und Lernstand werden nicht exportiert.

## Projektstruktur

```text
src/                             Oberfläche und Lernlogik
infra/                           CloudFormation und Deployment-Skripte
tests/                           Paket-, Vokabel- und Hosting-Tests
worker/                          statischer Sites-Worker
scripts/prepare-sites-build.mjs  Sites-Buildvorbereitung
```
