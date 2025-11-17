# 🧠 AI Assistant Instructions for CLI Development

This document defines the coding conventions, architecture, and task-processing guidelines for developing with this CLI-based SvelteKit application.

---

## 🚀 Quick Reference

- **Stack:** TypeScript, SvelteKit, Tailwind CSS, shadcn-svelte, Bun, Hono, ESLint
- **Naming Conventions:**
  - Files/folders: `kebab-case`
  - Variables/functions: `camelCase`
  - Types/interfaces: `PascalCase`
  - Constants: `UPPER_SNAKE_CASE`
- **Logging:** Use the `logger` utility (`src/lib/utils/logger.ts`), not `console.log`.
- **Component Structure:** One component per folder in `lib/components/`, organized by feature.
- **Helpers/Types:** Must be in `utils/` and `types/`, not in component folders.
- **Import Aliases:** Use `$lib`, `$types`, etc. for root imports.

---

## ⚙️ MCP Tools for AI Coding

- **ai-context7**: Connect to this MCP server to retrieve the latest CLI syntax, command usage patterns, and best practices. If `ai-context7` is unavailable, refer to official documentation for the libraries in use.
- **ai-fetch**: Test APIs, endpoints, and HTTP responses.
- **ai-puppeteer**: Use for interactive scraping, site testing, or browser automation.
- **ai-taskmaster**: Parses user requests into structured tasks.

---

## 🧠 UltraThink Mode

For complex tasks (e.g., implementing a new feature, major refactoring, or changes touching multiple systems like `auth`, `db`, and `ui`), activate **UltraThink Mode**.

**To activate, use a trigger phrase like: "Make me the task for..."**

### 🧩 UltraThink Workflow (Powered by `ai-taskmaster`)

1.  **Planning Phase**: `ai-taskmaster` parses the request and generates a master plan in `/ai-docs/task/master-task-plan.md`.
2.  **Validation Phase**: The plan is cross-checked against `ai-context7` (or official docs) to ensure it uses the latest, most accurate information.
3.  **Subtask Breakdown**: Validated subtasks are created in `/ai-docs/task/sub-tasks/`. Each subtask file includes a `description`, `steps`, `status`, and `test strategy`.
4.  **Execution Phase**: Subtasks are executed sequentially or in parallel, with user approval required at each step.

> 🧑‍💻 For simple tasks (e.g., a single component change), skip UltraThink and follow the standard coding flow.

---

## 🧱 File & Folder Structure

The project structure should adapt to its scope.

### Monorepo (Frontend + Backend)

For projects with both a frontend and a backend, use a monorepo structure with an `apps/` directory. This keeps concerns separate and organized.

#### Frontend (`apps/frontend/src/`)

```txt
src/
├── lib/
│   ├── components/
│   │   ├── chat/
│   │   │   ├── message-bubble.svelte
│   │   │   ├── message-input.svelte
│   │   │   └── index.ts              ✅ Barrel export
│   │   ├── profile/
│   │   │   └── user-profile.svelte   ❌ Single file — no index.ts
│   ├── stores/
│   ├── utils/
│   ├── types/
│   │   └── index.type.ts             ✅ Barrel export
│   └── config/
└── routes/
```

#### Backend (`apps/backend/src/`)

```txt
src/
├── lib/
│   ├── auth/
│   ├── api/
│   ├── services/
│   ├── db/
│   ├── types/
│   └── utils/
```

### Standalone Frontend

For frontend-only projects, place the `src` directory at the root. This is simpler and avoids unnecessary nesting. The internal structure of `src/` would be the same as the `apps/frontend/src/` example above.

```txt
/
├── src/
│   ├── lib/
│   └── routes/
└── package.json
```

---

## 🧩 Component & Barrel Export Rules

- **Components**: Place each component in its own folder: `lib/components/feature-name/`.
- **Barrel Exports (`index.ts`)**: Use when a folder contains **2 or more** logically grouped files. Do **not** use for single-file folders or `routes/`.

---

## 🎨 Styling & Theming

- **Styling**: Use **Tailwind CSS only**. Use the `cn()` utility from `utils/cn.ts` for conditional classes.
- **UI Components**: Base all UI on `shadcn-svelte` components from `$ui` do the alias for `components\ui` to use `$ui`.

---

## 🧪 TypeScript, Linting & Testing

- **TypeScript**: Use `strict` mode. Avoid `any`. Centralize types in `src/lib/types/`.
- **Testing**: Use **Vitest**. Co-locate tests in `__tests__/` folders or as `*.test.ts` files.

---

# 🗂️ Git Workflow & Commit Guidelines

## 🗒️ Commit Messages

- **Format:** Follow [Conventional Commits](https://www.conventionalcommits.org) style.
- **Structure:**
  - `type(scope): short, descriptive subject line` (max \~72 chars)
  - Optional body (1–3 lines) for additional context.
- **Restrictions:** Do **not** use `$()`, `<()>`, or `>()` in commit messages.

**Example:**

```txt
feat(auth): add user login functionality

Implements secure user authentication.
Includes password hashing and session management.
```

### Commit Types Reference

- \`\` A new feature.
- \`\` A bug fix.
- \`\` Changes to code style (white-space, formatting, missing semi-colons, etc.).
- \`\` Code change that neither fixes a bug nor adds a feature.
- \`\` Code change that improves performance.
- \`\` Testing purposes.
- \`\` Reverts a previous commit.

---

## 🌿 Branch Naming & Workflow

💡 **Branch Naming Rules:**

- `master` – Production-ready code. Each commit represents a new release.
- `develop` – Latest development changes for the next release.
- `feature` – Develop new features for upcoming or distant releases. Created from `develop`, merged back into `develop` when complete.
- `release` – Prepares a new production release. Created from `develop` for last-minute fixes and updates. Merged into both `master` and `develop` when finished.
- `hotfix` – Quickly fixes critical bugs in production. Created from `master`, merged into `master` and `develop` (or current release branch) when done.

> **Note:**
>
> - **Permanent branches:** `master`, `develop`, `feature`
> - **Temporary branches:** `release`, `hotfix` (deleted after merging)

---

## 📌 Summary

- Always use **Conventional Commits** format for clarity and automation compatibility.
- Keep commit messages **concise, descriptive, and consistent**.
- Follow branching rules to maintain a clean, predictable Git history.
- Use temporary branches only when necessary and delete them after merging.

## 📊 Logger Utility

The `logger` provides structured, level-based logging. It must be created at `src/lib/utils/logger.ts`.

**Implementation:**

```typescript
// src/lib/utils/logger.ts
import pino, { multistream } from 'pino';
import pretty from 'pino-pretty';

const LOG_FILE_PATH = 'logs/logger.jsonl';

/**
 * Returns a custom timestamp string in GMT+7 (Asia/Ho_Chi_Minh) timezone.
 * Format: dd/mm/yy HH:MM:ss
 */
function gmt7Time(): string {
	const [time, date] = new Date()
		.toLocaleString('vi-VN', {
			timeZone: 'Asia/Ho_Chi_Minh',
			day: '2-digit',
			month: '2-digit',
			year: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		})
		.split(' ');
	return `,"time":"${date} ${time}"`;
}

/**
 * Pretty console output stream (colorized, human-readable).
 */
const consoleStream = pretty({
	colorize: true,
	translateTime: false
});

/**
 * File output stream (JSON Lines format, one log per line).
 * The directory will be created automatically if it does not exist.
 */
const fileStream = pino.destination({
	dest: LOG_FILE_PATH,
	mkdir: true
});

/**
 * Central application logger.
 *
 * Features:
 * - Logs to both pretty console and JSONL file.
 * - Timestamps in GMT+7, dd/mm/yy HH:MM:ss.
 * - Log level names (e.g., "info") instead of numeric values.
 * - No `pid` or `hostname` in log output.
 *
 * Log levels (in increasing verbosity):
 *   fatal → error → warn → info → debug → trace
 *
 * @example
 * logger.info('Server started');
 * logger.warn({ duration: 5000 }, 'Slow query');
 * logger.error({ err }, 'Unhandled exception');
 *
 * // Create a feature-specific logger
 * const authLog = logger.child({ module: 'auth' });
 * authLog.info({ userId }, 'User logged in');
 */
export const logger = pino(
	{
		level: 'debug',
		base: {}, // remove pid and hostname from output
		timestamp: gmt7Time,
		formatters: {
			// Show string level ("info") instead of number (30)
			level: (label) => ({ level: label })
		}
	},
	multistream([
		{ stream: consoleStream, level: 'debug' },
		{ stream: fileStream, level: 'debug' }
	])
);
```

---

## ✅ Final Checklist

Before marking a task as complete, ensure the following:

1.  **Lint & Type Checks Pass**: must past lint and type checks without errors.
2.  **No TypeScript Errors**: Code is type-safe.
3.  **Valid Imports**: All imports are resolved, preferably using the prefix `$` alias e.g `$lib, $types`.
4.  **Correct Barrel Exports**: `index.ts` files are used according to the rules.
5.  **Logger Used**: No `console.log` statements remain; use the `logger` instead.
6.  **Code Quality**: Code is reusable (DRY), focused (SRP), and follows project conventions.
7.  **Correct Naming**: All files, folders, variables, and types follow the naming conventions.
8.  **Tests Written**: Logic and critical UI components are covered by tests.

---

## ✅ Task Completion Format

When a task is finished, use this format:

```txt
✅ Task completed successfully!
📁 Files created/modified:
  - apps/frontend/src/lib/components/user-profile/
    ├── user-profile.svelte
    └── index.ts
```
