# GrimoireFace

English | [简体中文](./README.zh-CN.md)

An interview practice assistant built with Vue 3 and Vite. GrimoireFace helps you prepare for technical interviews through structured question banks, mock interviews, algorithm practice, and AI-powered tools — all running locally in your browser with offline support via PWA.

> This project is derived from [iFace](https://github.com/Dogxi/iFace) by [Dogxi](https://github.com/Dogxi). Thank you for the open-source foundation.

## Features

- **Question Bank** — Browse, search, and manage interview questions across multiple categories (Frontend, Go, Java, Networking, System Design, etc.)
- **Practice Mode** — Study questions with spaced-repetition tracking and progress stats
- **Mock Interview** — Simulate real interview sessions with timers and AI feedback
- **Weak Points** — Identify and review topics where you need more practice
- **JD Match** — Analyze job descriptions against your skill profile
- **AI Tools** — Integrated AI assistant for coding help and explanations
- **Algorithm Practice** — Track algorithm problems, submissions, and notes
- **Import & Manage** — Import question banks from JSON and manage your data locally
- **PWA Support** — Install as a desktop/mobile app with offline caching

## Screenshots

| Homepage | Question Bank | Practice Mode |
| :------: | :-----------: | :-----------: |
| ![Homepage](asset/homepage.png) | ![Question Bank](asset/warehouse.png) | ![Practice Mode](asset/practice.png) |

| Algorithm | Manage Data | Settings | Dark Mode |
| :-------: | :---------: | :------: | :-------: |
| ![Algorithm](asset/algorithm.png) | ![Manage](asset/manage.png) | ![Settings](asset/setting.png) | ![Dark Mode](asset/dark.png) |

## Tech Stack

- [Vue 3](https://vuejs.org/) — Progressive JavaScript framework
- [Vite](https://vitejs.dev/) — Next-generation frontend tooling
- [TypeScript](https://www.typescriptlang.org/) — Typed JavaScript
- [Tailwind CSS v4](https://tailwindcss.com/) — Utility-first CSS framework
- [Pinia](https://pinia.vuejs.org/) — State management
- [Vue Router](https://router.vuejs.org/) — Client-side routing
- [idb](https://github.com/jakearchibald/idb) — IndexedDB wrapper for local data storage
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) — PWA capabilities

## Prerequisites

Before your first run, make sure you have the following installed:

- **Node.js** ≥ 18 (recommended: latest LTS)
- **npm** ≥ 9 (comes with Node.js)

> Alternatively, you can use [Bun](https://bun.sh/) as a drop-in replacement for npm.

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/lokidundun/GrimoireFace.git
cd GrimoireFace
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the development server

```bash
npm run dev
```

The app will be available at `http://localhost:5173/`.

### 4. Build for production

```bash
npm run build
```

The output will be in the `dist/` directory.

### 5. Preview production build

```bash
npm run preview
```

## Project Structure

```
GrimoireFace/
├── public/              # Static assets
├── src/
│   ├── components/      # Reusable Vue components
│   ├── composables/     # Vue composition functions
│   ├── data/            # Static data and seed files
│   ├── lib/             # Core utilities (db, AI client, etc.)
│   ├── pages/           # Route-level page components
│   ├── router/          # Vue Router configuration
│   ├── stores/          # Pinia stores
│   ├── types/           # TypeScript type definitions
│   ├── App.vue          # Root component
│   └── main.ts          # Entry point
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── LICENSE
```

## Data Storage

All your data is stored **locally** in the browser using IndexedDB. No server or cloud account is required. You can:

- Import question banks from JSON files
- Export your progress and notes
- Clear all data from the browser's storage at any time

## Acknowledgements

This project is inspired by and derived from [iFace](https://github.com/Dogxi/iFace) by [Dogxi](https://github.com/Dogxi), licensed under the MIT License.

## License

This project is licensed under the [MIT License](./LICENSE).
