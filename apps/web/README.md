# Lazuli Web Frontend

A beautiful cryptocurrency trading interface built with React, Vite, and Tailwind CSS.

## Getting Started

First, install the dependencies:

```bash
bun install
```

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) with your browser to see the result.

## Available Scripts

- `bun run dev` - Start development server with hot reload
- `bun run build` - Build for production
- `bun run preview` - Preview production build locally
- `bun run lint` - Run ESLint
- `bun run type-check` - Run TypeScript type checking
- `bun run clean` - Clean build artifacts

## Tech Stack

- **Runtime**: [Bun](https://bun.sh) - Fast JavaScript runtime
- **Build Tool**: [Vite](https://vitejs.dev) - Next generation frontend tooling
- **Framework**: [React](https://react.dev) - UI library
- **Routing**: [React Router](https://reactrouter.com) - Client-side routing
- **Styling**: [Tailwind CSS](https://tailwindcss.com) - Utility-first CSS
- **Charts**: [Lightweight Charts](https://tradingview.github.io/lightweight-charts/) - Financial charts
- **Animation**: [Framer Motion](https://www.framer.com/motion/) - Animation library

## Project Structure

```
src/
├── components/    # Reusable UI components
├── pages/         # Page components
├── lib/           # Utilities and API client
├── hooks/         # Custom React hooks
├── styles/        # Global styles
└── assets/        # Static assets
```

## Environment Variables

Create a `.env` file in the root of the web app:

```
VITE_API_URL=http://localhost:3000
```
