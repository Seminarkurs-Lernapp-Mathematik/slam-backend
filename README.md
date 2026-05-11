<div align="center">

# SLAM Backend
### Cloudflare Workers API für die SLAM Lern-App

*Ultra-leichtgewichtig. Fünf KI-Anbieter. Eine einzige Production-Dependency.*

[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Hono](https://img.shields.io/badge/Hono-Framework-E36002?logo=hono&logoColor=white)](https://hono.dev)
[![Live](https://img.shields.io/badge/Live-api.learn--smart.app-brightgreen)](https://api.learn-smart.app)

</div>

---

## Zahlen & Fakten

<table>
<tr>
<td align="center"><b>7.900</b><br><sub>Zeilen TypeScript</sub></td>
<td align="center"><b>59</b><br><sub>Git Commits</sub></td>
<td align="center"><b>40</b><br><sub>Source-Dateien</sub></td>
<td align="center"><b>13</b><br><sub>API-Endpunkte</sub></td>
<td align="center"><b>1</b><br><sub>Production-Dependency</sub></td>
</tr>
</table>

> **1 Production-Dependency** — nur Hono. Keine unnötigen Abstraktionen.  
> Deployed auf Cloudflares Edge-Netzwerk: **~30 Sekunden** von `git push` bis live.

---

## Die fünf KI-Anbieter

Jede Aufgabe im System verwendet den optimalen Anbieter — konfigurierbar in [`src/config/models.json`](./src/config/models.json):

| Aufgabe | Anbieter | Modell | Einsatz |
|:---|:---|:---|:---|
| `generateQuestions` | **Claude** | claude-sonnet-4-6 | Hochwertige Mathe-Aufgaben |
| `generateMiniApp` | **Claude** | claude-sonnet-4-6 | Interaktive HTML/JS-Apps |
| `manageLearningPlan` | **Claude** | claude-sonnet-4-6 | Langfristige Lernpläne |
| `aiAssessment` | **Claude** | claude-sonnet-4-6 | XAI-Lehrerberichte |
| `evaluateAnswer` | **Gemini** | gemini-3.2-flash | Echtzeit-Antwortbewertung |
| `customHint` | **Gemini** | gemini-3.2-flash | Gestufte Hinweise |
| `updateAutoMode` | **Gemini** | gemini-3.2-flash | Schwierigkeitsanpassung |
| `manageMemories` | **Gemini** | gemini-3.2-flash | SM-2 Spaced Repetition |
| `collaborativeCanvas` | **Gemini** | gemini-3.2-flash | Whiteboard-KI |
| `generateGeogebra` | **Mistral** | mistral-medium-3.5 | GeoGebra-Applets |
| `analyzeImage` | **Gemini** | gemini-3.1-pro | Mathematik-OCR |
| — | **OpenAI** | konfigurierbar | Fallback |
| — | **OpenRouter** | konfigurierbar | Fallback |

Fallback-Mechanismus: Bei Fehler eines Anbieters springt das System automatisch auf `gemini-3.2-flash` um.

---

## API-Endpunkte

```
POST /api/generate-questions      Batch-Generierung adaptiver Aufgaben
POST /api/evaluate-answer         KI-Bewertung einer Schülerantwort
POST /api/custom-hint             Progressiver Hinweis ohne Lösungsverrät
POST /api/generate-geogebra       GeoGebra-Applet für ein Thema
POST /api/generate-mini-app       Interaktive HTML/JS-Mini-App
POST /api/manage-learning-plan    Lernplan erstellen / aktualisieren
POST /api/manage-memories         SM-2 Spaced-Repetition-Updates
POST /api/analyze-image           Handschrift → LaTeX (OCR)
POST /api/update-auto-mode        Adaptive Schwierigkeit
POST /api/purchase                Coin-Transaktion (Shop)
GET  /api/jobs/:id                Status asynchroner Jobs
GET  /api/models                  Verfügbare KI-Modelle

GET  /teacher/analytics           XAI-Schülerauswertungen
GET  /teacher/classes             Klassen & Schülerübersicht
```

---

## Struktur

```
src/
├── index.ts              → Hono-App, Middleware, Routing
├── types.ts              → Gemeinsame TypeScript-Typen
├── callAI.ts             → Universeller AI-Client (5 Anbieter)
├── config/
│   └── models.json       → KI-Modell-Konfiguration pro Task
├── api/                  → 13 Endpunkt-Handler
└── teacher/              → Lehrer-Dashboard (inkl. Tests)
```

---

## Wer hat was gebaut?

| Autor | Commits | |
|:---|:---:|:---|
| Marco Duzevic | 57 | `███████████████████░` 97 % |
| emmilang09 | 1 | `░░░░░░░░░░░░░░░░░░░░` < 2 % |

---

## Quick Start

```bash
npm install
npm run dev          # → http://localhost:8787

npm run deploy       # → https://api.learn-smart.app  (~30s)
```

Umgebungsvariablen in Cloudflare Workers Secrets setzen:
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `MISTRAL_API_KEY`

---

## Verwandte Repos

| Repo | Beschreibung |
|:---|:---|
| **[slam-app](https://github.com/Seminarkurs-Lernapp-Mathematik/slam-app)** | Flutter App — iOS, Android, Web |
| **[Dokumentation](https://learn-smart.app)** | Projektdokumentation & Architektur |

---

<div align="center">
<sub>© 2025–2026 MVL-Gymnasium · Seminarkurs Informatik</sub>
</div>
