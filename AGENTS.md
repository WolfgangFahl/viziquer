# AGENTS.md — ViziQuer Development Guide

ViziQuer is a visual SPARQL query builder built on **Meteor.js** (full-stack JS framework),
MongoDB, jQuery, and Blaze templates. All application code lives under `app/`.

---

## Project Structure

```
viziquer/
├── app/                        # Meteor application (all source code)
│   ├── client/                 # Legacy client entry (CSS, templates, JS)
│   ├── server/platform/main.js # Server entry point
│   ├── tests/main.js           # Mocha test suite
│   ├── imports/                # Meteor lazy-loaded modules (main source)
│   │   ├── db/                 # Mongo collection definitions
│   │   ├── libs/               # Shared utility functions
│   │   ├── platform/           # Core platform (client & server)
│   │   │   ├── client/js/      # Client-side JS (editor, interpretator, utilities)
│   │   │   └── server/         # Server methods and publications
│   │   └── custom/
│   │       ├── vq/             # ViziQuer-specific SPARQL logic
│   │       └── owlgred/        # OWLGrEd diagram tool module
│   ├── eslint.config.mjs       # ESLint flat config (v9)
│   ├── biome.json              # Biome linter/formatter config
│   └── package.json            # Scripts and dependencies
└── doc/                        # Demo assets and documentation
```

---

## Build / Run / Test Commands

All commands must be run from the `app/` directory.

```bash
# Install dependencies (use ci for reproducible installs)
meteor npm ci

# Run in development mode (port 3000)
meteor run
# or with Node inspector on port 3333
npm run dev

# Run unit tests (once, non-interactive)
npm test
# Equivalent: meteor test --once --driver-package meteortesting:mocha

# Run full-app integration tests (with file watching)
npm run test-app
# Equivalent: TEST_WATCH=1 meteor test --full-app --driver-package meteortesting:mocha

# Run a single test by grep pattern (Mocha --grep)
meteor test --once --driver-package meteortesting:mocha --grep "pattern matching test name"

# Lint with ESLint (primary enforced linter)
npm run lint
# Equivalent: eslint .

# Lint/format with Biome (not in npm scripts; run manually)
npx biome lint .
npx biome check .
npx biome format . --write
```

---

## Language and Framework

- **JavaScript only** — no TypeScript, no JSX. All source files are `.js`.
- **`@types/*` packages** are installed for IDE type hinting only (JSDoc-style awareness).
- **Meteor conventions** are central to the architecture:
  - Server logic: `Meteor.methods({ ... })`, `Meteor.publish(...)`
  - Client subscriptions: `Meteor.subscribe(...)`
  - DB operations: use async variants — `findOneAsync`, `insertAsync`, `updateAsync`
  - Global reactive state: `Session`, `ReactiveVar`
  - Routing: `FlowRouter` (`meteor/ostrio:flow-router-extra`)
  - Roles/permissions: `Roles` (`meteor/roles`)
- **Node version:** v22 (see `.nvmrc`).

---

## Code Style

### Formatting
- **Indentation:** 2 spaces (no tabs).
- **Line length:** 120 characters max for JS files.
- **Quotes:** single quotes preferred (Biome enforces this). Double quotes appear in legacy platform files — prefer single quotes in new code.
- **Semicolons:** include them.
- **Trailing whitespace:** none; files must end with a newline.
- **Line endings:** LF.

### Imports
- Use **absolute `/imports/...` paths** in entry point files (e.g., `server/platform/main.js`).
- Use **relative paths with `.js` extension** within module files:
  ```js
  import { Diagrams } from '../../db/platform/collections.js';
  import { is_not_empty } from '../../libs/platform/lib.js';
  ```
- **Meteor package imports** use the `meteor/` prefix:
  ```js
  import { Meteor } from 'meteor/meteor';
  import { Mongo } from 'meteor/mongo';
  import { Roles } from 'meteor/roles';
  ```
- **Import ordering** (conventional, not enforced):
  1. Meteor package imports (`meteor/*`)
  2. Shared library/utility imports
  3. Database collection imports
  4. Third-party npm imports
  5. Side-effect imports (HTML templates, CSS)

### Naming Conventions
| Entity | Convention | Example |
|---|---|---|
| Server utility functions | `snake_case` | `is_not_empty`, `get_current_time`, `no_rights_to_access_msg` |
| Meteor methods | `camelCase` | `executeSparql`, `insertDiagram`, `importConfiguration` |
| Client functions/methods | `camelCase` | `isAdmin`, `resetQuery`, `getProjectGroups` |
| Module-level objects | `PascalCase` | `Utilities`, `Dialog`, `Interpreter` |
| Mongo collections | `PascalCase` noun | `Diagrams`, `Projects`, `CompartmentTypes` |
| True constants | `SCREAMING_SNAKE_CASE` | `TIMEOUT_TEST`, `SPARQL_PAGE_SIZE`, `DEFAULT_PROFILE_NAME` |
| Source files (server) | `snake_case.js` | `execute_sparql.js`, `user_rights.js`, `_helpers.js` |
| Source files (client classes) | `PascalCase.js` | `Dialog.js`, `NewElement.js`, `VQ_Element.js` |
| Source files (client modules) | `camelCase.js` | `genAbstractQuery.js`, `autoCompletion.js` |

### Types and Documentation
- Use **JSDoc block comments** for complex or public-facing functions:
  ```js
  /**
   * Executes a SPARQL query against the given endpoint.
   * @param {string} query - The SPARQL query string.
   * @param {Object} options - Request options.
   * @returns {Promise<{status: number, result?: any, error?: string}>}
   */
  ```
- No TypeScript; avoid `@ts-check` directives unless specifically needed.

---

## Error Handling

- **Meteor methods** return status objects rather than throwing:
  ```js
  return { status: 200, result: data };
  return { status: 500, error: 'The query is empty' };
  return { status: 401 };
  ```
- **Use `try/catch`** for async operations; log with `console.error` and return a status object:
  ```js
  try {
    const resp = await fetch(req);
    if (!resp.ok) return { status: 500, error: await resp.text() };
    return { status: 200, result: await resp.json() };
  } catch (err) {
    console.error('fetch failed:', err);
    return { status: 504, error: 'bad response: ' + err.message };
  }
  ```
- **Guard clauses** for permission and validation checks:
  ```js
  if (!await is_project_member(user_id, project)) return null;
  if (!options?.params?.query) return { status: 500, error: 'Query is empty' };
  ```
- **Wrap Meteor callback APIs** in Promises using async/await:
  ```js
  const result = await new Promise((resolve, reject) => {
    Meteor.call('methodName', arg, (err, res) => {
      if (err) return reject(err);
      return resolve(res);
    });
  });
  ```
- **No floating promises** — always `await` or `.catch()` async calls. ESLint
  (`nfp/no-floating-promise`) and Biome warn on unhandled promises.
- **No custom error classes** — use plain `Error` objects when throwing:
  ```js
  throw new Error('No SELECT in the query');
  ```
- **Log with `console.log` / `console.error`** — no structured logger exists.

---

## Testing

- **Framework:** Mocha (via `meteortesting:mocha`) + Node's built-in `assert`.
- **Test files** live in `app/tests/`. The main file is `tests/main.js`.
- **Pattern:** `describe` / `it` blocks; use `assert.strictEqual`, `assert.ok`, etc.
- Use `Meteor.isClient` / `Meteor.isServer` guards for environment-specific tests:
  ```js
  import assert from 'assert';

  describe('my feature', function () {
    it('does something', async function () {
      const result = await someFunction();
      assert.strictEqual(result.status, 200);
    });

    if (Meteor.isServer) {
      it('server-only behavior', function () {
        assert.ok(true);
      });
    }
  });
  ```
- **Run a single test:** use `--grep` to match by test name (see commands above).
- Tests are currently minimal (smoke tests only). New features should include basic
  happy-path and error-path tests.

---

## ESLint Rules Summary

Key deviations from `eslint:recommended` (see `app/eslint.config.mjs`):
- `no-unused-vars`: **off** — unused variables are tolerated.
- `no-empty`: **off** — empty catch blocks are tolerated.
- `require-await`: **warn** — async functions without await should be flagged.
- `nfp/no-floating-promise`: **warn** — unhandled promises should be flagged.
- Globals declared: `Meteor`, `Session`, `$`, `_`, `Konva`, `YASQE`, `BlazeLayout`, `TAPi18n`, and all browser/node/meteor globals.
- **Auto-generated files are excluded** from linting: PEG.js parsers (`*_parser.js`), `layoutEngine.js` variants, `libs/3rdparty/`.

---

## Key Patterns to Follow

1. **Server methods** must check user authentication and project membership before performing any data access. Use helpers from `imports/platform/server/_global_functions.js`.
2. **Async DB operations** — always use the `Async` variants: `Collection.findOneAsync()`, `Collection.insertAsync()`, `Collection.updateAsync()`, `Collection.removeAsync()`.
3. **Client-server communication** goes through `Meteor.call` / `Meteor.methods`. Avoid direct DB access from the client.
4. **Publications** expose only the minimum fields needed; use field projections.
5. **PEG.js parser files** (`*_parser.js`) are auto-generated — edit the `.pegjs` grammar instead and regenerate.
6. **Inline comments** in the codebase may appear in Latvian (the core team is based in Latvia) — this is expected.
