// Anti-AI-slop rules (see rules/anti-slop-ruleset.md). Used to constrain the proposer and to hard-filter its output.
import rules from "@/rules/anti-slop.json";

const banned = new Set<string>([...rules.never_suggest, ...rules.never_suggest_da].map((w) => w.toLowerCase()));
const bannedHeads = new Set<string>([...banned].map((w) => w.split(/\s+/)[0]));

/** True when a proposed replacement is a word or phrase LLMs overuse. */
export function isSlop(candidate: string): boolean {
  const c = candidate.toLowerCase().trim();
  if (banned.has(c)) return true;
  // single-word inflections of banned heads (delve -> delved) are also refused
  const head = c.split(/\s+/)[0];
  if (bannedHeads.has(head) && /^(delv|underscor|showcas|leverag|utiliz|elevat|foster|navigat|unlock|harness|embark|streamlin|revolutioniz|empower|dykk|navig|udforsk)/.test(head)) return true;
  return false;
}

/** Compact lists for prompts. */
export const NEVER_SUGGEST_PROMPT = rules.never_suggest.filter((w) => !w.includes(" ")).slice(0, 160).join(", ");
export const NEVER_SUGGEST_DA_PROMPT = rules.never_suggest_da.filter((w) => !w.includes(" ")).slice(0, 40).join(", ");
export const PRESERVE_PROMPT = rules.preserve.map((p: string) => `- ${p}`).join("\n");
