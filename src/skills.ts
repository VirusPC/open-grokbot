/**
 * The Agents Vite plugin resolves `agents:skills` to a `skills` directory
 * next to the importing file, and `agents:skills/<path>` relative to that
 * same directory. This file lives in `src/`, so `../skills` is the repo-root
 * `skills/` folder (one child directory per skill, each with SKILL.md).
 *
 * The `agents:skills/*` module type ships with `agents` (pulled in by
 * `import { callable } from "agents"`).
 */
import bundledSkills from "agents:skills/../skills";

export const labSkills = bundledSkills;
